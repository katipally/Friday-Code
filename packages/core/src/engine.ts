import fs from "node:fs"
import path from "node:path"
import { connectServers, type McpServerConfig } from "@friday/mcp"
import {
  BUILTIN_PROVIDERS,
  fetchModels,
  getProviderKey,
  loadAuth,
  setProviderKey,
  streamProvider,
  validateKey,
} from "@friday/providers"
import {
  DEFAULT_MODE,
  type Effort,
  type EngineEvent,
  type EngineEventBody,
  type ModeId,
  type ModelInfo,
  type ProviderInfo,
  type UICommand,
} from "@friday/shared"
import {
  BUILTIN_TOOLS,
  buildRegistry,
  closeBrowser,
  computerInstalled,
  computerSupport,
  findBrowser,
  installComputerUse,
  startBrowser,
  type Tool,
  uninstallComputerUse,
} from "@friday/tools"
import { type CustomCommand, loadCommands } from "./commands.ts"
import { loadConfig, saveConfig } from "./config.ts"
import { type CronJob, loadCron, parseInterval, saveCron } from "./cron.ts"
import {
  cancelMic,
  type InputDevice,
  listInputDevices,
  micRecording,
  micSetupSteps,
  micStatus,
  prewarmMic,
  startMic,
  stopMic,
  transcribePartial,
} from "./mic.ts"
import { notify } from "./notify.ts"
import { persistPermission, projectPermissions, revokeProjectPermissions } from "./permissions.ts"
import { type RunnerHost, SessionRunner, type SessionStats, type SpawnOpts } from "./runner.ts"
import { SessionStore } from "./sessions.ts"
import type { SkillInfo } from "./skills.ts"
import type { StreamFn } from "./stream.ts"

