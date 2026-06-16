import { Match, onMount, Show, Switch } from "solid-js"
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/solid"
import { theme } from "@friday/shared"
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
import { AskCard } from "./components/AskCard.tsx"
import { ModelModal } from "./components/ModelModal.tsx"
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

  return (
    <box width="100%" height="100%" backgroundColor={theme.bg}>
      {/* The single outermost frame stays black; mode accent lives on badges, panels and focus rings. */}
      <box flexGrow={1} flexDirection="column" border borderStyle="rounded" borderColor={theme.frame} backgroundColor={theme.bg}>
        <TopBar />
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <SessionsPanel />
          <Show when={app.leftOpen()}>
            <Divider side="left" />
          </Show>
          <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
            <Chat />
            <PermissionCard />
            <AskCard />
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
  useKeyboard((key) => {
    if (app.view() === "exit") return // ExitScreen owns keys
    if (key.ctrl && key.name === "c") return app.quit()
    if (app.view() === "splash") {
      if (["return", "enter", "space", "escape"].includes(key.name)) app.setView("shell")
      return
    }
    if (app.onboardingOpen()) return // Onboarding owns keys while open
    if (app.modelModalOpen()) return // ModelModal owns keys while open
    if (app.paletteOpen()) return // CommandPalette owns keys while open
    if (app.historyOpen()) return // SessionHistory owns keys while open
    if (app.dirModalOpen()) return // DirectoryModal owns keys while open
    if (app.mcpModalOpen()) return // McpModal owns keys while open
    if (app.checkpointsOpen()) return // CheckpointHistory owns keys while open
    if (app.askPending()) return // AskCard owns keys while open

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
    if (key.ctrl && key.name === "b") return app.setLeftOpen(!app.leftOpen())
    if (key.ctrl && key.name === "g") return app.setRightOpen(!app.rightOpen())
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
