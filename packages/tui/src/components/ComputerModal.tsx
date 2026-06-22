import { theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { createMemo, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { Overlay } from "./ui.tsx"

/**
 * Computer-use control panel: device support, install / uninstall of the opt-in nut.js backend, and
 * the permissions the OS needs before desktop control actually does anything. One place for
 * everything the user can do with computer-use — the model only ever ACTS through a permission
 * prompt (or yolo), never installs on its own.
 */
export function ComputerModal() {
  const app = useApp()
  const support = createMemo(() => app.engine.computerSupport())

  useKeyboard((key) => {
    if (!app.computerModalOpen()) return
    if (key.name === "escape") return app.setComputerModalOpen(false)
    if (app.computerInstalling()) return // busy installing — ignore actions
    if (key.name === "i" && !app.computerReady() && support().ok) return app.installComputer()
    if (key.name === "u" && app.computerReady()) return app.uninstallComputer()
  })

  return (
    <Show when={app.computerModalOpen()}>
      <Scrim onClose={() => app.setComputerModalOpen(false)}>
        <Overlay title="computer use" hint="desktop control — mouse · keyboard · screenshot" width={66}>
          {/* Device support */}
          <box flexDirection="row" gap={1}>
            <text fg={support().ok ? theme.success : theme.error}>{support().ok ? "✓" : "✗"}</text>
            <text fg={theme.text}>{support().platform}</text>
            <text fg={theme.textFaint}>{support().ok ? "supported" : "not supported"}</text>
          </box>
          <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
            <text fg={theme.textMuted}>{support().note}</text>
          </box>

          {/* Install status */}
          <box flexDirection="row" gap={1}>
            <text fg={app.computerReady() ? theme.success : theme.textFaint}>
              {app.computerReady() ? "✓ backend installed" : "· backend not installed"}
            </text>
            <Show when={app.computerInstalling()}>
              <text fg={theme.brand}>installing nut.js… (can take a minute)</text>
            </Show>
          </box>

          <Show when={!app.computerReady() && !support().ok}>
            <text fg={theme.warning}>Install is disabled — this device can't drive the desktop.</text>
          </Show>

          {/* Last install log (errors etc.) */}
          <Show when={app.computerInstallLog()}>
            <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1} maxHeight={6}>
              <text fg={theme.textFaint} selectable>
                {app.computerInstallLog()}
              </text>
            </box>
          </Show>

          {/* What it does */}
          <box flexDirection="column" backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
            <text fg={theme.textFaint}>screenshot · move · click · type · key · scroll</text>
            <text fg={theme.textFaint}>
              Friday screenshots the screen and reads it before acting; every action asks permission
            </text>
            <text fg={theme.textFaint}>unless you're in yolo mode.</text>
          </box>

          {/* Actions */}
          <box flexDirection="row" gap={2}>
            <Show when={!app.computerReady()}>
              <text fg={support().ok && !app.computerInstalling() ? theme.success : theme.textFaint}>i install</text>
            </Show>
            <Show when={app.computerReady()}>
              <text fg={theme.error}>u uninstall</text>
            </Show>
            <text fg={theme.textFaint}>esc close</text>
          </box>
        </Overlay>
      </Scrim>
    </Show>
  )
}
