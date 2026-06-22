import { theme } from "@friday/shared"
import { For } from "solid-js"
import { useApp } from "../store.tsx"

const HINTS: { keys: string; label: string }[] = [
  { keys: "enter", label: "send" },
  { keys: "shift+tab", label: "mode" },
  { keys: "ctrl+b", label: "panel" },
  { keys: "ctrl+k", label: "cmds" },
  { keys: "/", label: "command" },
  { keys: "@", label: "file" },
  { keys: "ctrl+c", label: "quit" },
]

/** Contextual key hints. The "? keys" segment is clickable to open the full keymap overlay. */
export function FooterHints() {
  const app = useApp()
  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} gap={2} alignItems="center">
      <For each={HINTS}>
        {(h) => {
          // The quit hint flips to an armed warning once Ctrl+C is pressed once (gated exit).
          const armed = () => h.keys === "ctrl+c" && app.quitArmed()
          return (
            <box flexDirection="row" gap={1}>
              <text fg={armed() ? theme.warning : theme.text}>{h.keys}</text>
              <text fg={armed() ? theme.warning : theme.textFaint}>{armed() ? "press again to exit" : h.label}</text>
            </box>
          )
        }}
      </For>
      <box flexGrow={1} />
      <box flexDirection="row" gap={1} onMouseDown={() => app.setOverlayOpen(true)}>
        <text fg={theme.text}>?</text>
        <text fg={theme.textFaint}>keys</text>
      </box>
    </box>
  )
}
