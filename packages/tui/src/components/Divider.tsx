import { createSignal } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"

/**
 * A draggable divider for resizing the side panels. The visible rule is 1 column but the
 * grab area is 3 columns wide so it's easy to hit. Resizing is delta-based off the grab
 * point (not absolute cursor x), so grabbing anywhere on the handle never snaps the panel
 * and a re-layout mid-drag can't make it jump.
 */
export function Divider(props: { side: "left" | "right" }) {
  const app = useApp()
  const dims = useTerminalDimensions()
  const [active, setActive] = createSignal(false)
  const [hover, setHover] = createSignal(false)
  const accent = () => getMode(app.mode()).accent
  const color = () => (active() ? accent() : hover() ? theme.border : theme.borderMuted)
  const glyph = () => (active() || hover() ? "┇" : "┊")

  // The grab origin, captured on the first drag event of a gesture.
  let startX = 0
  let startW = 0
  let dragging = false

  function onDrag(e: any) {
    if (typeof e?.x !== "number") return
    const max = Math.floor(dims().width / 2)
    if (!dragging) {
      dragging = true
      startX = e.x
      startW = props.side === "left" ? app.leftWidth() : app.rightWidth()
      setActive(true)
    }
    const delta = e.x - startX
    if (props.side === "left") app.setLeftWidth(Math.max(14, Math.min(max, startW + delta)))
    else app.setRightWidth(Math.max(16, Math.min(max, startW - delta)))
  }
  function end() {
    dragging = false
    setActive(false)
  }

  return (
    <box
      width={3}
      height="100%"
      backgroundColor={theme.bg}
      alignItems="center"
      justifyContent="center"
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={() => setActive(true)}
      onMouseDrag={onDrag}
      onMouseDragEnd={end}
      onMouseUp={end}
    >
      <text fg={color()}>{glyph()}</text>
    </box>
  )
}
