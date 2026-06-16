import { createContext, createSignal, useContext, type JSX } from "solid-js"
import { DEFAULT_MODE, cycleMode, type MascotState, type ModeId } from "@friday/shared"

export type ChatMsg = { id: string; role: "user" | "assistant"; text: string }
export type SessionItem = { id: string; title: string }

const WELCOME =
  "Hey — I'm Friday. This is the M0 shell: the real engine arrives in M1.\n" +
  "Try it out: Shift+Tab cycles modes (watch the frame recolor), Ctrl+B toggles the sessions " +
  "panel, drag a panel's edge to resize it, and press ? for the full keymap."

const CANNED =
  "Got it. The agent loop, providers and tools land in M1 — for now I'm just showing off the " +
  "interface. Notice the mascot reacting and the status strip updating above the composer. ✦"

/** All UI state + actions for the M0 shell, shared via context. */
export function createAppStore() {
  const [view, setView] = createSignal<"splash" | "shell">("splash")
  const [mode, setMode] = createSignal<ModeId>(DEFAULT_MODE)
  const [model] = createSignal("no model — open /model")
  const [leftOpen, setLeftOpen] = createSignal(true)
  const [rightOpen, setRightOpen] = createSignal(true)
  const [leftWidth, setLeftWidth] = createSignal(22)
  const [rightWidth, setRightWidth] = createSignal(28)
  const [overlayOpen, setOverlayOpen] = createSignal(false)
  const [mascot, setMascot] = createSignal<MascotState>("idle")
  const [status, setStatus] = createSignal("ready")
  const [dragging, setDragging] = createSignal<null | "left" | "right">(null)
  const [activeSession, setActiveSession] = createSignal("s1")
  const [messages, setMessages] = createSignal<ChatMsg[]>([
    { id: "m0", role: "assistant", text: WELCOME },
  ])

  const sessions: SessionItem[] = [
    { id: "s1", title: "friday code shell" },
    { id: "s2", title: "scratch" },
  ]

  let counter = 0
  const nextId = () => `m${++counter}`

  function toggleMode(dir: 1 | -1 = 1) {
    setMode((m) => cycleMode(m, dir))
  }

  let replyTimer: ReturnType<typeof setTimeout> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  function submit(text: string) {
    const t = text.trim()
    if (!t) return
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text: t }])
    setMascot("thinking")
    setStatus("drafting a reply…")
    if (replyTimer) clearTimeout(replyTimer)
    if (idleTimer) clearTimeout(idleTimer)
    replyTimer = setTimeout(() => {
      setMascot("streaming")
      setMessages((prev) => [...prev, { id: nextId(), role: "assistant", text: CANNED }])
      setStatus("ready")
      setMascot("done")
      idleTimer = setTimeout(() => setMascot("idle"), 1200)
    }, 700)
  }

  return {
    view,
    setView,
    mode,
    setMode,
    model,
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
    mascot,
    setMascot,
    status,
    setStatus,
    dragging,
    setDragging,
    activeSession,
    setActiveSession,
    messages,
    sessions,
    toggleMode,
    submit,
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
