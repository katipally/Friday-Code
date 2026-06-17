import { createEffect, createMemo, createSignal, Match, onMount, Show, Switch, untrack } from "solid-js"
import { useKeyboard, useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/solid"
import { theme } from "@friday/shared"
import type { Engine } from "@friday/core"
import { AppProvider, createAppStore, useApp } from "./store.tsx"
import { Splash } from "./components/Splash.tsx"
import { TopBar } from "./components/TopBar.tsx"
import { SessionsPanel } from "./components/SessionsPanel.tsx"
import { ContextPanel } from "./components/ContextPanel.tsx"
import { Divider } from "./components/Divider.tsx"
import { ReopenStub } from "./components/PanelChrome.tsx"
import { Chat } from "./components/Chat.tsx"
import { StatusStrip } from "./components/StatusStrip.tsx"
import { Composer } from "./components/Composer.tsx"
import { FooterHints } from "./components/FooterHints.tsx"
import { KeymapOverlay } from "./components/KeymapOverlay.tsx"
import { PermissionCard } from "./components/PermissionCard.tsx"
import { AskCard } from "./components/AskCard.tsx"
import { PlanCard } from "./components/PlanCard.tsx"
import { ModelModal } from "./components/ModelModal.tsx"
import { EffortSlider } from "./components/EffortSlider.tsx"
import { CommandPalette } from "./components/CommandPalette.tsx"
import { SessionHistory } from "./components/SessionHistory.tsx"
import { DirectoryModal } from "./components/DirectoryModal.tsx"
import { McpModal } from "./components/McpModal.tsx"
import { CheckpointHistory } from "./components/CheckpointHistory.tsx"
import { ExitScreen } from "./components/ExitScreen.tsx"
import { Onboarding } from "./components/Onboarding.tsx"
import { Toasts } from "./components/Toasts.tsx"

function Shell() {
  const app = useApp()
  const dims = useTerminalDimensions()

  // Panel resize is driven from this row (not the divider) so drag events keep landing even when
  // the handle reflows out from under the cursor — the bug that made the right panel glitch.
  // Width math is absolute (startW + delta), so a double-delivered event is idempotent.
  const [dragSide, setDragSide] = createSignal<null | "left" | "right">(null)
  let startX = 0
  let startW = 0
  function grab(side: "left" | "right", e: any) {
    setDragSide(side)
    startX = typeof e?.x === "number" ? e.x : 0
    startW = side === "left" ? app.leftWidth() : app.rightWidth()
  }
  function onRowDrag(e: any) {
    const side = dragSide()
    if (!side || typeof e?.x !== "number") return
    const max = Math.floor(dims().width / 2)
    const delta = e.x - startX
    if (side === "left") app.setLeftWidth(Math.max(14, Math.min(max, startW + delta)))
    else app.setRightWidth(Math.max(16, Math.min(max, startW - delta)))
  }
  const endDrag = () => setDragSide(null)

  // ---- responsive breakpoints ----
  // WIDE ≥100 · MED 70–99 (panels clamped so chat keeps a floor) · NARROW <70 (panels collapse;
  // an opened panel takes the full screen so the chat is never squeezed to nothing).
  const NARROW = 70
  const MIN_CHAT = 36
  const narrow = createMemo(() => dims().width < NARROW)
  // In MED, scale both panel widths down proportionally so chat never drops below MIN_CHAT.
  const panelBudget = () => Math.max(0, dims().width - MIN_CHAT - 4) // ~4 cols for dividers
  const effWidth = (mine: number, otherOpen: boolean, otherW: number) => {
    const total = mine + (otherOpen ? otherW : 0)
    if (total === 0 || total <= panelBudget()) return mine
    return Math.max(14, Math.floor((mine * panelBudget()) / total))
  }
  const effLeft = () => effWidth(app.leftWidth(), app.rightOpen(), app.rightWidth())
  const effRight = () => effWidth(app.rightWidth(), app.leftOpen(), app.leftWidth())

  // Crossing into NARROW auto-collapses both panels (remembering the user's intent so widening
  // restores it). Inside NARROW only one panel shows at a time (the open one is fullscreen).
  let wasNarrow = false
  let savedLeft = true
  let savedRight = true
  createEffect(() => {
    const n = narrow()
    untrack(() => {
      if (n && !wasNarrow) {
        savedLeft = app.leftOpen()
        savedRight = app.rightOpen()
        app.setLeftOpen(false)
        app.setRightOpen(false)
      } else if (!n && wasNarrow) {
        app.setLeftOpen(savedLeft)
        app.setRightOpen(savedRight)
      }
      wasNarrow = n
    })
  })
  const openLeftSolo = () => {
    app.setLeftOpen(true)
    if (narrow()) app.setRightOpen(false)
  }
  const openRightSolo = () => {
    app.setRightOpen(true)
    if (narrow()) app.setLeftOpen(false)
  }

  return (
    <box width="100%" height="100%" backgroundColor={theme.bg}>
      {/* The single outermost frame stays black; mode accent lives on badges, panels and focus rings. */}
      <box flexGrow={1} flexDirection="column" border borderStyle="rounded" borderColor={theme.frame} backgroundColor={theme.bg}>
        <TopBar />
        <box flexDirection="row" flexGrow={1} minHeight={0} onMouseDrag={onRowDrag} onMouseUp={endDrag} onMouseDragEnd={endDrag}>
          {/* Side panels are inline only when there's room; in NARROW they become fullscreen overlays. */}
          <Show when={!narrow()} fallback={<Show when={!app.leftOpen()}><ReopenStub glyph="›" onOpen={openLeftSolo} /></Show>}>
            <SessionsPanel widthOverride={effLeft()} />
            <Show when={app.leftOpen()}>
              <Divider side="left" active={dragSide() === "left"} onGrab={(e) => grab("left", e)} onDrag={onRowDrag} onEnd={endDrag} />
            </Show>
          </Show>
          <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
            <Chat />
            <StatusStrip />
            <Composer />
          </box>
          <Show when={!narrow()} fallback={<Show when={!app.rightOpen()}><ReopenStub glyph="‹" onOpen={openRightSolo} /></Show>}>
            <Show when={app.rightOpen()}>
              <Divider side="right" active={dragSide() === "right"} onGrab={(e) => grab("right", e)} onDrag={onRowDrag} onEnd={endDrag} />
            </Show>
            <ContextPanel widthOverride={effRight()} />
          </Show>
        </box>
        <FooterHints />
      </box>
      {/* NARROW fullscreen panel overlays — chat keeps full focus until the user opens one. */}
      <Show when={narrow() && app.leftOpen()}>
        <box position="absolute" top={1} left={1} width={Math.max(0, dims().width - 2)} height={Math.max(0, dims().height - 2)}>
          <SessionsPanel fullscreen />
        </box>
      </Show>
      <Show when={narrow() && app.rightOpen()}>
        <box position="absolute" top={1} left={1} width={Math.max(0, dims().width - 2)} height={Math.max(0, dims().height - 2)}>
          <ContextPanel fullscreen />
        </box>
      </Show>
      <Show when={app.overlayOpen()}>
        <KeymapOverlay />
      </Show>
      <Show when={app.modelModalOpen()}>
        <ModelModal />
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
      <Show when={app.mcpModalOpen()}>
        <McpModal />
      </Show>
      <Show when={app.checkpointsOpen()}>
        <CheckpointHistory />
      </Show>
      <Show when={app.onboardingOpen()}>
        <Onboarding />
      </Show>
      {/* HITL prompts render as centered overlays above the (dimmed) shell. */}
      <PermissionCard />
      <AskCard />
      <PlanCard />
      <Toasts />
    </box>
  )
}

function AppRoot() {
  const app = useApp()
  const renderer = useRenderer()
  const dims = useTerminalDimensions()

  onMount(() => app.engine.ready())

  let lastEsc = 0
  let stopArmedAt = 0
  useKeyboard((key) => {
    if (app.view() === "exit") return // ExitScreen owns keys
    if (key.ctrl && key.name === "c") return app.quit()
    if (app.view() === "splash") {
      if (["return", "enter", "space", "escape"].includes(key.name)) app.setView("shell")
      return
    }
    if (app.onboardingOpen()) return // Onboarding owns keys while open
    if (app.modelModalOpen()) return // ModelModal owns keys while open
    if (app.effortOpen()) return // EffortSlider owns keys while open
    if (app.paletteOpen()) return // CommandPalette owns keys while open
    if (app.historyOpen()) return // SessionHistory owns keys while open
    if (app.dirModalOpen()) return // DirectoryModal owns keys while open
    if (app.mcpModalOpen()) return // McpModal owns keys while open
    if (app.checkpointsOpen()) return // CheckpointHistory owns keys while open
    if (app.askPending()) return // AskCard owns keys while open
    if (app.planPending()) return // PlanCard owns keys while open

    if (app.pending()) {
      const decisions = ["allow-once", "allow-always", "deny"] as const
      if (key.name === "a") return app.replyPermission("allow-once")
      if (key.name === "s") return app.replyPermission("allow-always")
      if (key.name === "d" || key.name === "escape") return app.replyPermission("deny")
      if (key.name === "up" || key.name === "k") return app.setPermSel((s) => (s + 2) % 3)
      if (key.name === "down" || key.name === "j" || (key.name === "tab" && !key.shift)) return app.setPermSel((s) => (s + 1) % 3)
      if (key.name === "tab" && key.shift) return app.setPermSel((s) => (s + 2) % 3)
      if (key.name === "return" || key.name === "enter") return app.replyPermission(decisions[app.permSel()]!)
      return
    }
    if (app.overlayOpen()) {
      if (key.name === "escape") app.setOverlayOpen(false)
      return
    }
    if (key.shift && key.name === "tab") return app.toggleMode(1)
    if (key.ctrl && key.name === "b") {
      const open = !app.leftOpen()
      app.setLeftOpen(open)
      if (open && dims().width < 70) app.setRightOpen(false) // one panel at a time on narrow terminals
      return
    }
    if (key.ctrl && key.name === "g") {
      const open = !app.rightOpen()
      app.setRightOpen(open)
      if (open && dims().width < 70) app.setLeftOpen(false)
      return
    }
    if (key.ctrl && /^[1-9]$/.test(key.name)) return app.switchSessionByIndex(Number(key.name) - 1)
    if (key.ctrl && key.name === "k") return app.setPaletteOpen(true)
    if (key.ctrl && key.name === "y") return app.setHistoryOpen(true)
    if (key.name?.toLowerCase() === "f1" || (key.ctrl && key.name === "/")) return app.setOverlayOpen(true)
    if (key.name === "escape") {
      if (app.busy()) {
        // Double-Esc to stop: first Esc arms (shows a hint), a second within 1.5s aborts.
        // A stray single Esc is a no-op, so the agent isn't killed by an accidental tap.
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
      // Double-tap Esc (within 500ms) opens the checkpoint / undo history.
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

  return (
    <Switch fallback={<Splash />}>
      <Match when={app.view() === "exit"}>
        <ExitScreen />
      </Match>
      <Match when={app.view() === "shell"}>
        <Shell />
      </Match>
    </Switch>
  )
}

export function App(props: { engine: Engine }) {
  const store = createAppStore(props.engine)
  return (
    <AppProvider store={store}>
      <AppRoot />
    </AppProvider>
  )
}
