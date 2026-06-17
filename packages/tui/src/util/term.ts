/**
 * Terminal capability detection.
 *
 * Some terminals — notably macOS Terminal.app — don't advertise truecolor (no
 * `COLORTERM`) and use `wcwidth` width rules, so wide/emoji glyphs misalign and our
 * finely-stepped greys collapse under 256-color quantization. We detect those cases
 * once at startup and degrade glyphs (emoji → narrow ASCII) so layout stays aligned.
 */
const termProgram = process.env.TERM_PROGRAM ?? ""

/** macOS Terminal.app — no truecolor, wcwidth widths. The main "broken in CMD" culprit. */
export const isAppleTerminal = termProgram === "Apple_Terminal"

/** True when the terminal advertises 24-bit color. */
export const hasTruecolor =
  /truecolor|24bit/i.test(process.env.COLORTERM ?? "") || !!process.env.WT_SESSION || termProgram === "iTerm.app"

/**
 * Whether to avoid wide/emoji glyphs. Apple Terminal and any non-truecolor terminal
 * render emoji at inconsistent widths, breaking column alignment — fall back to ASCII.
 */
export const narrowGlyphs = isAppleTerminal || !hasTruecolor

/**
 * Pick a glyph based on terminal capability: `wide` for capable terminals,
 * `fallback` (a single-width ASCII/Unicode glyph) for Apple Terminal / 256-color.
 */
export function glyph(wide: string, fallback: string): string {
  return narrowGlyphs ? fallback : wide
}
