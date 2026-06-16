import {
  getMode,
  type EngineEventBody,
  type Effort,
  type Message,
  type ModeId,
  type PermissionCategory,
  type ProviderInfo,
  type ToolCall,
  type TodoItem,
  type TodoStatus,
} from "@friday/shared"
import { getProviderKey } from "@friday/providers"
import {
  ASK_USER,
  SKILL_TOOL,
  TASK_TOOL,
  TODO_WRITE,
  LSP_HOVER,
  LSP_DEFINITION,
  LSP_SYMBOLS,
  LSP_TOOLS,
  toToolDef,
  type Tool,
  type ToolResult,
} from "@friday/tools"
import { LspManager, formatDiagnostics } from "@friday/lsp"
import { subagentPrompt, systemPrompt } from "./prompt.ts"
import type { SessionStore } from "./sessions.ts"
import { loadProjectContext, type ProjectContext } from "./context.ts"
import { expandMentions } from "./mentions.ts"
import { loadCommands, type CustomCommand } from "./commands.ts"
import { loadSkills, type Skill } from "./skills.ts"
import { applyFiles, readOrNull, snapshotFile, type Checkpoint } from "./checkpoints.ts"
import { COMPACTION, estimateTokens, renderTranscript, safeCutIndex } from "./compaction.ts"
import type { StreamFn } from "./stream.ts"
import path from "node:path"

const now = () => Date.now()
const MAX_STEPS = 50

type Pending = { resolve: (d: "allow" | "deny") => void; category: PermissionCategory }

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s || "{}")
  } catch {
    return {}
  }
}

function summarizeCall(tc: ToolCall): string {
  const args = safeParse(tc.arguments) as Record<string, unknown>
  if (typeof args.command === "string") return args.command
  if (typeof args.path === "string") return String(args.path)
  return tc.arguments.slice(0, 120)
}

export interface SessionStats {
  messages: number
  tokens: number
  durationMs: number
}

/** Shared, manager-owned services a runner needs. */
export interface RunnerHost {
  streamFn: StreamFn
  store: SessionStore
  /** current tool registry (reflects MCP connect/disconnect) */
  registry: () => { list: Tool[]; defs: ReturnType<typeof toToolDef>[]; get(name: string): Tool | undefined }
  /** shared model/mode selection */
  selection: () => { providerId?: string; model?: string; reasoning: boolean; effort: Effort; mode: ModeId; contextWindow: number }
  resolveProvider: () => ProviderInfo
  /** globally-unique id source (so permission/ask requestIds don't collide across sessions) */
  nextId: () => string
  /** emit a body tagged with this runner's session id */
  emit: (sessionId: string, body: EngineEventBody) => void
}

/**
 * Owns one session's mutable state and runs its agent loop. Multiple runners
 * execute concurrently; the manager (Engine) routes commands and multiplexes events.
 */
export class SessionRunner {
  readonly sessionId: string
  private title: string
  private roots: string[]
  private cwd: string
  private messages: Message[]
  private seq: number
  private startedAt = now()
  private totalTokens = 0

  private context: ProjectContext
  private skills: Skill[]
  private lsp: LspManager
  /** files with outstanding diagnostics, for the Files panel */
  private diag = new Map<string, { errors: number; warnings: number }>()

  private abort?: AbortController
  busy = false
  /** set while a permission/ask card is awaiting the user for this session */
  needsInput = false
  private pending = new Map<string, Pending>()
  private pendingAsk = new Map<string, (answer: string) => void>()
  private sessionAllow = new Set<PermissionCategory>()

  private checkpoints: Checkpoint[] = []
  private currentCheckpoint?: Checkpoint
  private redoState?: { files: Map<string, string | null>; messages: Message[] }

  private todos: TodoItem[] = []
  private compaction?: { summary: string; throughIndex: number }

  constructor(
    private host: RunnerHost,
    row: { id: string; title: string; roots: string[] },
    fallbackCwd: string,
  ) {
    this.sessionId = row.id
    this.title = row.title
    this.roots = row.roots.length ? row.roots : [fallbackCwd]
    this.cwd = this.roots[0]!
    this.messages = host.store.loadMessages(row.id)
    this.seq = this.messages.length
    this.context = loadProjectContext(this.roots)
    this.skills = loadSkills(this.roots)
    this.lsp = new LspManager(this.cwd)
  }

