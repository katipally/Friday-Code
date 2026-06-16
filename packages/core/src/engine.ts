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
  type TodoItem,
  type TodoStatus,
  type UICommand,
} from "@friday/shared"
import {
  BUILTIN_PROVIDERS,
  fetchModels,
  getProviderKey,
  loadAuth,
  setProviderKey,
  streamProvider,
} from "@friday/providers"
import { ASK_USER, BUILTIN_TOOLS, SKILL_TOOL, TASK_TOOL, TODO_WRITE, buildRegistry, toToolDef, type Tool, type ToolResult } from "@friday/tools"
import { connectServers, type McpServerConfig } from "@friday/mcp"
import { loadConfig, saveConfig } from "./config.ts"
import { COMPACTION, estimateTokens, renderTranscript, safeCutIndex } from "./compaction.ts"
import { subagentPrompt, systemPrompt } from "./prompt.ts"
import { SessionStore } from "./sessions.ts"
import { loadProjectContext, type ProjectContext } from "./context.ts"
import { expandMentions } from "./mentions.ts"
import { loadCommands, type CustomCommand } from "./commands.ts"
import { loadSkills, type Skill } from "./skills.ts"
import { applyFiles, readOrNull, snapshotFile, type Checkpoint } from "./checkpoints.ts"
import path from "node:path"

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
  private mcpConnections = new Map<string, { close: () => void; toolNames: string[] }>()
  private cwd: string // primary root (= roots[0])
  private roots: string[]
  private streamFn: StreamFn
  private store: SessionStore
  private context!: ProjectContext
  private skills!: Skill[]

  private sessionId!: string
  private sessionTitle!: string
  private sessionStartedAt = now()
  private seq = 0
  private totalTokens = 0

  private mode: ModeId
  private effort: Effort
  private providerId?: string
  private model?: string
  private modelReasoning = false

  private abort?: AbortController
  private busy = false
  private pending = new Map<string, Pending>()
  private pendingAsk = new Map<string, (answer: string) => void>()
  private sessionAllow = new Set<PermissionCategory>()
  private idc = 0

  private checkpoints: Checkpoint[] = []
  private currentCheckpoint?: Checkpoint
  private redoState?: { files: Map<string, string | null>; messages: Message[] }

  private todos: TodoItem[] = []
  private contextWindow = 0
  /** When set, the prefix [0, throughIndex) is represented by `summary` instead of raw messages. */
  private compaction?: { summary: string; throughIndex: number }

  constructor(opts: EngineOptions) {
    this.cwd = opts.cwd
    this.roots = [opts.cwd]
    this.streamFn = opts.streamFn ?? (streamProvider as StreamFn)
    this.store = opts.store ?? new SessionStore()
    const cfg = loadConfig()
    this.mode = cfg.mode ?? DEFAULT_MODE
    this.effort = cfg.effort ?? "medium"
    this.providerId = cfg.providerId
    this.model = cfg.model
    this.modelReasoning = cfg.reasoning ?? false
    this.contextWindow = cfg.contextWindow ?? 0

    const resumed = opts.resumeId
      ? this.store.get(opts.resumeId)
      : opts.continueLast
        ? this.store.latest(this.cwd)
        : undefined
    if (resumed) this.adoptSession(resumed)
    else this.adoptSession(this.store.create(this.roots, crypto.randomUUID(), now()))
    this.reloadWorkspace()
  }

  /** (Re)load project context + skills for the current set of roots. */
  private reloadWorkspace(): void {
    this.context = loadProjectContext(this.roots)
    this.skills = loadSkills(this.roots)
  }

  /** Connect configured MCP servers and merge their tools into the registry. Call once at startup. */
  async init(): Promise<void> {
    const cfg = loadConfig()
    for (const [name, server] of Object.entries(cfg.mcp ?? {})) await this.connectMcp(name, server)
  }

  private async connectMcp(name: string, server: McpServerConfig): Promise<boolean> {
    try {
      const conn = await connectServers({ [name]: server })
      if (!conn.servers.length) return false
      this.mcpConnections.set(name, { close: conn.close, toolNames: conn.tools.map((t) => t.name) })
      this.allTools.push(...conn.tools)
      this.registry = buildRegistry(this.allTools)
      this.mcpServers = [...this.mcpConnections.keys()]
      return true
    } catch {
      return false
    }
  }

  listMcpServers(): string[] {
    return this.mcpServers
  }
  /** Configured MCP servers (name -> config), regardless of connection state. */
  mcpConfig(): Record<string, McpServerConfig> {
    return loadConfig().mcp ?? {}
  }
  async addMcpServer(name: string, server: McpServerConfig): Promise<boolean> {
    saveConfig({ mcp: { ...(loadConfig().mcp ?? {}), [name]: server } })
    return this.connectMcp(name, server)
  }
  removeMcpServer(name: string): void {
    const c = this.mcpConnections.get(name)
    if (c) {
      c.close()
      this.allTools = this.allTools.filter((t) => !c.toolNames.includes(t.name))
      this.registry = buildRegistry(this.allTools)
      this.mcpConnections.delete(name)
    }
    const mcp = { ...(loadConfig().mcp ?? {}) }
    delete mcp[name]
    saveConfig({ mcp })
    this.mcpServers = [...this.mcpConnections.keys()]
  }

  dispose(): void {
    for (const c of this.mcpConnections.values()) c.close()
  }

  private adoptSession(row: { id: string; title: string; roots: string[] }): void {
    this.sessionId = row.id
    this.sessionTitle = row.title
    this.roots = row.roots.length ? row.roots : [this.cwd]
    this.cwd = this.roots[0]!
    this.messages = this.store.loadMessages(row.id)
    this.seq = this.messages.length
    this.sessionStartedAt = now()
    this.checkpoints = []
    this.currentCheckpoint = undefined
    this.redoState = undefined
    this.todos = []
    this.compaction = undefined
  }

  private addMessage(msg: Message): void {
    this.messages.push(msg)
    this.store.appendMessage(this.sessionId, this.seq++, msg)
    this.store.touch(this.sessionId, now())
  }

  /** Derive a clean session title from the first user prompt (heuristic, not the expanded text). */
  private setTitleFromPrompt(typed: string): void {
    if (this.sessionTitle && this.sessionTitle !== "new session") return
    const cleaned = typed
      .replace(/@\S+/g, "") // drop file mentions
      .replace(/`+/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (!cleaned) return
    let title = cleaned.slice(0, 48).replace(/[.,;:!?]+$/, "")
    title = title.charAt(0).toUpperCase() + title.slice(1)
    this.sessionTitle = title
    this.store.rename(this.sessionId, title, now())
    this.emit({ type: "session-changed", sessionId: this.sessionId, title, cwd: this.cwd, roots: this.roots })
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
    if (this.model && this.providerId)
      this.emit({ type: "model-changed", model: this.model, provider: this.providerId, reasoning: this.modelReasoning })
    this.emit({ type: "session-changed", sessionId: this.sessionId, title: this.sessionTitle, cwd: this.cwd, roots: this.roots })
    if (this.messages.length)
      this.emit({ type: "session-loaded", sessionId: this.sessionId, title: this.sessionTitle, cwd: this.cwd, roots: this.roots, messages: this.messages })
    this.emit({ type: "todos", items: this.todos })
    this.emit({ type: "ready", needsModel: !this.model || !this.providerId })
  }

  // ---- sessions ----
  /** Working ("parallel") sessions for the current directory, newest first. */
  listSessions(): { id: string; title: string }[] {
    return this.store.list(this.cwd).map((s) => ({ id: s.id, title: s.title }))
  }
  /** Full history across all directories (for the history view). */
  listAllSessions(): { id: string; title: string; cwd: string; roots: string[]; updatedAt: number }[] {
    return this.store.list().map((s) => ({ id: s.id, title: s.title, cwd: s.cwd, roots: s.roots, updatedAt: s.updatedAt }))
  }
  currentRoots(): string[] {
    return this.roots
  }
  /** Add a directory to the current session's workspace (does NOT create a new session). */
  addRoot(dir: string): void {
    if (this.roots.includes(dir)) return
    this.roots = this.store.addRoot(this.sessionId, dir, now())
    this.reloadWorkspace()
    this.emit({ type: "session-changed", sessionId: this.sessionId, title: this.sessionTitle, cwd: this.cwd, roots: this.roots })
  }
  /** Switch the workspace to a different root — creates a NEW session in that directory. */
  setRoot(dir: string): void {
    if (this.busy) return
    this.cwd = dir
    this.roots = [dir]
    this.adoptSession(this.store.create([dir], crypto.randomUUID(), now()))
    this.reloadWorkspace()
    this.totalTokens = 0
    this.emitSessionState([])
  }
  currentSessionId(): string {
    return this.sessionId
  }
  currentTitle(): string {
    return this.sessionTitle
  }
  currentCwd(): string {
    return this.cwd
  }
  stats(): SessionStats {
    const messages = this.messages.filter((m) => m.role === "user" || m.role === "assistant").length
    return { messages, tokens: this.totalTokens, durationMs: now() - this.sessionStartedAt }
  }
  newSession(): void {
    if (this.busy) return
    this.adoptSession(this.store.create(this.roots, crypto.randomUUID(), now()))
    this.totalTokens = 0
    this.emitSessionState([])
  }
  switchSession(id: string): void {
    if (this.busy || id === this.sessionId) return
    const row = this.store.get(id)
    if (!row) return
    const changedRoots = row.roots.join("|") !== this.roots.join("|")
    this.adoptSession(row) // sets roots + primary cwd
    if (changedRoots) this.reloadWorkspace()
    this.totalTokens = 0
    this.emitSessionState(this.messages)
  }
  deleteSession(id: string): void {
    if (this.busy && id === this.sessionId) return // don't yank the session out from under a running turn
    this.store.delete(id)
    if (id === this.sessionId) {
      const next = this.store.latest(this.cwd)
      if (next) this.adoptSession(next)
      else this.adoptSession(this.store.create(this.roots, crypto.randomUUID(), now()))
      this.totalTokens = 0
      this.emitSessionState(this.messages)
    } else {
      // Active session unchanged — just nudge the UI to refresh its lists.
      this.emit({ type: "session-changed", sessionId: this.sessionId, title: this.sessionTitle, cwd: this.cwd, roots: this.roots })
    }
  }

  private emitSessionState(messages: Message[]): void {
    this.emit({ type: "session-changed", sessionId: this.sessionId, title: this.sessionTitle, cwd: this.cwd, roots: this.roots })
    this.emit({ type: "session-loaded", sessionId: this.sessionId, title: this.sessionTitle, cwd: this.cwd, roots: this.roots, messages })
    this.emit({ type: "todos", items: this.todos })
  }

  // ---- checkpoints / undo-rewind ----
  listCheckpoints(): { id: string; label: string; createdAt: number; files: number }[] {
    return this.checkpoints
      .map((c) => ({ id: c.id, label: c.label, createdAt: c.createdAt, files: c.files.size }))
      .reverse() // newest first
  }
  hasRedo(): boolean {
    return !!this.redoState
  }

  /** Rewind files + conversation back to the start of the given checkpoint's turn. */
  restoreCheckpoint(id: string): void {
    if (this.busy) return
    const idx = this.checkpoints.findIndex((c) => c.id === id)
    if (idx < 0) return
    const cp = this.checkpoints[idx]!
    const tail = this.checkpoints.slice(idx)

    // Capture redo state: current content of every file we're about to revert + current conversation.
    const redoFiles = new Map<string, string | null>()
    for (const c of tail) for (const p of c.files.keys()) if (!redoFiles.has(p)) redoFiles.set(p, readOrNull(p))
    this.redoState = { files: redoFiles, messages: [...this.messages] }

    // Revert files to their earliest recorded prior content (their state at the checkpoint's start).
    const restore = new Map<string, string | null>()
    for (const c of tail) for (const [p, prior] of c.files) if (!restore.has(p)) restore.set(p, prior)
    applyFiles(restore)

    // Rewind the conversation.
    this.messages = this.messages.slice(0, cp.messageSeq)
    this.seq = cp.messageSeq
    this.store.truncateMessages(this.sessionId, cp.messageSeq)
    this.checkpoints = this.checkpoints.slice(0, idx)
    this.currentCheckpoint = undefined

    this.emit({ type: "status", text: `rewound to “${cp.label}”` })
    this.emit({ type: "session-loaded", sessionId: this.sessionId, title: this.sessionTitle, cwd: this.cwd, roots: this.roots, messages: this.messages })
  }

  /** Undo the last rewind (re-apply the files + conversation that were reverted). */
  redoLast(): void {
    if (this.busy || !this.redoState) return
    applyFiles(this.redoState.files)
    this.messages = [...this.redoState.messages]
    this.seq = this.messages.length
    this.store.truncateMessages(this.sessionId, 0)
    this.messages.forEach((m, i) => this.store.appendMessage(this.sessionId, i, m))
    this.redoState = undefined
    this.emit({ type: "status", text: "redone" })
    this.emit({ type: "session-loaded", sessionId: this.sessionId, title: this.sessionTitle, cwd: this.cwd, roots: this.roots, messages: this.messages })
  }

  // ---- queries for the /model modal ----
  listProviders(): ProviderInfo[] {
    const custom = loadAuth().custom ?? []
    return [...BUILTIN_PROVIDERS, ...custom]
  }
  async listModels(providerId: string): Promise<ModelInfo[]> {
    const provider = this.listProviders().find((x) => x.id === providerId)
    if (!provider) return []
    const override = loadAuth().providers[provider.id]?.baseURL
    const resolved = override ? { ...provider, baseURL: override } : provider
    return fetchModels(resolved, getProviderKey(provider.id))
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
  selection(): { providerId?: string; model?: string; effort: Effort; mode: ModeId; reasoning: boolean } {
    return { providerId: this.providerId, model: this.model, effort: this.effort, mode: this.mode, reasoning: this.modelReasoning }
  }
  contextInfo(): { files: string[] } {
    return { files: this.context.files }
  }
  listCommands(): CustomCommand[] {
    return loadCommands(this.roots)
  }

  connectProvider(providerId: string, apiKey: string, baseURL?: string): void {
    setProviderKey(providerId, apiKey, baseURL)
  }
  selectModel(providerId: string, model: string, reasoning = false, contextWindow?: number): void {
    this.providerId = providerId
    this.model = model
    this.modelReasoning = reasoning
    if (contextWindow && contextWindow > 0) this.contextWindow = contextWindow
    saveConfig({ providerId, model, reasoning, contextWindow: this.contextWindow || undefined })
    this.emit({ type: "model-changed", model, provider: providerId, reasoning })
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
      case "run-command":
        this.runEngineCommand(cmd.command)
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

  /**
   * Dispatch an engine-side slash command sent over the bus (`run-command`).
   * Real commands are registered by later milestones (e.g. `/compact`, `/commit`);
   * unknown commands surface a clear error rather than failing silently.
   */
  private runEngineCommand(command: string): void {
    const [name] = command.trim().split(/\s+/)
    switch (name) {
      case "compact":
        void this.forceCompact()
        break
      default:
        this.emit({ type: "error", message: `Unknown command: /${name}` })
    }
  }

  // ---- the agentic loop ----
  /** Drain one provider turn, accumulating text/reasoning/tool-calls and firing callbacks. */
  private async collectTurn(
    gen: AsyncGenerator<ProviderEvent>,
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
      .map((c) => ({ id: c.id || this.nextId(), name: c.name, arguments: c.args || "{}" }))
    return { text, reasoning, reasoningSignature, toolCalls }
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
    // Open a checkpoint for this turn (files are snapshotted lazily as edits happen).
    this.currentCheckpoint = {
      id: this.nextId(),
      label: text.replace(/\s+/g, " ").trim().slice(0, 60) || "turn",
      createdAt: now(),
      messageSeq: this.messages.length,
      files: new Map(),
    }
    this.checkpoints.push(this.currentCheckpoint)
    this.redoState = undefined // a fresh turn invalidates redo
    const { text: expanded } = expandMentions(text, this.roots)
    this.addMessage({ role: "user", text: expanded })
    this.setTitleFromPrompt(text)
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

  // ---- context compaction ----
  /** The message list actually sent to the model (summary prefix + recent tail). */
  private sendMessages(): Message[] {
    if (!this.compaction) return this.messages
    const summaryMsg: Message = {
      role: "user",
      text: `<conversation_summary>\nEarlier conversation, condensed for context:\n${this.compaction.summary}\n</conversation_summary>`,
    }
    return [summaryMsg, ...this.messages.slice(this.compaction.throughIndex)]
  }

  private async maybeCompact(provider: ProviderInfo, apiKey: string | undefined, signal: AbortSignal, force: boolean): Promise<void> {
    const window = this.contextWindow || COMPACTION.defaultWindow
    const tokens = estimateTokens(this.sendMessages())
    if (!force && tokens < Math.floor(window * COMPACTION.threshold)) return
    const floor = this.compaction?.throughIndex ?? 0
    const target = this.messages.length - COMPACTION.keepRecent
    const cut = safeCutIndex(this.messages, target, floor)
    if (cut <= floor) return // no new, safely-cuttable history
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

  /** One-shot provider call to compress a transcript prefix into a faithful summary. */
  private async summarize(
    provider: ProviderInfo,
    apiKey: string | undefined,
    signal: AbortSignal,
    msgs: Message[],
    prior?: string,
  ): Promise<string> {
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
      model: this.model!,
      messages: [
        { role: "system", text: "You compress coding-session transcripts into concise, faithful summaries." } as Message,
        { role: "user", text: instruction } as Message,
      ],
      tools: [],
      maxTokens: 1024,
    }
    let text = ""
    try {
      for await (const ev of this.streamFn(provider, apiKey, req, signal)) {
        if (signal.aborted) break
        if (ev.type === "text") text += ev.delta
      }
    } catch {
      return prior ?? ""
    }
    return text.trim() || prior || ""
  }

  private async forceCompact(): Promise<void> {
    if (!this.model || !this.providerId) return this.emit({ type: "error", message: "Select a model first (/model)." })
    if (this.busy) return this.emit({ type: "status", text: "busy — compaction runs automatically" })
    if (this.messages.length <= COMPACTION.keepRecent) return this.emit({ type: "status", text: "nothing to compact yet" })
    const provider = this.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    this.emit({ type: "mascot", state: "working" })
    await this.maybeCompact(provider, apiKey, new AbortController().signal, true)
    this.emit({ type: "mascot", state: "idle" })
    this.emit({ type: "status", text: "ready" })
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

      // Auto-compact older history before it overflows the model window.
      await this.maybeCompact(provider, apiKey, signal, false)

      const req = {
        model: this.model!,
        messages: [
          {
            role: "system",
            text: systemPrompt({
              cwd: this.cwd,
              roots: this.roots,
              mode: this.mode,
              context: this.context.content,
              skills: this.skills.map((s) => ({ name: s.name, description: s.description, whenToUse: s.whenToUse })),
            }),
          } as Message,
          ...this.sendMessages(),
        ],
        tools: this.registry.defs,
        // Only send reasoning effort for models that actually support it (avoids 400s on e.g. gpt-4o).
        effort: this.modelReasoning ? this.effort : undefined,
        maxTokens: 8192,
      }

      let streamedText = false
      const { text, reasoning, reasoningSignature, toolCalls } = await this.collectTurn(
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
        reasoningSignature: reasoningSignature || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      })

      if (!toolCalls.length) {
        this.emit({ type: "turn-done", id })
        return
      }

      for (const tc of toolCalls) {
        if (signal.aborted) return

        // todo_write renders in the right-panel list, not as a chat tool-card.
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

        // Snapshot the file for undo before an edit-category tool mutates it.
        if (tool.permission === "edit" && this.currentCheckpoint) {
          const a = safeParse(tc.arguments) as { path?: string }
          if (typeof a.path === "string") snapshotFile(this.currentCheckpoint, path.resolve(this.cwd, a.path))
        }

        let result: ToolResult
        try {
          result = await tool.execute(safeParse(tc.arguments), { cwd: this.cwd, roots: this.roots, signal })
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
      const { text, reasoning, reasoningSignature, toolCalls } = await this.collectTurn(
        this.streamFn(
          provider,
          apiKey,
          { model: this.model!, messages, tools: defs, effort: this.modelReasoning ? this.effort : undefined, maxTokens: 4096 },
          signal,
        ),
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
