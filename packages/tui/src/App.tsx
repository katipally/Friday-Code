import type { Engine } from "@friday/core"
import { theme } from "@friday/shared"
import { useKeyboard, useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Match, onMount, Show, Switch, untrack } from "solid-js"
import { AddModal } from "./components/AddModal.tsx"
import { AskCard } from "./components/AskCard.tsx"
import { Chat } from "./components/Chat.tsx"
import { CheckpointHistory } from "./components/CheckpointHistory.tsx"
import { CommandPalette } from "./components/CommandPalette.tsx"
import { CompactionCard, CompactionSummary } from "./components/CompactionCard.tsx"
import { Composer } from "./components/Composer.tsx"
import { ComputerModal } from "./components/ComputerModal.tsx"
import { ConsoleView } from "./components/ConsoleView.tsx"
import { ContextPanel } from "./components/ContextPanel.tsx"
import { Dashboard } from "./components/Dashboard.tsx"
import { DirectoryModal } from "./components/DirectoryModal.tsx"
import { CollapseTab, GripDivider } from "./components/Divider.tsx"
import { EffortSlider } from "./components/EffortSlider.tsx"
import { FooterHints } from "./components/FooterHints.tsx"
import { ForkPicker } from "./components/ForkPicker.tsx"
import { KeymapOverlay } from "./components/KeymapOverlay.tsx"
import { WORDMARK_ROWS } from "./components/Logo.tsx"
import { McpModal } from "./components/McpModal.tsx"
import { MicModal } from "./components/MicModal.tsx"
import { ModelModal } from "./components/ModelModal.tsx"
import { PermissionCard } from "./components/PermissionCard.tsx"
import { PlanCard } from "./components/PlanCard.tsx"
import { SessionHistory } from "./components/SessionHistory.tsx"
import { SkillsModal } from "./components/SkillsModal.tsx"
import { StatusStrip } from "./components/StatusStrip.tsx"
import { Toasts } from "./components/Toasts.tsx"
import { TopBar } from "./components/TopBar.tsx"
import { TrustPrompt } from "./components/TrustPrompt.tsx"
import { YoloConfirm } from "./components/YoloConfirm.tsx"
import { AppProvider, createAppStore, useApp } from "./store.tsx"

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

// Wordmark left in the terminal on exit — the SAME half-block glyphs as the empty-state Logo
// (shared WORDMARK_ROWS), printed statically in brand amber (xterm-256 #214). The live logo's
// per-column shimmer can't render to stdout, but the glyph rows themselves print fine.
const AMBER = "\x1b[38;5;214m"
const RESET = "\x1b[0m"
const EXIT_LOGO = WORDMARK_ROWS.map((r) => `  ${AMBER}${r}${RESET}`).join("\n")

