import {
  DEFAULT_MODE,
  type EngineEvent,
  type EngineEventBody,
  type Effort,
  type ModeId,
  type ModelInfo,
  type ProviderInfo,
  type UICommand,
} from "@friday/shared"
import { BUILTIN_PROVIDERS, fetchModels, getProviderKey, loadAuth, setProviderKey, streamProvider } from "@friday/providers"
import { BUILTIN_TOOLS, buildRegistry, type Tool } from "@friday/tools"
import { connectServers, type McpServerConfig } from "@friday/mcp"
import { loadConfig, saveConfig } from "./config.ts"
import { SessionStore } from "./sessions.ts"
import { loadCommands, type CustomCommand } from "./commands.ts"
import { SessionRunner, type RunnerHost, type SessionStats } from "./runner.ts"
import type { StreamFn } from "./stream.ts"
import { notify } from "./notify.ts"

export type { StreamFn } from "./stream.ts"
export type { SessionStats } from "./runner.ts"

const now = () => Date.now()

export interface EngineOptions {
  cwd: string
  streamFn?: StreamFn
  store?: SessionStore
  resumeId?: string
  continueLast?: boolean
}

/**
 * Manager over one-or-more concurrent {@link SessionRunner}s. Owns shared services
 * (providers, tools, MCP, model selection, the session store) and multiplexes every
 * runner's events onto the bus, tagged with its session id. A single "focused"
 * session is what the UI shows; the rest keep running in the background.
 */
export class Engine {
  private listeners = new Set<(e: EngineEvent) => void>()
  private allTools: Tool[] = [...BUILTIN_TOOLS]
  private registry = buildRegistry(this.allTools)
  private mcpServers: string[] = []
  private mcpConnections = new Map<string, { close: () => void; toolNames: string[] }>()

  private cwd: string
  private streamFn: StreamFn
  private store: SessionStore
  private idc = 0

  private mode: ModeId
  private effort: Effort
  private providerId?: string
  private model?: string
  private modelReasoning = false
  private contextWindow = 0
  private modelCost?: { input: number; output: number }

  private runners = new Map<string, SessionRunner>()
  private focusedId!: string

  private host: RunnerHost = {
    streamFn: undefined as any, // set in constructor (needs `this.streamFn`)
    store: undefined as any,
    registry: () => this.registry,
    selection: () => ({
      providerId: this.providerId,
      model: this.model,
      reasoning: this.modelReasoning,
      effort: this.effort,
      mode: this.mode,
      contextWindow: this.contextWindow,
      cost: this.modelCost,
    }),
    resolveProvider: () => this.resolveProvider(),
    nextId: () => this.nextId(),
    emit: (sessionId, body) => this.dispatch(sessionId, body),
    hooks: () => loadConfig().hooks,
    bashPolicy: () => loadConfig().bash,
  }

  constructor(opts: EngineOptions) {
    this.cwd = opts.cwd
    this.streamFn = opts.streamFn ?? (streamProvider as StreamFn)
    this.store = opts.store ?? new SessionStore()
    this.host.streamFn = this.streamFn
    this.host.store = this.store

    const cfg = loadConfig()
    this.mode = cfg.mode ?? DEFAULT_MODE
    this.effort = cfg.effort ?? "medium"
    this.providerId = cfg.providerId
    this.model = cfg.model
    this.modelReasoning = cfg.reasoning ?? false
    this.contextWindow = cfg.contextWindow ?? 0
    this.modelCost = cfg.cost

    const resumed = opts.resumeId ? this.store.get(opts.resumeId) : opts.continueLast ? this.store.latest(this.cwd) : undefined
    const row = resumed ?? this.store.create([this.cwd], crypto.randomUUID(), now())
    const runner = this.makeRunner(row)
    this.focusedId = runner.sessionId
  }

