import { useTerminalDimensions } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"

/**
 * The prompt composer — confined to the center column. Auto-grows from 1 line up to ~1/3 of the
 * screen, then scrolls. Enter submits, Shift+Enter inserts a newline (custom textarea keybindings).
 *
 * The textarea is uncontrolled: we read `plainText` on submit and `clear()` it afterwards (the
 * controlled value/onInput path does not fire reliably for every keystroke).
 */
export function Composer() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const mode = () => getMode(app.mode())
  const focused = () =>
    app.view() === "shell" &&
    !app.overlayOpen() &&
    !app.modelModalOpen() &&
    !app.pending() &&
    !app.askPending()
  const maxHeight = () => Math.max(4, Math.floor(dims().height / 3))

  let ta: any
  function submit() {
    const text: string = ta?.plainText ?? ""
    if (text.trim()) app.submit(text)
    ta?.clear?.()
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
          ref={(r: any) => (ta = r)}
          onSubmit={submit}
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "return", shift: true, action: "newline" },
          ]}
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