function Shell() {
  const app = useApp()
  const dims = useTerminalDimensions()

  // Right-panel resize state. A vertical grip bar sits between chat and the right panel.
  const [dragging, setDragging] = createSignal(false)
  let startX = 0
  let startW = 0

  // Min wide enough that stat labels/numbers never wrap; max capped so the panel can't swallow
  // the chat. Dragging below the min snaps the panel fully closed.
  const MIN_RIGHT = 24
  const maxRight = () => Math.max(MIN_RIGHT, Math.floor(dims().width * 0.5))

  function grab(e: any) {
    setDragging(true)
    startX = typeof e?.x === "number" ? e.x : 0
    startW = app.rightWidth()
  }
  function onDrag(e: any) {
    if (!dragging() || typeof e?.x !== "number") return
    // Panel sits on the LEFT, so dragging the grip rightward grows it.
    const delta = e.x - startX
    const target = startW + delta
    // Dragging the grip past the minimum collapses the panel — the CollapseTab then
    // drags it back open. We keep rightWidth at its last valid size so reopening restores it.
    if (target < MIN_RIGHT - 4) {
      app.setRightOpen(false)
      endDrag()
      return
    }
    app.setRightWidth(Math.max(MIN_RIGHT, Math.min(maxRight(), target)))
  }
  const endDrag = () => setDragging(false)

  // Responsive: on narrow terminals the right panel becomes a fullscreen overlay.
  const NARROW = 70
  const narrow = createMemo(() => dims().width < NARROW)

  // Responsive conversation gutters: full-width (just the 1-col buffer) on small terminals, then a
  // growing inset so the conversation column caps near TARGET cols and stays centered on wide ones —
  // otherwise the right-aligned user bubble and left-aligned reply drift far apart. Chat + composer
  // + status share this inset so the whole column lines up.
  const TARGET = 100
  const contentPad = createMemo(() => {
    const sidebar = !narrow() && app.rightOpen() ? app.rightWidth() + 1 : 0
    const mainW = dims().width - sidebar
    return 1 + Math.max(0, Math.floor((mainW - TARGET) / 2))
  })

  let wasNarrow = false
  let savedRight = true
  createEffect(() => {
    const n = narrow()
    untrack(() => {
      if (n && !wasNarrow) {
        savedRight = app.rightOpen()
        app.setRightOpen(false)
      } else if (!n && wasNarrow) {
        app.setRightOpen(savedRight)
      }
      wasNarrow = n
    })
  })

  return (
    <box width="100%" height="100%" backgroundColor={theme.bg}>
      {/* No outer app frame (opencode-style): the canvas is borderless. Chrome is greyscale + brand
          amber; the per-mode accent is confined to the chat transcript + composer focus ring. */}
      <box flexGrow={1} flexDirection="column" backgroundColor={theme.bg}>
        {/* The side panel is a full-height LEFT sidebar that PUSHES the main column (it never hovers).
            Drag is handled at the row so resize keeps tracking once the cursor leaves the grip. */}
        <box
          flexDirection="row"
          flexGrow={1}
          minHeight={0}
          onMouseDrag={onDrag}
          onMouseUp={endDrag}
          onMouseDragEnd={endDrag}
        >
          {/* Full-height left sidebar with a draggable grip; a collapse tab shows when closed. */}
          <Show when={!narrow()} fallback={<CollapseTab side="left" onOpen={() => app.setRightOpen(true)} />}>
            <Show when={app.rightOpen()} fallback={<CollapseTab side="left" onOpen={() => app.setRightOpen(true)} />}>
              <ContextPanel widthOverride={app.rightWidth()} />
              <GripDivider active={dragging()} onGrab={grab} onDrag={onDrag} onEnd={endDrag} />
            </Show>
          </Show>

          {/* Main column — top bar, chat, status, composer, footer. Everything centers over the
              chat area, which narrows as the sidebar opens, keeping the UI balanced. */}
          <box flexGrow={1} minHeight={0} flexDirection="column">
            <TopBar />
            {/* The chat area spans the FULL column width so its scrollbar sits on the terminal's
                right edge; the conversation content is inset by `pad` internally to stay centered
                and aligned with the composer below. */}
            <box flexGrow={1} minHeight={0} flexDirection="column">
              <Chat pad={contentPad()} />
            </box>
            {/* Status + composer share the chat's inset so the input box stays aligned with the
                conversation column as it centers on wide terminals. */}
            <box flexShrink={0} flexDirection="column" paddingLeft={contentPad()} paddingRight={contentPad()}>
              <StatusStrip />
              <Composer />
            </box>
            <FooterHints />
          </box>
        </box>
      </box>

      {/* Narrow-terminal fullscreen overlay for the right panel. */}
      <Show when={narrow() && app.rightOpen()}>
        <box position="absolute" top={0} left={0} width={dims().width} height={dims().height}>
          <ContextPanel fullscreen />
        </box>
      </Show>

      <Show when={app.overlayOpen()}>
        <KeymapOverlay />
      </Show>
      <Show when={app.modelModalOpen()}>
        <ModelModal />
      </Show>
      <Show when={app.yoloConfirmOpen()}>
        <YoloConfirm />
      </Show>
      <Show when={app.micModalOpen()}>
        <MicModal />
      </Show>
      <Show when={app.effortOpen()}>
        <EffortSlider />
      </Show>
      <Show when={app.paletteOpen()}>
        <CommandPalette />
      </Show>
      <Show when={app.historyOpen()}>
        <SessionHistory />
      </Show>
      <Show when={app.dirModalOpen()}>
        <DirectoryModal />
      </Show>
      <Show when={app.addModalOpen()}>
        <AddModal />
      </Show>
      <Show when={app.mcpModalOpen()}>
        <McpModal />
      </Show>
      <Show when={app.skillsModalOpen()}>
        <SkillsModal />
      </Show>
      <Show when={app.computerModalOpen()}>
        <ComputerModal />
      </Show>
      <Show when={app.checkpointsOpen()}>
        <CheckpointHistory />
      </Show>
      <Show when={app.forkOpen()}>
        <ForkPicker />
      </Show>
      <TrustPrompt />
      {/* HITL prompts render as centered overlays above the (dimmed) shell. */}
      <PermissionCard />
      <AskCard />
      <PlanCard />
      <CompactionCard />
      <CompactionSummary />
      <Toasts />
    </box>
  )
}

