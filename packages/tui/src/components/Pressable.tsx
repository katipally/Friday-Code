import { theme } from "@friday/shared"
import { createSignal } from "solid-js"
import { useHover } from "../motion/index.ts"

/**
 * A small clickable label with clear pointer feedback: it brightens + tints its background on
 * hover, and flashes the Friday brand for ~150ms on click so you always know the press registered.
 * (A generic chrome control — brand, not the per-mode accent.)
 */
export function Pressable(props: {
  label: string
  onClick: () => void
  /** resting text color (defaults to faint) */
  fg?: string
  /** alignment of the label inside the hit box */
  grow?: boolean
}) {
  const h = useHover({ base: theme.bg, hover: theme.bgHover })
  const [pressed, setPressed] = createSignal(false)
  let t: ReturnType<typeof setTimeout> | undefined

  const color = () => (pressed() ? theme.brand : h.hovered() ? theme.text : (props.fg ?? theme.textFaint))

  function down() {
    setPressed(true)
    clearTimeout(t)
    t = setTimeout(() => setPressed(false), 150)
    props.onClick()
  }

  return (
    <box
      flexGrow={props.grow ? 1 : 0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={pressed() ? theme.bgHover : h.bg()}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={down}
    >
      <text fg={color()}>{props.label}</text>
    </box>
  )
}
