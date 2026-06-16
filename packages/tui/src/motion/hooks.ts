import { createSignal, createEffect, on, onCleanup, onMount, type Accessor } from "solid-js"
import { animate, type AnimateOpts } from "./animate.ts"
import { motion } from "./config.ts"
import { lighten } from "../util/colors.ts"

/**
 * Animate a signal toward a reactive target whenever the target changes.
 * Great for panel widths, gauges, counters. Snaps when reduced-motion.
 */
export function useTween(target: Accessor<number>, opts: AnimateOpts = {}): Accessor<number> {
  const [val, setVal] = createSignal(target())
  let cur = target()
  let stop: (() => void) | undefined
  const set = (v: number) => {
    cur = v
    setVal(v)
  }
  createEffect(
    on(
      target,
      (to) => {
        stop?.()
        stop = animate(cur, to, set, opts)
      },
      { defer: true },
    ),
  )
  onCleanup(() => stop?.())
  return val
}

/**
 * Reveal-on-mount counter: returns how many of `count` items are visible,
 * incrementing on a stagger interval so lists cascade in. Snaps when reduced.
 */
export function useStagger(count: Accessor<number>, stepMs = 22): Accessor<number> {
  const [visible, setVisible] = createSignal(motion.reduced() ? count() : 0)
  createEffect(
    on(count, (n) => {
      if (motion.reduced()) {
        setVisible(n)
        return
      }
      if (visible() >= n) {
        setVisible(n)
        return
      }
      const timer = setInterval(() => {
        setVisible((v) => {
          if (v >= n) {
            clearInterval(timer)
            return n
          }
          return v + 1
        })
      }, stepMs)
      onCleanup(() => clearInterval(timer))
    }),
  )
  return visible
}

/**
 * A "breathing" accent color — oscillates toward a lighter tint via a sine wave.
 * Used to signal focus / live activity without a hard blink. Pass active=false to rest.
 */
export function useBreathe(accent: Accessor<string>, active: Accessor<boolean>, periodMs = 1600): Accessor<string> {
  const [phase, setPhase] = createSignal(0)
  onMount(() => {
    if (motion.reduced()) return
    const timer = setInterval(() => setPhase((p) => (p + motion.frameMs / periodMs) % 1), motion.frameMs)
    onCleanup(() => clearInterval(timer))
  })
  return () => {
    if (!active() || motion.reduced()) return accent()
    const wave = (Math.sin(phase() * Math.PI * 2) + 1) / 2 // 0..1
    return lighten(accent(), wave * 0.35)
  }
}
