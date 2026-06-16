import { Show } from "solid-js"
import { theme } from "@friday/shared"
import { useHover } from "../motion/index.ts"

/**
 * A clearly-labelled panel close control: the keybinding hint next to an ✕ that
 * turns red on hover. Click closes; the keybinding still works globally (App.tsx).
 */
export function CloseButton(props: { hint?: string; onClose: () => void }) {
  const h = useHover({ base: theme.bgPanel })
  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={h.bg()}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={props.onClose}
    >
      <Show when={props.hint}>
        <text fg={theme.textFaint}>{props.hint}</text>
      </Show>
      <text fg={h.hovered() ? theme.error : theme.textMuted}>✕</text>
    </box>
  )
}

/** The 3-col stub a collapsed panel shrinks to — a hover-highlit chevron to re-open it. */
export function ReopenStub(props: { glyph: string; onOpen: () => void }) {
  const h = useHover({ base: theme.bgPanel })
  return (
    <box
      width={3}
      height="100%"
      backgroundColor={h.bg()}
      alignItems="center"
      paddingTop={1}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={props.onOpen}
    >
      <text fg={h.hovered() ? theme.text : theme.textMuted}>{props.glyph}</text>
    </box>
  )
}
