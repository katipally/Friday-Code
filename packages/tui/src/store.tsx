import { createContext, createMemo, createSignal, useContext, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import {
  DEFAULT_MODE,
  cycleMode,
  type EngineEvent,
  type Effort,
  type MascotState,
  type Message,
  type ModeId,
} from "@friday/shared"
import type { Engine, SessionStats } from "@friday/core"

export type ToolStatus = "running" | "done" | "error"

export type ViewItem =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant"
      id: string
      text: string
      reasoning: string
      thinkingOpen: boolean
      done: boolean
      startedAt: number
      durationMs?: number
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

export type PendingPermission = { requestId: string; tool: string; summary: string; detail?: string }
export type PendingAsk = { requestId: string; question: string; options?: string[] }
export type SessionItem = { id: string; title: string }

/** Rebuild view items from stored messages (history replay on resume/switch). */
function messagesToItems(messages: Message[]): ViewItem[] {
  const out: ViewItem[] = []
  let n = 0
  for (const m of messages) {
    if (m.role === "user") out.push({ kind: "user", id: `h${n++}`, text: m.text })
    else if (m.role === "assistant") {
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

export function createAppStore(engine: Engine) {
  const [view, setView] = createSignal<"splash" | "shell" | "exit">("splash")
  const [mode, setModeSig] = createSignal<ModeId>(engine.selection().mode ?? DEFAULT_MODE)
  const [effort, setEffortSig] = createSignal<Effort>(engine.selection().effort ?? "medium")
  const [model, setModel] = createSignal<string>(engine.selection().model ?? "no model — open /model")
  const [needsModel, setNeedsModel] = createSignal(false)

  const [leftOpen, setLeftOpen] = createSignal(true)
  const [rightOpen, setRightOpen] = createSignal(true)
  const [leftWidth, setLeftWidth] = createSignal(22)
  const [rightWidth, setRightWidth] = createSignal(28)
  const [overlayOpen, setOverlayOpen] = createSignal(false)
  const [modelModalOpen, setModelModalOpen] = createSignal(false)

  const [mascot, setMascot] = createSignal<MascotState>("idle")
  const [status, setStatus] = createSignal("ready")
  const [tokens, setTokens] = createSignal(0)
  const [dragging, setDragging] = createSignal<null | "left" | "right">(null)
  const [busy, setBusy] = createSignal(false)
  const [pending, setPending] = createSignal<PendingPermission | null>(null)
  const [askPending, setAskPending] = createSignal<PendingAsk | null>(null)
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  const [composerText, setComposerText] = createSignal("")

  const [items, setItems] = createStore<ViewItem[]>([])
  const [contextFiles] = createSignal<string[]>(engine.contextInfo().files)
  const [skills] = createSignal(engine.listSkills())
  const [sessions, setSessions] = createSignal<SessionItem[]>(engine.listSessions())
  const runningTools = createMemo(() =>
    items.filter((i) => i.kind === "tool" && i.status === "running").map((i) => (i as any).title ?? (i as any).name),
  )
  const [activeSession, setActiveSession] = createSignal(engine.currentSessionId())
  const refreshSessions = () => setSessions(engine.listSessions())

  let localId = 0
  const nextLocalId = () => `u${++localId}`

  function patchItem(id: string, fn: (it: ViewItem) => void) {
    const idx = items.findIndex((i) => i.id === id)
    if (idx >= 0) setItems(idx, produce(fn))
  }

  // ---- engine event handling ----
  engine.subscribe((e: EngineEvent) => {
    switch (e.type) {
      case "ready":
        setNeedsModel(e.needsModel)
        if (e.needsModel) setModelModalOpen(true)
        break
      case "model-changed":
        setModel(e.model)
        setNeedsModel(false)
        break
      case "message-start":
        setItems(items.length, {
          kind: "assistant",
          id: e.id,
          text: "",
          reasoning: "",
          thinkingOpen: true,
          done: false,
          startedAt: Date.now(),
        })
        setBusy(true)
        break
      case "text":
        patchItem(e.id, (it) => {
          if (it.kind === "assistant") it.text += e.delta
        })
        break
      case "reasoning":
        patchItem(e.id, (it) => {
          if (it.kind === "assistant") it.reasoning += e.delta
        })
        break
      case "tool-call":
        setItems(items.length, {
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
        patchItem(e.callId, (it) => {
          if (it.kind === "tool") {
            it.status = e.ok ? "done" : "error"
            it.output = e.output
            it.title = e.title
            it.diff = e.diff
          }
        })
        break
      case "permission-request":
        setPending({ requestId: e.requestId, tool: e.tool, summary: e.summary, detail: e.detail })
        break
      case "ask-user":
        setAskPending({ requestId: e.requestId, question: e.question, options: e.options })
        break
      case "turn-done":
        patchItem(e.id, (it) => {
          if (it.kind === "assistant") {
            it.done = true
            it.thinkingOpen = false
            it.durationMs = Date.now() - it.startedAt
          }
        })
        setBusy(false)
        break
      case "usage":
        setTokens(e.input + e.output)
        break
      case "status":
        setStatus(e.text)
        if (e.tokens != null) setTokens(e.tokens)
        break
      case "mascot":
        setMascot(e.state)
        break
      case "error":
        setItems(items.length, { kind: "error", id: nextLocalId(), text: e.message })
        setBusy(false)
        break
      case "session-changed":
        setActiveSession(e.sessionId)
        refreshSessions()
        break
      case "session-loaded":
        setItems(messagesToItems(e.messages))
        setTokens(0)
        setPending(null)
        setAskPending(null)
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
    { name: "new", description: "start a new session" },
    { name: "clear", description: "clear the conversation (new session)" },
    { name: "sessions", description: "focus the sessions panel" },
    { name: "help", description: "show the keymap" },
    { name: "exit", description: "quit Friday (clean exit)" },
  ]

  function listCommands(): { name: string; description: string }[] {
    return [...BUILTIN_COMMANDS, ...engine.listCommands().map((c) => ({ name: c.name, description: c.description }))]
  }

  function runCommand(name: string, args = "") {
    switch (name) {
      case "model":
        return setModelModalOpen(true)
      case "new":
      case "clear":
        return newSession()
      case "sessions":
        return setLeftOpen(true)
      case "help":
        return setOverlayOpen(true)
      case "exit":
      case "quit":
        return quit()
    }
    const custom = engine.listCommands().find((c) => c.name === name)
    if (custom) return submitRaw(args ? `${custom.template}\n\n${args}` : custom.template)
  }

  function submitRaw(text: string) {
    setItems(items.length, { kind: "user", id: nextLocalId(), text })
    engine.send({ type: "prompt", text })
  }

  function submit(text: string) {
    const t = text.trim()
    if (!t) return
    if (t.startsWith("/")) {
      const [name, ...rest] = t.slice(1).split(/\s+/)
      return runCommand(name!, rest.join(" "))
    }
    submitRaw(t)
  }

  function abort() {
    engine.send({ type: "abort" })
  }

  function replyPermission(decision: "allow-once" | "allow-always" | "deny") {
    const p = pending()
    if (!p) return
    engine.send({ type: "permission-reply", requestId: p.requestId, decision })
    setPending(null)
  }

  function replyAsk(answer: string) {
    const a = askPending()
    if (!a) return
    engine.send({ type: "ask-reply", requestId: a.requestId, answer })
    setAskPending(null)
  }

  function connectAndSelect(providerId: string, model: string, apiKey?: string, baseURL?: string) {
    if (apiKey) engine.connectProvider(providerId, apiKey, baseURL)
    engine.selectModel(providerId, model)
    setModelModalOpen(false)
  }

  function toggleThinking(id: string) {
    patchItem(id, (it) => {
      if (it.kind === "assistant") it.thinkingOpen = !it.thinkingOpen
    })
  }
  function toggleToolOpen(id: string) {
    patchItem(id, (it) => {
      if (it.kind === "tool") it.open = !it.open
    })
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

  const [exitStats, setExitStats] = createSignal<SessionStats | null>(null)
  function quit() {
    setExitStats(engine.stats())
    setView("exit")
  }

  return {
    engine,
    view,
    setView,
    mode,
    effort,
    setEffort,
    model,
    needsModel,
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    leftWidth,
    setLeftWidth,
    rightWidth,
    setRightWidth,
    overlayOpen,
    setOverlayOpen,
    modelModalOpen,
    setModelModalOpen,
    mascot,
    status,
    tokens,
    dragging,
    setDragging,
    busy,
    pending,
    askPending,
    replyAsk,
    items,
    sessions,
    activeSession,
    setActiveSession,
    toggleMode,
    submit,
    abort,
    replyPermission,
    connectAndSelect,
    toggleThinking,
    toggleToolOpen,
    newSession,
    switchSession,
    switchSessionByIndex,
    quit,
    exitStats,
    paletteOpen,
    setPaletteOpen,
    composerText,
    setComposerText,
    listCommands,
    runCommand,
    contextFiles,
    skills,
    runningTools,
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