  private emit(body: EngineEventBody): void {
    this.host.emit(this.sessionId, body)
  }

  // ---- public accessors (used by the manager / UI) ----
  currentTitle(): string {
    return this.title
  }
  currentCwd(): string {
    return this.cwd
  }
  currentRoots(): string[] {
    return this.roots
  }
  contextInfo(): { files: string[] } {
    return { files: this.context.files }
  }
  listSkills(): { name: string; description: string }[] {
    return this.skills.map((s) => ({ name: s.name, description: s.description }))
  }
  listCommands(): CustomCommand[] {
    return loadCommands(this.roots)
  }
  stats(): SessionStats {
    const messages = this.messages.filter((m) => m.role === "user" || m.role === "assistant").length
    return { messages, tokens: this.totalTokens, durationMs: now() - this.startedAt }
  }
  listCheckpoints(): { id: string; label: string; createdAt: number; files: number }[] {
    return this.checkpoints.map((c) => ({ id: c.id, label: c.label, createdAt: c.createdAt, files: c.files.size })).reverse()
  }
  hasRedo(): boolean {
    return !!this.redoState
  }

  /** Emit this session's full current state (on focus / resume). */
  emitState(includeMessages: boolean): void {
    this.emit({ type: "session-changed", sessionId: this.sessionId, title: this.title, cwd: this.cwd, roots: this.roots })
    if (includeMessages)
      this.emit({ type: "session-loaded", sessionId: this.sessionId, title: this.title, cwd: this.cwd, roots: this.roots, messages: this.messages })
    this.emit({ type: "todos", items: this.todos })
  }

  addRoot(dir: string): void {
    if (this.roots.includes(dir)) return
    this.roots = this.host.store.addRoot(this.sessionId, dir, now())
    this.context = loadProjectContext(this.roots)
    this.skills = loadSkills(this.roots)
    this.emit({ type: "session-changed", sessionId: this.sessionId, title: this.title, cwd: this.cwd, roots: this.roots })
  }

  // ---- command handling ----
  abortRun(): void {
    this.abort?.abort()
  }
  dispose(): void {
    this.abort?.abort()
    this.lsp.dispose()
  }
  handlePermissionReply(requestId: string, decision: "allow-once" | "allow-always" | "deny"): boolean {
    const p = this.pending.get(requestId)
    if (!p) return false
    this.pending.delete(requestId)
    if (decision === "allow-always") this.sessionAllow.add(p.category)
    this.needsInput = this.pending.size > 0 || this.pendingAsk.size > 0
    p.resolve(decision === "deny" ? "deny" : "allow")
    return true
  }
  handleAskReply(requestId: string, answer: string): boolean {
    const r = this.pendingAsk.get(requestId)
    if (!r) return false
    this.pendingAsk.delete(requestId)
    this.needsInput = this.pending.size > 0 || this.pendingAsk.size > 0
    r(answer)
    return true
  }

  private addMessage(msg: Message): void {
    this.messages.push(msg)
    this.host.store.appendMessage(this.sessionId, this.seq++, msg)
    this.host.store.touch(this.sessionId, now())
  }

