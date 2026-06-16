import { RGBA } from "@opentui/core"
import { createSignal, onMount, onCleanup, type JSX } from "solid-js"
import { Appear, animate, motion, easeOutQuad } from "../motion/index.ts"

// A dim, semi-transparent backdrop so the shell stays visible behind overlays.
const SCRIM = RGBA.fromValues(0.02, 0.02, 0.03, 0.55)

export function Scrim(props: { onClose: () => void; children: JSX.Element }) {
  // Fade the backdrop in on the absolute box itself (wrapping it would collapse
  // its 100% sizing). The inner content pops in via <Appear>.
  const [op, setOp] = createSignal(motion.reduced() ? 1 : 0)
  onMount(() => {
    const stop = animate(0, 1, setOp, { duration: 120, ease: easeOutQuad })
    onCleanup(stop)
  })

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
      style={{ opacity: op() }}
    >
      <box onMouseDown={(e: any) => e?.stopPropagation?.()}>
        <Appear distance={1} duration={190}>
          {props.children}
        </Appear>
      </box>
    </box>
  )
}
