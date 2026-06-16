import { createSignal } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"

/**
 * The prompt composer — confined to the center column. Auto-grows from 1 line up to ~1/3 of the
 * screen, then scrolls. Enter submits, Shift+Enter inserts a newline (textarea default).
 */
export function Composer() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const [value, setValue] = createSignal("")
  const mode = () => getMode(app.mode())
  const focused = () => app.view() === "shell" && !app.overlayOpen()
  const maxHeight = () => Math.max(4, Math.floor(dims().height / 3))

  function submit() {
    app.submit(value())
    setValue("")
  }

  return (
    <box
      flexDirection="row"
      border
      borderStyle="rounded"
      borderColor={focused() ? mode().accent : theme.border}
      backgroundColor={theme.bgComposer}
      paddingLeft={1}
      paddingRight={1}
      alignItems="flex-end"
    >
      <box flexGrow={1}>
        <textarea
          value={value()}
          onInput={setValue}
          onSubmit={submit}
          focused={focused()}
          placeholder="ask anything…   (⇧⏎ for newline)"
          placeholderColor={theme.textFaint}
          textColor={theme.text}
          backgroundColor={theme.bgComposer}
          minHeight={1}
          maxHeight={maxHeight()}
          wrapText
        />
      </box>
      <box flexDirection="row" gap={1} marginLeft={1} alignItems="center">
        <text fg={mode().accent}>{mode().glyph}</text>
        <text fg={theme.textFaint}>{mode().label}</text>
      </box>
    </box>
  )
}
