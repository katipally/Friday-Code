import { easeOutCubic, type Ease } from "./easing.ts"
import { motion } from "./config.ts"

export interface AnimateOpts {
  duration?: number
  ease?: Ease
  delay?: number
  onDone?: () => void
}

/**
 * Tween a single numeric value from→to, calling `set` each frame.
 * Returns a stop() handle. Honors reduced-motion (jumps to `to` immediately).
 * Frame-loop based (setInterval) for deterministic, testable behavior.
 */
export function animate(from: number, to: number, set: (v: number) => void, opts: AnimateOpts = {}): () => void {
  const duration = opts.duration ?? motion.duration
  const ease = opts.ease ?? easeOutCubic
  if (motion.reduced() || duration <= 0) {
    set(to)
    opts.onDone?.()
    return () => {}
  }

  let timer: ReturnType<typeof setInterval> | undefined
  let startedAt = 0
  const tick = () => {
    const t = Math.min(1, (Date.now() - startedAt) / duration)
    set(from + (to - from) * ease(t))
    if (t >= 1) {
      set(to)
      stop()
      opts.onDone?.()
    }
  }
  const stop = () => {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const begin = () => {
    startedAt = Date.now()
    set(from)
    timer = setInterval(tick, motion.frameMs)
  }
  if (opts.delay && opts.delay > 0) {
    const d = setTimeout(begin, opts.delay)
    return () => {
      clearTimeout(d)
      stop()
    }
  }
  begin()
  return stop
}
