import {
  DEFAULT_MODE,
  getMode,
  type EngineEvent,
  type Effort,
  type Message,
  type ModeId,
  type ModelInfo,
  type PermissionCategory,
  type ProviderEvent,
  type ProviderInfo,
  type ToolCall,
  type UICommand,
} from "@friday/shared"
import {
  BUILTIN_PROVIDERS,
  getModels,
  getProviderKey,
  loadAuth,
  setProviderKey,
  streamProvider,
} from "@friday/providers"
import { ASK_USER, BUILTIN_TOOLS, SKILL_TOOL, TASK_TOOL, buildRegistry, toToolDef, type Tool, type ToolResult } from "@friday/tools"
import { connectServers } from "@friday/mcp"
import { loadConfig, saveConfig } from "./config.ts"
import { subagentPrompt, systemPrompt } from "./prompt.ts"
import { SessionStore } from "./sessions.ts"
import { loadProjectContext, type ProjectContext } from "./context.ts"
import { expandMentions } from "./mentions.ts"
import { loadCommands, type CustomCommand } from "./commands.ts"
import { loadSkills, type Skill } from "./skills.ts"

const now = () => Date.now()

export type StreamFn = (
  provider: ProviderInfo,
  apiKey: string | undefined,
  req: Parameters<typeof streamProvider>[2],
  signal: AbortSignal,
) => AsyncGenerator<ProviderEvent>

export interface EngineOptions {
  cwd: string
  /** override the provider streamer (for tests) */
  streamFn?: StreamFn
  /** override the session store (for tests) */
  store?: SessionStore
  /** resume a specific session id */
  resumeId?: string
  /** resume the most recent session in this cwd */
  continueLast?: boolean
}

export interface SessionStats {
  messages: number
  tokens: number
  durationMs: number
}

const MAX_STEPS = 50

type Pending = { resolve: (d: "allow" | "deny") => void; category: PermissionCategory }

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s || "{}")
  } catch {
    return {}
  }
}

export class Engine {
  private listeners = new Set<(e: EngineEvent) => void>()
  private messages: Message[] = []
  private allTools: Tool[] = [...BUILTIN_TOOLS]
  private registry = buildRegistry(this.allTools)
  private mcpServers: string[] = []
  private mcpClose?: () => void
  private cwd: string
  private streamFn: StreamFn
  private store: SessionStore
  private context: ProjectContext
  private skills: Skill[]

  private sessionId!: string
  private sessionTitle!: string
  private sessionStartedAt = now()
  private seq = 0
  private totalTokens = 0

  private mode: ModeId
  private effort: Effort
  private providerId?: string
  private model?: string

  private abort?: AbortController
  private busy = false
  private pending = new Map<string, Pending>()
  private pendingAsk = new Map<string, (answer: string) => void>()
  private sessionAllow = new Set<PermissionCategory>()
  private idc = 0

  constructor(opts: EngineOptions) {
    this.cwd = opts.cwd
    this.streamFn = opts.streamFn ?? (streamProvider as StreamFn)
    this.store = opts.store ?? new SessionStore()
    this.context = loadProjectContext(opts.cwd)
    this.skills = loadSkills(opts.cwd)
    const cfg = loadConfig()
    this.mode = cfg.mode ?? DEFAULT_MODE
    this.effort = cfg.effort ?? "medium"
    this.providerId = cfg.providerId
    this.model = cfg.model

    const resumed = opts.resumeId
      ? this.store.get(opts.resumeId)
      : opts.continueLast
        ? this.store.latest(this.cwd)
        : undefined
    if (resumed) this.adoptSession(resumed)
    else this.adoptSession(this.store.create(this.cwd, crypto.randomUUID(), now()))
  }

  /** Connect configured MCP servers and merge their tools into the registry. Call once at startup. */
  async init(): Promise<void> {
    const cfg = loadConfig()
    if (!cfg.mcp || !Object.keys(cfg.mcp).length) return
    try {
      const conn = await connectServers(cfg.mcp)
      this.mcpClose = conn.close
      this.mcpServers = conn.servers
      if (conn.tools.length) {
        this.allTools.push(...conn.tools)
        this.registry = buildRegistry(this.allTools)
      }
    } catch {
      /* MCP is optional */
    }
  }

  listMcpServers(): string[] {
    return this.mcpServers
  }

  dispose(): void {
    this.mcpClose?.()
  }

