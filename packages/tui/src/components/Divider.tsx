import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"

/** A 1-column draggable divider used to resize the side panels. */
export function Divider(props: { side: "left" | "right" }) {
  const app = useApp()
  const active = () => app.dragging() === props.side
  const color = () => (active() ? getMode(app.mode()).accent : theme.borderMuted)

  return (
    <box
      width={1}
      height="100%"
      backgroundColor={theme.bg}
      onMouseDown={(e: any) => {
        e?.preventDefault?.()
        app.setDragging(props.side)
      }}
    >
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={color()}>┊</text>
      </box>
    </box>
  )
}
