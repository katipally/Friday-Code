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
    if (key.name === "return" || key.name === "enter" || key.name === "escape" || key.name === "space")
      return app.stopVoiceModal()
  })

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
          <text fg={theme.textFaint}>⏎/esc stop & insert · transcribes live, on-device</text>
        </box>
      </Scrim>
    </Show>
  )
}