export type { SessionStats } from "./runner.ts"
export type { StreamFn } from "./stream.ts"

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
  /** sessionIds that are agent-spawned background tasks (vs user sessions), with their description. */
  private taskMeta = new Map<string, { description: string; createdAt: number }>()
  /** follow-up prompts queued for a background task while it was busy; drained when it goes idle */
  private taskQueue = new Map<string, string[]>()
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
      outputStyle: loadConfig().outputStyle,
    }),
    resolveProvider: () => this.resolveProvider(),
    nextId: () => this.nextId(),
    emit: (sessionId, body) => this.dispatch(sessionId, body),
    hooks: () => loadConfig().hooks,
    bashPolicy: () => loadConfig().bash,
    formatterEnabled: () => loadConfig().formatter,
    projectPermissions: (root) => projectPermissions(root),
    persistPermission: (root, rule) => persistPermission(root, rule),
    spawnTask: (prompt, description, opts) => this.spawnTask(prompt, description, opts),
    sendToTask: (id, text) => this.sendToTask(id, text),
    taskList: () => this.taskList(),
    stopTask: (id) => this.stopTask(id),
    cronCreate: (description, prompt, every) => this.cronCreate(description, prompt, every),
    cronList: () => this.cronList(),
    cronDelete: (id) => this.cronDelete(id),
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

    const resumed = opts.resumeId
      ? this.store.get(opts.resumeId)
      : opts.continueLast
        ? this.store.latest(this.cwd)
        : undefined
    const row = resumed ?? this.store.buildRow([this.cwd], crypto.randomUUID(), now())
    const runner = this.makeRunner(row)
    this.focusedId = runner.sessionId
    // Restore a resumed session's own model/provider/mode/effort (new sessions keep the global default).
    if (resumed) this.applySessionSelection(runner.sessionId)
    // One set of exit hooks per process (not per Engine). On a hard signal — terminal closed (SIGHUP)
    // or kill (SIGTERM) — fully shut down: aborting every runner cascades to its bash process group,
    // so background tasks and anything they spawned (dev servers, watchers) die with Friday instead of
    // orphaning and pinning the CPU. SIGINT is owned by the TUI's clean quit.
    if (!Engine.exitHooked) {
      Engine.exitHooked = true
      for (const sig of ["SIGTERM", "SIGHUP"] as const) {
        process.once(sig, () => {
          this.dispose()
          process.exit(0)
        })
      }
    }
  }
  private static exitHooked = false

  /** Stop a runner this process owns. */
  requestStop(sessionId: string): void {
    this.runners.get(sessionId)?.abortRun()
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
      else if (body.type === "permission-request" || body.type === "ask-user")
        notify("Friday", `“${label}” needs your input`)
    }
    this.emit({ ...body, sessionId } as EngineEvent)
    // When a background task finishes (or errors), refresh the Tasks panel and drain queued follow-ups,
    // on the next tick so `busy` has settled. This is the only completion hook; no polling anywhere.
    if (body.type === "turn-done" || body.type === "error") {
      setTimeout(() => {
        if (this.taskMeta.has(sessionId)) this.emitTasks()
        this.drainTask(sessionId)
      }, 0)
    }
  }

  // ---- background tasks (agent-spawned async sessions) ----
  /** Spawn a detached background session that runs `prompt` to completion; returns its id. When
   * `worktree` is set, the task first enters an isolated git worktree of that name (parallel writable
   * work that won't collide with the main checkout or other tasks). */
  spawnTask(prompt: string, description: string, opts?: SpawnOpts): string {
    const roots = this.focused().currentRoots()
    const title = (description || "task").slice(0, 60)
    const runner = this.makeRunner(this.store.buildRow(roots, crypto.randomUUID(), now(), title))
    this.taskMeta.set(runner.sessionId, { description, createdAt: now() })
    // Budget caps hard-stop the session; an optional posture pins its permission mode.
    runner.configureAgent({
      posture: opts?.posture,
      budgetUsd: opts?.budgetUsd,
      budgetTokens: opts?.budgetTokens,
    })
    void (async () => {
      if (opts?.worktree) await runner.enterWorktree(opts.worktree)
      await runner.runPrompt(prompt)
    })()
    this.emitTasks()
    return runner.sessionId
  }
  taskList(): { id: string; title: string; description: string; status: "running" | "done"; summary?: string }[] {
    return [...this.taskMeta.entries()].map(([id, meta]) => {
      const r = this.runners.get(id)
      const msgs = r?.snapshotMessages() ?? []
      const last = [...msgs].reverse().find((m) => m.role === "assistant" && "text" in m && m.text) as
        | { text?: string }
        | undefined
      return {
        id,
        title: r?.currentTitle() ?? meta.description,
        description: meta.description,
        status: r?.busy ? ("running" as const) : ("done" as const),
        summary: last?.text?.slice(0, 240),
      }
    })
  }
  stopTask(id: string): void {
    this.runners.get(id)?.abortRun()
    this.emitTasks()
  }
  /** Stop (if running) and drop a background agent from the list entirely. */
  removeTask(id: string): void {
    const r = this.runners.get(id)
    if (r) {
      r.abortRun()
      r.dispose()
      this.runners.delete(id)
    }
    this.taskMeta.delete(id)
    this.emitTasks()
  }
  /** Inject a follow-up prompt into a background task. Queues it if the task is mid-turn. */
  sendToTask(id: string, text: string): boolean {
    const r = this.runners.get(id)
    if (!r) return false
    if (r.busy) {
      const q = this.taskQueue.get(id) ?? []
      q.push(text)
      this.taskQueue.set(id, q)
      return true
    }
    void r.runPrompt(text)
    this.emitTasks()
    return true
  }
  private drainTask(id: string): void {
    const r = this.runners.get(id)
    if (!r || r.busy) return
    const q = this.taskQueue.get(id)
    if (!q?.length) return
    const next = q.shift()!
    if (!q.length) this.taskQueue.delete(id)
    void r.runPrompt(next)
  }
  /** Force-activate deferred tools (by name prefix) for the focused session so the model can use them
   * immediately without calling tool_search first. Returns the number activated. */
  activateTools(prefix: string): number {
    return this.focused().activateTools(prefix)
  }
  /** Launch / connect the user's browser for CDP automation (the /chrome command). */
  async startBrowser(): Promise<string> {
    if (!findBrowser()) throw new Error("no Chrome/Brave/Edge/Chromium found — install one first")
    return startBrowser(loadConfig().browser)
  }
  closeBrowser(): void {
    closeBrowser()
  }
  /** Whether an automatable browser binary is installed (for /doctor). */
  browserAvailable(): boolean {
    return !!findBrowser()
  }
  // ---- mic (on-device speech-to-text via whisper-tiny.en) ----
  micStatus(): { ok: boolean; reason: string } {
    return micStatus(loadConfig().voice)
  }
  /** OS-aware enablement checklist for the mic setup screen. */
  micSetupSteps(): { ready: boolean; lines: string[] } {
    return micSetupSteps(loadConfig().voice)
  }
  micRecording(): boolean {
    return micRecording()
  }
  /** Selectable mic inputs (for the device picker in the mic modal). */
  micInputDevices(): InputDevice[] {
    return listInputDevices()
  }
  /** Begin capturing the mic (press-to-talk). `device` is an id from micInputDevices(). */
  startMic(device?: string): void {
    startMic(loadConfig().voice, device)
  }
  /** Transcribe captured-so-far audio without stopping — drives the live preview. */
  transcribePartial(): Promise<string> {
    return transcribePartial(loadConfig().voice)
  }
  /** Stop capture and return the locally-transcribed text ("" if nothing heard). */
  stopMic(): Promise<string> {
    return stopMic(loadConfig().voice)
  }
  cancelMic(): void {
    cancelMic()
  }
  /** Warm the whisper model in the background so the first transcription isn't slow. */
  prewarmMic(): void {
    prewarmMic(loadConfig().voice)
  }
  // ---- computer use (opt-in native backend) ----
  computerInstalled(): boolean {
    return computerInstalled()
  }
  /** Whether the current OS/session can drive the desktop, with a human-readable note. */
  computerSupport(): { ok: boolean; platform: string; note: string } {
    return computerSupport()
  }
  installComputerUse(): Promise<{ ok: boolean; log: string }> {
    return installComputerUse()
  }
  uninstallComputerUse(): boolean {
    return uninstallComputerUse()
  }
  private emitTasks(): void {
    this.dispatch(this.focusedId, { type: "tasks", items: this.taskList() })
  }

  // ---- cron (recurring background tasks) ----
  private cronTimer: ReturnType<typeof setInterval> | null = null
  cronCreate(description: string, prompt: string, every: string): { ok: boolean; id?: string; error?: string } {
    const everyMs = parseInterval(every)
    if (everyMs == null) return { ok: false, error: `unrecognized interval "${every}" (use 30s/5m/2h/1d/hourly/daily)` }
    const job: CronJob = { id: crypto.randomUUID().slice(0, 8), description, prompt, everyMs, nextRun: now() + everyMs }
    saveCron([...loadCron(), job])
    this.startScheduler()
    return { ok: true, id: job.id }
  }
  cronList(): CronJob[] {
    return loadCron()
  }
  cronDelete(id: string): void {
    saveCron(loadCron().filter((j) => j.id !== id))
  }
  /** Start the in-process cron ticker (idempotent, unref'd so it never keeps the process alive). */
  startScheduler(): void {
    if (this.cronTimer) return
    this.cronTimer = setInterval(() => this.cronTick(), 30_000)
    this.cronTimer.unref?.()
  }
  private cronTick(): void {
    const t = now()
    const jobs = loadCron()
    let changed = false
    for (const job of jobs) {
      if (job.nextRun <= t) {
        this.spawnTask(job.prompt, `cron: ${job.description}`)
        job.nextRun = t + job.everyMs
        changed = true
      }
    }
    if (changed) saveCron(jobs)
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
    if (loadCron().length) this.startScheduler() // resume schedules from a prior run
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
  /** Read the user config (for the UI: theme, budget, etc.). */
  userConfig(): import("./config.ts").FridayConfig {
    return loadConfig()
  }
  /** Persist a config patch (theme, budget, …). */
  setUserConfig(patch: Partial<import("./config.ts").FridayConfig>): void {
    saveConfig(patch)
  }
  /** "Always allow" rules remembered for the focused session's project (for the /permissions view). */
  projectPermissions(): { bash?: string[]; categories?: string[] } {
    return projectPermissions(this.currentRoots()[0] ?? this.cwd)
  }
  /** Forget all remembered "always allow" rules for the focused session's project. */
  clearProjectPermissions(): void {
    revokeProjectPermissions(this.currentRoots()[0] ?? this.cwd)
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
  /** Shut down EVERYTHING this process owns: abort all runners (which kills their bash process groups
   * + child processes) and close MCP servers. Idempotent — safe to call from the clean quit and from
   * signal hooks. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const [id, r] of this.runners) {
      if (r.isEmpty() && !r.busy) this.store.delete(id) // never persist empty placeholders
      r.dispose() // aborts the run → its bash tool's abort handler kills the whole process group
    }
    for (const c of this.mcpConnections.values()) c.close()
  }
  private disposed = false

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

  // ---- workspace trust ----
  /** Has the user granted Friday access to the cwd — or to an ancestor of it (prefix trust)? */
  isCwdTrusted(): boolean {
    const trusted = loadConfig().trustedRoots ?? []
    return trusted.some(
      (root) => this.cwd === root || this.cwd.startsWith(root.endsWith(path.sep) ? root : root + path.sep),
    )
  }
  /** Remember the current directory as trusted so the prompt isn't shown again for it. */
  trustCwd(): void {
    const trusted = loadConfig().trustedRoots ?? []
    if (!trusted.includes(this.cwd)) saveConfig({ trustedRoots: [...trusted, this.cwd] })
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
    return this.store
      .list()
      .map((s) => ({ id: s.id, title: s.title, cwd: s.cwd, roots: s.roots, updatedAt: s.updatedAt }))
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
  contextInfo(): { files: string[]; pinned: string[] } {
    return this.focused().contextInfo()
  }
  /** Pin/unpin a file (relative to the focused session's primary root) into context for the session. */
  pinContextFile(rel: string): void {
    this.focused().pinFile(rel)
  }
  unpinContextFile(rel: string): void {
    this.focused().unpinFile(rel)
  }
  listSkills(): SkillInfo[] {
    return this.focused().listSkills()
  }
  listCommands(): CustomCommand[] {
    return loadCommands(this.focused().currentRoots())
  }
  stats(): SessionStats {
    return this.focused().stats()
  }
  listCheckpoints(): { id: string; label: string; createdAt: number; files: number; added: number; removed: number }[] {
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
    const runner = this.makeRunner(this.store.buildRow(focused.currentRoots(), crypto.randomUUID(), now()))
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
    const row = this.store.create(
      focused.currentRoots(),
      crypto.randomUUID(),
      now(),
      `fork · ${focused.currentTitle()}`,
    )
    slice.forEach((m, i) => {
      this.store.appendMessage(row.id, i, m)
    })
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
    this.applySessionSelection(id) // restore this session's model/provider/mode/effort
    runner.emitState(true)
  }
  /** Add a directory to the focused session's workspace (no new session). */
  addRoot(dir: string): void {
    this.focused().addRoot(dir)
  }
  /** Open a new session rooted at `dir` and focus it. */
  setRoot(dir: string): void {
    const runner = this.makeRunner(this.store.buildRow([dir], crypto.randomUUID(), now()))
    this.focusedId = runner.sessionId
    runner.emitState(true)
  }
  deleteSession(id: string): void {
    const r = this.runners.get(id)
    if (r) {
      if (r.busy) r.abortRun() // stop a mid-turn session before discarding it
      r.dispose()
      this.runners.delete(id)
    }
    this.store.delete(id)
    if (id === this.focusedId) {
      const next = this.store.latest(this.cwd) ?? this.store.buildRow([this.cwd], crypto.randomUUID(), now())
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
  selection(): {
    providerId?: string
    model?: string
    effort: Effort
    mode: ModeId
    reasoning: boolean
    contextWindow: number
    outputStyle?: string
    autoCompactThreshold?: number
  } {
    return {
      providerId: this.providerId,
      model: this.model,
      effort: this.effort,
      mode: this.mode,
      reasoning: this.modelReasoning,
      contextWindow: this.contextWindow,
      outputStyle: loadConfig().outputStyle,
      autoCompactThreshold: loadConfig().autoCompactThreshold,
    }
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
  async connectAndValidate(
    providerId: string,
    apiKey?: string,
    baseURL?: string,
  ): Promise<{ ok: boolean; error?: string }> {
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
    else if (baseOverride && getProviderKey(providerId))
      setProviderKey(providerId, getProviderKey(providerId)!, baseOverride)
    return { ok: true }
  }
  selectModel(
    providerId: string,
    model: string,
    reasoning = false,
    contextWindow?: number,
    cost?: { input: number; output: number },
  ): void {
    this.providerId = providerId
    this.model = model
    this.modelReasoning = reasoning
    if (contextWindow && contextWindow > 0) this.contextWindow = contextWindow
    this.modelCost = cost ?? this.modelCost
    // Save to the global config (the default for NEW sessions) AND to THIS session's meta, so resuming
    // it later restores the model it was using rather than the current global default.
    saveConfig({ providerId, model, reasoning, contextWindow: this.contextWindow || undefined, cost: this.modelCost })
    this.store.setMeta(this.focusedId, {
      providerId,
      model,
      reasoning,
      contextWindow: this.contextWindow || undefined,
      cost: this.modelCost,
    })
    this.dispatch(this.focusedId, {
      type: "model-changed",
      model,
      provider: providerId,
      reasoning,
      contextWindow: this.contextWindow,
    })
  }
  setMode(m: ModeId): void {
    this.mode = m
    this.store.setMeta(this.focusedId, { mode: m })
  }
  /**
   * Apply a session's persisted selection (model/provider/effort/mode) to the engine when it becomes
   * focused, so a resumed/switched-to session restores exactly what it was using. New sessions have no
   * meta, so the current global defaults stand. Emits model-changed; the TUI re-reads mode/effort from
   * engine.selection() on the accompanying session-changed event.
   */
  private applySessionSelection(id: string): void {
    const m = this.store.loadMeta(id)
    if (m.providerId) this.providerId = m.providerId
    if (m.model) this.model = m.model
    if (typeof m.reasoning === "boolean") this.modelReasoning = m.reasoning
    if (m.contextWindow && m.contextWindow > 0) this.contextWindow = m.contextWindow
    if (m.cost) this.modelCost = m.cost
    if (m.mode) this.mode = m.mode
    if (m.effort) this.effort = m.effort
    if (m.model) {
      this.dispatch(id, {
        type: "model-changed",
        model: this.model!,
        provider: this.providerId!,
        reasoning: this.modelReasoning,
        contextWindow: this.contextWindow,
      })
    }
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
      case "inject":
        void this.focused().injectMessage(cmd.text, cmd.images, cmd.id, cmd.interrupt)
        break
      case "inject-pause":
        this.focused().armInjectPause(cmd.interrupt)
        break
      case "inject-resume":
        this.focused().resumeInject()
        break
      case "set-mode":
        this.mode = cmd.mode
        saveConfig({ mode: cmd.mode })
        this.store.setMeta(this.focusedId, { mode: cmd.mode })
        break
      case "set-effort":
        this.effort = cmd.effort as Effort
        saveConfig({ effort: cmd.effort as Effort })
        this.store.setMeta(this.focusedId, { effort: cmd.effort as Effort })
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
