import {
  actionForKey,
  compareSemver,
  detectInstallMethod,
  type Engine,
  getLatestVersion,
  type InstallMethod,
  type KeyAction,
  type Keymap,
  loadKeybindings,
  normalizeChord,
  type PresenceRow,
  RESERVED,
  type SessionStats,
  saveKeybindings,
  type TmuxLayout,
  type TmuxPane,
} from "@friday/core"
import {
  type AskQuestion,
  applyTheme,
  cycleMode,
  DEFAULT_MODE,
  type Effort,
  type EngineEvent,
  getMode,
  type MascotState,
  type Message,
  type ModeId,
  type TodoItem,
  themeNames,
} from "@friday/shared"
import { createContext, createMemo, createSignal, type JSX, onCleanup, useContext } from "solid-js"
import { createStore, produce } from "solid-js/store"

export type ToolStatus = "running" | "done" | "error"

export type ViewItem =
  /** `text` is what's sent to the model (paste tokens expanded); `display`, when set, is the compact
   * buffer the user actually saw (with inline paste tokens) and is what the bubble renders. */
  | { kind: "user"; id: string; text: string; display?: string; mode?: ModeId }
  | {
      kind: "assistant"
      id: string
      text: string
      reasoning: string
      thinkingOpen: boolean
      done: boolean
      /** finalized mid-turn because it ended in tool calls (not the turn's last bubble) — caret off,
       * but no per-step copy/fork/meta action row. */
      intermediate?: boolean
      startedAt: number
      durationMs?: number
      /** per-turn token usage, attributed on turn-done (shown in the action row) */
      inputTokens?: number
      outputTokens?: number
      /** the mode this reply ran in — colors its ⏺ marker so you can tell at a glance */
      mode?: ModeId
      /** cut short by a /pause — renders a "⏸ paused" tag */
      interrupted?: boolean
    }
  | {
      kind: "tool"
      id: string
      name: string
      input: unknown
      status: ToolStatus
      output: string
      title?: string
      diff?: string
      open: boolean
      /** second gate: once `open`, output shows a head+tail digest until `full` reveals everything. */
      full?: boolean
    }
  | { kind: "error"; id: string; text: string }
  | { kind: "notice"; id: string; text: string; summary?: string }
  /** a flow divider shown when a plan is accepted ("running · <mode>") or refined ("refining plan");
   * tinted by the relevant mode. `note` is an optional quoted subtitle (e.g. the refinement text). */
  | { kind: "breaker"; id: string; mode: ModeId; label: string; note?: string }
  /** a /pause note injected mid-task: "pending" (sent, about to be folded in at the next step) then
   * "attached" (now part of the agent's context). `at` is when sent; `attachedAt` when it landed. */
  | { kind: "inject"; id: string; text: string; state: "pending" | "attached"; at: number; attachedAt?: number }

/**
 * Resolve which session's pending HITL prompt (permission/ask) to surface: the focused session's own
 * if it has one, otherwise the oldest background session that's waiting — so a delegated agent's
 * question reaches the user in the main view. Returns the session id (for clearing + labeling) and the
 * value (carries the requestId the reply routes back by). Pure so it's unit-testable.
 */
export function resolvePending<T>(map: Record<string, T>, active: string): { sid: string; val: T } | null {
  if (map[active]) return { sid: active, val: map[active]! }
  for (const sid of Object.keys(map)) if (map[sid]) return { sid, val: map[sid]! }
  return null
}

export type PendingPermission = { requestId: string; tool: string; summary: string; detail?: string; risk?: string }
export type PendingAsk = { requestId: string; questions: AskQuestion[] }
export type PlanEntry = { id: string; title: string; text: string }
export type SessionItem = { id: string; title: string; cwd: string; roots: string[] }
export type ChangedFile = { path: string; status: string; added: number; removed: number; kind?: "file" | "dir" }
export type TaskRow = { id: string; title: string; description: string; status: "running" | "done"; summary?: string }
export type TeamMember = { sessionId: string; role: string; status: string; activity: string }
export type TeamPost = {
  id: number
  sessionId: string
  role: string
  kind: string
  toRole?: string
  text: string
  createdAt: number
}
export type TeamState = {
  teamId: string
  goal: string
  status: string
  members: TeamMember[]
  posts: TeamPost[]
  claims: { path: string; sessionId: string }[]
}

/** Prefix of the synthetic prompt sent when a plan is accepted — recognized so history replay renders
 * it as a flow breaker instead of a user bubble (keeps plan execution looking continuous). */
const CARRY_OUT_PREFIX = "Carry out this plan, step by step:"

/** Rebuild view items from stored messages (history replay on resume/switch). */
function messagesToItems(messages: Message[]): ViewItem[] {
  const out: ViewItem[] = []
  let n = 0
  for (const m of messages) {
    if (m.role === "user") {
      // A plan-execution carry-out replays as a breaker, matching how it rendered live.
      if (m.text.startsWith(CARRY_OUT_PREFIX))
        out.push({ kind: "breaker", id: `h${n++}`, mode: DEFAULT_MODE, label: "ran plan" })
      else out.push({ kind: "user", id: `h${n++}`, text: m.text })
    } else if (m.role === "assistant") {
      if (m.text || m.reasoning)
        out.push({
          kind: "assistant",
          id: `h${n++}`,
          text: m.text ?? "",
          reasoning: m.reasoning ?? "",
          thinkingOpen: false,
          done: true,
          startedAt: 0,
        })
    } else if (m.role === "tool") {
      if (m.name === "todo_write") continue // shown in the panel, not the transcript
      out.push({
        kind: "tool",
        id: `h${n++}`,
        name: m.name,
        input: {},
        status: m.isError ? "error" : "done",
        output: m.result,
        open: false,
      })
    }
  }
  return out
}

