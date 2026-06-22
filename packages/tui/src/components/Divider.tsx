import { theme } from "@friday/shared"
import { createSignal } from "solid-js"
import { shimmerAccent, useHover } from "../motion/index.ts"

/**
 * A vertical draggable grip bar that sits between the chat and the right panel.
 * It brightens on hover, shimmers while dragging, and is wide enough to grab easily.
 * Chrome — tinted with the Friday brand, not the per-mode accent.
 */
export function GripDivider(props: {
  active: boolean
  onGrab: (e: any) => void
  onDrag: (e: any) => void
  onEnd: () => void
}) {
  const [hover, setHover] = createSignal(false)
  const ruleColor = () =>
    props.active ? shimmerAccent(theme.brand, 0.4) : hover() ? theme.borderActive : theme.border

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
 * A thin clickable/draggable strip that appears when the side panel is collapsed.
 * Click or drag it to reopen the panel. It sits flush with its edge; the chevron points inward.
 */
export function CollapseTab(props: { side: "left" | "right"; onOpen: () => void }) {
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