  private setTitleFromPrompt(typed: string): void {
    if (this.title && this.title !== "new session") return
    const cleaned = typed.replace(/@\S+/g, "").replace(/`+/g, "").replace(/\s+/g, " ").trim()
    if (!cleaned) return
    let title = cleaned.slice(0, 48).replace(/[.,;:!?]+$/, "")
    title = title.charAt(0).toUpperCase() + title.slice(1)
    this.title = title
    this.host.store.rename(this.sessionId, title, now())
    this.emit({ type: "session-changed", sessionId: this.sessionId, title, cwd: this.cwd, roots: this.roots })
  }

  // ---- checkpoints / undo ----
  restoreCheckpoint(id: string): void {
    if (this.busy) return
    const idx = this.checkpoints.findIndex((c) => c.id === id)
    if (idx < 0) return
    const cp = this.checkpoints[idx]!
    const tail = this.checkpoints.slice(idx)

    const redoFiles = new Map<string, string | null>()
    for (const c of tail) for (const p of c.files.keys()) if (!redoFiles.has(p)) redoFiles.set(p, readOrNull(p))
    this.redoState = { files: redoFiles, messages: [...this.messages] }

    const restore = new Map<string, string | null>()
    for (const c of tail) for (const [p, prior] of c.files) if (!restore.has(p)) restore.set(p, prior)
    applyFiles(restore)

    this.messages = this.messages.slice(0, cp.messageSeq)
    this.seq = cp.messageSeq
    this.host.store.truncateMessages(this.sessionId, cp.messageSeq)
    this.checkpoints = this.checkpoints.slice(0, idx)
    this.currentCheckpoint = undefined

    this.emit({ type: "status", text: `rewound to “${cp.label}”` })
    this.emit({ type: "session-loaded", sessionId: this.sessionId, title: this.title, cwd: this.cwd, roots: this.roots, messages: this.messages })
  }

  redoLast(): void {
    if (this.busy || !this.redoState) return
    applyFiles(this.redoState.files)
    this.messages = [...this.redoState.messages]
    this.seq = this.messages.length
    this.host.store.truncateMessages(this.sessionId, 0)
    this.messages.forEach((m, i) => this.host.store.appendMessage(this.sessionId, i, m))
    this.redoState = undefined
    this.emit({ type: "status", text: "redone" })
    this.emit({ type: "session-loaded", sessionId: this.sessionId, title: this.title, cwd: this.cwd, roots: this.roots, messages: this.messages })
  }

  // ---- the agentic loop ----
  async runPrompt(text: string): Promise<void> {
    if (this.busy) return
    const sel = this.host.selection()
    if (!sel.model || !sel.providerId) {
      this.emit({ type: "error", message: "No model selected — open /model to connect one." })
      return
    }
    this.busy = true
    this.abort = new AbortController()
    this.currentCheckpoint = {
      id: this.host.nextId(),
      label: text.replace(/\s+/g, " ").trim().slice(0, 60) || "turn",
      createdAt: now(),
      messageSeq: this.messages.length,
      files: new Map(),
    }
    this.checkpoints.push(this.currentCheckpoint)
    this.redoState = undefined
    const { text: expanded, files } = expandMentions(text, this.roots)
    this.addMessage({ role: "user", text: await this.augmentSymbols(text, expanded, files) })
    this.setTitleFromPrompt(text)
    const start = now()
    try {
      await this.loop(start)
    } catch (e: any) {
      if (this.abort.signal.aborted) this.emit({ type: "status", text: "stopped" })
      else {
        this.emit({ type: "error", message: e?.message ?? String(e) })
        this.emit({ type: "mascot", state: "error" })
      }
    } finally {
      this.busy = false
      this.abort = undefined
      this.emit({ type: "mascot", state: "idle" })
      this.emit({ type: "status", text: "ready" })
    }
  }

  private async collectTurn(
    gen: AsyncGenerator<import("@friday/shared").ProviderEvent>,
    signal: AbortSignal,
    on: { text?: (d: string) => void; reasoning?: (d: string) => void; usage?: (input: number, output: number) => void },
  ): Promise<{ text: string; reasoning: string; reasoningSignature: string; toolCalls: ToolCall[] }> {
    let text = ""
    let reasoning = ""
    let reasoningSignature = ""
    const calls = new Map<number, { id: string; name: string; args: string }>()
    for await (const ev of gen) {
      if (signal.aborted) break
      switch (ev.type) {
        case "text":
          text += ev.delta
          on.text?.(ev.delta)
          break
        case "reasoning":
          reasoning += ev.delta
          on.reasoning?.(ev.delta)
          break
        case "reasoning_signature":
          reasoningSignature += ev.signature
          break
        case "tool_start": {
          const c = calls.get(ev.index) ?? { id: "", name: "", args: "" }
          if (ev.id) c.id = ev.id
          if (ev.name) c.name = ev.name
          calls.set(ev.index, c)
          break
        }
        case "tool_delta": {
          const c = calls.get(ev.index) ?? { id: "", name: "", args: "" }
          c.args += ev.argsDelta
          calls.set(ev.index, c)
          break
        }
        case "usage":
          on.usage?.(ev.input, ev.output)
          break
      }
    }
    const toolCalls: ToolCall[] = [...calls.values()]
      .filter((c) => c.name)
      .map((c) => ({ id: c.id || this.host.nextId(), name: c.name, arguments: c.args || "{}" }))
    return { text, reasoning, reasoningSignature, toolCalls }
  }

  // ---- compaction ----
  private sendMessages(): Message[] {
    if (!this.compaction) return this.messages
    const summaryMsg: Message = {
      role: "user",
      text: `<conversation_summary>\nEarlier conversation, condensed for context:\n${this.compaction.summary}\n</conversation_summary>`,
    }
    return [summaryMsg, ...this.messages.slice(this.compaction.throughIndex)]
  }

  private async maybeCompact(provider: ProviderInfo, apiKey: string | undefined, signal: AbortSignal, force: boolean): Promise<void> {
    const window = this.host.selection().contextWindow || COMPACTION.defaultWindow
    if (!force && estimateTokens(this.sendMessages()) < Math.floor(window * COMPACTION.threshold)) return
    const floor = this.compaction?.throughIndex ?? 0
    const cut = safeCutIndex(this.messages, this.messages.length - COMPACTION.keepRecent, floor)
    if (cut <= floor) return
    const before = estimateTokens(this.messages.slice(0, cut))
    this.emit({ type: "status", text: "compacting context…" })
    const summary = await this.summarize(provider, apiKey, signal, this.messages.slice(0, cut), this.compaction?.summary)
    if (!summary) return
    this.compaction = { summary, throughIndex: cut }
    this.emit({
      type: "compaction",
      turnsCompacted: cut - floor,
      kept: this.messages.length - cut,
      tokensBefore: before,
      tokensAfter: estimateTokens(this.sendMessages()),
    })
  }

  private async summarize(provider: ProviderInfo, apiKey: string | undefined, signal: AbortSignal, msgs: Message[], prior?: string): Promise<string> {
    const instruction = [
      prior ? `An earlier summary exists; extend it without repeating:\n${prior}\n` : "",
      "Summarize the conversation below for continuity. Preserve the user's goals, key decisions, file paths created or edited, important findings, and any unfinished tasks. Use terse bullet points. Output only the summary.",
      "",
      "Conversation:",
      renderTranscript(msgs),
    ]
      .filter(Boolean)
      .join("\n")
    const req = {
      model: this.host.selection().model!,
      messages: [
        { role: "system", text: "You compress coding-session transcripts into concise, faithful summaries." } as Message,
        { role: "user", text: instruction } as Message,
      ],
      tools: [],
      maxTokens: 1024,
    }
    let text = ""
    try {
      for await (const ev of this.host.streamFn(provider, apiKey, req, signal)) {
        if (signal.aborted) break
        if (ev.type === "text") text += ev.delta
      }
    } catch {
      return prior ?? ""
    }
    return text.trim() || prior || ""
  }

  async forceCompact(): Promise<void> {
    const sel = this.host.selection()
    if (!sel.model || !sel.providerId) return this.emit({ type: "error", message: "Select a model first (/model)." })
    if (this.busy) return this.emit({ type: "status", text: "busy — compaction runs automatically" })
    if (this.messages.length <= COMPACTION.keepRecent) return this.emit({ type: "status", text: "nothing to compact yet" })
    const provider = this.host.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    this.emit({ type: "mascot", state: "working" })
    await this.maybeCompact(provider, apiKey, new AbortController().signal, true)
    this.emit({ type: "mascot", state: "idle" })
    this.emit({ type: "status", text: "ready" })
  }

  private async loop(start: number): Promise<void> {
    const sel = this.host.selection()
    const provider = this.host.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    const registry = this.host.registry()
    const signal = this.abort!.signal
    let inTok = 0
    let outTok = 0

    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) return
      const id = this.host.nextId()
      this.emit({ type: "message-start", role: "assistant", id })
      this.emit({ type: "mascot", state: "thinking" })
      this.emit({ type: "status", text: "thinking…", elapsedMs: now() - start })

      await this.maybeCompact(provider, apiKey, signal, false)

      const req = {
        model: sel.model!,
        messages: [
          {
            role: "system",
            text: systemPrompt({
              cwd: this.cwd,
              roots: this.roots,
              mode: sel.mode,
              context: this.context.content,
              skills: this.skills.map((s) => ({ name: s.name, description: s.description, whenToUse: s.whenToUse })),
            }),
          } as Message,
          ...this.sendMessages(),
        ],
        tools: registry.defs,
        effort: sel.reasoning ? sel.effort : undefined,
        maxTokens: 8192,
      }

      let streamedText = false
      const { text, reasoning, reasoningSignature, toolCalls } = await this.collectTurn(this.host.streamFn(provider, apiKey, req, signal), signal, {
        text: (d) => {
          if (!streamedText) {
            streamedText = true
            this.emit({ type: "mascot", state: "streaming" })
          }
          this.emit({ type: "text", id, delta: d })
        },
        reasoning: (d) => this.emit({ type: "reasoning", id, delta: d }),
        usage: (i, o) => {
          inTok += i
          outTok += o
          this.totalTokens += i + o
          this.emit({ type: "usage", input: inTok, output: outTok })
          this.emit({ type: "status", text: "thinking…", elapsedMs: now() - start, tokens: inTok + outTok })
        },
      })
      if (signal.aborted) return

      this.addMessage({
        role: "assistant",
        text: text || undefined,
        reasoning: reasoning || undefined,
        reasoningSignature: reasoningSignature || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      })

      if (!toolCalls.length) {
        this.emit({ type: "turn-done", id })
        return
      }

      for (const tc of toolCalls) {
        if (signal.aborted) return

        if (tc.name === TODO_WRITE) {
          const a = safeParse(tc.arguments) as { todos?: { text?: string; status?: TodoStatus }[] }
          this.todos = (a.todos ?? [])
            .filter((t) => t.text)
            .map((t, i) => ({ id: `t${i}`, text: t.text!, status: (t.status ?? "pending") as TodoStatus }))
          this.emit({ type: "todos", items: this.todos })
          const rendered = this.todos.length
            ? this.todos.map((t) => `${t.status === "done" ? "[x]" : t.status === "active" ? "[~]" : "[ ]"} ${t.text}`).join("\n")
            : "(list cleared)"
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: `Todos updated:\n${rendered}` })
          continue
        }

        this.emit({ type: "tool-call", id, callId: tc.id, name: tc.name, input: safeParse(tc.arguments) })
        this.emit({ type: "mascot", state: "working" })
        this.emit({ type: "status", text: `running ${tc.name}…`, elapsedMs: now() - start })

        if (tc.name === SKILL_TOOL) {
          const a = safeParse(tc.arguments) as { name?: string }
          const skill = this.skills.find((s) => s.name === a.name)
          const output = skill ? skill.content : `Unknown skill: ${a.name}. Available: ${this.skills.map((s) => s.name).join(", ") || "(none)"}`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output, isError: !skill })
          this.emit({ type: "tool-result", callId: tc.id, ok: !!skill, output, title: `skill ${a.name ?? ""}` })
          continue
        }

        if (tc.name === TASK_TOOL) {
          const a = safeParse(tc.arguments) as { description?: string; prompt?: string; agent?: string }
          this.emit({ type: "mascot", state: "working" })
          this.emit({ type: "status", text: `subagent: ${a.description ?? "task"}…` })
          const summary = await this.runSubagent(a.prompt ?? "", a.agent)
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: summary })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output: summary, title: `task: ${a.description ?? "subagent"}` })
          continue
        }

        if (tc.name === ASK_USER) {
          const a = safeParse(tc.arguments) as { question?: string; options?: unknown }
          const requestId = this.host.nextId()
          this.emit({
            type: "ask-user",
            requestId,
            question: a.question ?? "",
            options: Array.isArray(a.options) ? (a.options as string[]) : undefined,
          })
          this.emit({ type: "mascot", state: "idle" })
          this.emit({ type: "status", text: "waiting for you…" })
          this.needsInput = true
          const answer = await new Promise<string>((resolve) => this.pendingAsk.set(requestId, resolve))
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: answer })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output: answer })
          continue
        }

        if (LSP_TOOLS.has(tc.name)) {
          const output = await this.runLspTool(tc.name, safeParse(tc.arguments))
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output, title: tc.name })
          continue
        }

        const tool = registry.get(tc.name)
        if (!tool) {
          const msg = `Unknown tool: ${tc.name}`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: msg, isError: true })
          this.emit({ type: "tool-result", callId: tc.id, ok: false, output: msg })
          continue
        }

        const decision = await this.checkPermission(tool, tc, sel.mode)
        if (decision === "deny") {
          const msg = `User denied permission to run ${tool.name}.`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: msg, isError: true })
          this.emit({ type: "tool-result", callId: tc.id, ok: false, output: msg })
          continue
        }

        if (tool.permission === "edit" && this.currentCheckpoint) {
          const a = safeParse(tc.arguments) as { path?: string }
          if (typeof a.path === "string") snapshotFile(this.currentCheckpoint, path.resolve(this.cwd, a.path))
        }

        const args = safeParse(tc.arguments)
        let result: ToolResult
        try {
          result = await tool.execute(args, { cwd: this.cwd, roots: this.roots, signal })
        } catch (e: any) {
          result = { output: `Error: ${e?.message ?? e}`, isError: true }
        }

        // Ground edits in real compiler output: feed back LSP diagnostics for the changed file.
        if (tool.permission === "edit" && !result.isError && typeof (args as any)?.path === "string") {
          const diag = await this.diagnoseEdited(path.resolve(this.cwd, (args as any).path))
          if (diag) result = { ...result, output: result.output + diag }
        }

        this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: result.output, isError: result.isError })
        this.emit({ type: "tool-result", callId: tc.id, ok: !result.isError, output: result.output, title: result.title, diff: result.diff })
      }
    }
  }

  private async runSubagent(prompt: string, agent?: string): Promise<string> {
    const sel = this.host.selection()
    const provider = this.host.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    const signal = this.abort!.signal
    const tools = this.host
      .registry()
      .list.filter(
        (t) => t.permission === "read" && t.name !== SKILL_TOOL && t.name !== TASK_TOOL && t.name !== ASK_USER && t.name !== TODO_WRITE && !LSP_TOOLS.has(t.name),
      )
    const defs = tools.map(toToolDef)
    const get = (n: string) => tools.find((t) => t.name === n)
    const messages: Message[] = [
      { role: "system", text: subagentPrompt(agent, this.cwd) },
      { role: "user", text: prompt },
    ]
    let lastText = ""

    for (let step = 0; step < 15; step++) {
      if (signal.aborted) break
      const { text, reasoning, reasoningSignature, toolCalls } = await this.collectTurn(
        this.host.streamFn(provider, apiKey, { model: sel.model!, messages, tools: defs, effort: sel.reasoning ? sel.effort : undefined, maxTokens: 4096 }, signal),
        signal,
        { usage: (i, o) => (this.totalTokens += i + o) },
      )
      messages.push({
        role: "assistant",
        text: text || undefined,
        reasoning: reasoning || undefined,
        reasoningSignature: reasoningSignature || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      })
      if (text) lastText = text
      if (!toolCalls.length) return lastText || "(no result)"

      for (const tc of toolCalls) {
        const tool = get(tc.name)
        let result: ToolResult
        if (!tool) result = { output: `Unknown or disallowed tool for a sub-agent: ${tc.name}`, isError: true }
        else {
          try {
            result = await tool.execute(safeParse(tc.arguments), { cwd: this.cwd, roots: this.roots, signal })
          } catch (e: any) {
            result = { output: `Error: ${e?.message ?? e}`, isError: true }
          }
        }
        messages.push({ role: "tool", callId: tc.id, name: tc.name, result: result.output, isError: result.isError })
      }
    }
    return lastText || "(subagent reached its step limit)"
  }

  // ---- LSP grounding ----
  private rel(p: string): string {
    const r = path.relative(this.cwd, p)
    return r && !r.startsWith("..") ? r : p
  }

  /** Resolve bare `@Symbol` mentions (no slash/dot) to workspace symbol locations. */
  private async augmentSymbols(original: string, expanded: string, files: string[]): Promise<string> {
    const tokens = [...original.matchAll(/(?:^|\s)@([A-Za-z_][A-Za-z0-9_]+)(?![/.])/g)]
      .map((m) => m[1]!)
      .filter((t) => !files.includes(t))
    const uniq = [...new Set(tokens)].slice(0, 3)
    if (!uniq.length) return expanded
    const blocks: string[] = []
    for (const t of uniq) {
      const hits = await this.lsp.workspaceSymbols(t).catch(() => [])
      if (hits.length) blocks.push(`<symbol name="${t}">\n${hits.map((h) => `${h.name} — ${this.rel(h.path)}:${h.line}`).join("\n")}\n</symbol>`)
    }
    return blocks.length ? `${expanded}\n\n${blocks.join("\n\n")}` : expanded
  }

  private async diagnoseEdited(file: string): Promise<string> {
    try {
      const diags = await this.lsp.diagnose(file)
      const errors = diags.filter((d) => d.severity === 1).length
      const warnings = diags.filter((d) => d.severity === 2).length
      if (errors || warnings) this.diag.set(file, { errors, warnings })
      else this.diag.delete(file)
      this.emit({
        type: "diagnostics",
        items: [...this.diag.entries()].map(([p, v]) => ({ path: this.rel(p), errors: v.errors, warnings: v.warnings })),
      })
      return formatDiagnostics(file, diags)
    } catch {
      return ""
    }
  }

  private async runLspTool(name: string, args: unknown): Promise<string> {
    const a = args as { path?: string; line?: number; character?: number; query?: string }
    const file = a.path ? path.resolve(this.cwd, a.path) : undefined
    if (name === LSP_HOVER) {
      if (!file) return "lsp_hover needs a path."
      return (await this.lsp.hover(file, (a.line ?? 1) - 1, (a.character ?? 1) - 1)) ?? "No hover info (no language server, or nothing there)."
    }
    if (name === LSP_DEFINITION) {
      if (!file) return "lsp_definition needs a path."
      const defs = await this.lsp.definition(file, (a.line ?? 1) - 1, (a.character ?? 1) - 1)
      return defs.length ? defs.map((d) => this.rel(d)).join("\n") : "No definition found (or no language server)."
    }
    if (name === LSP_SYMBOLS) {
      if (a.query) {
        const syms = await this.lsp.workspaceSymbols(a.query, file ?? "x.ts")
        return syms.length ? syms.map((s) => `${s.name} — ${this.rel(s.path)}:${s.line}`).join("\n") : "No matching symbols (or no language server)."
      }
      if (file) {
        const syms = await this.lsp.documentSymbols(file)
        return syms.length ? syms.join("\n") : "No symbols (or no language server)."
      }
      return "lsp_symbols needs `query` or `path`."
    }
    return "Unknown LSP tool."
  }

  private async checkPermission(tool: Tool, tc: ToolCall, mode: ModeId): Promise<"allow" | "deny"> {
    const cat = tool.permission
    if (cat === "read") return "allow"
    if (this.sessionAllow.has(cat)) return "allow"
    const verdict = getMode(mode).policy[cat]
    if (verdict === "allow") return "allow"
    if (verdict === "deny") return "deny"

    const requestId = this.host.nextId()
    this.emit({ type: "permission-request", requestId, tool: tool.name, summary: `Allow ${tool.name}?`, detail: summarizeCall(tc) })
    this.emit({ type: "mascot", state: "idle" })
    this.emit({ type: "status", text: "waiting for you…" })
    this.needsInput = true
    return new Promise<"allow" | "deny">((resolve) => this.pending.set(requestId, { resolve, category: cat }))
  }
}