export function createAppStore(engine: Engine, version = "dev") {
  const [view, setView] = createSignal<"shell" | "console" | "dashboard" | "exit">("shell")
  const [mode, setModeSig] = createSignal<ModeId>(engine.selection().mode ?? DEFAULT_MODE)
  const [effort, setEffortSig] = createSignal<Effort>(engine.selection().effort ?? "medium")
  const [model, setModel] = createSignal<string>(engine.selection().model ?? "no model — open /model")
  const [reasoningModel, setReasoningModel] = createSignal<boolean>(engine.selection().reasoning ?? false)
  const [providerId, setProviderId] = createSignal<string | undefined>(engine.selection().providerId)
  const [needsModel, setNeedsModel] = createSignal(false)
  const [effortOpen, setEffortOpen] = createSignal(false)
  // The wire protocol of the connected provider — drives which effort levels the slider offers.
  const providerProtocol = () => {
    const id = providerId()
    return id ? engine.listProviders().find((p) => p.id === id)?.protocol : undefined
  }

  const [rightOpen, setRightOpen] = createSignal(true)
  const [rightWidth, setRightWidth] = createSignal(28)
  const [overlayOpen, setOverlayOpen] = createSignal(false)
  const [modelModalOpen, setModelModalOpen] = createSignal(false)
  const [yoloConfirmOpen, setYoloConfirmOpen] = createSignal(false)
  const [micModalOpen, setMicModalOpen] = createSignal(false)
  // press-to-talk lifecycle for the mic modal
  const [micPhase, setMicPhase] = createSignal<"idle" | "recording" | "transcribing" | "setup" | "error">("idle")
  const [micError, setMicError] = createSignal("")
  // Non-empty → the modal shows the OS-aware setup checklist (also shown alongside an error).
  const [micSetup, setMicSetup] = createSignal<string[]>([])
  // Mic input devices + live (partial) transcription while recording.
  const [micDevices, setMicDevices] = createSignal<{ id: string; label: string }[]>([])
  const [micDevice, setMicDevice] = createSignal(0) // index into micDevices()
  const [micPartial, setMicPartial] = createSignal("")
  let micTick: ReturnType<typeof setInterval> | undefined
  // First-run-per-directory workspace trust gate (replaces the old welcome tour).
  const [trustOpen, setTrustOpen] = createSignal(!engine.isCwdTrusted())

  // First Esc while busy "arms" the stop; a second Esc within the window actually aborts.
  const [stopArmed, setStopArmed] = createSignal(false)
  // First Ctrl+C "arms" the quit; a second within the window actually exits (footer hint shows it).
  const [quitArmed, setQuitArmed] = createSignal(false)
  // Highlighted action in the permission card (0 allow-once · 1 allow-always · 2 deny).
  const [permSel, setPermSel] = createSignal(0)
  // Transient toasts (e.g. a background session finished or needs input).
  const [toasts, setToasts] = createSignal<{ id: number; text: string; kind: "done" | "input" | "error" }[]>([])
  let toastId = 0
  function pushToast(text: string, kind: "done" | "input" | "error") {
    const id = ++toastId
    setToasts((t) => [...t.slice(-3), { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }

  // Per-session state — keyed by sessionId so background sessions keep their own
  // busy/tokens/todos/pending while another session is focused on screen.
  const [sessionBusy, setSessionBusy] = createSignal<Record<string, boolean>>({})
  const [sessionNeeds, setSessionNeeds] = createSignal<Record<string, boolean>>({})
  const [sessionTokens, setSessionTokens] = createSignal<Record<string, number>>({})
  const [sessionTodos, setSessionTodos] = createSignal<Record<string, TodoItem[]>>({})
  const [sessionPending, setSessionPending] = createSignal<Record<string, PendingPermission>>({})
  const [sessionAsk, setSessionAsk] = createSignal<Record<string, PendingAsk>>({})
  // Plans proposed this session (viewable any time) + the one currently awaiting an execute decision.
  const [sessionPlans, setSessionPlans] = createSignal<Record<string, PlanEntry[]>>({})
  const [sessionPlanPending, setSessionPlanPending] = createSignal<Record<string, PlanEntry | null>>({})
  // True while the plan card is a READ-ONLY viewer (re-opened from the sidebar) vs the execute gate.
  const [planReadOnly, setPlanReadOnly] = createSignal(false)
  const [sessionDiag, setSessionDiag] = createSignal<
    Record<string, { path: string; errors: number; warnings: number }[]>
  >({})
  const [sessionCost, setSessionCost] = createSignal<Record<string, number>>({})
  // Status / mascot / git are per-session too, so switching shows the focused
  // session's real state instead of a stale global "thinking…".
  const [sessionStatus, setSessionStatus] = createSignal<Record<string, string>>({})
  const [sessionMascot, setSessionMascot] = createSignal<Record<string, MascotState>>({})
  const [sessionChanged, setSessionChanged] = createSignal<Record<string, ChangedFile[]>>({})
  // Compaction progress + controls, per session.
  const [sessionCompacting, setSessionCompacting] = createSignal<Record<string, boolean>>({})
  const [sessionCompactPct, setSessionCompactPct] = createSignal<Record<string, { before: number; after: number }>>({})
  const [sessionSummary, setSessionSummary] = createSignal<Record<string, string>>({})
  const [sessionCanUndoCompact, setSessionCanUndoCompact] = createSignal<Record<string, boolean>>({})
  // Prompts typed while a turn is running — drained one at a time at each turn boundary.
  const [sessionQueue, setSessionQueue] = createSignal<Record<string, string[]>>({})
  // The read-only "compaction summary" viewer (a string when open, null when closed) — global modal.
  const [compactionView, setCompactionView] = createSignal<string | null>(null)
  // Background tasks (agent-spawned async sessions) — global, not per focused session.
  const [tasks, setTasks] = createSignal<TaskRow[]>([])
  // Active agent team (orchestrator + shared board) — drives the console view. Null when no team.
  const [team, setTeam] = createSignal<TeamState | null>(engine.teamSnapshot() as TeamState | null)
  // Live runners owned by OTHER terminals in this project (cross-process presence), polled on refresh.
  const [remoteAgents, setRemoteAgents] = createSignal<PresenceRow[]>(engine.remoteAgents())
  // Optional usage budget (tokens/$) — drives a warning in the context panel when exceeded.
  const [budget, setBudget] = createSignal<{ tokens?: number; usd?: number } | null>(engine.userConfig().budget ?? null)
  // Per-session unread marker: the item count last seen while focused on a session.
  const [sessionSeenLen, setSessionSeenLen] = createSignal<Record<string, number>>({})
  const [contextWindow, setContextWindow] = createSignal(0)
  const setKey = <T,>(set: (fn: (m: Record<string, T>) => Record<string, T>) => void, sid: string, v: T) =>
    set((m) => ({ ...m, [sid]: v }))
  const delKey = <T,>(set: (fn: (m: Record<string, T>) => Record<string, T>) => void, sid: string) =>
    set((m) => {
      if (!(sid in m)) return m
      const n = { ...m }
      delete n[sid]
      return n
    })

  const [activeSession, setActiveSession] = createSignal(engine.currentSessionId())
  // View items, keyed by session. Background sessions keep building their own
  // transcript so switching to a live session shows its in-flight turn.
  const [sessionItems, setSessionItems] = createStore<Record<string, ViewItem[]>>({})
  const seeded = new Set<string>()
  // Memoized so the focused-session arrays keep a stable identity between unrelated re-renders —
  // a fresh `?? []` each call would make <For> re-create rows and flicker. EMPTY is shared so the
  // "no data yet" case is referentially stable too.
  const EMPTY: never[] = []
  const items = createMemo(() => sessionItems[activeSession()] ?? EMPTY)
  const [contextFiles, setContextFiles] = createSignal<string[]>(engine.contextInfo().files)
  const [pinnedFiles, setPinnedFiles] = createSignal<string[]>(engine.contextInfo().pinned)
  const [contextModalOpen, setContextModalOpen] = createSignal(false)
  const [skills, setSkills] = createSignal(engine.listSkills())
  const [agentDefs, setAgentDefs] = createSignal(engine.listAgents())
  const [teamDefs, setTeamDefs] = createSignal(engine.listTeams())
  const [mcpServers, setMcpServers] = createSignal(engine.listMcpServers())
  const [sessions, setSessions] = createSignal<SessionItem[]>(engine.listSessions())
  const [allSessions, setAllSessions] = createSignal(engine.listAllSessions())
  const changedFiles = createMemo(() => sessionChanged()[activeSession()] ?? EMPTY)
  const runningTools = createMemo(() =>
    items()
      .filter((i) => i.kind === "tool" && i.status === "running")
      .map((i) => (i as any).title ?? (i as any).name),
  )
  const [currentCwd, setCurrentCwd] = createSignal(engine.currentCwd())
  const [roots, setRoots] = createSignal<string[]>(engine.currentRoots())
  const [historyOpen, setHistoryOpen] = createSignal(false)
  const [dirModalOpen, setDirModalOpen] = createSignal(false)
  const [pauseModalOpen, setPauseModalOpen] = createSignal(false)
  const [mcpModalOpen, setMcpModalOpen] = createSignal(false)
  const [skillsModalOpen, setSkillsModalOpen] = createSignal(false)
  const [computerModalOpen, setComputerModalOpen] = createSignal(false)
  // Computer-use backend state, mirrored reactively for the modal (engine.computerInstalled() is a
  // plain fs check, not reactive).
  const [computerReady, setComputerReady] = createSignal(engine.computerInstalled())
  const [computerInstalling, setComputerInstalling] = createSignal(false)
  const [computerInstallLog, setComputerInstallLog] = createSignal("")
  function installComputer() {
    if (computerInstalling() || engine.computerInstalled()) return
    setComputerInstalling(true)
    setComputerInstallLog("")
    engine
      .installComputerUse()
      .then((r) => {
        setComputerInstallLog(r.log)
        setComputerReady(r.ok)
        if (r.ok) engine.activateTools("computer_") // make the desktop tools available this session
      })
      .catch((e) => setComputerInstallLog(String(e?.message ?? e)))
      .finally(() => setComputerInstalling(false))
  }
  function uninstallComputer() {
    engine.uninstallComputerUse()
    setComputerReady(engine.computerInstalled())
  }
  /** Open the macOS privacy pane for the permission computer-use needs (control = Accessibility,
   * screenshot = Screen Recording) so the user can click-grant instead of hunting through Settings. */
  function openMacPrivacy(pane: "accessibility" | "screen") {
    if (process.platform !== "darwin") {
      pushToast("opening privacy settings is only supported on macOS", "input")
      return
    }
    const anchor = pane === "accessibility" ? "Privacy_Accessibility" : "Privacy_ScreenCapture"
    try {
      Bun.spawn(["open", `x-apple.systempreferences:com.apple.preference.security?${anchor}`])
      pushToast(`opened ${pane === "accessibility" ? "Accessibility" : "Screen Recording"} settings`, "done")
    } catch (e) {
      pushToast(`couldn't open settings: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }
  const [checkpointsOpen, setCheckpointsOpen] = createSignal(false)
  const [forkOpen, setForkOpen] = createSignal(false)
  const [settingsModalOpen, setSettingsModalOpen] = createSignal(false)
  const [themeModalOpen, setThemeModalOpen] = createSignal(false)
  const [newlineMode, setNewlineMode] = createSignal<"shift" | "alt" | "both">(
    engine.userConfig().composerNewline ?? "both",
  )
  // Config-backed UI settings mirrored as signals so the Settings rows update the instant they change
  // (engine.userConfig() is a plain fs read, not reactive).
  const [autoupdate, setAutoupdateSig] = createSignal<"notify" | "off">(engine.userConfig().autoupdate ?? "notify")
  const [outputStyle, setOutputStyleSig] = createSignal<string>(engine.userConfig().outputStyle ?? "concise")
  const [formatterOn, setFormatterSig] = createSignal<boolean>(engine.userConfig().formatter !== false)
  const [autoCompactThreshold, setAutoCompactSig] = createSignal<number>(
    engine.userConfig().autoCompactThreshold ?? 0.85,
  )

  // Rebindable keymap (~/.friday/keybindings.json over defaults). The global handler dispatches the
  // named action a key resolves to; /settings edits the bindings and persists them.
  const [keymap, setKeymap] = createSignal<Keymap>(loadKeybindings())
  const keyAction = (key: Parameters<typeof actionForKey>[0]): KeyAction | undefined => actionForKey(key, keymap())
  /** Rebind an action to a chord. Returns false (and no-ops) if the chord is reserved. */
  function rebind(action: KeyAction, chord: string): boolean {
    const norm = normalizeChord(chord)
    if (RESERVED.includes(norm)) return false
    const next = { ...keymap(), [action]: norm }
    setKeymap(next)
    saveKeybindings(next)
    return true
  }
  function resetKeybindings() {
    saveKeybindings({}) // wipe overrides → file holds nothing → load yields pure defaults
    setKeymap(loadKeybindings())
  }

  // ---- version updates ----
  // "idle" until a check runs; "checking" while querying npm; "current"/"available" after; "updating"
  // during the upgrade; "done"/"error" after. updateLatest holds the newest version when available.
  const [updateModalOpen, setUpdateModalOpen] = createSignal(false)
  const [updateState, setUpdateState] = createSignal<
    "idle" | "checking" | "current" | "available" | "updating" | "done" | "error"
  >("idle")
  const [updateLatest, setUpdateLatest] = createSignal<string | null>(null)
  const [updateLog, setUpdateLog] = createSignal("")
  const [updateMethod, setUpdateMethod] = createSignal<InstallMethod>(detectInstallMethod())
  const [wantsRestart, setWantsRestart] = createSignal(false)
  // Post-teardown update: the modal's "update & restart" sets this so finalizeExit runs the
  // package-manager upgrade in the restored normal terminal (NOT inside the alt-screen), then relaunches.
  const [wantsUpdate, setWantsUpdate] = createSignal(false)

  /** Query npm for the latest version; flag "available" when newer than the running build. */
  async function checkForUpdate(): Promise<void> {
    setUpdateState("checking")
    const latest = await getLatestVersion()
    engine.setUserConfig({ lastUpdateCheck: Date.now() })
    if (!latest) {
      setUpdateState("error")
      setUpdateLog("could not reach the npm registry")
      return
    }
    setUpdateLatest(latest)
    const newer = version !== "dev" && compareSemver(latest, version) > 0
    // Record the newest version so the next reopen can auto-update instantly (no network wait).
    if (newer) engine.setUserConfig({ latestKnown: latest })
    setUpdateState(newer ? "available" : "current")
  }
  /** Apply a theme live + persist it. Live switch repaints what re-renders; a restart guarantees all. */
  function applyThemeNow(name: string) {
    engine.setUserConfig({ theme: name })
    applyTheme(name)
    setThemeModalOpen(false)
    pushToast(`theme “${name}” saved — restart to apply fully`, "done")
  }

  // Focused-session views of the per-session maps.
  const status = () => sessionStatus()[activeSession()] ?? "ready"
  const mascot = () => sessionMascot()[activeSession()] ?? ("idle" as MascotState)
  const busy = () => !!sessionBusy()[activeSession()]
  const tokens = () => sessionTokens()[activeSession()] ?? 0
  const todos = createMemo(() => sessionTodos()[activeSession()] ?? EMPTY)
  // HITL prompts (permission / ask) surface in the MAIN view even when they come from a delegated
  // background agent: prefer the focused session's own pending, else the oldest background one that's
  // waiting. The reply routes back by requestId (engine matches across all runners), so answering from
  // here bridges to the right agent. `*From` returns the asking agent's label when it isn't the focused
  // session, so the card can show "agent X asks".
  const pendingSrc = () => resolvePending(sessionPending(), activeSession())
  const askSrc = () => resolvePending(sessionAsk(), activeSession())
  const pending = () => pendingSrc()?.val ?? null
  const askPending = () => askSrc()?.val ?? null
  const pendingFrom = () => {
    const s = pendingSrc()
    return s && s.sid !== activeSession() ? titleOf(s.sid) : null
  }
  const askFrom = () => {
    const s = askSrc()
    return s && s.sid !== activeSession() ? titleOf(s.sid) : null
  }
  const plans = createMemo(() => sessionPlans()[activeSession()] ?? EMPTY)
  const planPending = () => sessionPlanPending()[activeSession()] ?? null
  const diagnostics = createMemo(() => sessionDiag()[activeSession()] ?? EMPTY)
  const cost = () => sessionCost()[activeSession()] ?? 0
  const sessionRunning = (id: string) => !!sessionBusy()[id]
  const sessionNeedsInput = (id: string) => !!sessionNeeds()[id]
  const sessionTokenCount = (id: string) => sessionTokens()[id] ?? 0
  const compacting = () => !!sessionCompacting()[activeSession()]
  const compactPct = () => sessionCompactPct()[activeSession()] ?? { before: 0, after: 0 }
  const lastSummary = () => sessionSummary()[activeSession()] ?? null
  const canUndoCompact = () => !!sessionCanUndoCompact()[activeSession()]
  const queued = (): string[] => sessionQueue()[activeSession()] ?? (EMPTY as string[])

  // Single source of truth: is ANY blocking overlay / modal / HITL prompt on screen?
  // Used to blur the composer, gate global keys, and freeze chat scroll so keystrokes never
  // leak into the prompt while a modal owns the keyboard. Every new overlay must be OR'd in here
  // (and nowhere else) — that's the whole point of centralizing it.
  const anyModalOpen = () =>
    overlayOpen() ||
    modelModalOpen() ||
    yoloConfirmOpen() ||
    micModalOpen() ||
    trustOpen() ||
    effortOpen() ||
    historyOpen() ||
    dirModalOpen() ||
    pauseModalOpen() ||
    mcpModalOpen() ||
    skillsModalOpen() ||
    contextModalOpen() ||
    computerModalOpen() ||
    checkpointsOpen() ||
    forkOpen() ||
    settingsModalOpen() ||
    themeModalOpen() ||
    updateModalOpen() ||
    compacting() ||
    !!compactionView() ||
    !!pending() ||
    !!askPending() ||
    !!planPending()

  const titleOf = (id: string) =>
    allSessions().find((s) => s.id === id)?.title ?? sessions().find((s) => s.id === id)?.title ?? "session"

  const refreshSessions = () => {
    setSessions(engine.listSessions())
    setAllSessions(engine.listAllSessions())
    setContextFiles(engine.contextInfo().files)
    setPinnedFiles(engine.contextInfo().pinned)
    setSkills(engine.listSkills())
    setAgentDefs(engine.listAgents())
    setTeamDefs(engine.listTeams())
    // Cross-terminal sync: re-read shared state every poll so teams/tasks/sessions started in another
    // terminal of this project show up here (hot-reload), and stale ones drop off.
    setRemoteAgents(engine.remoteAgents())
    setTeam((cur) => {
      const snap = engine.teamSnapshot() as TeamState | null
      // Don't clobber a locally-driven team's richer live state with a thinner DB snapshot of the same team.
      return cur && snap && cur.teamId === snap.teamId ? cur : snap
    })
  }

  const pinContextFile = (rel: string) => {
    engine.pinContextFile(rel)
    setPinnedFiles(engine.contextInfo().pinned)
  }
  const unpinContextFile = (rel: string) => {
    engine.unpinContextFile(rel)
    setPinnedFiles(engine.contextInfo().pinned)
  }

  let localId = 0
  const nextLocalId = () => `u${++localId}`

  // Latest cumulative usage per session, attributed to the assistant bubble on turn-done.
  const lastUsage = new Map<string, { input: number; output: number }>()

  // The composer textarea renderable. OpenTUI's autoFocus blurs it when another focusable
  // element is clicked; we keep a handle so focus can be re-asserted (so the user never has
  // to click back into the prompt before typing).
  let composerEl: { focus?: () => void; setText?: (s: string) => void; cursorOffset?: number } | null = null
  function registerComposer(el: any) {
    composerEl = el
  }
  function focusComposer() {
    // Defer so a key that dismissed a modal (and triggered this) can't leak into the refocused composer.
    queueMicrotask(() => composerEl?.focus?.())
  }
  /** Replace the composer text (e.g. when rewinding to a past prompt) and focus it. */
  function setComposerText(text: string) {
    composerEl?.setText?.(text)
    if (composerEl) composerEl.cursorOffset = text.length
    focusComposer()
  }
  /** True when the composer is empty/whitespace — used to gate the `?` help shortcut so it never
   * eats a literal "?" typed mid-sentence. */
  function composerEmpty(): boolean {
    const t = (composerEl as any)?.plainText
    return !t || !String(t).trim()
  }
  /** Clear the composer WITHOUT focusing it (used to wipe a stray key after opening an overlay). */
  function clearComposer() {
    composerEl?.setText?.("")
    if (composerEl) composerEl.cursorOffset = 0
  }

  // True when a non-focused session has produced output since we last looked at it.
  const sessionActivity = (id: string) =>
    id !== activeSession() && (sessionItems[id]?.length ?? 0) > (sessionSeenLen()[id] ?? 0)

  function appendItem(sid: string, item: ViewItem) {
    seeded.add(sid)
    setSessionItems(produce((m) => void (m[sid] ??= []).push(item)))
  }
  function patchItemIn(sid: string, id: string, fn: (it: ViewItem) => void) {
    setSessionItems(
      produce((m) => {
        const it = m[sid]?.find((i) => i.id === id)
        if (it) fn(it)
      }),
    )
  }
  /** Patch an item in the focused session (used by toggle handlers). */
  function patchItem(id: string, fn: (it: ViewItem) => void) {
    patchItemIn(activeSession(), id, fn)
  }
  /** Seed a session's transcript from stored messages, but never clobber a live buffer. */
  function seedSession(sid: string, messages: Message[]) {
    if (seeded.has(sid)) return
    seeded.add(sid)
    setSessionItems(sid, messagesToItems(messages))
  }

  // ---- streaming coalescing ----
  // A fast provider stream (e.g. GPT-5) emits many small text/reasoning deltas. Patching the
  // store on every one re-parses the markdown and re-renders the whole rail per token, which
  // saturates the event loop and starves keyboard input (dropped Esc, laggy typing). Instead we
  // accumulate deltas per assistant item and flush them in ONE store update at ~30fps.
  const streamBuf = new Map<string, { sid: string; id: string; text: string; reasoning: string }>()
  const streamSeen = new Set<string>() // `${id}:${field}` that already had their first (instant) delta
  let flushTimer: ReturnType<typeof setInterval> | null = null
  function applyAccumulated(sid: string, id: string, text: string, reasoning: string) {
    setSessionItems(
      produce((m) => {
        const it = m[sid]?.find((i) => i.id === id)
        if (it?.kind === "assistant") {
          if (text) it.text += text
          if (reasoning) it.reasoning += reasoning
        }
      }),
    )
  }
  function flushStream() {
    if (streamBuf.size === 0) {
      if (flushTimer) {
        clearInterval(flushTimer)
        flushTimer = null
      }
      return
    }
    const pending = [...streamBuf.values()]
    streamBuf.clear()
    setSessionItems(
      produce((m) => {
        for (const b of pending) {
          const it = m[b.sid]?.find((i) => i.id === b.id)
          if (it?.kind === "assistant") {
            if (b.text) it.text += b.text
            if (b.reasoning) it.reasoning += b.reasoning
          }
        }
      }),
    )
  }
  function bufferDelta(sid: string, id: string, field: "text" | "reasoning", delta: string) {
    // The first delta of each field renders immediately (instant first-token feedback); the rest
    // are coalesced and flushed at ~30fps so a fast stream can't starve the event loop / input.
    const key = `${id}:${field}`
    if (!streamSeen.has(key)) {
      streamSeen.add(key)
      applyAccumulated(sid, id, field === "text" ? delta : "", field === "reasoning" ? delta : "")
      return
    }
    let b = streamBuf.get(id)
    if (!b) streamBuf.set(id, (b = { sid, id, text: "", reasoning: "" }))
    b[field] += delta
    // ~18fps: coarse enough that each flush carries a meaningful chunk (so markdown re-parses land
    // as steady growth, not per-token flicker) while still feeling live.
    if (!flushTimer) flushTimer = setInterval(flushStream, 55)
  }
  /** Apply any buffered deltas for one item immediately (used when its turn finalizes). */
  function flushItem(id: string) {
    streamSeen.delete(`${id}:text`)
    streamSeen.delete(`${id}:reasoning`)
    const b = streamBuf.get(id)
    if (!b) return
    streamBuf.delete(id)
    applyAccumulated(b.sid, id, b.text, b.reasoning)
  }

  // ---- engine event handling ----
  engine.subscribe((e: EngineEvent) => {
    const sid = e.sessionId
    const focused = sid === activeSession()
    switch (e.type) {
      case "ready":
        setNeedsModel(e.needsModel)
        // No model yet → go straight to the picker (no welcome tour). Defer if the trust gate is up;
        // accepting trust opens the picker itself.
        if (e.needsModel && !trustOpen()) setModelModalOpen(true)
        break
      case "model-changed":
        setModel(e.model)
        setReasoningModel(e.reasoning)
        setProviderId(e.provider)
        if (e.contextWindow != null) setContextWindow(e.contextWindow)
        setNeedsModel(false)
        break
      case "message-start":
        setKey(setSessionBusy, sid, true)
        appendItem(sid, {
          kind: "assistant",
          id: e.id,
          text: "",
          reasoning: "",
          thinkingOpen: true,
          done: false,
          startedAt: Date.now(),
          mode: e.mode,
        })
        break
      case "text":
        bufferDelta(sid, e.id, "text", e.delta)
        break
      case "reasoning":
        bufferDelta(sid, e.id, "reasoning", e.delta)
        break
      case "tool-call":
        appendItem(sid, {
          kind: "tool",
          id: e.callId,
          name: e.name,
          input: e.input,
          status: "running",
          output: "",
          open: false,
        })
        break
      case "tool-result":
        patchItemIn(sid, e.callId, (it) => {
          if (it.kind === "tool") {
            it.status = e.ok ? "done" : "error"
            it.output = e.output
            it.title = e.title
            it.diff = e.diff
          }
        })
        break
      case "permission-request":
        setKey(setSessionPending, sid, {
          requestId: e.requestId,
          tool: e.tool,
          summary: e.summary,
          detail: e.detail,
          risk: e.risk,
        })
        setKey(setSessionNeeds, sid, true)
        if (focused) setPermSel(0)
        else pushToast(`⚠ ${titleOf(sid)} needs input`, "input")
        break
      case "ask-user":
        setKey(setSessionAsk, sid, { requestId: e.requestId, questions: e.questions })
        setKey(setSessionNeeds, sid, true)
        if (!focused) pushToast(`⚠ ${titleOf(sid)} asks a question`, "input")
        break
      case "plan-ready": {
        const title =
          e.plan
            .split("\n")
            .map((s) => s.trim())
            .find(Boolean)
            ?.replace(/^#+\s*/, "")
            .slice(0, 60) ?? "plan"
        const entry: PlanEntry = { id: nextLocalId(), title, text: e.plan }
        setSessionPlans((m) => ({ ...m, [sid]: [...(m[sid] ?? []), entry] }))
        setPlanReadOnly(false) // a fresh plan is the execute gate, not the read-only viewer
        setKey(setSessionPlanPending, sid, entry)
        setKey(setSessionNeeds, sid, true)
        if (!focused) pushToast(`◐ ${titleOf(sid)} has a plan ready`, "input")
        break
      }
      case "turn-done": {
        if (sessionBusy()[sid] && !focused) pushToast(`✓ ${titleOf(sid)} finished`, "done")
        setKey(setSessionBusy, sid, false)
        flushItem(e.id) // apply any buffered tail before finalizing so no token is lost
        const u = lastUsage.get(sid)
        patchItemIn(sid, e.id, (it) => {
          if (it.kind !== "assistant") return
          it.done = true
          it.thinkingOpen = false
          it.durationMs = Date.now() - it.startedAt
          if (u) {
            it.inputTokens = u.input
            it.outputTokens = u.output
          }
        })
        lastUsage.delete(sid)
        // Defer to a macrotask: turn-done fires from inside the loop while the runner is still busy
        // (its finally — which flips runner.busy false — runs a microtask later). A setTimeout(0) lets
        // that finally and the trailing "ready" complete first, so the next prompt isn't dropped by
        // runPrompt's own busy guard.
        setTimeout(() => drainQueue(sid), 0)
        break
      }
      case "message-stop":
        // Finalize an intermediate assistant bubble (it ended in tool calls) so its streaming caret
        // stops and its markdown stabilizes — WITHOUT clearing busy or attributing usage (the turn
        // continues; usage belongs to the final bubble).
        flushItem(e.id)
        patchItemIn(sid, e.id, (it) => {
          if (it.kind !== "assistant") return
          it.done = true
          it.intermediate = true
          it.thinkingOpen = false
          it.durationMs = Date.now() - it.startedAt
          if (e.interrupted) it.interrupted = true
        })
        break
      case "usage":
        // `input`/`output` are cumulative for the whole turn — remember the latest snapshot so it
        // can be attributed to the assistant bubble when the turn finalizes (per-message metadata).
        lastUsage.set(sid, { input: e.input, output: e.output })
        setKey(setSessionTokens, sid, e.input + e.output)
        if (e.costUsd != null) setKey(setSessionCost, sid, e.costUsd)
        break
      case "status":
        setKey(setSessionStatus, sid, e.text)
        if (e.tokens != null) setKey(setSessionTokens, sid, e.tokens)
        // Defensive backstop: "ready"/"stopped" are terminal, so clear busy even if a turn-done
        // was somehow missed — this is what stops a runaway elapsed timer after Esc.
        if (e.text === "ready" || e.text === "stopped") setKey(setSessionBusy, sid, false)
        break
      case "mascot":
        setKey(setSessionMascot, sid, e.state)
        break
      case "todos":
        setKey(setSessionTodos, sid, e.items)
        break
      case "plans":
        // The persisted plan list (on resume) — replace so the Context panel matches what's saved.
        setSessionPlans((m) => ({ ...m, [sid]: e.items }))
        break
      case "diagnostics":
        setKey(setSessionDiag, sid, e.items)
        break
      case "session-files":
        setKey(setSessionChanged, sid, e.items)
        break
      case "notice":
        appendItem(sid, { kind: "notice", id: nextLocalId(), text: e.text })
        break
      case "tasks":
        // Global (not per-session): the agent-spawned background tasks panel.
        setTasks(e.items)
        break
      case "team":
        // Global: the agent-team shared board, feeds the console view.
        setTeam(e.team as TeamState | null)
        break
      case "compaction-start":
        setKey(setSessionCompacting, sid, true)
        setKey(setSessionCompactPct, sid, { before: e.pctBefore, after: e.pctBefore })
        break
      case "compaction": {
        const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
        setKey(setSessionCompacting, sid, false)
        const before = sessionCompactPct()[sid]?.before ?? e.pctAfter
        setKey(setSessionCompactPct, sid, { before, after: e.pctAfter })
        setKey(setSessionSummary, sid, e.summary)
        setKey(setSessionCanUndoCompact, sid, true)
        appendItem(sid, {
          kind: "notice",
          id: nextLocalId(),
          text: `↻ compacted ${e.turnsCompacted} earlier messages · kept ${e.kept} recent · ~${k(e.tokensBefore)} → ${k(e.tokensAfter)} tokens · view summary`,
          summary: e.summary,
        })
        break
      }
      case "compaction-aborted":
        setKey(setSessionCompacting, sid, false)
        break
      case "error":
        appendItem(sid, { kind: "error", id: nextLocalId(), text: e.message })
        setKey(setSessionBusy, sid, false)
        break
      case "inject-attached":
        // The /pause note just landed in the agent's context — flip its chip pending → attached.
        patchItemIn(sid, e.id, (it) => {
          if (it.kind === "inject") {
            it.state = "attached"
            it.attachedAt = Date.now()
          }
        })
        break
      case "session-changed":
        // Metadata/list refresh — NOT a focus change (that's session-loaded).
        if (focused) {
          setCurrentCwd(e.cwd)
          setRoots(e.roots)
        }
        refreshSessions()
        break
      case "session-loaded": {
        // The focus signal: this session is now on screen.
        setActiveSession(sid)
        seedSession(sid, e.messages)
        setKey(setSessionSeenLen, sid, sessionItems[sid]?.length ?? 0)
        setCurrentCwd(e.cwd)
        setRoots(e.roots)
        // Re-sync the per-session selection the engine just restored (mode/effort/model), so switching
        // to or resuming a session shows what IT was using, not the previous session's settings.
        const sel = engine.selection()
        setModeSig(sel.mode ?? DEFAULT_MODE)
        setEffortSig(sel.effort ?? "medium")
        if (sel.model) setModel(sel.model)
        setReasoningModel(sel.reasoning ?? false)
        setProviderId(sel.providerId)
        refreshSessions()
        break
      }
    }
  })

  // ---- actions ----
  function applyMode(next: ModeId) {
    setModeSig(next)
    engine.setMode(next)
    engine.send({ type: "set-mode", mode: next })
  }
  function toggleMode(dir: 1 | -1 = 1) {
    const next = cycleMode(mode(), dir)
    // Entering yolo grants blanket approval (edits, shell, browser, computer) with no prompts —
    // gate it behind an explicit confirmation so nobody lands here by accidentally cycling modes.
    if (next === "yolo" && mode() !== "yolo") {
      setYoloConfirmOpen(true)
      return
    }
    applyMode(next)
  }
  function confirmYolo() {
    setYoloConfirmOpen(false)
    applyMode("yolo")
  }
  function cancelYolo() {
    setYoloConfirmOpen(false)
  }
  /** Insert transcribed text into the composer, appending to anything already typed. */
  function insertTranscript(text: string) {
    const cur = (composerEl as any)?.plainText ? String((composerEl as any).plainText).trim() : ""
    setComposerText(cur ? `${cur} ${text}` : text)
  }
  function stopMicTick() {
    if (micTick) clearInterval(micTick)
    micTick = undefined
  }
  /** Begin capture on the selected device and stream a live (partial) transcription into the modal. */
  function startMicCapture() {
    const dev = micDevices()[micDevice()]?.id
    engine.startMic(dev)
    setMicPartial("")
    setMicPhase("recording")
    stopMicTick()
    micTick = setInterval(() => {
      if (micPhase() !== "recording") return
      engine
        .transcribePartial()
        .then((t) => t && setMicPartial(t))
        .catch(() => {})
    }, 2000)
  }
  /** Cycle the mic input device while the picker is open; restarts capture on the new device. */
  function cycleMicDevice(dir: 1 | -1) {
    const n = micDevices().length
    if (n < 2 || micPhase() !== "recording") return
    setMicDevice((i) => (i + dir + n) % n)
    engine.cancelMic()
    startMicCapture()
  }
  /** Close the mic modal, cancelling an in-progress recording. */
  function closeMic() {
    stopMicTick()
    if (micPhase() === "recording") engine.cancelMic()
    setMicPartial("")
    setMicModalOpen(false)
    setMicPhase("idle")
    setMicError("")
    setMicSetup([])
  }
  /**
   * Mic toggle (Ctrl+R) — press-to-talk, on-device whisper. First press records; second press stops
   * and transcribes locally, inserting into the composer. If the mic isn't set up, the modal shows an
   * OS-aware checklist (and stays open on error) instead of a toast that vanishes.
   */
  function toggleMic() {
    if (micPhase() === "recording") {
      // stop & transcribe locally (may take a moment, esp. on first run while the model loads)
      stopMicTick()
      setMicPhase("transcribing")
      engine
        .stopMic()
        .then((text) => {
          setMicModalOpen(false)
          setMicPhase("idle")
          if (text) {
            insertTranscript(text)
            pushToast("transcribed — edit & press Enter to send", "done")
          } else pushToast("nothing heard", "input")
        })
        .catch((e) => {
          setMicError(e?.message ?? String(e))
          setMicSetup(engine.micSetupSteps().lines)
          setMicPhase("error")
        })
      return
    }
    if (micModalOpen()) return closeMic() // setup/error/transcribing modal open → toggle off
    const st = engine.micStatus()
    if (!st.ok) {
      setMicSetup(engine.micSetupSteps().lines)
      setMicError("")
      setMicPhase("setup")
      setMicModalOpen(true)
      return
    }
    try {
      setMicDevices(engine.micInputDevices())
      setMicDevice(0)
      setMicError("")
      setMicSetup([])
      setMicModalOpen(true)
      startMicCapture()
    } catch (e: any) {
      setMicError(e?.message ?? String(e))
      setMicSetup(engine.micSetupSteps().lines)
      setMicPhase("error")
      setMicModalOpen(true)
    }
  }
  // ---- dashboard launchers + the tmux "wall" (real, tile-able terminals managed from the dashboard) ----
  /** A window-launch failure message that names the real reason (truncated) instead of a generic line. */
  const winFail = (r: { backend: string; error?: string }, what: string) =>
    r.error ? `couldn't open ${what} (${r.backend}): ${r.error.slice(0, 120)}` : `no terminal backend to open ${what}`

  // The wall: a tmux session of tiled panes. When tmux is available the dashboard launches work INTO
  // the wall (real terminals you can tile + close from here); otherwise it falls back to OS windows.
  const tmuxOn = () => engine.tmuxOn()
  const [wallPanes, setWallPanes] = createSignal<TmuxPane[]>([])
  const refreshWall = () => {
    if (tmuxOn()) void engine.wallList().then(setWallPanes)
  }
  /** Add a friday pane to the wall (args = [] new chat · ["-s",id] resume · ["attach",id] watch). */
  function addToWall(args: string[], title: string, cwd?: string) {
    void engine.wallOpen(args, title, cwd).then((r) => {
      pushToast(r.ok ? `added "${title}" to the wall` : `wall: ${r.error ?? "failed"}`, r.ok ? "done" : "error")
      refreshWall()
    })
  }
  function removeWallPane(paneId: string) {
    void engine.wallRemove(paneId).then(() => refreshWall())
  }
  function closeWall() {
    void engine.wallRemoveAll().then(() => {
      setWallPanes([])
      pushToast("closed the wall", "input")
    })
  }
  function arrangeWall(layout: TmuxLayout) {
    void engine
      .wallArrange(layout)
      .then((r) => pushToast(r.ok ? `wall: ${layout}` : `wall: ${r.error ?? "failed"}`, "input"))
  }
  /** Open a real OS terminal attached to the wall so you watch every pane tiled. */
  function viewWall() {
    const r = engine.wallView()
    pushToast(r.ok ? `opened the wall (${r.backend})` : winFail(r, "the wall"), r.ok ? "done" : "error")
  }

  /** Open a brand-new chat — into the wall when tmux is available, else its own OS window. */
  function newChatWindow() {
    if (tmuxOn()) return addToWall([], "new chat")
    const r = engine.openInteractive([])
    pushToast(r.ok ? `opened new chat (${r.backend})` : winFail(r, "a window"), r.ok ? "done" : "error")
  }
  /** Resume an existing session, in its own folder. Into the wall when tmux is available. */
  function resumeInWindow(id: string) {
    const row = allSessions().find((s) => s.id === id) ?? sessions().find((s) => s.id === id)
    if (tmuxOn()) return addToWall(["-s", id], row?.title ?? "session", row?.cwd)
    const r = engine.openInteractive(["-s", id], row?.cwd)
    pushToast(r.ok ? `opened session (${r.backend})` : winFail(r, "the session"), r.ok ? "done" : "error")
  }
  /** Fan out a swarm of independent agents (one task per line) + a watch pane/window for each. */
  function launchSwarm(tasks: string[]) {
    const jobs = tasks
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ description: t.slice(0, 40), prompt: t }))
    if (!jobs.length) return
    const ids = engine.spawnAgents(jobs)
    for (const id of ids) {
      if (tmuxOn()) void engine.wallOpen(["attach", id], "swarm")
      else engine.popoutAgent(id) // read-only watch window per agent
    }
    refreshWall()
    pushToast(`spawned ${ids.length} swarm agent(s)`, "done")
  }
  /** Ask Friday to form a coordinated team for a goal (it decides the roles via the team tool). */
  function launchTeam(goal: string) {
    const g = goal.trim()
    if (!g) return
    setView("shell")
    submit(`Form an agent team to accomplish this goal. Decide the roles yourself and call the team tool.\n\nGoal: ${g}`)
  }
  /** Delegate a task to a named agent def (background session). */
  function launchAgent(name: string, task: string) {
    const t = task.trim()
    if (!t) return
    setView("shell")
    submit(`Delegate this to the "${name}" agent: call delegate({ agent: "${name}", background: true, prompt }).\n\nTask: ${t}`)
  }
  /** Launch a reusable team def toward a goal (roster pre-filled from the team def). */
  function launchTeamDef(name: string, goal: string) {
    const prompt = engine.teamPromptFor(name, goal.trim())
    if (!prompt) return
    setView("shell")
    submit(prompt)
  }
  function setEffort(e: Effort) {
    setEffortSig(e)
    engine.send({ type: "set-effort", effort: e })
  }

  const BUILTIN_COMMANDS: { name: string; description: string }[] = [
    { name: "model", description: "connect a provider / pick a model" },
    { name: "effort", description: "set reasoning effort (slider)" },
    { name: "new", description: "start a new session in this window" },
    { name: "clear", description: "clear the conversation (reset this window)" },
    { name: "resume", description: "resume or switch to another session" },
    { name: "fork", description: "branch a session from a past turn" },
    { name: "dir", description: "change or add a working directory" },
    { name: "pause", description: "pause the agent — opens a composer to add context it missed" },
    { name: "mic", description: "talk to Friday — on-device speech-to-text (Ctrl+R)" },
    { name: "mcp", description: "view / add / remove MCP servers" },
    { name: "skills", description: "browse installed skills and run one" },
    { name: "agent", description: "create a reusable agent (AI wizard) — writes .friday/agents/<name>.md" },
    { name: "team", description: "create a reusable team (AI wizard) — writes .friday/teams/<name>.json" },
    { name: "compact", description: "summarize old context to free space" },
    { name: "init", description: "scan the repo and write a FRIDAY.md guide (runs as a prompt)" },
    { name: "context", description: "show what's in the context window" },
    { name: "usage", description: "show token + cost usage this session" },
    { name: "doctor", description: "check model, provider & environment health" },
    { name: "dashboard", description: "dashboard — Sessions · Teams · Swarm (Ctrl+O)" },
    { name: "console", description: "live agent-team cockpit — shared board + roster (Ctrl+T)" },
    { name: "fleet", description: "swarm: open an external window per running agent (inline view: Ctrl+O)" },
    { name: "browser", description: "launch the browser + activate browser tools (/browser close to stop)" },
    { name: "chrome", description: "alias for /browser" },
    { name: "computer", description: "desktop control — open the install / device-support panel" },
    { name: "review", description: "review uncommitted changes and report issues (runs as a prompt)" },
    { name: "security-review", description: "audit uncommitted changes for security issues (runs as a prompt)" },
    { name: "permissions", description: "view / clear remembered approvals" },
    { name: "theme", description: "switch UI theme" },
    { name: "settings", description: "open settings — autoupdate, keybindings, editor, theme" },
    { name: "update", description: "check for a new version & update friday" },
    { name: "budget", description: "set a token/$ usage budget" },
    { name: "commit", description: "stage all & commit (drafts message)" },
    { name: "undo", description: "rewind files + chat to a checkpoint" },
    { name: "help", description: "show the keymap" },
    { name: "restart", description: "relaunch friday, resuming this session" },
    { name: "exit", description: "quit Friday (clean exit)" },
  ]

  function listCommands(): { name: string; description: string }[] {
    return [...BUILTIN_COMMANDS, ...engine.listCommands().map((c) => ({ name: c.name, description: c.description }))]
  }

  /** Route an engine-side slash command (e.g. /compact) over the bus. */
  function sendEngineCommand(command: string) {
    engine.send({ type: "run-command", command })
  }

  /** Run a slash command; returns true if it matched a built-in or custom command. */
  function runCommand(name: string, args = ""): boolean {
    switch (name) {
      case "model":
        setModelModalOpen(true)
        return true
      case "effort":
        if (!reasoningModel()) {
          pushToast("the current model has no adjustable reasoning effort", "input")
          return true
        }
        setEffortOpen(true)
        return true
      case "new":
        newSession() // a fresh session IN THIS TUI (opening a real terminal window is dashboard-only)
        return true
      case "clear":
        newSession() // reset the conversation in place (this window)
        return true
      case "resume":
      case "sessions": // aliases for the old command names
      case "history":
        setHistoryOpen(true)
        return true
      case "fork":
        setForkOpen(true)
        return true
      case "dir":
        setDirModalOpen(true)
        return true
      // `/nudge` and `/add` are kept as aliases for `/pause`.
      case "pause":
      case "nudge":
      case "add": {
        // Pausing only makes sense while the agent is working. When idle there's nothing to pause or
        // fold into, so say so instead of silently turning the note into a fresh prompt.
        if (!busy()) {
          pushToast("nothing to pause — the agent isn't working", "input")
          return true
        }
        // `/pause` always pauses the agent NOW and opens the composer modal — any inline `args` are
        // ignored (the modal is the single entry point, so you can attach @files / paste before sending).
        engine.send({ type: "inject-pause", interrupt: true })
        setPauseModalOpen(true)
        return true
      }
      case "mcp":
        setMcpModalOpen(true)
        return true
      case "skills":
        setSkillsModalOpen(true)
        return true
      case "compact":
        sendEngineCommand("compact")
        return true
      case "theme": {
        const name = args.trim()
        // Bare /theme opens the picker; /theme <name> applies directly.
        if (!name) {
          setThemeModalOpen(true)
          return true
        }
        if (!themeNames().includes(name)) {
          appendItem(activeSession(), {
            kind: "notice",
            id: nextLocalId(),
            text: `themes: ${themeNames().join(", ")} · /theme <name> (or bare /theme to pick)`,
          })
          return true
        }
        applyThemeNow(name)
        return true
      }
      case "settings":
      case "config":
        setSettingsModalOpen(true)
        return true
      case "update": {
        setUpdateModalOpen(true)
        if (updateState() === "idle" || updateState() === "current") void checkForUpdate()
        return true
      }
      case "budget": {
        const a = args.trim().toLowerCase()
        if (a === "off" || a === "clear") {
          engine.setUserConfig({ budget: undefined })
          setBudget(null)
          pushToast("budget cleared", "done")
          return true
        }
        const usd = a.startsWith("$") ? Number(a.slice(1)) : undefined
        const tokens = !a.startsWith("$")
          ? Number(a.replace(/[_,k]/gi, (m) => (m.toLowerCase() === "k" ? "000" : "")))
          : undefined
        if ((usd == null || !Number.isFinite(usd)) && (tokens == null || !Number.isFinite(tokens) || !tokens)) {
          appendItem(activeSession(), {
            kind: "notice",
            id: nextLocalId(),
            text: "usage: /budget 100000 · /budget $5 · /budget off",
          })
          return true
        }
        const next = usd != null ? { usd } : { tokens }
        engine.setUserConfig({ budget: next })
        setBudget(next)
        pushToast(`budget set: ${usd != null ? `$${usd}` : `${tokens} tokens`}`, "done")
        return true
      }
      case "init":
        submitRaw(
          "Scan this repository and write a concise FRIDAY.md at the repo root that orients a coding agent: the project's purpose, tech stack, how to build/test/run, the key directories, and any conventions. Read package.json, the README, and a sample of the source tree first. Keep it under ~50 lines. Create or overwrite FRIDAY.md.",
          "/init",
        )
        return true
      case "review":
        submitRaw(
          "Review the current uncommitted changes (start with `git diff`). Report bugs, regressions, missing edge cases, and style issues grouped by severity, each with a specific file:line. Do not make edits — just report.",
          "/review",
        )
        return true
      case "security-review":
        submitRaw(
          "Audit the current uncommitted changes (`git diff`) for security issues: injection, auth/authz gaps, secret leakage, unsafe deserialization, path traversal, SSRF, and risky dependencies. Report findings with severity and file:line. Do not make edits.",
          "/security-review",
        )
        return true
      case "agent": {
        // AI wizard: Friday interviews the user and writes a reusable agent def.
        submitRaw(
          `Help me create a new reusable agent definition. Ask me (with ask_user) for: the agent's purpose, what tools/permissions it needs (read-only or able to edit/run), a preferred model if any, and a short name. Then write the def to .friday/agents/<name>.md with YAML frontmatter (name, description, optional tools, model, skills, mcp, posture: plan|default|yolo) followed by the system prompt as the body. Keep the prompt focused. ${args ? `\n\nStarting hint: ${args}` : ""}`,
          "/agent new",
        )
        return true
      }
      case "team": {
        // AI wizard: Friday interviews the user and writes a reusable team def.
        submitRaw(
          `Help me create a new reusable team definition. Ask me (with ask_user) for: the team's goal/purpose, the roles needed and which agent backs each (see the Sub-agents list), and a short name. Then write the def to .friday/teams/<name>.json as { "name", "description", "members": [{ "role", "agent", "prompt" }] }. ${args ? `\n\nStarting hint: ${args}` : ""}`,
          "/team new",
        )
        return true
      }
      case "context":
      case "usage":
      case "stats": {
        const sid = activeSession()
        const tok = sessionTokens()[sid] ?? 0
        const cost = sessionCost()[sid]
        const cw = engine.selection().contextWindow
        const pct = cw ? Math.round((tok / cw) * 100) : undefined
        const parts = [
          `model: ${model()}${providerId() ? ` (${providerId()})` : ""}`,
          `tokens: ${tok.toLocaleString()}${cw ? ` / ${cw.toLocaleString()}${pct != null ? ` (${pct}%)` : ""}` : ""}`,
          cost != null ? `cost: $${cost.toFixed(4)}` : "",
          `mode: ${mode()}`,
        ].filter(Boolean)
        appendItem(sid, { kind: "notice", id: nextLocalId(), text: parts.join(" · ") })
        return true
      }
      case "dashboard": {
        toggleDashboard()
        return true
      }
      case "console": {
        toggleConsole()
        return true
      }
      case "fleet": {
        const running = tasks().filter((t) => t.status === "running").length
        if (!running) {
          pushToast("no running agents to open — spawn some with spawn_agents / task_create", "input")
          return true
        }
        const r = engine.openFleet()
        pushToast(
          r.ok
            ? `opened ${r.opened} agent window(s) via ${r.backend}`
            : r.error
              ? `couldn't open agent windows (${r.backend}): ${r.error.slice(0, 120)}`
              : "no terminal backend — see the dashboard's Swarm tab (Ctrl+O)",
          r.ok ? "done" : "input",
        )
        return true
      }
      case "computer":
      case "computer-use": {
        // All install/uninstall/status/device-support lives in the modal now (one place the user can
        // see what's supported, install/remove, and grant-permission guidance).
        const a = args.trim().toLowerCase()
        if (a === "install") installComputer()
        else if (a === "uninstall" || a === "remove") uninstallComputer()
        setComputerModalOpen(true)
        return true
      }
      case "voice":
      case "mic": {
        // Mic is bound to Ctrl+R; this hidden alias just delegates.
        toggleMic()
        return true
      }
      case "browser":
      case "chrome": {
        const a = args.trim().toLowerCase()
        if (a === "close" || a === "stop") {
          engine.closeBrowser()
          pushToast("browser closed", "done")
          return true
        }
        // Activate the browser_* tools for this session so Friday can use them without tool_search.
        engine.activateTools("browser_")
        pushToast("launching browser… (browser tools active for Friday)", "input")
        engine
          .startBrowser()
          .then((m) => pushToast(m, "done"))
          .catch((e) => pushToast(`browser: ${e?.message ?? e}`, "error"))
        return true
      }
      case "doctor": {
        const sid = activeSession()
        const lines = [
          model() && providerId() ? `✓ model: ${model()} (${providerId()})` : "✗ no model — run /model",
          `✓ mode: ${mode()} · effort: ${effort()}${reasoningModel() ? "" : " (model has no reasoning channel)"}`,
          `✓ output style: ${engine.selection().outputStyle ?? "concise"}`,
          engine.browserAvailable()
            ? "✓ browser: available (/browser)"
            : "✗ browser: none found (install Chrome/Brave/Edge)",
          (() => {
            const v = engine.micStatus()
            return v.ok ? "✓ mic: ready (Ctrl+R · on-device whisper)" : `✗ mic: ${v.reason}`
          })(),
          engine.computerInstalled()
            ? "✓ computer-use: installed (/computer to manage)"
            : "· computer-use: not installed (/computer to set up)",
          `✓ platform: ${process.platform}`,
        ]
        appendItem(sid, { kind: "notice", id: nextLocalId(), text: lines.join("\n") })
        return true
      }
      case "permissions": {
        if (args.trim() === "clear") {
          engine.clearProjectPermissions()
          pushToast("cleared remembered approvals for this project", "done")
          return true
        }
        const p = engine.projectPermissions()
        const parts: string[] = []
        if (p.bash?.length) parts.push(`bash: ${p.bash.join(", ")}`)
        if (p.categories?.length) parts.push(`always: ${p.categories.join(", ")}`)
        appendItem(activeSession(), {
          kind: "notice",
          id: nextLocalId(),
          text: parts.length
            ? `remembered approvals — ${parts.join(" · ")} · /permissions clear to reset`
            : "no remembered approvals for this project",
        })
        return true
      }
      case "commit":
        sendEngineCommand("commit")
        return true
      case "undo":
        setCheckpointsOpen(true)
        return true
      case "help":
        setOverlayOpen(true)
        return true
      case "restart":
        quit(true)
        return true
      case "exit":
      case "quit":
        quit()
        return true
    }
    const custom = engine.listCommands().find((c) => c.name === name)
    if (custom) {
      submitRaw(args ? `${custom.template}\n\n${args}` : custom.template)
      return true
    }
    return false
  }

  function submitRaw(text: string, display?: string) {
    const sid = activeSession()
    // If a turn is already running, queue the prompt instead of racing the engine — it drains at the
    // next turn boundary (see drainQueue). Lets the user stage follow-ups / course-correct mid-run.
    if (sessionBusy()[sid]) {
      setSessionQueue((m) => ({ ...m, [sid]: [...(m[sid] ?? []), text] }))
      return
    }
    appendItem(sid, { kind: "user", id: nextLocalId(), text, display, mode: mode() })
    // Optimistically flip to busy so the status strip + timer appear the instant Enter is pressed,
    // before the engine's first message-start arrives (closes the perceived "nothing happening" gap).
    setKey(setSessionBusy, sid, true)
    setKey(setSessionStatus, sid, "sent…")
    engine.send({ type: "prompt", text })
  }

  /** Run a skill from the Skills modal — close it and fold an invoke prompt in as a normal turn. */
  function runSkill(name: string) {
    setSkillsModalOpen(false)
    submitRaw(`Use the "${name}" skill.`, `/skills ${name}`)
  }

  /** Send the next queued prompt for a session once it goes idle (called at turn boundaries). */
  function drainQueue(sid: string) {
    if (sessionBusy()[sid]) return
    const q = sessionQueue()[sid]
    if (!q?.length) return
    const [next, ...rest] = q
    setSessionQueue((m) => ({ ...m, [sid]: rest }))
    if (sid === activeSession()) submitRaw(next!)
  }
  /** Drop a staged prompt by index (clicking its chip's ✕). */
  function unqueue(i: number) {
    const sid = activeSession()
    setSessionQueue((m) => ({ ...m, [sid]: (m[sid] ?? []).filter((_, k) => k !== i) }))
  }

  function submit(text: string, display?: string) {
    const t = text.trim()
    if (!t) return
    if (t.startsWith("/")) {
      const [name, ...rest] = t.slice(1).split(/\s+/)
      if (runCommand(name!, rest.join(" "))) return
    }
    submitRaw(t, display)
  }

  function openPath(p: string) {
    engine.send({ type: "open-path", path: p })
  }

  function abort() {
    setStopArmed(false)
    // Optimistic "stopping…" so the strip reflects the interrupt instantly; the engine
    // follows with "stopped" + a turn-done that clears busy and freezes the timer.
    setKey(setSessionStatus, activeSession(), "stopping…")
    // Interrupting means "stop" — discard staged prompts rather than firing them after the abort.
    setSessionQueue((m) => ({ ...m, [activeSession()]: [] }))
    engine.send({ type: "abort" })
  }

  /** Add a note to the running agent's context (the /pause feature). While busy it shows an interleaved
   * "pending" chip in the transcript (id correlates with the engine's inject-attached event, which flips
   * it to "attached"). When idle it's just a normal prompt. */
  function injectNote(text: string, interrupt = false) {
    const t = text.trim()
    if (!t) return
    const sid = activeSession()
    if (!sessionBusy()[sid]) return submitRaw(t) // idle → ordinary prompt (shows as a user bubble)
    const id = nextLocalId()
    appendItem(sid, { kind: "inject", id, text: t, state: "pending", at: Date.now() })
    engine.send({ type: "inject", id, text: t, interrupt })
  }
  /** /pause modal submit: inject the composed note (interrupt = cut the current generation now), or
   * release the soft-pause if empty. */
  function pauseInject(text: string, interrupt = false) {
    setPauseModalOpen(false)
    if (text.trim()) injectNote(text, interrupt)
    else engine.send({ type: "inject-resume" }) // empty send still releases a soft-pause
  }
  /** /pause modal cancel: release the soft-pause without adding anything. */
  function pauseCancel() {
    setPauseModalOpen(false)
    engine.send({ type: "inject-resume" })
  }

  function replyPermission(decision: "allow-once" | "allow-always" | "deny") {
    const src = pendingSrc()
    if (!src) return
    engine.send({ type: "permission-reply", requestId: src.val.requestId, decision })
    if (decision === "allow-always") pushToast("✓ remembered for this project (/permissions to manage)", "done")
    // Clear the asking session's entry (may be a background agent, not the focused one).
    delKey(setSessionPending, src.sid)
    delKey(setSessionNeeds, src.sid)
    // The modal owned focus while open; hand it back so the composer is typeable immediately.
    focusComposer()
  }

  function replyAsk(answers: Record<string, string>) {
    const src = askSrc()
    if (!src) return
    engine.send({ type: "ask-reply", requestId: src.val.requestId, answers })
    delKey(setSessionAsk, src.sid)
    delKey(setSessionNeeds, src.sid)
    focusComposer()
  }

  // ---- plan-mode gate ----
  /** Close the plan card without acting (used by "keep planning", "custom input", and the viewer). */
  function dismissPlan() {
    delKey(setSessionPlanPending, activeSession())
    delKey(setSessionNeeds, activeSession())
    setPlanReadOnly(false)
  }
  /**
   * Accept the pending plan: switch to the chosen mode and continue the SAME flow — instead of a fresh
   * user prompt, we drop an inline "running · <mode>" breaker (tinted by the chosen mode) and let the
   * agent carry on below it. The plan text is re-sent to the engine inline (so it survives compaction),
   * but the UI shows the breaker rather than a user bubble. Only the execute gate calls this — the
   * sidebar viewer is read-only.
   */
  function executePlan(targetMode: ModeId, entry?: PlanEntry) {
    const plan = entry ?? planPending()
    dismissPlan()
    if (targetMode !== mode()) {
      setModeSig(targetMode)
      engine.setMode(targetMode)
      engine.send({ type: "set-mode", mode: targetMode })
    }
    const sid = activeSession()
    appendItem(sid, {
      kind: "breaker",
      id: nextLocalId(),
      mode: targetMode,
      label: `running · ${getMode(targetMode).label}`,
    })
    setKey(setSessionBusy, sid, true)
    setKey(setSessionStatus, sid, "sent…")
    engine.send({
      type: "prompt",
      text: plan?.text ? `${CARRY_OUT_PREFIX}\n\n${plan.text}` : "Carry out the plan you just proposed, step by step.",
    })
  }
  /** "custom input…" on the plan gate: close the gate but STAY in plan mode and send the typed text
   * as a refinement. Instead of a plain user bubble, we drop an inline "refining plan" breaker (with
   * the typed text as a quoted note) — matching how plan-execution / compaction render as flow
   * markers rather than prompts — then send the text to the engine. The agent revises the plan and
   * calls exit_plan again, which re-opens the gate. (Distinct from "keep planning", which closes with
   * no message.) */
  function refinePlan(text: string) {
    const t = text.trim()
    dismissPlan()
    if (!t) return
    const sid = activeSession()
    // If a turn is somehow still running, fall back to the normal queue path (drains at the boundary).
    if (sessionBusy()[sid]) {
      setSessionQueue((m) => ({ ...m, [sid]: [...(m[sid] ?? []), t] }))
      return
    }
    appendItem(sid, { kind: "breaker", id: nextLocalId(), mode: "plan", label: "refining plan", note: t })
    setKey(setSessionBusy, sid, true)
    setKey(setSessionStatus, sid, "sent…")
    engine.send({ type: "prompt", text: t })
  }
  /** Re-open a previously proposed plan in the plan card as a READ-ONLY viewer (no execute options). */
  function viewPlan(entry: PlanEntry) {
    setPlanReadOnly(true)
    setKey(setSessionPlanPending, activeSession(), entry)
  }

  // ---- compaction controls ----
  /** Manually trigger compaction now (sidebar button / /compact). */
  function compactNow() {
    sendEngineCommand("compact")
  }
  /** Stop an in-flight compaction. */
  function stopCompact() {
    engine.send({ type: "stop-compaction" })
  }
  /** Undo the last completed compaction (restores full history) — optimistically clears the flag. */
  function undoCompact() {
    engine.send({ type: "undo-compaction" })
    setKey(setSessionCanUndoCompact, activeSession(), false)
  }
  /** Open the read-only compaction-summary viewer. */
  function viewCompaction(text: string) {
    setCompactionView(text)
  }

  function connectAndSelect(
    providerId: string,
    model: string,
    reasoning: boolean,
    apiKey?: string,
    baseURL?: string,
    contextWindow?: number,
    cost?: { input: number; output: number },
  ) {
    if (apiKey) engine.connectProvider(providerId, apiKey, baseURL)
    engine.selectModel(providerId, model, reasoning, contextWindow, cost)
    setModelModalOpen(false)
  }

  function toggleThinking(id: string) {
    patchItem(id, (it) => it.kind === "assistant" && (it.thinkingOpen = !it.thinkingOpen))
  }
  function toggleToolOpen(id: string) {
    // Collapsing also resets the second gate, so reopening always starts at the digest (head+tail).
    patchItem(id, (it) => {
      if (it.kind !== "tool") return false
      it.open = !it.open
      if (!it.open) it.full = false
      return true
    })
  }
  /** Second gate: reveal the complete tool output instead of the head+tail digest. */
  function toggleToolFull(id: string) {
    patchItem(id, (it) => it.kind === "tool" && (it.full = !it.full))
  }

  function newSession() {
    engine.send({ type: "new-session" })
  }
  function switchSession(id: string) {
    engine.send({ type: "switch-session", sessionId: id })
  }
  function switchSessionByIndex(i: number) {
    const s = sessions()[i]
    if (s) switchSession(s.id)
  }
  // ---- console / agent-team actions ----
  function toggleConsole() {
    setView(view() === "console" ? "shell" : "console")
  }
  function toggleDashboard() {
    setView(view() === "dashboard" ? "shell" : "dashboard")
  }
  /** Focus an agent's session and drop back into the chat shell. */
  function visitAgent(sessionId: string) {
    switchSession(sessionId)
    setView("shell")
  }
  function stopAgent(sessionId: string) {
    // requestStop aborts locally if we own it, else queues a stop for the owning terminal to apply.
    engine.requestStop(sessionId)
    pushToast("stopped agent", "input")
  }
  /** Remove a swarm/background agent from the dashboard (stops it first if running). */
  function removeAgent(sessionId: string) {
    engine.removeTask(sessionId)
    pushToast("removed agent", "input")
  }
  /** Dismiss the current agent team (stops running members) and clear the panel. */
  function dismissTeam() {
    engine.dismissTeam()
    pushToast("dismissed team", "input")
  }
  function popoutAgent(sessionId: string) {
    if (tmuxOn()) return addToWall(["attach", sessionId], titleOf(sessionId))
    const r = engine.popoutAgent(sessionId)
    pushToast(r.ok ? `opened agent window via ${r.backend}` : winFail(r, "the agent window"), r.ok ? "done" : "input")
  }
  function deleteSession(id: string) {
    engine.deleteSession(id)
    seeded.delete(id)
    setSessionItems(produce((m) => void delete m[id]))
    delKey(setSessionStatus, id)
    delKey(setSessionMascot, id)
    delKey(setSessionChanged, id)
    refreshSessions()
  }
  function setRoot(dir: string) {
    engine.setRoot(dir)
    refreshSessions()
  }
  function addRoot(dir: string) {
    engine.addRoot(dir)
    refreshSessions()
  }
  function mcpConfig() {
    return engine.mcpConfig()
  }
  function refreshMcp() {
    setMcpServers(engine.listMcpServers())
  }
  async function addMcpServer(name: string, server: Parameters<Engine["addMcpServer"]>[1]) {
    const ok = await engine.addMcpServer(name, server)
    refreshMcp()
    return ok
  }
  function removeMcpServer(name: string) {
    engine.removeMcpServer(name)
    refreshMcp()
  }
  function restoreCheckpoint(id: string, scope: "both" | "code" | "conversation" = "both") {
    // The engine truncates messages and re-emits session-loaded; clear the seeded flag so the
    // transcript is actually rebuilt from the truncated messages (otherwise it stays stale).
    seeded.delete(activeSession())
    engine.restoreCheckpoint(id, scope)
    setCheckpointsOpen(false)
    refreshSessions()
  }

  /** Rewind to the snapshot taken before a user turn, then drop that prompt back in the composer.
   * Matches the in-memory checkpoint by its label (the prompt text). Snapshots only exist for turns
   * made in the current process, so resumed-session turns can't be rewound this way. */
  function rewindToPrompt(text: string) {
    const norm = text.replace(/\s+/g, " ").trim().slice(0, 60)
    const cp = engine.listCheckpoints().find((c) => c.label === norm)
    if (!cp) {
      pushToast("no snapshot for that turn — can't rewind", "input")
      return
    }
    seeded.delete(activeSession())
    engine.restoreCheckpoint(cp.id)
    refreshSessions()
    setComposerText(text)
  }

  /** Fork a new session branching from the turn whose user prompt matches `text` (used by the
   * per-message fork action). Includes the AI response + any tools of that turn (everything up to
   * the next user turn) so the new chat picks up right after the reply. Falls back to forking the
   * whole conversation if no exact turn is found. */
  function forkFromText(text: string) {
    const norm = text.replace(/\s+/g, " ").trim().slice(0, 80)
    const points = engine.forkPoints()
    let k = -1
    for (let i = points.length - 1; i >= 0; i--)
      if (points[i]!.text === norm) {
        k = i
        break
      }
    if (k < 0) {
      engine.forkSession() // whole conversation
    } else {
      // Up to (but not including) the next user turn → keeps this turn's assistant reply + tools.
      const next = points[k + 1]
      engine.forkSession(next ? next.index - 1 : undefined)
    }
    refreshSessions()
    pushToast("forked a new session from that turn", "input")
  }
  function redoLast() {
    engine.redoLast()
    setCheckpointsOpen(false)
  }
  /** Branch a new session from the chosen past turn and focus it. */
  function forkFrom(index: number) {
    engine.forkSession(index)
    setForkOpen(false)
    refreshSessions()
    pushToast("forked a new session from that turn", "input")
  }

  /** Workspace trust gate: grant access to this directory, then continue to the model picker if needed. */
  function trustCwd() {
    engine.trustCwd()
    setTrustOpen(false)
    if (needsModel()) setModelModalOpen(true)
  }
  /** Decline trust → leave immediately (don't operate on an untrusted directory). */
  function declineTrust() {
    setTrustOpen(false)
    quit()
  }

  const [exitStats, setExitStats] = createSignal<SessionStats | null>(null)
  function quit(restart = false) {
    if (restart) setWantsRestart(true)
    setExitStats(engine.stats())
    setView("exit")
  }
  /**
   * Defer the upgrade to teardown: close the modal and quit with wantsUpdate. finalizeExit runs the
   * package-manager install in the restored normal terminal and then relaunches, so the new binary
   * boots exactly like a fresh shell launch. Running npm inside the alt-screen and re-execing the
   * just-swapped binary left the relaunched TUI's input dead — this avoids that entirely.
   */
  function updateAndRestart() {
    setWantsUpdate(true)
    setUpdateModalOpen(false)
    quit(true)
  }

  // Update checks: one at startup, then every 4h while running. Released builds only, and only
  // when not disabled. When a newer version turns up we pop the notify modal — even mid-work — but
  // only once per version, and never on top of another modal (so it can't clobber what you're doing;
  // it waits for the next tick when you're clear). Fire-and-forget so it never blocks render.
  let notifiedVersion: string | null = null
  function maybeNotifyUpdate(): void {
    if (updateState() !== "available") return
    const latest = updateLatest()
    if (!latest || latest === notifiedVersion) return // already surfaced this version
    if (anyModalOpen()) return // don't interrupt another modal — retry on the next interval
    notifiedVersion = latest
    setUpdateModalOpen(true)
  }
  if (version !== "dev") {
    const check = () => {
      if (engine.userConfig().autoupdate === "off") return
      void checkForUpdate().then(maybeNotifyUpdate)
    }
    const cfg = engine.userConfig()
    const stale = Date.now() - (cfg.lastUpdateCheck ?? 0) > 24 * 60 * 60 * 1000
    if (cfg.autoupdate !== "off" && stale) check()
    const timer = setInterval(check, 4 * 60 * 60 * 1000)
    onCleanup(() => clearInterval(timer))
  }

  return {
    engine,
    version,
    view,
    setView,
    mode,
    effort,
    setEffort,
    effortOpen,
    setEffortOpen,
    providerProtocol,
    model,
    reasoningModel,
    needsModel,
    rightOpen,
    setRightOpen,
    rightWidth,
    setRightWidth,
    anyModalOpen,
    overlayOpen,
    setOverlayOpen,
    modelModalOpen,
    setModelModalOpen,
    yoloConfirmOpen,
    confirmYolo,
    cancelYolo,
    micModalOpen,
    micPhase,
    micError,
    micSetup,
    micDevices,
    micDevice,
    micPartial,
    cycleMicDevice,
    closeMic,
    toggleMic,
    newChatWindow,
    resumeInWindow,
    launchSwarm,
    launchTeam,
    launchAgent,
    launchTeamDef,
    agentDefs,
    teamDefs,
    refreshSessions,
    // tmux wall (control center)
    tmuxOn,
    wallPanes,
    refreshWall,
    removeWallPane,
    closeWall,
    arrangeWall,
    viewWall,
    trustOpen,
    trustCwd,
    declineTrust,
    cwdLabel: () => engine.currentCwd(),
    mascot,
    status,
    tokens,
    busy,
    pending,
    askPending,
    pendingFrom,
    askFrom,
    replyAsk,
    plans,
    planPending,
    planReadOnly,
    dismissPlan,
    executePlan,
    refinePlan,
    viewPlan,
    compacting,
    compactPct,
    lastSummary,
    canUndoCompact,
    compactionView,
    setCompactionView,
    compactNow,
    stopCompact,
    undoCompact,
    viewCompaction,
    queued,
    unqueue,
    items,
    sessions,
    activeSession,
    setActiveSession,
    sessionRunning,
    sessionNeedsInput,
    sessionTokenCount,
    sessionCost,
    sessionActivity,
    toggleMode,
    submit,
    abort,
    openPath,
    replyPermission,
    connectAndSelect,
    toggleThinking,
    toggleToolOpen,
    toggleToolFull,
    newSession,
    switchSession,
    switchSessionByIndex,
    deleteSession,
    setRoot,
    addRoot,
    roots,
    allSessions,
    currentCwd,
    historyOpen,
    setHistoryOpen,
    dirModalOpen,
    setDirModalOpen,
    pauseModalOpen,
    setPauseModalOpen,
    pauseInject,
    pauseCancel,
    mcpModalOpen,
    skillsModalOpen,
    setSkillsModalOpen,
    runSkill,
    computerModalOpen,
    setComputerModalOpen,
    computerReady,
    computerInstalling,
    computerInstallLog,
    installComputer,
    uninstallComputer,
    openMacPrivacy,
    setMcpModalOpen,
    mcpConfig,
    refreshMcp,
    addMcpServer,
    removeMcpServer,
    checkpointsOpen,
    setCheckpointsOpen,
    restoreCheckpoint,
    forkOpen,
    setForkOpen,
    forkFrom,
    forkFromText,
    rewindToPrompt,
    registerComposer,
    focusComposer,
    setComposerText,
    composerEmpty,
    clearComposer,
    redoLast,
    quit,
    exitStats,
    stopArmed,
    quitArmed,
    setQuitArmed,
    setStopArmed,
    permSel,
    setPermSel,
    toasts,
    listCommands,
    runCommand,
    contextFiles,
    pinnedFiles,
    pinContextFile,
    unpinContextFile,
    contextModalOpen,
    setContextModalOpen,
    skills,
    mcpServers,
    runningTools,
    todos,
    changedFiles,
    tasks,
    team,
    sessionItems,
    toggleConsole,
    toggleDashboard,
    visitAgent,
    stopAgent,
    removeAgent,
    remoteAgents,
    dismissTeam,
    popoutAgent,
    budget,
    diagnostics,
    cost,
    contextWindow,
    sendEngineCommand,
    // settings / theme / update / keymap
    settingsModalOpen,
    setSettingsModalOpen,
    themeModalOpen,
    setThemeModalOpen,
    applyThemeNow,
    keymap,
    keyAction,
    rebind,
    resetKeybindings,
    updateModalOpen,
    setUpdateModalOpen,
    updateState,
    updateLatest,
    updateLog,
    updateMethod,
    setUpdateMethod,
    checkForUpdate,
    updateAndRestart,
    wantsRestart,
    wantsUpdate,
    autoupdate,
    setAutoupdate: (v: "notify" | "off") => {
      setAutoupdateSig(v)
      engine.setUserConfig({ autoupdate: v })
    },
    outputStyle,
    setOutputStyle: (v: string) => {
      setOutputStyleSig(v)
      engine.setUserConfig({ outputStyle: v })
    },
    formatterOn,
    setFormatter: (on: boolean) => {
      setFormatterSig(on)
      engine.setUserConfig({ formatter: on })
    },
    autoCompactThreshold,
    setAutoCompactThreshold: (v: number) => {
      setAutoCompactSig(v)
      engine.setUserConfig({ autoCompactThreshold: v })
    },
    newlineMode,
    setNewlineMode: (v: "shift" | "alt" | "both") => {
      setNewlineMode(v)
      engine.setUserConfig({ composerNewline: v })
    },
  }
}

export type AppStore = ReturnType<typeof createAppStore>

const AppContext = createContext<AppStore>()

export function AppProvider(props: { store: AppStore; children: JSX.Element }) {
  return <AppContext.Provider value={props.store}>{props.children}</AppContext.Provider>
}

export function useApp(): AppStore {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within <AppProvider>")
  return ctx
}
