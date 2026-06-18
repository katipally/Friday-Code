import {
  getMode,
  type AskOption,
  type AskQuestion,
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
  EXIT_PLAN,
  SKILL_TOOL,
  TASK_TOOL,
  TODO_WRITE,
  LSP_HOVER,
  LSP_DEFINITION,
  LSP_SYMBOLS,
  LSP_TOOLS,
  toToolDef,
  unifiedDiff,
  diffStats,
  type Tool,
  type ToolResult,
} from "@friday/tools"
import { LspManager, formatDiagnostics } from "@friday/lsp"
import { runHooks, type HookEvent, type HookPayload, type HooksConfig } from "./hooks.ts"
import { gitStatus, gitDiff, gitCommitAll } from "./git.ts"
import { bashRisk, matchesList } from "./safety.ts"
import { subagentPrompt, customAgentPrompt, systemPrompt } from "./prompt.ts"
import type { SessionStore } from "./sessions.ts"
import { loadProjectContext, type ProjectContext } from "./context.ts"
import { expandMentions, collectImages } from "./mentions.ts"
import { loadCommands, type CustomCommand } from "./commands.ts"
import { loadSkills, type Skill } from "./skills.ts"
import { loadAgents, type AgentDef } from "./agents.ts"
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

/** Like safeParse but reports failure, so a tool whose streamed args were truncated/corrupt is
 * rejected (fed back as an error) instead of silently executing with `{}` (e.g. edit with no path). */
function tryParseArgs(s: string): { ok: true; value: unknown } | { ok: false } {
  const t = (s ?? "").trim()
  if (!t) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(t) }
  } catch {
    return { ok: false }
  }
}

/** Clamp a model-supplied todo status to the rendered enum (tolerate common aliases). */
function normTodoStatus(s?: string): TodoStatus {
  if (s === "pending" || s === "active" || s === "done") return s
  if (s === "in_progress" || s === "in-progress" || s === "running") return "active"
  if (s === "completed" || s === "complete" || s === "finished") return "done"
  return "pending"
}

/** Cap on accumulated streamed tool-call arguments — guards against a pathological provider OOM. */
const MAX_TOOL_ARGS = 1_000_000

/**
 * Safety net for when the model writes choices into the question text instead of the `options`
 * array (a common slip). Pulls out an inline `Options: [...]` / `Options: a, b, c` or a trailing
 * bulleted/numbered list so the UI can still render them as real selectable options.
 */
