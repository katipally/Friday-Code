import { MODES, theme } from "@friday/shared"
import { For } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { SectionLabel } from "./ui.tsx"

const KEYS: { keys: string; label: string }[] = [
  { keys: "Enter", label: "send message" },
  { keys: "Shift+Enter", label: "new line in composer" },
  { keys: "Shift+Tab", label: "cycle mode (plan → default → yolo)" },
  { keys: "Ctrl+B", label: "toggle context panel" },
  { keys: "Ctrl+K", label: "command palette" },
  { keys: "Ctrl+O", label: "dashboard — Sessions · Teams · Swarm · History (tab to switch)" },
  { keys: "Ctrl+T", label: "agent-team console (j/k · v visit · s stop · o pop-out)" },
  { keys: "Ctrl+R", label: "mic — press to record, press again to transcribe (on-device)" },
  { keys: "/effort", label: "reasoning-effort slider (←/→ · click · enter)" },
  { keys: "Ctrl+Y", label: "session history (all directories)" },
  { keys: "Ctrl+1-9", label: "switch working session" },
  { keys: "/ · @", label: "slash command · file mention" },
  { keys: "? · F1", label: "this keymap (or click ? keys)" },
  { keys: "Esc", label: "close overlay / cancel" },
  { keys: "Ctrl+C", label: "quit (press twice)" },
]

/** Full-screen keymap overlay. Dismissed via Esc or click (handled in App + backdrop). */
export function KeymapOverlay() {
  const app = useApp()

  return (
    <Scrim onClose={() => app.setOverlayOpen(false)}>
      <box
        flexDirection="column"
        backgroundColor={theme.bgElevated}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <SectionLabel text="keyboard" />
        <box flexDirection="column">
          <For each={KEYS}>
            {(k) => (
              <box flexDirection="row" gap={2}>
                <box width={16}>
                  <text fg={theme.text}>{k.keys}</text>
                </box>
                <text fg={theme.textFaint}>{k.label}</text>
              </box>
            )}
          </For>
        </box>
        <box height={1} />
        <SectionLabel text="modes" />
        <box flexDirection="column">
          <For each={MODES}>
            {(m) => (
              <box flexDirection="row" gap={2}>
                <box width={16} flexDirection="row" gap={1}>
                  <text fg={m.accent}>{m.glyph}</text>
                  <text fg={m.accent}>{m.label}</text>
                </box>
                <text fg={theme.textFaint}>{m.hint}</text>
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
