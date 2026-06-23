/**
 * Easing functions — all take t ∈ [0,1] and return an eased progress.
 * Mirrors the curve set OpenTUI's Timeline exposes, so component code reads the same.
 */
export type Ease = (t: number) => number

export const linear: Ease = (t) => t
export const easeOutQuad: Ease = (t) => 1 - (1 - t) * (1 - t)
export const easeOutCubic: Ease = (t) => 1 - (1 - t) ** 3

/** Overshoot-and-settle — gives modals/cards a lively "pop". */
export const easeOutBack: Ease = (t) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

/** Bouncy elastic settle — used sparingly (e.g. mascot reactions). */
export const easeOutElastic: Ease = (t) => {
  if (t === 0 || t === 1) return t
  const c4 = (2 * Math.PI) / 3
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}
