/**
 * Active terminal capability detection (inspired by opencode).
 *
 * Env vars alone misclassify terminals: a plain Terminal.app advertises no truecolor and uses
 * `wcwidth`, so our finely-stepped greys collapse and wide glyphs misalign — yet the *same* binary
 * looks right in VSCode's terminal (which sets COLORTERM=truecolor). To render consistently we ask
 * the terminal itself, via OSC escape sequences, what background it has — with a short timeout and a
 * full raw-mode restore so a non-responding terminal never wedges input.
 *
 * This runs ONCE before the first render; on any failure it resolves to a safe default and the UI
 * proceeds exactly as before.
 */

export interface TerminalProfile {
  /** detected terminal background, or null when it couldn't be queried */
  background: "dark" | "light" | null
}

/** Parse an OSC 10/11 color reply (`rgb:RRRR/GGGG/BBBB`, `#RRGGBB`, or `rgb(r,g,b)`) → 0..255 RGB. */
function parseColor(s: string): { r: number; g: number; b: number } | null {
  if (s.startsWith("rgb:")) {
    const [r, g, b] = s.slice(4).split("/")
    if (r == null || g == null || b == null) return null
    // components may be 1–4 hex digits; normalise to 8-bit using the high byte.
    const to8 = (h: string) => parseInt(h.padEnd(4, h[h.length - 1] ?? "0").slice(0, 4), 16) >> 8
    return { r: to8(r), g: to8(g), b: to8(b) }
  }
  if (s.startsWith("#") && s.length >= 7) {
    return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16) }
  }
  if (s.startsWith("rgb(")) {
    const [r, g, b] = s.slice(4, -1).split(",").map(Number)
    if (r == null || g == null || b == null) return null
    return { r, g, b }
  }
  return null
}

/** Query the terminal background via OSC 11 and classify it dark/light by relative luminance. */
export function probeTerminal(timeoutMs = 200): Promise<TerminalProfile> {
  const stdin = process.stdin
  const stdout = process.stdout
  if (!stdin.isTTY || !stdout.isTTY) return Promise.resolve({ background: null })

  return new Promise((resolve) => {
    let done = false
    const wasRaw = stdin.isRaw
    const finish = (background: "dark" | "light" | null) => {
      if (done) return
      done = true
      try {
        stdin.removeListener("data", onData)
        if (!wasRaw) stdin.setRawMode(false)
      } catch {}
      clearTimeout(timer)
      resolve({ background })
    }
    const onData = (buf: Buffer) => {
      const m = buf.toString().match(/\x1b\]11;([^\x07\x1b]+)/)
      if (!m?.[1]) return
      const c = parseColor(m[1].trim())
      if (!c) return finish(null)
      const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255
      finish(lum > 0.5 ? "light" : "dark")
    }
    try {
      stdin.setRawMode(true)
      stdin.on("data", onData)
      stdout.write("\x1b]11;?\x07")
    } catch {
      return finish(null)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
  })
}
