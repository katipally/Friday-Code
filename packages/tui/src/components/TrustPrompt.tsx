import { theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { Overlay } from "./ui.tsx"

/**
 * First-run-per-directory trust gate. Friday reads and runs code in the working directory, so the
 * first time it's opened in a folder we ask before doing anything. Granting is remembered in config
 * (trustedRoots) so it's a one-time prompt per folder. Declining exits.
 */
export function TrustPrompt() {
  const app = useApp()

  useKeyboard((key) => {
    if (!app.trustOpen()) return
    if (key.name === "return" || key.name === "enter") return app.trustCwd()
    if (key.name === "escape") return app.declineTrust()
  })

  return (
    <Show when={app.trustOpen()}>
      <Scrim onClose={() => app.declineTrust()}>
        <Overlay title="Trust this folder?" width={64}>
          <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
            <text fg={theme.text}>{app.cwdLabel()}</text>
          </box>
          <text fg={theme.textMuted}>
            Friday can read files and run commands here. Only continue in directories you trust.
          </text>
          <text fg={theme.textFaint}>⏎ trust &amp; continue · esc quit</text>
        </Overlay>
      </Scrim>
    </Show>
  )
}
