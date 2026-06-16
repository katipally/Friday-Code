import { createContext, createSignal, useContext, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import {
  DEFAULT_MODE,
  cycleMode,
  type EngineEvent,
  type Effort,
  type MascotState,
  type ModeId,
} from "@friday/shared"
import type { Engine } from "@friday/core"

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

export function createAppStore(engine: Engine) {
  const [view, setView] = createSignal<"splash" | "shell">("splash")
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

  const [items, setItems] = createStore<ViewItem[]>([])
  const sessions: SessionItem[] = [{ id: "s1", title: "session" }]
  const [activeSession, setActiveSession] = createSignal("s1")

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
        setItems([])
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

  function submit(text: string) {
    const t = text.trim()
    if (!t) return
    if (t.startsWith("/")) {
      const cmd = t.slice(1).split(/\s+/)[0]
      if (cmd === "model") return setModelModalOpen(true)
      if (cmd === "new" || cmd === "clear") {
        engine.send({ type: "new-session" })
        return
      }
      if (cmd === "help") return setOverlayOpen(true)
      // unknown slash: fall through as a normal prompt
    }
    setItems(items.length, { kind: "user", id: nextLocalId(), text: t })
    engine.send({ type: "prompt", text: t })
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
