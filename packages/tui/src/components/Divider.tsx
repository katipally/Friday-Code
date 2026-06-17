import { createSignal } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { shimmerAccent, useHover } from "../motion/index.ts"

/**
 * A vertical draggable grip bar that sits between the chat and the right panel.
 * It brightens on hover, shimmers while dragging, and is wide enough to grab easily.
 */
export function GripDivider(props: {
  active: boolean
  onGrab: (e: any) => void
  onDrag: (e: any) => void
  onEnd: () => void
}) {
  const app = useApp()
  const [hover, setHover] = createSignal(false)
  const accent = () => getMode(app.mode()).accent
  const ruleColor = () => (props.active ? shimmerAccent(accent(), 0.4) : hover() ? theme.borderActive : theme.border)

  return (
    <box
      width={2}
      height="100%"
      backgroundColor={theme.bg}
      alignItems="center"
      justifyContent="center"
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={(e: any) => props.onGrab(e)}
      onMouseDrag={(e: any) => props.onDrag(e)}
      onMouseDragEnd={props.onEnd}
      onMouseUp={props.onEnd}
    >
      <box width={1} height="100%" backgroundColor={ruleColor()} />
    </box>
  )
}

/**
 * A thin clickable/draggable strip that appears when the right panel is collapsed.
 * Click or drag it to reopen the panel. It sits flush with the right edge.
 */
export function CollapseTab(props: { side: "right"; onOpen: () => void }) {
  const h = useHover({ base: theme.bgPanel })
  return (
    <box
      width={2}
      height="100%"
      backgroundColor={h.bg()}
      alignItems="center"
      paddingTop={1}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={props.onOpen}
    >
      <text fg={h.hovered() ? theme.text : theme.textMuted}>{props.side === "right" ? "‹" : "›"}</text>
    </box>
  )
}
