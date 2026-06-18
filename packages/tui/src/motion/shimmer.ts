import { createSignal } from "solid-js"
import { lighten } from "../util/colors.ts"
import { motion } from "./config.ts"

/**
 * One shared shimmer clock for the whole app. Every accent that pulses reads from this
 * single phase, so the logo, the assistant marker, the progress bar, the active divider —
 * everything tinted with the mode accent — glows *in sync* rather than drifting (each
 * `useBreathe` starts its own interval at mount and would otherwise be out of phase).
 *
 * The interval is started lazily on first read and runs for the app's lifetime (a singleton
 * heartbeat — no per-component setup/teardown). It never ticks under reduced-motion.
 */
const PERIOD_MS = 2400

const [phase, setPhase] = createSignal(0)
let started = false

function ensureRunning() {
  if (started || motion.reduced()) return
  started = true
  setInterval(() => setPhase((p) => (p + motion.frameMs / PERIOD_MS) % 1), motion.frameMs)
}

/** Shared 0..1 shimmer phase. Reactive — read it inside an effect/JSX to re-render on tick. */
export function shimmerPhase(): number {
  ensureRunning()
  return phase()
}

/** The current shimmering tint of `accent` (a gentle pulse toward white). Static if reduced-motion. */
export function shimmerAccent(accent: string, amt = 0.22): string {
  if (motion.reduced()) return accent
  const wave = (Math.sin(shimmerPhase() * Math.PI * 2) + 1) / 2 // 0..1
  return lighten(accent, wave * amt)
}
