import { theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { Meta, Overlay, Pill } from "./ui.tsx"

/**
 * /update — version status + one-tap upgrade. Also opened automatically at startup when a newer
 * version is detected (notify mode). Shows current/latest/channel and drives checkForUpdate /
 * updateAndRestart on the store; the actual upgrade shells out to the detected package manager.
 */
export function UpdateModal() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const st = () => app.updateState()
  const busy = () => st() === "checking" || st() === "updating"

  useKeyboard((key) => {
    if (!app.updateModalOpen()) return
    if (key.name === "escape" && !busy()) app.setUpdateModalOpen(false)
  })

  const statusLine = () => {
    switch (st()) {
      case "checking":
        return "checking npm for the latest version…"
      case "updating":
        return "updating… (running the package manager)"
      case "available":
        return `update available — v${app.updateLatest()}`
      case "current":
        return "you're on the latest version"
      case "done":
        return "updated — restart to use the new version"
      case "error":
        return "couldn't complete — see the log below"
      default:
        return "check for a new version"
    }
  }

  return (
    <Scrim onClose={() => !busy() && app.setUpdateModalOpen(false)}>
      <Overlay title="friday" hint="version & updates" width={Math.min(64, dims().width - 4)}>
        <box flexDirection="column" gap={0}>
          <box flexDirection="row" gap={1}>
            <box width={10}>
              <Meta text="Current" />
            </box>
            <text fg={theme.text}>v{app.version}</text>
          </box>
          <box flexDirection="row" gap={1}>
            <box width={10}>
              <Meta text="Latest" />
            </box>
            <text fg={st() === "available" ? theme.success : theme.text}>
              {app.updateLatest() ? `v${app.updateLatest()}` : "—"}
            </text>
          </box>
          <box flexDirection="row" gap={1}>
            <box width={10}>
              <Meta text="Channel" />
            </box>
            <text fg={theme.textMuted}>{app.updateMethod()} · friday-code</text>
          </box>
        </box>

        <text fg={st() === "error" ? theme.error : st() === "available" ? theme.success : theme.textFaint}>
          {statusLine()}
        </text>

        <Show when={app.updateLog()}>
          <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
            <text fg={theme.textFaint}>{app.updateLog().split("\n").slice(-4).join("\n")}</text>
          </box>
        </Show>

        <box flexDirection="row" gap={1} alignItems="center">
          <Pill label="Check" disabled={busy()} onClick={() => app.checkForUpdate()} />
          <Show when={st() === "available" || st() === "error"}>
            <Pill
              label="Update & restart"
              accent={theme.success}
              disabled={busy()}
              onClick={() => app.updateAndRestart()}
            />
          </Show>
          <Pill
            label={st() === "done" ? "Restart now" : "Cancel"}
            onClick={() => (st() === "done" ? app.quit(true) : app.setUpdateModalOpen(false))}
          />
        </box>
        <text fg={theme.textFaint}>esc close</text>
      </Overlay>
    </Scrim>
  )
}