function AppRoot() {
  const app = useApp()
  const renderer = useRenderer()

  onMount(() => app.engine.ready())

  let lastEsc = 0
  let stopArmedAt = 0
  let quitArmedAt = 0
  useKeyboard((key) => {
    if (app.view() === "exit") return // exit is finalizing; ignore keys
    if (key.ctrl && key.name === "c") {
      // Gated quit: first Ctrl+C arms (footer shows "press again to exit"), a second within 2s
      // actually exits. Prevents a stray Ctrl+C from dropping the user out of a long session.
      const t = Date.now()
      if (app.quitArmed() && t - quitArmedAt < 2000) {
        app.setQuitArmed(false)
        return app.quit()
      }
      quitArmedAt = t
      app.setQuitArmed(true)
      setTimeout(() => {
        if (Date.now() - quitArmedAt >= 1950) app.setQuitArmed(false)
      }, 2000)
      return
    }
    if (app.view() === "console") {
      // ConsoleView owns its keys; only the toggle is global so it can close from here too.
      if (key.ctrl && key.name === "t") return app.toggleConsole()
      return
    }
    if (app.view() === "dashboard") {
      // Dashboard owns its keys; only the toggle is global so it can close from here too.
      if (key.ctrl && key.name === "o") return app.toggleDashboard()
      return
    }
    // KeymapOverlay has no useKeyboard of its own — close it on Esc here.
    if (app.overlayOpen()) {
      if (key.name === "escape") app.setOverlayOpen(false)
      return
    }
    // Every other modal / HITL prompt owns its own keyboard; global shortcuts must not fire under
    // them. anyModalOpen() is the single source of truth (store), so nothing can be forgotten here.
    if (app.anyModalOpen()) return
    if (key.shift && key.name === "tab") return app.toggleMode(1)
    if (key.ctrl && key.name === "b") {
      app.setRightOpen(!app.rightOpen())
      return
    }
    if (key.ctrl && /^[1-9]$/.test(key.name)) return app.switchSessionByIndex(Number(key.name) - 1)
    if (key.ctrl && key.name === "k") return app.setPaletteOpen(true)
    if (key.ctrl && key.name === "r") return app.toggleMic()
    if (key.ctrl && key.name === "t") return app.toggleConsole()
    if (key.ctrl && key.name === "o") return app.toggleDashboard()
    if (key.ctrl && key.name === "y") return app.setHistoryOpen(true)
    if (key.name?.toLowerCase() === "f1" || (key.ctrl && key.name === "/")) return app.setOverlayOpen(true)
    // `?` opens the keymap, but only when the composer is empty so it never eats a literal "?".
    if ((key.name === "?" || (key.name === "/" && key.shift)) && app.composerEmpty()) {
      app.setOverlayOpen(true)
      queueMicrotask(() => app.clearComposer()) // wipe the stray "?" the textarea may have inserted
      return
    }
    if (key.name === "escape") {
      if (app.busy()) {
        // Double-Esc to stop: first Esc arms (shows a hint), a second within 1.5s aborts.
        const t = Date.now()
        if (app.stopArmed() && t - stopArmedAt < 1500) {
          stopArmedAt = 0
          app.setStopArmed(false)
          return app.abort()
        }
        stopArmedAt = t
        app.setStopArmed(true)
        setTimeout(() => {
          if (Date.now() - stopArmedAt >= 1450) app.setStopArmed(false)
        }, 1500)
        return
      }
      // Double-tap Esc opens the checkpoint / undo history.
      const t = Date.now()
      if (t - lastEsc < 500) {
        lastEsc = 0
        return app.setCheckpointsOpen(true)
      }
      lastEsc = t
    }
  })

  useSelectionHandler((selection) => {
    const txt = selection.getSelectedText()
    if (txt) renderer.copyToClipboardOSC52(txt)
  })

  // Clean exit: no full-screen farewell. Tear down the TUI, then leave the wordmark, session stats and
  // the resume command in the normal terminal scrollback.
  let exited = false
  function finalizeExit() {
    if (exited) return
    exited = true
    const id = app.engine.currentSessionId()
    const title = app.engine.currentTitle()
    const empty = app.engine.currentIsEmpty()
    const s = app.exitStats()
    app.engine.dispose() // close MCP + discard empty placeholder sessions so history stays clean
    renderer.destroy() // leave the alt-screen and restore the normal terminal
    const name = title ? `  “${title}”\n` : ""
    const stats = s ? `  ${s.messages} messages · ${fmtTokens(s.tokens)} tokens · ${fmtDuration(s.durationMs)}\n` : ""
    const resume = empty ? "" : `  resume:  friday -s ${id}\n` // empty sessions are discarded on dispose
    process.stdout.write(`\n${EXIT_LOGO}\n\n${name}${stats}${resume}\n`)
    process.exit(0)
  }
  createEffect(() => {
    if (app.view() === "exit") finalizeExit()
  })

  return (
    <Switch fallback={<Shell />}>
      <Match when={app.view() === "exit"}>{null}</Match>
      <Match when={app.view() === "console"}>
        <ConsoleView />
      </Match>
      <Match when={app.view() === "dashboard"}>
        <Dashboard />
      </Match>
    </Switch>
  )
}

export function App(props: { engine: Engine; version?: string }) {
  const store = createAppStore(props.engine, props.version)
  return (
    <AppProvider store={store}>
      <AppRoot />
    </AppProvider>
  )
}