  private adoptSession(row: { id: string; title: string }): void {
    this.sessionId = row.id
    this.sessionTitle = row.title
    this.messages = this.store.loadMessages(row.id)
    this.seq = this.messages.length
    this.sessionStartedAt = now()
  }

  private addMessage(msg: Message): void {
    this.messages.push(msg)
    this.store.appendMessage(this.sessionId, this.seq++, msg)
    this.store.touch(this.sessionId, now())
    this.maybeTitleFromMessage(msg)
  }

  private maybeTitleFromMessage(msg: Message): void {
    if (msg.role !== "user") return
    if (this.sessionTitle && this.sessionTitle !== "new session") return
    const title = msg.text.replace(/\s+/g, " ").trim().slice(0, 48) || "session"
    this.sessionTitle = title
    this.store.rename(this.sessionId, title, now())
    this.emit({ type: "session-changed", sessionId: this.sessionId, title })
  }

  // ---- subscription ----
  subscribe(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(e: EngineEvent): void {
    for (const l of this.listeners) l(e)
  }
  private nextId(): string {
    return `e${++this.idc}`
  }

  /** Announce initial state (used right after the UI subscribes). */
  ready(): void {
    if (this.model && this.providerId) this.emit({ type: "model-changed", model: this.model, provider: this.providerId })
    this.emit({ type: "session-changed", sessionId: this.sessionId, title: this.sessionTitle })
    if (this.messages.length)
      this.emit({ type: "session-loaded", sessionId: this.sessionId, title: this.sessionTitle, messages: this.messages })
    this.emit({ type: "ready", needsModel: !this.model || !this.providerId })
  }

  // ---- sessions ----
  listSessions(): { id: string; title: string }[] {
    return this.store.list(this.cwd).map((s) => ({ id: s.id, title: s.title }))
  }
  currentSessionId(): string {
    return this.sessionId
  }
  currentTitle(): string {
    return this.sessionTitle
  }
  stats(): SessionStats {
    const messages = this.messages.filter((m) => m.role === "user" || m.role === "assistant").length
    return { messages, tokens: this.totalTokens, durationMs: now() - this.sessionStartedAt }
  }
  newSession(): void {
    if (this.busy) return
    this.adoptSession(this.store.create(this.cwd, crypto.randomUUID(), now()))
    this.totalTokens = 0
    this.emit({ type: "session-changed", sessionId: this.sessionId, title: this.sessionTitle })
    this.emit({ type: "session-loaded", sessionId: this.sessionId, title: this.sessionTitle, messages: [] })
  }
  switchSession(id: string): void {
    if (this.busy || id === this.sessionId) return
    const row = this.store.get(id)
    if (!row) return
    this.adoptSession(row)
    this.totalTokens = 0
    this.emit({ type: "session-changed", sessionId: this.sessionId, title: this.sessionTitle })
    this.emit({ type: "session-loaded", sessionId: this.sessionId, title: this.sessionTitle, messages: this.messages })
  }

  // ---- queries for the /model modal ----
  listProviders(): ProviderInfo[] {
    const custom = loadAuth().custom ?? []
    return [...BUILTIN_PROVIDERS, ...custom]
  }
  async listModels(providerId: string): Promise<ModelInfo[]> {
    const p = this.listProviders().find((x) => x.id === providerId)
    const catalogId = (p as any)?.catalogId as string | undefined
    return getModels(providerId, catalogId)
  }
  authState(): Record<string, { hasKey: boolean }> {
    const auth = loadAuth()
    const out: Record<string, { hasKey: boolean }> = {}
    for (const p of this.listProviders()) {
      const envHit = (p.envKeys ?? []).some((k) => !!process.env[k])
      out[p.id] = { hasKey: p.keyless === true || envHit || !!auth.providers[p.id]?.apiKey }
    }
    return out
  }
  selection(): { providerId?: string; model?: string; effort: Effort; mode: ModeId } {
    return { providerId: this.providerId, model: this.model, effort: this.effort, mode: this.mode }
  }
  contextInfo(): { files: string[] } {
    return { files: this.context.files }
  }
  listCommands(): CustomCommand[] {
    return loadCommands(this.cwd)
  }
  cwdPath(): string {
    return this.cwd
  }

  connectProvider(providerId: string, apiKey: string, baseURL?: string): void {
    setProviderKey(providerId, apiKey, baseURL)
  }
  selectModel(providerId: string, model: string): void {
    this.providerId = providerId
    this.model = model
    saveConfig({ providerId, model })
    this.emit({ type: "model-changed", model, provider: providerId })
  }

  // ---- command intake ----
  send(cmd: UICommand): void {
    switch (cmd.type) {
      case "prompt":
        void this.runPrompt(cmd.text)
        break
      case "abort":
        this.abort?.abort()
        break
      case "set-mode":
        this.mode = cmd.mode
        saveConfig({ mode: cmd.mode })
        break
      case "set-effort":
        this.effort = cmd.effort as Effort
        saveConfig({ effort: cmd.effort as Effort })
        break
      case "set-model":
        // model id may be "providerId/model" — handled by selectModel via UI
        break
      case "permission-reply": {
        const p = this.pending.get(cmd.requestId)
        if (p) {
          this.pending.delete(cmd.requestId)
          if (cmd.decision === "allow-always") this.sessionAllow.add(p.category)
          p.resolve(cmd.decision === "deny" ? "deny" : "allow")
        }
        break
      }
      case "ask-reply": {
        const r = this.pendingAsk.get(cmd.requestId)
        if (r) {
          this.pendingAsk.delete(cmd.requestId)
          r(cmd.answer)
        }
        break
      }
      case "new-session":
        this.newSession()
        break
      case "switch-session":
        this.switchSession(cmd.sessionId)
        break
      default:
        break
    }
  }

  setMode(m: ModeId): void {
    this.mode = m
  }

  // ---- the agentic loop ----
  /** Drain one provider turn, accumulating text/reasoning/tool-calls and firing callbacks. */
  private async collectTurn(
    gen: AsyncGenerator<ProviderEvent>,
    signal: AbortSignal,
    on: { text?: (d: string) => void; reasoning?: (d: string) => void; usage?: (input: number, output: number) => void },
  ): Promise<{ text: string; reasoning: string; toolCalls: ToolCall[] }> {
    let text = ""
    let reasoning = ""
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
      .map((c) => ({ id: c.id || this.nextId(), name: c.name, arguments: c.args || "{}" }))
    return { text, reasoning, toolCalls }
  }

  private resolveProvider(): ProviderInfo {
    const found = this.listProviders().find((p) => p.id === this.providerId)
    if (found) {
      const override = loadAuth().providers[found.id]?.baseURL
      return override ? { ...found, baseURL: override } : found
    }
    return { id: this.providerId ?? "unknown", name: "unknown", protocol: "openai", baseURL: "" }
  }

  private async runPrompt(text: string): Promise<void> {
    if (this.busy) return
    if (!this.model || !this.providerId) {
      this.emit({ type: "error", message: "No model selected — open /model to connect one." })
      return
    }
    this.busy = true
    this.abort = new AbortController()
    const { text: expanded } = expandMentions(text, this.cwd)
    this.addMessage({ role: "user", text: expanded })
    const start = Date.now()
    try {
      await this.loop(start)
    } catch (e: any) {
      if (this.abort.signal.aborted) {
        this.emit({ type: "status", text: "stopped" })
      } else {
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

  private async loop(start: number): Promise<void> {
    const provider = this.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    const signal = this.abort!.signal
    let inTok = 0
    let outTok = 0

    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) return
      const id = this.nextId()
      this.emit({ type: "message-start", role: "assistant", id })
      this.emit({ type: "mascot", state: "thinking" })
      this.emit({ type: "status", text: "thinking…", elapsedMs: Date.now() - start })

      const req = {
        model: this.model!,
        messages: [
          {
            role: "system",
            text: systemPrompt({
              cwd: this.cwd,
              mode: this.mode,
              context: this.context.content,
              skills: this.skills.map((s) => ({ name: s.name, description: s.description, whenToUse: s.whenToUse })),
            }),
          } as Message,
          ...this.messages,
        ],
        tools: this.registry.defs,
        effort: this.effort,
        maxTokens: 8192,
      }

      let streamedText = false
      const { text, reasoning, toolCalls } = await this.collectTurn(
        this.streamFn(provider, apiKey, req, signal),
        signal,
        {
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
            this.emit({ type: "status", text: "thinking…", elapsedMs: Date.now() - start, tokens: inTok + outTok })
          },
        },
      )
      if (signal.aborted) return

      this.addMessage({
        role: "assistant",
        text: text || undefined,
        reasoning: reasoning || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      })

      if (!toolCalls.length) {
        this.emit({ type: "turn-done", id })
        return
      }

      for (const tc of toolCalls) {
        if (signal.aborted) return
        this.emit({ type: "tool-call", id, callId: tc.id, name: tc.name, input: safeParse(tc.arguments) })
        this.emit({ type: "mascot", state: "working" })
        this.emit({ type: "status", text: `running ${tc.name}…`, elapsedMs: Date.now() - start })

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
          const requestId = this.nextId()
          this.emit({
            type: "ask-user",
            requestId,
            question: a.question ?? "",
            options: Array.isArray(a.options) ? (a.options as string[]) : undefined,
          })
          this.emit({ type: "mascot", state: "idle" })
          this.emit({ type: "status", text: "waiting for you…" })
          const answer = await new Promise<string>((resolve) => this.pendingAsk.set(requestId, resolve))
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: answer })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output: answer })
          continue
        }

        const tool = this.registry.get(tc.name)
        if (!tool) {
          const msg = `Unknown tool: ${tc.name}`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: msg, isError: true })
          this.emit({ type: "tool-result", callId: tc.id, ok: false, output: msg })
          continue
        }

        const decision = await this.checkPermission(tool, tc)
        if (decision === "deny") {
          const msg = `User denied permission to run ${tool.name}.`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: msg, isError: true })
          this.emit({ type: "tool-result", callId: tc.id, ok: false, output: msg })
          continue
        }

        let result: ToolResult
        try {
          result = await tool.execute(safeParse(tc.arguments), { cwd: this.cwd, signal })
        } catch (e: any) {
          result = { output: `Error: ${e?.message ?? e}`, isError: true }
        }
        this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: result.output, isError: result.isError })
        this.emit({
          type: "tool-result",
          callId: tc.id,
          ok: !result.isError,
          output: result.output,
          title: result.title,
          diff: result.diff,
        })
      }
    }
  }

  listSkills(): { name: string; description: string }[] {
    return this.skills.map((s) => ({ name: s.name, description: s.description }))
  }

  /** Run a read-only research sub-agent to completion and return its final summary. */
  private async runSubagent(prompt: string, agent?: string): Promise<string> {
    const provider = this.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    const signal = this.abort!.signal
    const tools = this.registry.list.filter(
      (t) => t.permission === "read" && t.name !== SKILL_TOOL && t.name !== TASK_TOOL && t.name !== ASK_USER,
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
      const { text, toolCalls } = await this.collectTurn(
        this.streamFn(provider, apiKey, { model: this.model!, messages, tools: defs, effort: this.effort, maxTokens: 4096 }, signal),
        signal,
        { usage: (i, o) => (this.totalTokens += i + o) },
      )
      messages.push({ role: "assistant", text: text || undefined, toolCalls: toolCalls.length ? toolCalls : undefined })
      if (text) lastText = text
      if (!toolCalls.length) return lastText || "(no result)"

      for (const tc of toolCalls) {
        const tool = get(tc.name)
        let result: ToolResult
        if (!tool) result = { output: `Unknown or disallowed tool for a sub-agent: ${tc.name}`, isError: true }
        else {
          try {
            result = await tool.execute(safeParse(tc.arguments), { cwd: this.cwd, signal })
          } catch (e: any) {
            result = { output: `Error: ${e?.message ?? e}`, isError: true }
          }
        }
        messages.push({ role: "tool", callId: tc.id, name: tc.name, result: result.output, isError: result.isError })
      }
    }
    return lastText || "(subagent reached its step limit)"
  }

  private async checkPermission(tool: Tool, tc: ToolCall): Promise<"allow" | "deny"> {
    const cat = tool.permission
    if (cat === "read") return "allow"
    if (this.sessionAllow.has(cat)) return "allow"
    const verdict = getMode(this.mode).policy[cat]
    if (verdict === "allow") return "allow"
    if (verdict === "deny") return "deny"

    const requestId = this.nextId()
    const detail = summarizeCall(tc)
    this.emit({ type: "permission-request", requestId, tool: tool.name, summary: `Allow ${tool.name}?`, detail })
    this.emit({ type: "mascot", state: "idle" })
    this.emit({ type: "status", text: "waiting for you…" })
    return new Promise<"allow" | "deny">((resolve) => this.pending.set(requestId, { resolve, category: cat }))
  }
}

function summarizeCall(tc: ToolCall): string {
  const args = safeParse(tc.arguments) as Record<string, unknown>
  if (typeof args.command === "string") return args.command
  if (typeof args.path === "string") return String(args.path)
  return tc.arguments.slice(0, 120)
}
