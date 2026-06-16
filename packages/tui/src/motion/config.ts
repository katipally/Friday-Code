import { createSignal } from "solid-js"

/**
 * Global motion config. When `reduced` is true, every motion primitive snaps
 * straight to its final state (no tweening) — for slow terminals, CI, or user
 * preference. Auto-detected at import, overridable at runtime (onboarding/M14).
 */
function detectReduced(): boolean {
  if (process.env.FRIDAY_REDUCED_MOTION === "1" || process.env.FRIDAY_REDUCED_MOTION === "true") return true
  // `dumb` terminals and known non-interactive shells can't paint smooth motion.
  if (process.env.TERM === "dumb") return true
  // Non-interactive (tests, CI, pipes): snap straight to final state — motion is
  // meaningless without a live terminal and would hide content from a one-shot capture.
  if (!process.stdout.isTTY) return true
  return false
}

const [reduced, setReduced] = createSignal(detectReduced())

export const motion = {
  /** Reactive: read inside components to respond to live toggles. */
  reduced,
  setReduced,
  /** Default tween duration (ms). */
  duration: 200,
  /** Frame interval (~60fps). Terminals cap here anyway. */
  frameMs: 16,
}
