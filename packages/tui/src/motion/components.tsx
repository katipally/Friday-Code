import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js"
import { animate } from "./animate.ts"
import { motion } from "./config.ts"
import { type Ease, easeOutBack, easeOutQuad } from "./easing.ts"

/** Fade children in on mount (opacity 0→1). Snaps when reduced-motion. */
export function Fade(props: { children: JSX.Element; duration?: number; delay?: number; ease?: Ease }) {
  const [op, setOp] = createSignal(motion.reduced() ? 1 : 0)
  onMount(() => {
    const stop = animate(0, 1, setOp, {
      duration: props.duration ?? 160,
      delay: props.delay,
      ease: props.ease ?? easeOutQuad,
    })
    onCleanup(stop)
  })
  return <box style={{ opacity: op() }}>{props.children}</box>
}

/**
 * Slide + fade in on mount. Starts pushed down by `distance` rows and rises into
 * place with an overshoot (easeOutBack) — the lively "pop" for modals/cards.
 * Uses positive marginTop (no negative margins) so layout stays predictable.
 */
export function Appear(props: {
  children: JSX.Element
  distance?: number
  duration?: number
  delay?: number
  ease?: Ease
}) {
  const dist = props.distance ?? 1
  const [off, setOff] = createSignal(motion.reduced() ? 0 : dist)
  const [op, setOp] = createSignal(motion.reduced() ? 1 : 0)
  onMount(() => {
    const dur = props.duration ?? 200
    const s1 = animate(dist, 0, (v) => setOff(Math.round(v)), {
      duration: dur,
      delay: props.delay,
      ease: props.ease ?? easeOutBack,
    })
    const s2 = animate(0, 1, setOp, { duration: dur * 0.8, delay: props.delay, ease: easeOutQuad })
    onCleanup(() => {
      s1()
      s2()
    })
  })
  return <box style={{ marginTop: off(), opacity: op() }}>{props.children}</box>
}

/**
 * Conditionally render `children` with a fade-in when shown. Collapse is instant
 * (flexbox reclaims the space) — used for accordion sections.
 */
export function Reveal(props: { when: boolean; children: JSX.Element; duration?: number }) {
  return (
    <Show when={props.when}>
      <Fade duration={props.duration ?? 140}>{props.children}</Fade>
    </Show>
  )
}
