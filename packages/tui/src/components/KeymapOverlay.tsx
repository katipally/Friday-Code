import { MODES, theme } from "@friday/shared"
import { For } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"

const KEYS: { keys: string; label: string }[] = [
  { keys: "Enter", label: "send message" },
  { keys: "Shift+Enter", label: "new line in composer" },
  { keys: "Shift+Tab", label: "cycle mode (plan → default → yolo)" },
  { keys: "Ctrl+B", label: "toggle context panel" },
  { keys: "Ctrl+K", label: "command palette" },
  { keys: "/effort", label: "reasoning-effort slider (←/→ · click · enter)" },
  { keys: "Ctrl+Y", label: "session history (all directories)" },
  { keys: "Ctrl+1-9", label: "switch working session" },
  { keys: "/ · @", label: "slash command · file mention" },
  { keys: "? · F1", label: "this keymap (or click ? keys)" },
  { keys: "Esc", label: "close overlay / cancel" },
  { keys: "Ctrl+C", label: "quit" },
]

/** Full-screen keymap overlay. Dismissed via Esc or click (handled in App + backdrop). */
export function KeymapOverlay() {
  const app = useApp()

  return (
    <Scrim onClose={() => app.setOverlayOpen(false)}>
      <box
        flexDirection="column"
        border
        borderStyle="single"
        borderColor={theme.border}
        backgroundColor={theme.bgElevated}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <text fg={theme.textMuted}>keyboard</text>
        <box flexDirection="column">
          <For each={KEYS}>
            {(k) => (
              <box flexDirection="row" gap={2}>
                <box width={16}>
                  <text fg={theme.text}>{k.keys}</text>
                </box>
                <text fg={theme.textMuted}>{k.label}</text>
              </box>
            )}
          </For>
        </box>
        <box height={1} />
        <text fg={theme.textMuted}>modes</text>
        <box flexDirection="column">
          <For each={MODES}>
            {(m) => (
              <box flexDirection="row" gap={2}>
                <box width={16} flexDirection="row" gap={1}>
                  <text fg={m.accent}>{m.glyph}</text>
                  <text fg={m.accent}>{m.label}</text>
                </box>
                <text fg={theme.textMuted}>{m.hint}</text>
              </box>
            )}
          </For>
        </box>
        <box height={1} />
        <text fg={theme.textFaint}>esc or click to close</text>
      </box>
    </Scrim>
  )
}
