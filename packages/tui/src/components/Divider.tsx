import { createSignal } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"

/**
 * A 1-column draggable divider for resizing the side panels.
 * OpenTUI delivers button-held motion as `onMouseDrag` (not `onMouseMove`), so we resize here.
 */
export function Divider(props: { side: "left" | "right" }) {
  const app = useApp()
  const dims = useTerminalDimensions()
  const [active, setActive] = createSignal(false)
  const color = () => (active() ? getMode(app.mode()).accent : theme.borderMuted)

  function resize(e: { x: number }) {
    const w = dims().width
    if (props.side === "left") app.setLeftWidth(Math.max(14, Math.min(Math.floor(w / 2), e.x - 1)))
    else app.setRightWidth(Math.max(16, Math.min(Math.floor(w / 2), w - e.x - 2)))
  }

  return (
    <box
      width={1}
      height="100%"
      backgroundColor={theme.bg}
      onMouseDown={() => setActive(true)}
      onMouseDrag={(e: any) => {
        setActive(true)
        resize(e)
      }}
      onMouseDragEnd={() => setActive(false)}
      onMouseUp={() => setActive(false)}
    >
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={color()}>┊</text>
      </box>
    </box>
  )
}