  // ---- shared infra ----
  private nextId(): string {
    return `e${++this.idc}`
  }
  private emit(e: EngineEvent): void {
    for (const l of this.listeners) l(e)
  }
  /** Tag a body with its session id, fire background notifications, and broadcast. */
  private dispatch(sessionId: string, body: EngineEventBody): void {
    if (sessionId !== this.focusedId) {
      const r = this.runners.get(sessionId)
      const label = r?.currentTitle() ?? "a session"
      if (body.type === "turn-done") notify("Friday", `“${label}” finished`)
      else if (body.type === "permission-request" || body.type === "ask-user") notify("Friday", `“${label}” needs your input`)
    }
    this.emit({ ...body, sessionId } as EngineEvent)
  }
  private makeRunner(row: { id: string; title: string; roots: string[] }): SessionRunner {
    const r = new SessionRunner(this.host, row, this.cwd)
    this.runners.set(r.sessionId, r)
    return r
  }
  private focused(): SessionRunner {
    return this.runners.get(this.focusedId)!
  }
  /** Load (or revive) a runner for a stored session. */
  private runnerFor(id: string): SessionRunner | undefined {
    const existing = this.runners.get(id)
    if (existing) return existing
    const row = this.store.get(id)
    return row ? this.makeRunner(row) : undefined
  }

  subscribe(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  // ---- MCP ----
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
    for (const r of this.runners.values()) r.dispose()
    for (const c of this.mcpConnections.values()) c.close()
  }

  // ---- announce / focus ----
  ready(): void {
    if (this.model && this.providerId)
      this.dispatch(this.focusedId, {
        type: "model-changed",
        model: this.model,
        provider: this.providerId,
        reasoning: this.modelReasoning,
        contextWindow: this.contextWindow,
      })
    this.focused().emitState(true)
    this.dispatch(this.focusedId, { type: "ready", needsModel: !this.model || !this.providerId })
  }

  // ---- sessions ----
  listSessions(): { id: string; title: string }[] {
    return this.store.list(this.focused().currentCwd()).map((s) => ({ id: s.id, title: s.title }))
  }
  listAllSessions(): { id: string; title: string; cwd: string; roots: string[]; updatedAt: number }[] {
    return this.store.list().map((s) => ({ id: s.id, title: s.title, cwd: s.cwd, roots: s.roots, updatedAt: s.updatedAt }))
  }
  /** Session ids with a currently-running agent loop (for the RUNNING panel). */
  runningSessions(): string[] {
    return [...this.runners.values()].filter((r) => r.busy).map((r) => r.sessionId)
  }
  currentSessionId(): string {
    return this.focusedId
  }
  currentTitle(): string {
    return this.focused().currentTitle()
  }
  currentCwd(): string {
    return this.focused().currentCwd()
  }
  currentRoots(): string[] {
    return this.focused().currentRoots()
  }
  contextInfo(): { files: string[] } {
    return this.focused().contextInfo()
  }
  listSkills(): { name: string; description: string }[] {
    return this.focused().listSkills()
  }
  listCommands(): CustomCommand[] {
    return loadCommands(this.focused().currentRoots())
  }
  stats(): SessionStats {
    return this.focused().stats()
  }
  listCheckpoints(): { id: string; label: string; createdAt: number; files: number }[] {
    return this.focused().listCheckpoints()
  }
  hasRedo(): boolean {
    return this.focused().hasRedo()
  }
  restoreCheckpoint(id: string): void {
    this.focused().restoreCheckpoint(id)
  }
  redoLast(): void {
    this.focused().redoLast()
  }

