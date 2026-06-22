import { theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { Show } from "solid-js"
import { shimmerAccent } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"

/**
 * Live voice-input modal. While open, the native speech helper streams partial transcripts which
 * render here in real time; ⏎/esc stops and drops the final text into the composer (editable).
 */
export function VoiceModal() {
  const app = useApp()

  useKeyboard((key) => {
    if (!app.voiceModalOpen()) return
    if (
      key.name === "return" ||
      key.name === "enter" ||
      key.name === "escape" ||
      key.name === "space" ||
      (key.ctrl && key.name === "r")
    )
      return app.stopVoiceModal()
  })

  const setup = () => app.voiceSetup()

  return (
    <Show when={app.voiceModalOpen()}>
      <Scrim onClose={() => app.stopVoiceModal()}>
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
          <Show
            when={!app.voiceError() && setup().length === 0}
            fallback={
              <>
                <text fg={app.voiceError() ? theme.error : theme.warning}>
                  {app.voiceError() ? "⚠ voice error" : "⚠ voice not set up yet"}
                </text>
                {/* The actual error (if a session failed). */}
                <Show when={app.voiceError()}>
                  <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                    <text fg={theme.error} selectable>
                      {app.voiceError()}
                    </text>
                  </box>
                </Show>
                {/* What might fix it — the OS-aware checklist (✓ done · • todo). */}
                <Show when={setup().length}>
                  <text fg={theme.textFaint}>{app.voiceError() ? "what might fix it:" : ""}</text>
                  <box flexDirection="column" backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                    {setup().map((l) => (
                      <text fg={l.startsWith("✓") ? theme.success : theme.text}>{l}</text>
                    ))}
                  </box>
                </Show>
                <text fg={theme.textFaint}>esc close · once fixed, press Ctrl+R again</text>
              </>
            }
          >
            <text fg={theme.info}>🎙 listening — speak now</text>
            <box
              border
              borderStyle="single"
              borderColor={theme.border}
              backgroundColor={theme.bgComposer}
              paddingLeft={1}
              paddingRight={1}
              minHeight={3}
            >
              <text fg={theme.text} selectable>
                {app.voicePartial() || "…"}
              </text>
            </box>
            <text fg={theme.textFaint}>⏎/esc/Ctrl+R stop & insert · transcribes live, on-device</text>
          </Show>
        </box>
      </Scrim>
    </Show>
  )
}
