import { RGBA } from "@opentui/core"
import type { JSX } from "solid-js"

// A dim, semi-transparent backdrop so the shell stays visible behind overlays.
const SCRIM = RGBA.fromValues(0.02, 0.02, 0.03, 0.55)

export function Scrim(props: { onClose: () => void; children: JSX.Element }) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      backgroundColor={SCRIM}
      justifyContent="center"
      alignItems="center"
      onMouseDown={props.onClose}
    >
      <box onMouseDown={(e: any) => e?.stopPropagation?.()}>{props.children}</box>
    </box>
  )
}
