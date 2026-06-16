import { onMount, Show } from "solid-js"
import { useKeyboard, useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import type { Engine } from "@friday/core"
import { AppProvider, createAppStore, useApp } from "./store.tsx"
import { Splash } from "./components/Splash.tsx"
import { TopBar } from "./components/TopBar.tsx"
import { SessionsPanel } from "./components/SessionsPanel.tsx"
import { ContextPanel } from "./components/ContextPanel.tsx"
import { Divider } from "./components/Divider.tsx"
import { Chat } from "./components/Chat.tsx"
import { StatusStrip } from "./components/StatusStrip.tsx"
import { Composer } from "./components/Composer.tsx"
import { FooterHints } from "./components/FooterHints.tsx"
import { KeymapOverlay } from "./components/KeymapOverlay.tsx"
import { PermissionCard } from "./components/PermissionCard.tsx"
import { ModelModal } from "./components/ModelModal.tsx"

function Shell() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const accent = () => getMode(app.mode()).accent

  function onMove(e: { x: number }) {
    const d = app.dragging()
    if (!d) return
    const w = dims().width
    if (d === "left") app.setLeftWidth(Math.max(14, Math.min(Math.floor(w / 2), e.x - 1)))
    else app.setRightWidth(Math.max(16, Math.min(Math.floor(w / 2), w - e.x - 2)))
  }
  function onUp() {
    if (app.dragging()) app.setDragging(null)
  }

  return (
    <box width="100%" height="100%" backgroundColor={theme.bg} onMouseMove={onMove as any} onMouseUp={onUp}>
      <box flexGrow={1} flexDirection="column" border borderStyle="rounded" borderColor={accent()} backgroundColor={theme.bg}>
        <TopBar />
        <box flexDirection="row" flexGrow={1}>
          <SessionsPanel />
          <Show when={app.leftOpen()}>
            <Divider side="left" />
          </Show>
          <box flexGrow={1} flexDirection="column" paddingLeft={1} paddingRight={1}>
            <Chat />
            <PermissionCard />
            <StatusStrip />
            <Composer />
          </box>
          <Show when={app.rightOpen()}>
            <Divider side="right" />
          </Show>
          <ContextPanel />
        </box>
        <FooterHints />
      </box>
      <Show when={app.overlayOpen()}>
        <KeymapOverlay />
      </Show>
      <Show when={app.modelModalOpen()}>
        <ModelModal />
      </Show>
    </box>
  )
}

function AppRoot() {
  const app = useApp()
  const renderer = useRenderer()

  onMount(() => app.engine.ready())

  useKeyboard((key) => {
    if (app.view() === "splash") {
      if (["return", "enter", "space", "escape"].includes(key.name)) app.setView("shell")
      return
    }
    if (app.modelModalOpen()) return // ModelModal owns keys while open

    if (app.pending()) {
      if (key.name === "a" || key.name === "return" || key.name === "enter") return app.replyPermission("allow-once")
      if (key.name === "s") return app.replyPermission("allow-always")
      if (key.name === "d" || key.name === "escape") return app.replyPermission("deny")
      return
    }
    if (app.overlayOpen()) {
      if (key.name === "escape") app.setOverlayOpen(false)
      return
    }
    if (key.shift && key.name === "tab") return app.toggleMode(1)
    if (key.ctrl && key.name === "b") return app.setLeftOpen(!app.leftOpen())
    if (key.ctrl && key.name === "g") return app.setRightOpen(!app.rightOpen())
    if (key.name?.toLowerCase() === "f1" || (key.ctrl && key.name === "/")) return app.setOverlayOpen(true)
    if (key.name === "escape" && app.busy()) return app.abort()
  })

  useSelectionHandler((selection) => {
    const txt = selection.getSelectedText()
    if (txt) renderer.copyToClipboardOSC52(txt)
  })

  return (
    <Show when={app.view() === "shell"} fallback={<Splash />}>
      <Shell />
    </Show>
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
