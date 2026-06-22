import { theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { Match, Show, Switch } from "solid-js"
import { shimmerAccent } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"

/**
 * Mic modal — press-to-talk, on-device speech-to-text (whisper-tiny.en). Ctrl+R (or ⏎/space) while
 * recording stops & transcribes locally and drops the text into the composer. Shows an OS-aware setup
 * checklist when the mic isn't ready, and keeps the error on screen (with the fix) if anything fails.
 */
export function MicModal() {
  const app = useApp()

  useKeyboard((key) => {
    if (!app.micModalOpen()) return
    if (app.micPhase() === "transcribing") return // busy — ignore keys until it finishes
    if (
      key.name === "return" ||
      key.name === "enter" ||
      key.name === "escape" ||
      key.name === "space" ||
      (key.ctrl && key.name === "r")
    )
      return app.toggleMic() // recording → stop&insert; setup/error → close
  })

  return (
    <Show when={app.micModalOpen()}>
      <Scrim onClose={() => app.closeMic()}>
        <box
          flexDirection="column"
          width={64}
          border
          borderStyle="single"
          borderColor={shimmerAccent(theme.info)}
          backgroundColor={theme.bgElevated}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          gap={1}
        >
          <Switch>
            <Match when={app.micPhase() === "recording"}>
              <text fg={theme.info}>🎙 recording — speak now</text>
              <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1} minHeight={1}>
                <text fg={theme.textMuted}>listening on-device · nothing leaves your machine</text>
              </box>
              <text fg={theme.textFaint}>⏎ / esc / Ctrl+R — stop & transcribe</text>
            </Match>

            <Match when={app.micPhase() === "transcribing"}>
              <text fg={theme.info}>⏳ transcribing on-device…</text>
              <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1} minHeight={1}>
                <text fg={theme.textFaint}>first run loads whisper-tiny.en (~40MB) — a moment, then instant</text>
              </box>
            </Match>

            {/* setup or error */}
            <Match when={app.micPhase() === "setup" || app.micPhase() === "error"}>
              <text fg={app.micError() ? theme.error : theme.warning}>
                {app.micError() ? "⚠ mic error" : "⚠ mic not set up yet"}
              </text>
              <Show when={app.micError()}>
                <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                  <text fg={theme.error} selectable>
                    {app.micError()}
                  </text>
                </box>
              </Show>
              <Show when={app.micSetup().length}>
                <text fg={theme.textFaint}>{app.micError() ? "what might fix it:" : ""}</text>
                <box flexDirection="column" backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                  {app.micSetup().map((l) => (
                    <text fg={l.startsWith("✓") ? theme.success : theme.text}>{l}</text>
                  ))}
                </box>
              </Show>
              <text fg={theme.textFaint}>esc close · once fixed, press Ctrl+R again</text>
            </Match>
          </Switch>
        </box>
      </Scrim>
    </Show>
  )
}
