import { test, expect } from "bun:test"
import { animate } from "../src/motion/animate.ts"
import { motion } from "../src/motion/config.ts"
import { linear, easeOutQuad, easeOutCubic, easeOutBack, easeOutElastic } from "../src/motion/easing.ts"

test("easing curves anchor at 0 and 1", () => {
  for (const ease of [linear, easeOutQuad, easeOutCubic, easeOutBack, easeOutElastic]) {
    expect(ease(0)).toBeCloseTo(0, 5)
    expect(ease(1)).toBeCloseTo(1, 5)
  }
})

test("easeOutQuad is monotonic and ahead of linear early", () => {
  expect(easeOutQuad(0.25)).toBeGreaterThan(linear(0.25))
  expect(easeOutQuad(0.5)).toBeGreaterThan(easeOutQuad(0.25))
})

test("animate snaps to final value immediately under reduced motion", () => {
  // Tests run non-TTY → reduced motion is on, so animate is synchronous.
  expect(motion.reduced()).toBe(true)
  let v = -1
  let done = false
  const stop = animate(0, 42, (n) => (v = n), { onDone: () => (done = true) })
  expect(v).toBe(42)
  expect(done).toBe(true)
  stop()
})

test("animate with zero duration jumps to target", () => {
  let v = 0
  animate(5, 99, (n) => (v = n), { duration: 0 })
  expect(v).toBe(99)
})