export function extractInlineOptions(raw: string): { question: string; options?: string[] } {
  const inline = raw.match(/\bOptions?\s*:\s*(.+?)\s*$/im)
  if (inline) {
    const body = inline[1]!.trim()
    const bracket = body.match(/^\[(.*)\]$/s)
    const opts = (bracket ? bracket[1]! : body)
      .split(/\s*,\s*/)
      .map((s) => s.replace(/^['"]|['"]$/g, "").trim())
      .filter(Boolean)
    if (opts.length >= 2) return { question: raw.slice(0, inline.index).trim() || "Pick one:", options: opts }
  }
  const lines = raw.split("\n")
  const isBullet = (l: string) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l)
  const start = lines.findIndex(isBullet)
  if (start >= 0) {
    const opts = lines
      .slice(start)
      .filter(isBullet)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    if (opts.length >= 2) return { question: lines.slice(0, start).join("\n").trim() || "Pick one:", options: opts }
  }
  return { question: raw }
}

/** Normalize a model-supplied option (a bare string or a { label, description } object) to an AskOption. */
function toAskOption(o: unknown): AskOption | null {
  if (typeof o === "string") return o.trim() ? { label: o.trim() } : null
  if (o && typeof o === "object") {
    const label = (o as any).label
    if (typeof label === "string" && label.trim()) {
      const description = (o as any).description
      const preview = (o as any).preview
      return {
        label: label.trim(),
        description: typeof description === "string" && description.trim() ? description.trim() : undefined,
        preview: typeof preview === "string" && preview.trim() ? preview.replace(/\s+$/, "") : undefined,
      }
    }
  }
  return null
}

/**
 * Build one AskQuestion, preferring explicit `options[]` (strings or { label, description } objects)
 * but falling back to extracting choices the model wrote inline in the question text.
 */
function toAskQuestion(id: string, question: string, explicit: unknown, multi = false, header?: string, art?: string): AskQuestion {
  const hdr = typeof header === "string" && header.trim() ? header.trim() : undefined
  const banner = typeof art === "string" && art.trim() ? art.replace(/\s+$/, "") : undefined
  if (Array.isArray(explicit) && explicit.length) {
    const options = explicit.map(toAskOption).filter((o): o is AskOption => o !== null)
    if (options.length) return { id, question, header: hdr, art: banner, options, multi }
  }
  const parsed = extractInlineOptions(question)
  return { id, question: parsed.question, header: hdr, art: banner, options: parsed.options?.map((label) => ({ label })), multi }
}

/** Render ask_user answers back to the model: a single answer verbatim, or labeled Q/A pairs. */
function formatAskAnswers(questions: AskQuestion[], answers: Record<string, string>): string {
  if (questions.length === 1) return answers[questions[0]!.id] ?? "(no answer)"
  return questions.map((q) => `Q: ${q.question}\nA: ${answers[q.id] ?? "(no answer)"}`).join("\n\n")
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
  selection: () => {
    providerId?: string
    model?: string
    reasoning: boolean
    effort: Effort
    mode: ModeId
    contextWindow: number
    cost?: { input: number; output: number }
  }
  resolveProvider: () => ProviderInfo
  /** globally-unique id source (so permission/ask requestIds don't collide across sessions) */
  nextId: () => string
  /** emit a body tagged with this runner's session id */
  emit: (sessionId: string, body: EngineEventBody) => void
  /** lifecycle hooks config */
  hooks: () => HooksConfig | undefined
  /** bash allow/deny lists */
  bashPolicy: () => { allow?: string[]; deny?: string[] } | undefined
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
  /** input tokens the provider reported for the most recent request — the real size of the current
   * context, used to drive auto-compaction (more accurate than the char estimate). */
  private lastInputTokens = 0

  private context: ProjectContext
  private skills: Skill[]
  private agents: AgentDef[]
  private lsp: LspManager
  /** files with outstanding diagnostics, for the Files panel */
  private diag = new Map<string, { errors: number; warnings: number }>()

  private abort?: AbortController
  busy = false
  /** id of the assistant message currently streaming — so we can always finalize it (even on abort/error). */
  private activeAssistantId?: string
  /** set when the model explicitly presented a plan via exit_plan this turn — suppresses the fallback heuristic. */
  private planEmitted = false
  /** set while a permission/ask card is awaiting the user for this session */
  needsInput = false
  private pending = new Map<string, Pending>()
  private pendingAsk = new Map<string, (answers: Record<string, string>) => void>()
  private sessionAllow = new Set<PermissionCategory>()

  private checkpoints: Checkpoint[] = []
  private currentCheckpoint?: Checkpoint
  private redoState?: { files: Map<string, string | null>; messages: Message[] }

  private todos: TodoItem[] = []
  private compaction?: { summary: string; throughIndex: number }
  /** Abort controller for an in-flight compaction summarize call — lets the user STOP it. */
  private compactionAbort?: AbortController
  /** Snapshot of the compaction state from before the last compaction, so it can be UNDONE.
   * (Compaction never drops messages — it only changes what sendMessages() prepends/slices — so
   * reverting this field fully restores the pre-compaction context.) */
  private preCompaction?: { compaction?: { summary: string; throughIndex: number } }

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
    this.agents = loadAgents(this.roots)
    this.lsp = new LspManager(this.cwd)
    void this.hook("SessionStart")
  }

  private emit(body: EngineEventBody): void {
    this.host.emit(this.sessionId, body)
  }

  private hook(event: HookEvent, extra: Partial<HookPayload> = {}, matchKey?: string) {
    return runHooks(event, this.host.hooks(), { event, session_id: this.sessionId, cwd: this.cwd, ...extra }, matchKey)
  }

  /**
   * Files this session has modified, derived from its own checkpoint snapshots
   * (not git) — so the panel reflects exactly what THIS session touched.
   */
  private emitSessionFiles(): void {
    const prior = new Map<string, string | null>() // path -> content before this session first touched it
    for (const cp of this.checkpoints) for (const [abs, before] of cp.files) if (!prior.has(abs)) prior.set(abs, before)
    const items: { path: string; status: string; added: number; removed: number }[] = []
    for (const [abs, before] of prior) {
      const cur = readOrNull(abs)
      if (before === cur) continue // touched but reverted to original — no net change
      const status = before === null ? "A" : cur === null ? "D" : "M"
      const { added, removed } = diffStats(unifiedDiff(before ?? "", cur ?? ""))
      items.push({ path: path.relative(this.cwd, abs) || abs, status, added, removed })
    }
    items.sort((a, b) => a.path.localeCompare(b.path))
    this.emit({ type: "session-files", items })
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
  /** A session with no messages yet — a throwaway "new session" placeholder, safe to discard. */
  isEmpty(): boolean {
    return this.messages.length === 0
  }
  /** A copy of this session's messages (for forking a branch). */
  snapshotMessages(): Message[] {
    return [...this.messages]
  }
  /** The user turns in this conversation, with their message index — the fork/timeline points. */
  forkPoints(): { index: number; text: string }[] {
    const out: { index: number; text: string }[] = []
    this.messages.forEach((m, index) => {
      if (m.role === "user") out.push({ index, text: (m.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80) })
    })
    return out
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
    this.emitSessionFiles()
  }

  addRoot(dir: string): void {
    if (this.roots.includes(dir)) return
    this.roots = this.host.store.addRoot(this.sessionId, dir, now())
    this.context = loadProjectContext(this.roots)
    this.skills = loadSkills(this.roots)
    this.agents = loadAgents(this.roots)
    this.emit({ type: "session-changed", sessionId: this.sessionId, title: this.title, cwd: this.cwd, roots: this.roots })
  }

  // ---- command handling ----
  abortRun(): void {
    this.abort?.abort()
    this.settleInputWaiters()
  }
  dispose(): void {
    this.abort?.abort()
    this.settleInputWaiters()
    this.lsp.dispose()
  }
  /** Release any in-flight permission/ask awaits (deny / no-answer) so the agent loop unwinds on
   * abort instead of hanging forever on a promise the user will never answer. */
  private settleInputWaiters(): void {
    if (this.pending.size === 0 && this.pendingAsk.size === 0) return
    for (const p of this.pending.values()) p.resolve("deny")
    this.pending.clear()
    for (const r of this.pendingAsk.values()) r({})
    this.pendingAsk.clear()
    this.needsInput = false
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
  handleAskReply(requestId: string, answers: Record<string, string>): boolean {
    const r = this.pendingAsk.get(requestId)
    if (!r) return false
    this.pendingAsk.delete(requestId)
    this.needsInput = this.pending.size > 0 || this.pendingAsk.size > 0
    r(answers)
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
    // Drop any compaction summary — its throughIndex points into the now-truncated history and
    // would otherwise make sendMessages() prepend a stale summary / slice the wrong range.
    this.compaction = undefined

    this.emit({ type: "status", text: `rewound to “${cp.label}”` })
    this.emit({ type: "session-loaded", sessionId: this.sessionId, title: this.title, cwd: this.cwd, roots: this.roots, messages: this.messages })
  }

  redoLast(): void {
    if (this.busy || !this.redoState) return
    applyFiles(this.redoState.files)
    this.messages = [...this.redoState.messages]
    this.seq = this.messages.length
    this.compaction = undefined // rebuilt history — a stale summary index would corrupt context
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
    // Acknowledge the submit instantly so the UI never feels dead between Enter and first token.
    this.emit({ type: "mascot", state: "thinking" })
    this.emit({ type: "status", text: "sent…" })

    // UserPromptSubmit hook may block the prompt or inject extra context.
    const pre = await this.hook("UserPromptSubmit", { prompt: text })
    if (pre.block) {
      this.emit({ type: "error", message: pre.reason ?? "Prompt blocked by a hook." })
      this.emit({ type: "mascot", state: "idle" })
      this.emit({ type: "status", text: "ready" })
      return
    }

    this.busy = true
    this.planEmitted = false
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
    let promptText = await this.augmentSymbols(text, expanded, files)
    if (pre.context) promptText += `\n\n<hook_context>\n${pre.context}\n</hook_context>`
    const images = collectImages(text, this.roots)
    this.addMessage({ role: "user", text: promptText, images: images.length ? images : undefined })
    this.setTitleFromPrompt(text)
    const start = now()
    try {
      await this.loop(start)
    } catch (e: any) {
      if (!this.abort.signal.aborted) this.emit({ type: "error", message: e?.message ?? String(e) })
    } finally {
      const aborted = this.abort?.signal.aborted ?? false
      this.busy = false
      this.abort = undefined
      // Always finalize the in-flight assistant item so the UI clears `busy` (stops the timer)
      // and marks the bubble done — turn-done is the ONLY event the UI uses for this, and the
      // normal path may not have emitted it (abort / error / step-limit).
      if (this.activeAssistantId) {
        this.emit({ type: "turn-done", id: this.activeAssistantId })
        this.activeAssistantId = undefined
      }
      void this.hook("Stop")
      this.emitSessionFiles()
      // Fallback: if the model finished a plan-mode turn WITHOUT calling exit_plan, still surface
      // something so the gate isn't lost — the plan is the last assistant message produced this turn.
      // The deterministic path (exit_plan) is preferred; this only runs when it wasn't used.
      if (!aborted && !this.planEmitted && this.host.selection().mode === "plan") {
        const last = [...this.messages].reverse().find((m) => m.role === "assistant" && !!m.text)
        if (last && last.role === "assistant" && last.text && last.text.trim().length > 12) {
          this.emit({ type: "plan-ready", plan: last.text })
        }
      }
      this.emit({ type: "mascot", state: "idle" })
      this.emit({ type: "status", text: aborted ? "stopped" : "ready" })
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
          if (c.args.length + ev.argsDelta.length > MAX_TOOL_ARGS) throw new Error("tool arguments exceeded the size limit")
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
    // Trigger off the real input-token count of the last request (most accurate proxy for the
    // current context size); fall back to the char estimate before the first usage arrives.
    const limit = Math.min(Math.floor(window * COMPACTION.threshold), window - COMPACTION.buffer)
    const used = this.lastInputTokens > 0 ? this.lastInputTokens : estimateTokens(this.sendMessages())
    if (!force && used < limit) return
    const floor = this.compaction?.throughIndex ?? 0
    const cut = safeCutIndex(this.messages, this.messages.length - COMPACTION.keepRecent, floor)
    if (cut <= floor) return
    const pct = (n: number) => Math.min(100, Math.round((n / window) * 100))
    void this.hook("PreCompact")

    // A dedicated controller so the user can STOP this compaction; the enclosing run's signal
    // (loop abort) also cancels it.
    this.compactionAbort = new AbortController()
    if (signal.aborted) return this.compactionAbort.abort()
    signal.addEventListener("abort", () => this.compactionAbort?.abort(), { once: true })

    this.emit({ type: "compaction-start", tokensBefore: used, pctBefore: pct(used), window })
    this.emit({ type: "status", text: "compacting context…" })
    const summary = await this.summarize(provider, apiKey, this.compactionAbort.signal, this.messages.slice(0, cut), this.compaction?.summary)
    if (this.compactionAbort.signal.aborted || !summary) {
      this.compactionAbort = undefined
      this.emit({ type: "compaction-aborted" })
      return
    }
    this.compactionAbort = undefined

    // Snapshot the prior state so this compaction can be undone (history itself is untouched).
    this.preCompaction = { compaction: this.compaction }
    this.compaction = { summary, throughIndex: cut }
    const after = estimateTokens(this.sendMessages())
    this.emit({
      type: "compaction",
      turnsCompacted: cut - floor,
      kept: this.messages.length - cut,
      tokensBefore: used,
      tokensAfter: after,
      summary,
      pctAfter: pct(after),
    })
  }

  /** Stop an in-flight compaction (the summarize call); history is left untouched. */
  stopCompaction(): void {
    this.compactionAbort?.abort()
  }

  /** Undo the most recent compaction: revert to the pre-compaction summary state (full history was
   * never dropped, so reverting the summary index restores the complete context). */
  undoCompaction(): void {
    if (this.busy) return this.emit({ type: "status", text: "can't undo while running" })
    if (!this.preCompaction) return this.emit({ type: "status", text: "nothing to undo" })
    this.compaction = this.preCompaction.compaction
    this.preCompaction = undefined
    this.emit({ type: "notice", text: "↺ compaction undone — full history restored" })
    this.emit({ type: "status", text: "ready" })
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
      this.activeAssistantId = id
      this.emit({ type: "message-start", role: "assistant", id, mode: sel.mode })
      this.emit({ type: "mascot", state: "thinking" })
      this.emit({ type: "status", text: "connecting…", elapsedMs: now() - start })

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
              agents: this.agents.map((a) => ({ name: a.name, description: a.description })),
            }),
          } as Message,
          ...this.sendMessages(),
        ],
        // Plan mode is STRICTLY read-only: only non-mutating tools (read/network/control + exit_plan)
        // are offered, so the agent can investigate and propose but can NEVER edit files or run bash —
        // it physically can't act, it can only plan. Every other mode hides exit_plan so the model can't
        // "present a plan" mid-execution.
        tools:
          sel.mode === "plan"
            ? registry.defs.filter((d) => {
                const t = registry.get(d.name)
                return !t || (t.permission !== "edit" && t.permission !== "bash")
              })
            : registry.defs.filter((d) => d.name !== EXIT_PLAN),
        effort: sel.reasoning ? sel.effort : undefined,
        maxTokens: 8192,
      }

      let streamedText = false
      let streamedReasoning = false
      const { text, reasoning, reasoningSignature, toolCalls } = await this.collectTurn(this.host.streamFn(provider, apiKey, req, signal), signal, {
        text: (d) => {
          if (!streamedText) {
            streamedText = true
            this.emit({ type: "mascot", state: "streaming" })
            this.emit({ type: "status", text: "streaming…", elapsedMs: now() - start })
          }
          this.emit({ type: "text", id, delta: d })
        },
        reasoning: (d) => {
          if (!streamedReasoning) {
            streamedReasoning = true
            this.emit({ type: "status", text: "thinking…", elapsedMs: now() - start })
          }
          this.emit({ type: "reasoning", id, delta: d })
        },
        usage: (i, o) => {
          inTok += i
          outTok += o
          this.totalTokens += i + o
          // The input figure for a request is the full context it ingested → remember the latest as
          // the current context size (drives auto-compaction). Don't sum it across steps.
          if (i > 0) this.lastInputTokens = i
          const cost =
            sel.cost && sel.cost.input != null && sel.cost.output != null
              ? (inTok / 1_000_000) * sel.cost.input + (outTok / 1_000_000) * sel.cost.output
              : undefined
          this.emit({ type: "usage", input: inTok, output: outTok, costUsd: cost })
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
        this.activeAssistantId = undefined
        return
      }

      // This step ends in tool calls, so a new assistant bubble will open next step. Finalize THIS
      // bubble now (stops its streaming caret) without ending the turn — busy stays true.
      this.emit({ type: "message-stop", id, intermediate: true })

      for (const tc of toolCalls) {
        if (signal.aborted) return

        if (tc.name === TODO_WRITE) {
          const a = safeParse(tc.arguments) as { todos?: { text?: string; status?: string }[] }
          this.todos = (a.todos ?? [])
            .filter((t) => t.text)
            .map((t, i) => ({ id: `t${i}`, text: t.text!, status: normTodoStatus(t.status) }))
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

        if (tc.name === EXIT_PLAN) {
          // The model has presented a finished plan. Emit it deterministically and LOCK the turn —
          // returning from loop() ends the agentic loop the instant the plan is ready.
          const a = safeParse(tc.arguments) as { plan?: string }
          const plan = (a.plan ?? "").trim()
          this.planEmitted = true
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: "Plan presented to the user for approval." })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output: plan, title: "plan ready" })
          this.emit({ type: "plan-ready", plan })
          this.emit({ type: "turn-done", id })
          this.activeAssistantId = undefined
          return
        }

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
          void this.hook("SubagentStop", { tool_response: summary })
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: summary })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output: summary, title: `task: ${a.description ?? "subagent"}` })
          continue
        }

        if (tc.name === ASK_USER) {
          const a = safeParse(tc.arguments) as {
            question?: string
            header?: string
            art?: string
            options?: unknown
            questions?: { question?: string; header?: string; art?: string; options?: unknown; multi?: boolean }[]
          }
          const questions: AskQuestion[] = Array.isArray(a.questions) && a.questions.length
            ? a.questions.map((q, i) => toAskQuestion(`q${i}`, q.question ?? "", q.options, q.multi === true, q.header, q.art))
            : [toAskQuestion("q0", a.question ?? "", a.options, false, a.header, a.art)]
          const requestId = this.host.nextId()
          this.emit({ type: "ask-user", requestId, questions })
          this.emit({ type: "mascot", state: "idle" })
          this.emit({ type: "status", text: "waiting for you…" })
          this.needsInput = true
          const answers = await new Promise<Record<string, string>>((resolve) => this.pendingAsk.set(requestId, resolve))
          const result = formatAskAnswers(questions, answers)
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output: result })
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

        const parsed = tryParseArgs(tc.arguments)
        if (!parsed.ok) {
          // Truncated/corrupt streamed JSON — reject rather than run e.g. edit/write with empty input.
          const msg = `Tool ${tc.name} was not run: its arguments were not valid JSON. Re-issue the call with valid JSON.`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: msg, isError: true })
          this.emit({ type: "tool-result", callId: tc.id, ok: false, output: msg })
          continue
        }
        let args = parsed.value

        // PreToolUse hook: may block the call or replace its input.
        const pre = await this.hook("PreToolUse", { tool_name: tc.name, tool_input: args }, tc.name)
        if (pre.block) {
          const msg = `Blocked by a PreToolUse hook${pre.reason ? `: ${pre.reason}` : "."}`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: msg, isError: true })
          this.emit({ type: "tool-result", callId: tc.id, ok: false, output: msg })
          continue
        }
        if (pre.input !== undefined) args = pre.input

        const decision = await this.checkPermission(tool, args, sel.mode)
        if (decision === "deny") {
          const msg = `User denied permission to run ${tool.name}.`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: msg, isError: true })
          this.emit({ type: "tool-result", callId: tc.id, ok: false, output: msg })
          continue
        }

        if (tool.permission === "edit" && this.currentCheckpoint) {
          const p = (args as any)?.path
          if (typeof p === "string") snapshotFile(this.currentCheckpoint, path.resolve(this.cwd, p))
        }

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

        void this.hook("PostToolUse", { tool_name: tc.name, tool_input: args, tool_response: result.output }, tc.name)
        this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: result.output, isError: result.isError })
        this.emit({ type: "tool-result", callId: tc.id, ok: !result.isError, output: result.output, title: result.title, diff: result.diff })
      }
    }
    // Fell out of the loop without finishing → the step budget ran out mid-task. Tell the user so
    // it doesn't look like work silently stopped; the `finally` in runPrompt finalizes the bubble.
    if (!this.abort?.signal.aborted) {
      this.emit({ type: "notice", text: `Reached the ${MAX_STEPS}-step limit — stopping. Ask me to continue if needed.` })
    }
  }

  private async runSubagent(prompt: string, agent?: string): Promise<string> {
    const sel = this.host.selection()
    const provider = this.host.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    const signal = this.abort!.signal
    // A custom agent type (.friday/agents/<name>.md) can supply its own prompt, model and
    // a narrowed tool allowlist. Sub-agents stay read-only — a custom `tools` list can only
    // pick from the read-only set, never escalate to edit/bash (which have no nested UI gate).
    const def = agent ? this.agents.find((a) => a.name === agent) : undefined
    let tools = this.host
      .registry()
      .list.filter(
        (t) => t.permission === "read" && t.name !== SKILL_TOOL && t.name !== TASK_TOOL && t.name !== ASK_USER && t.name !== TODO_WRITE && !LSP_TOOLS.has(t.name),
      )
    if (def?.tools?.length) tools = tools.filter((t) => def.tools!.includes(t.name))
    const defs = tools.map(toToolDef)
    const get = (n: string) => tools.find((t) => t.name === n)
    const model = def?.model ?? sel.model!
    const messages: Message[] = [
      { role: "system", text: def ? customAgentPrompt(def.content, this.cwd) : subagentPrompt(agent, this.cwd) },
      { role: "user", text: prompt },
    ]
    let lastText = ""

    for (let step = 0; step < 15; step++) {
      if (signal.aborted) break
      const { text, reasoning, reasoningSignature, toolCalls } = await this.collectTurn(
        this.host.streamFn(provider, apiKey, { model, messages, tools: defs, effort: sel.reasoning ? sel.effort : undefined, maxTokens: 4096 }, signal),
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
        if (!tool) {
          result = { output: `Unknown or disallowed tool for a sub-agent: ${tc.name}`, isError: true }
        } else {
          let args = safeParse(tc.arguments)
          // Sub-agent tool calls go through the same PreToolUse/PostToolUse hooks as the
          // main loop, so security gates apply uniformly.
          const pre = await this.hook("PreToolUse", { tool_name: tc.name, tool_input: args }, tc.name)
          if (pre.block) {
            result = { output: `Blocked by a PreToolUse hook${pre.reason ? `: ${pre.reason}` : "."}`, isError: true }
          } else {
            if (pre.input !== undefined) args = pre.input
            try {
              result = await tool.execute(args, { cwd: this.cwd, roots: this.roots, signal })
            } catch (e: any) {
              result = { output: `Error: ${e?.message ?? e}`, isError: true }
            }
            void this.hook("PostToolUse", { tool_name: tc.name, tool_input: args, tool_response: result.output }, tc.name)
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

  private async checkPermission(tool: Tool, args: unknown, mode: ModeId): Promise<"allow" | "deny"> {
    const cat = tool.permission
    if (cat === "read") return "allow"
    const command = typeof (args as any)?.command === "string" ? ((args as any).command as string) : undefined

    // bash allow/deny lists take precedence over the mode policy.
    if (cat === "bash" && command) {
      const policy = this.host.bashPolicy()
      if (matchesList(command, policy?.deny)) return "deny"
      if (matchesList(command, policy?.allow)) return "allow"
    }
    if (this.sessionAllow.has(cat)) return "allow"
    const verdict = getMode(mode).policy[cat]
    if (verdict === "allow") return "allow"
    if (verdict === "deny") return "deny"

    const requestId = this.host.nextId()
    const detail = command ?? (typeof (args as any)?.path === "string" ? String((args as any).path) : JSON.stringify(args).slice(0, 120))
    const risk = command ? bashRisk(command) : undefined
    this.emit({ type: "permission-request", requestId, tool: tool.name, summary: `Allow ${tool.name}?`, detail, risk })
    this.emit({ type: "mascot", state: "idle" })
    this.emit({ type: "status", text: "waiting for you…" })
    this.needsInput = true
    void this.hook("Notification", { message: `${tool.name} needs approval` })
    return new Promise<"allow" | "deny">((resolve) => this.pending.set(requestId, { resolve, category: cat }))
  }

  // ---- /commit ----
  async commitFlow(): Promise<void> {
    const status = await gitStatus(this.cwd)
    if (!status.repo) return this.emit({ type: "error", message: "Not a git repository." })
    if (!status.dirty) return this.emit({ type: "status", text: "nothing to commit — working tree clean" })

    this.emit({ type: "mascot", state: "working" })
    this.emit({ type: "status", text: "drafting commit message…" })
    const drafted = await this.draftCommit(await gitDiff(this.cwd))

    const requestId = this.host.nextId()
    this.emit({
      type: "ask-user",
      requestId,
      questions: [{ id: "q0", question: `Commit message (Enter to accept, or type your own):\n\n${drafted}` }],
    })
    this.needsInput = true
    const answers = await new Promise<Record<string, string>>((resolve) => this.pendingAsk.set(requestId, resolve))
    this.needsInput = this.pending.size > 0 || this.pendingAsk.size > 0
    const answer = answers.q0
    const message = answer && answer !== "(no answer)" ? answer : drafted

    const res = await gitCommitAll(this.cwd, message)
    this.emit({ type: "mascot", state: "idle" })
    if (res.ok) {
      this.emit({ type: "notice", text: `✓ committed ${res.info} — ${message}` })
      this.emitSessionFiles()
    } else {
      this.emit({ type: "error", message: `Commit failed: ${res.info}` })
    }
    this.emit({ type: "status", text: "ready" })
  }

  private async draftCommit(diff: string): Promise<string> {
    const sel = this.host.selection()
    if (!sel.model || !diff.trim()) return "Update files"
    const provider = this.host.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    const req = {
      model: sel.model,
      messages: [
        {
          role: "system",
          text: "Write ONE concise git commit subject line in conventional-commits style (type(scope): summary), imperative mood, under 72 chars. Output only the line.",
        } as Message,
        { role: "user", text: `Diff:\n${diff}` } as Message,
      ],
      tools: [],
      maxTokens: 80,
    }
    let text = ""
    try {
      for await (const ev of this.host.streamFn(provider, apiKey, req, new AbortController().signal)) if (ev.type === "text") text += ev.delta
    } catch {
      return "Update files"
    }
    return text.trim().split("\n")[0] || "Update files"
  }
}
