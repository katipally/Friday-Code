import type { Engine, SessionStats } from "@friday/core"
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
import { createContext, createMemo, createSignal, type JSX, useContext } from "solid-js"
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
    }
  | { kind: "error"; id: string; text: string }
  | { kind: "notice"; id: string; text: string; summary?: string }
  /** a flow divider shown when a plan is accepted ("running · <mode>") or refined ("refining plan");
   * tinted by the relevant mode. `note` is an optional quoted subtitle (e.g. the refinement text). */
  | { kind: "breaker"; id: string; mode: ModeId; label: string; note?: string }

export type PendingPermission = { requestId: string; tool: string; summary: string; detail?: string; risk?: string }
export type PendingAsk = { requestId: string; questions: AskQuestion[] }
export type PlanEntry = { id: string; title: string; text: string }
export type SessionItem = { id: string; title: string; cwd: string; roots: string[] }
export type ChangedFile = { path: string; status: string; added: number; removed: number; kind?: "file" | "dir" }
export type TaskRow = { id: string; title: string; description: string; status: "running" | "done"; summary?: string }

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
  const [view, setView] = createSignal<"splash" | "shell" | "exit">("splash")
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
  const [onboardingOpen, setOnboardingOpen] = createSignal(false)

  const [paletteOpen, setPaletteOpen] = createSignal(false)
  // First Esc while busy "arms" the stop; a second Esc within the window actually aborts.
  const [stopArmed, setStopArmed] = createSignal(false)
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
  const [skills, setSkills] = createSignal(engine.listSkills())
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
  const [mcpModalOpen, setMcpModalOpen] = createSignal(false)
  const [checkpointsOpen, setCheckpointsOpen] = createSignal(false)
  const [forkOpen, setForkOpen] = createSignal(false)

  // Focused-session views of the per-session maps.
  const status = () => sessionStatus()[activeSession()] ?? "ready"
  const mascot = () => sessionMascot()[activeSession()] ?? ("idle" as MascotState)
  const busy = () => !!sessionBusy()[activeSession()]
  const tokens = () => sessionTokens()[activeSession()] ?? 0
  const todos = createMemo(() => sessionTodos()[activeSession()] ?? EMPTY)
  const pending = () => sessionPending()[activeSession()] ?? null
  const askPending = () => sessionAsk()[activeSession()] ?? null
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
    onboardingOpen() ||
    effortOpen() ||
    paletteOpen() ||
    historyOpen() ||
    dirModalOpen() ||
    mcpModalOpen() ||
    checkpointsOpen() ||
    forkOpen() ||
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
    setSkills(engine.listSkills())
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
        if (e.needsModel) setOnboardingOpen(true) // first run → welcome tour, then /model
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
      case "session-changed":
        // Metadata/list refresh — NOT a focus change (that's session-loaded).
        if (focused) {
          setCurrentCwd(e.cwd)
          setRoots(e.roots)
        }
        refreshSessions()
        break
      case "session-loaded":
        // The focus signal: this session is now on screen.
        setActiveSession(sid)
        seedSession(sid, e.messages)
        setKey(setSessionSeenLen, sid, sessionItems[sid]?.length ?? 0)
        setCurrentCwd(e.cwd)
        setRoots(e.roots)
        refreshSessions()
        break
    }
  })

  // ---- actions ----
  function toggleMode(dir: 1 | -1 = 1) {
    const next = cycleMode(mode(), dir)
    setModeSig(next)
    engine.setMode(next)
    engine.send({ type: "set-mode", mode: next })
  }
  function setEffort(e: Effort) {
    setEffortSig(e)
    engine.send({ type: "set-effort", effort: e })
  }

  const BUILTIN_COMMANDS: { name: string; description: string }[] = [
    { name: "model", description: "connect a provider / pick a model" },
    { name: "effort", description: "set reasoning effort (slider)" },
    { name: "new", description: "start a new session" },
    { name: "clear", description: "clear the conversation (new session)" },
    { name: "resume", description: "resume or switch to another session" },
    { name: "fork", description: "branch a session from a past turn" },
    { name: "dir", description: "change or add a working directory" },
    { name: "mcp", description: "view / add / remove MCP servers" },
    { name: "compact", description: "summarize old context to free space" },
    { name: "init", description: "scan the repo and write a FRIDAY.md guide" },
    { name: "context", description: "show what's in the context window" },
    { name: "usage", description: "show token + cost usage this session" },
    { name: "stats", description: "show token + cost usage this session" },
    { name: "doctor", description: "check model, provider & environment health" },
    { name: "review", description: "review the current changes" },
    { name: "security-review", description: "audit the current changes for security issues" },
    { name: "permissions", description: "view / clear remembered approvals" },
    { name: "theme", description: "switch UI theme" },
    { name: "budget", description: "set a token/$ usage budget" },
    { name: "commit", description: "stage all & commit (drafts message)" },
    { name: "undo", description: "rewind files + chat to a checkpoint" },
    { name: "help", description: "show the keymap" },
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
      case "clear":
        newSession()
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
      case "mcp":
        setMcpModalOpen(true)
        return true
      case "compact":
        sendEngineCommand("compact")
        return true
      case "theme": {
        const name = args.trim()
        if (!name || !themeNames().includes(name)) {
          appendItem(activeSession(), {
            kind: "notice",
            id: nextLocalId(),
            text: `themes: ${themeNames().join(", ")} · /theme <name> (applies on next launch)`,
          })
          return true
        }
        engine.setUserConfig({ theme: name })
        applyTheme(name)
        pushToast(`theme “${name}” saved — restart to apply fully`, "done")
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
      case "doctor": {
        const sid = activeSession()
        const lines = [
          model() && providerId() ? `✓ model: ${model()} (${providerId()})` : "✗ no model — run /model",
          `✓ mode: ${mode()} · effort: ${effort()}${reasoningModel() ? "" : " (model has no reasoning channel)"}`,
          `✓ output style: ${engine.selection().outputStyle ?? "concise"}`,
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

  function replyPermission(decision: "allow-once" | "allow-always" | "deny") {
    const p = pending()
    if (!p) return
    engine.send({ type: "permission-reply", requestId: p.requestId, decision })
    if (decision === "allow-always") pushToast("✓ remembered for this project (/permissions to manage)", "done")
    delKey(setSessionPending, activeSession())
    delKey(setSessionNeeds, activeSession())
    // The modal owned focus while open; hand it back so the composer is typeable immediately.
    focusComposer()
  }

  function replyAsk(answers: Record<string, string>) {
    const a = askPending()
    if (!a) return
    engine.send({ type: "ask-reply", requestId: a.requestId, answers })
    delKey(setSessionAsk, activeSession())
    delKey(setSessionNeeds, activeSession())
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
    patchItem(id, (it) => it.kind === "tool" && (it.open = !it.open))
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

  const [exitStats, setExitStats] = createSignal<SessionStats | null>(null)
  function quit() {
    setExitStats(engine.stats())
    setView("exit")
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
    onboardingOpen,
    setOnboardingOpen,
    mascot,
    status,
    tokens,
    busy,
    pending,
    askPending,
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
    sessionActivity,
    toggleMode,
    submit,
    abort,
    openPath,
    replyPermission,
    connectAndSelect,
    toggleThinking,
    toggleToolOpen,
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
    mcpModalOpen,
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
    paletteOpen,
    setPaletteOpen,
    stopArmed,
    setStopArmed,
    permSel,
    setPermSel,
    toasts,
    listCommands,
    runCommand,
    contextFiles,
    skills,
    mcpServers,
    runningTools,
    todos,
    changedFiles,
    tasks,
    budget,
    diagnostics,
    cost,
    contextWindow,
    sendEngineCommand,
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
