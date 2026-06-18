/** Tiny hex-color helpers (no deps) for shimmer + tints. */

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function parse(hex: string): [number, number, number] {
  let h = hex.replace("#", "")
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, "0")).join("")}`
}

/** Mix `hex` toward white by `amt` (0..1). */
export function lighten(hex: string, amt: number): string {
  const [r, g, b] = parse(hex)
  return toHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt)
}

/** Mix `hex` toward black by `amt` (0..1). */
export function darken(hex: string, amt: number): string {
  const [r, g, b] = parse(hex)
  return toHex(r * (1 - amt), g * (1 - amt), b * (1 - amt))
}

/** Linear blend a -> b by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parse(a)
  const [r2, g2, b2] = parse(b)
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}