  newSession(): void {
    const runner = this.makeRunner(this.store.create(this.focused().currentRoots(), crypto.randomUUID(), now()))
    this.focusedId = runner.sessionId
    runner.emitState(true)
  }
  switchSession(id: string): void {
    if (id === this.focusedId) return
    const runner = this.runnerFor(id)
    if (!runner) return
    this.focusedId = id
    runner.emitState(true)
  }
  /** Add a directory to the focused session's workspace (no new session). */
  addRoot(dir: string): void {
    this.focused().addRoot(dir)
  }
  /** Open a new session rooted at `dir` and focus it. */
  setRoot(dir: string): void {
    const runner = this.makeRunner(this.store.create([dir], crypto.randomUUID(), now()))
    this.focusedId = runner.sessionId
    runner.emitState(true)
  }
  deleteSession(id: string): void {
    const r = this.runners.get(id)
    if (r) {
      r.dispose()
      this.runners.delete(id)
    }
    this.store.delete(id)
    if (id === this.focusedId) {
      const next = this.store.latest(this.cwd) ?? this.store.create([this.cwd], crypto.randomUUID(), now())
      const runner = this.runnerFor(next.id) ?? this.makeRunner(next)
      this.focusedId = runner.sessionId
      runner.emitState(true)
    } else {
      // Refresh the UI lists without changing focus.
      this.dispatch(this.focusedId, {
        type: "session-changed",
        sessionId: this.focusedId,
        title: this.focused().currentTitle(),
        cwd: this.focused().currentCwd(),
        roots: this.focused().currentRoots(),
      })
    }
  }

  // ---- model / provider queries ----
  listProviders(): ProviderInfo[] {
    const custom = loadAuth().custom ?? []
    return [...BUILTIN_PROVIDERS, ...custom]
  }
  async listModels(providerId: string): Promise<ModelInfo[]> {
    const provider = this.listProviders().find((x) => x.id === providerId)
    if (!provider) return []
    const override = loadAuth().providers[provider.id]?.baseURL
    return fetchModels(override ? { ...provider, baseURL: override } : provider, getProviderKey(provider.id))
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
  private resolveProvider(): ProviderInfo {
    const found = this.listProviders().find((p) => p.id === this.providerId)
    if (found) {
      const override = loadAuth().providers[found.id]?.baseURL
      return override ? { ...found, baseURL: override } : found
    }
    return { id: this.providerId ?? "unknown", name: "unknown", protocol: "openai", baseURL: "" }
  }
  connectProvider(providerId: string, apiKey: string, baseURL?: string): void {
    setProviderKey(providerId, apiKey, baseURL)
  }
  selectModel(providerId: string, model: string, reasoning = false, contextWindow?: number, cost?: { input: number; output: number }): void {
    this.providerId = providerId
    this.model = model
    this.modelReasoning = reasoning
    if (contextWindow && contextWindow > 0) this.contextWindow = contextWindow
    this.modelCost = cost ?? this.modelCost
    saveConfig({ providerId, model, reasoning, contextWindow: this.contextWindow || undefined, cost: this.modelCost })
    this.dispatch(this.focusedId, { type: "model-changed", model, provider: providerId, reasoning, contextWindow: this.contextWindow })
  }
  setMode(m: ModeId): void {
    this.mode = m
  }

  // ---- command intake ----
  send(cmd: UICommand): void {
    switch (cmd.type) {
      case "prompt":
        void this.focused().runPrompt(cmd.text)
        break
      case "abort":
        this.focused().abortRun()
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
        break
      case "run-command":
        this.runEngineCommand(cmd.command)
        break
      case "permission-reply":
        for (const r of this.runners.values()) if (r.handlePermissionReply(cmd.requestId, cmd.decision)) break
        break
      case "ask-reply":
        for (const r of this.runners.values()) if (r.handleAskReply(cmd.requestId, cmd.answer)) break
        break
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

  private runEngineCommand(command: string): void {
    const [name] = command.trim().split(/\s+/)
    switch (name) {
      case "compact":
        void this.focused().forceCompact()
        break
      case "commit":
        void this.focused().commitFlow()
        break
      default:
        this.dispatch(this.focusedId, { type: "error", message: `Unknown command: /${name}` })
    }
  }
}
