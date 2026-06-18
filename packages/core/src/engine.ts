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
import { BUILTIN_PROVIDERS, fetchModels, getProviderKey, loadAuth, setProviderKey, streamProvider, validateKey } from "@friday/providers"
import { BUILTIN_TOOLS, buildRegistry, type Tool } from "@friday/tools"
import { connectServers, type McpServerConfig } from "@friday/mcp"
import { loadConfig, saveConfig } from "./config.ts"
import { SessionStore } from "./sessions.ts"
import { loadCommands, type CustomCommand } from "./commands.ts"
import { SessionRunner, type RunnerHost, type SessionStats } from "./runner.ts"
import type { StreamFn } from "./stream.ts"
import { notify } from "./notify.ts"
import fs from "node:fs"
import path from "node:path"

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
    for (const [id, r] of this.runners) {
      if (r.isEmpty() && !r.busy) this.store.delete(id) // never persist empty placeholders
      r.dispose()
    }
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
  /**
   * "Active" sessions = those opened in THIS process run (the live runners), tagged with their
   * directory so the panel can group by it. They vanish when Friday closes; full persisted
   * history lives in /history. Focused session first, then most-recently-touched.
   */
  listSessions(): { id: string; title: string; cwd: string; roots: string[] }[] {
    return [...this.runners.values()]
      .map((r) => ({ id: r.sessionId, title: r.currentTitle(), cwd: r.currentCwd(), roots: r.currentRoots() }))
      .sort((a, b) => (a.id === this.focusedId ? -1 : b.id === this.focusedId ? 1 : 0))
  }
  /** Drop a session that never received a message so it never reaches persisted history. */
  private discardIfEmpty(id: string): void {
    const r = this.runners.get(id)
    if (!r || r.busy || !r.isEmpty() || id === this.focusedId) return
    r.dispose()
    this.runners.delete(id)
    this.store.delete(id)
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
  currentIsEmpty(): boolean {
    return this.focused().isEmpty()
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
  restoreCheckpoint(id: string, scope: "both" | "code" | "conversation" = "both"): void {
    this.focused().restoreCheckpoint(id, scope)
  }
  redoLast(): void {
    this.focused().redoLast()
  }

  newSession(): void {
    // If the current session is still empty, reuse it instead of spawning a duplicate
    // "new session" row (the root cause of session pile-up).
    const focused = this.focused()
    if (focused.isEmpty() && !focused.busy) {
      focused.emitState(true)
      return
    }
    const runner = this.makeRunner(this.store.create(focused.currentRoots(), crypto.randomUUID(), now()))
    this.focusedId = runner.sessionId
    runner.emitState(true)
  }
  /** The user turns of the focused session — the points a fork can branch from. */
  forkPoints(): { index: number; text: string }[] {
    return this.focused().forkPoints()
  }
  /** Branch a new session from the focused conversation, copying messages up to and including
   * the turn at `upto` (a message index). Omit `upto` to fork the whole conversation. Focuses it. */
  forkSession(upto?: number): void {
    const focused = this.focused()
    const msgs = focused.snapshotMessages()
    const cut = upto == null ? msgs.length : Math.max(0, Math.min(upto + 1, msgs.length))
    const slice = msgs.slice(0, cut)
    if (!slice.length) return
    const row = this.store.create(focused.currentRoots(), crypto.randomUUID(), now(), `fork · ${focused.currentTitle()}`)
    slice.forEach((m, i) => this.store.appendMessage(row.id, i, m))
    const runner = this.makeRunner(row)
    this.focusedId = runner.sessionId
    runner.emitState(true)
  }
  switchSession(id: string): void {
    if (id === this.focusedId) return
    const runner = this.runnerFor(id)
    if (!runner) return
    const prev = this.focusedId
    this.focusedId = id
    this.discardIfEmpty(prev) // throw away the empty session we just left
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
  /** What credentials a provider already has — so the connect UI can offer to reuse or override. */
  providerKeyInfo(id: string): { stored?: string; envVar?: string; baseURL?: string } {
    const auth = loadAuth()
    const p = this.listProviders().find((x) => x.id === id)
    const envVar = (p?.envKeys ?? []).find((k) => !!process.env[k])
    return { stored: auth.providers[id]?.apiKey, envVar, baseURL: auth.providers[id]?.baseURL }
  }
  /**
   * Validate a provider key against its live endpoint, persisting it only on success. Pass an empty
   * apiKey to validate the existing stored/env key (e.g. when the user keeps their current key).
   * Returns `{ ok: true }` when models can be listed, or an error message for the UI to show.
   */
  async connectAndValidate(providerId: string, apiKey?: string, baseURL?: string): Promise<{ ok: boolean; error?: string }> {
    const provider = this.listProviders().find((x) => x.id === providerId)
    if (!provider) return { ok: false, error: "unknown provider" }
    const storedBase = loadAuth().providers[providerId]?.baseURL
    const effBase = baseURL || storedBase || provider.baseURL
    const probe = { ...provider, baseURL: effBase }
    const typed = apiKey?.trim()
    const key = typed || getProviderKey(providerId)
    if (!key && !provider.keyless) return { ok: false, error: "enter an API key to connect" }
    const v = await validateKey(probe, key)
    if (!v.ok) return v
    // Persist only after a successful probe so a bad key never overwrites a working one.
    const baseOverride = baseURL && baseURL !== provider.baseURL ? baseURL : undefined
    if (typed) setProviderKey(providerId, typed, baseOverride)
    else if (baseOverride && getProviderKey(providerId)) setProviderKey(providerId, getProviderKey(providerId)!, baseOverride)
    return { ok: true }
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
      case "stop-compaction":
        this.focused().stopCompaction()
        break
      case "undo-compaction":
        this.focused().undoCompaction()
        break
      case "permission-reply":
        for (const r of this.runners.values()) if (r.handlePermissionReply(cmd.requestId, cmd.decision)) break
        break
      case "ask-reply":
        for (const r of this.runners.values()) if (r.handleAskReply(cmd.requestId, cmd.answers)) break
        break
      case "new-session":
        this.newSession()
        break
      case "switch-session":
        this.switchSession(cmd.sessionId)
        break
      case "open-path":
        this.openPath(cmd.path)
        break
      default:
        break
    }
  }

  /** Open a file (in $EDITOR / OS default) or reveal a folder, resolved against the focused roots. */
  private openPath(rel: string): void {
    const roots = this.focused().currentRoots()
    const expand = rel.startsWith("~/") && process.env.HOME ? process.env.HOME + rel.slice(1) : rel
    let abs = expand
    if (!path.isAbsolute(expand)) {
      for (const root of roots) {
        const full = path.join(root, expand)
        if (fs.existsSync(full)) {
          abs = full
          break
        }
      }
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(abs)
    } catch {
      this.dispatch(this.focusedId, { type: "notice", text: `↗ could not find ${rel}` })
      return
    }
    const mac = process.platform === "darwin"
    const editor = process.env.VISUAL || process.env.EDITOR
    const cmd: string[] = stat.isDirectory()
      ? mac
        ? ["open", "-R", abs] // reveal the folder in Finder
        : ["xdg-open", abs]
      : editor
        ? [editor, abs]
        : mac
          ? ["open", abs]
          : ["xdg-open", abs]
    try {
      Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" })
    } catch {
      this.dispatch(this.focusedId, { type: "notice", text: `↗ could not open ${rel}` })
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
