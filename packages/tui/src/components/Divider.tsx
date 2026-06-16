import { createSignal } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { shimmerAccent } from "../motion/index.ts"

/**
 * A draggable divider for resizing the side panels. Presentational: the actual drag math lives
 * on the parent row (App.tsx) so events keep landing even when the handle reflows out from under
 * the cursor (which is what made the *right* panel glitch). Here we just paint a clearly-visible
 * full-height rule that brightens on hover and shimmers while dragging, and report grab/drag/end.
 *
 * The visible rule is a 1-col bar centered in a 3-col grab area so it's easy to hit.
 */
export function Divider(props: {
  side: "left" | "right"
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
      width={3}
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
