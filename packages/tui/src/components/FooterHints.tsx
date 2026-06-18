import { For } from "solid-js"
import { theme } from "@friday/shared"
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
        {(h) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>{h.keys}</text>
            <text fg={theme.textFaint}>{h.label}</text>
          </box>
        )}
      </For>
      <box flexGrow={1} />
      <box flexDirection="row" gap={1} onMouseDown={() => app.setOverlayOpen(true)}>
        <text fg={theme.text}>?</text>
        <text fg={theme.textFaint}>keys</text>
      </box>
    </box>
  )
}
