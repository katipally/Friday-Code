import { createSignal, createEffect, on, onCleanup, onMount, type Accessor } from "solid-js"
import { theme } from "@friday/shared"
import { animate, type AnimateOpts } from "./animate.ts"
import { easeOutQuad } from "./easing.ts"
import { motion } from "./config.ts"
import { lighten, mix } from "../util/colors.ts"

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

/**
 * Pointer-hover state with a smooth background fade. Returns a tweened `bg` color
 * (base → hover over ~120ms), the raw `hovered` flag, and the mouse handlers to wire
 * onto a box. Snaps when reduced-motion. The unified near-black palette means fading
 * from `theme.bg` reads fine even when the real surface is a hair lighter.
 */
export function useHover(opts: { hover?: string; base?: string; duration?: number } = {}): {
  bg: Accessor<string>
  hovered: Accessor<boolean>
  onMouseOver: () => void
  onMouseOut: () => void
} {
  const hover = opts.hover ?? theme.bgHover
  const base = opts.base ?? theme.bg
  const [p, setP] = createSignal(0)
  const [hovered, setHovered] = createSignal(false)
  let stop: (() => void) | undefined
  const go = (to: number) => {
    if (motion.reduced()) return setP(to)
    stop?.()
    stop = animate(p(), to, setP, { duration: opts.duration ?? 120, ease: easeOutQuad })
  }
  onCleanup(() => stop?.())
  return {
    bg: () => (p() <= 0.001 ? base : mix(base, hover, p())),
    hovered,
    onMouseOver: () => {
      setHovered(true)
      go(1)
    },
    onMouseOut: () => {
      setHovered(false)
      go(0)
    },
  }
}
