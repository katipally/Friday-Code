/**
 * Terminal capability detection.
 *
 * Some terminals — notably macOS Terminal.app — don't advertise truecolor (no
 * `COLORTERM`) and use `wcwidth` width rules, so wide/emoji glyphs misalign and our
 * finely-stepped greys collapse under 256-color quantization. We detect those cases
 * once at startup and degrade glyphs (emoji → narrow ASCII) so layout stays aligned.
 */
const termProgram = process.env.TERM_PROGRAM ?? ""

/** Force-degrade to the narrow/ASCII glyph set regardless of detection (FRIDAY_ASCII=1). */
const forceAscii = /^(1|true)$/i.test(process.env.FRIDAY_ASCII ?? "")

/** macOS Terminal.app — no truecolor, wcwidth widths. The main "broken in CMD" culprit. */
export const isAppleTerminal = termProgram === "Apple_Terminal"

/** True when the terminal advertises 24-bit color. */
export const hasTruecolor =
  /truecolor|24bit/i.test(process.env.COLORTERM ?? "") || !!process.env.WT_SESSION || termProgram === "iTerm.app"

/**
 * Whether to avoid wide/emoji glyphs. Apple Terminal and any non-truecolor terminal
 * render emoji at inconsistent widths, breaking column alignment — fall back to ASCII.
 * `FRIDAY_ASCII=1` forces this on for any terminal.
 */
export const narrowGlyphs = forceAscii || isAppleTerminal || !hasTruecolor

/**
 * Pick a glyph based on terminal capability: `wide` for capable terminals,
 * `fallback` (a single-width ASCII/Unicode glyph) for Apple Terminal / 256-color.
 */
export function glyph(wide: string, fallback: string): string {
  return narrowGlyphs ? fallback : wide
}

/**
 * Centralized, capability-aware UI glyph table. Every terminal-risky codepoint used in the UI
 * resolves here once at startup, so a single place controls what renders in a `wcwidth` terminal.
 * Each `fallback` is guaranteed single-width and present in standard terminal fonts.
 */
export const G = {
  // mode glyphs (modes.ts owns the "wide" set; these are the safe widths)
  modePlan: glyph("◐", "*"),
  modeDefault: glyph("◈", "~"),
  modeAcceptEdit: glyph("✎", "+"),
  modeYolo: glyph("⚡", "!"),
  // timeline / markers
  marker: glyph("⏺", "*"),
  branch: glyph("╰", "\\"),
  // todo checkboxes + section caret
  todoDone: glyph("☑", "[x]"),
  todoOpen: glyph("☐", "[ ]"),
  caret: glyph("▸", ">"),
  // status dots (mcp, etc.)
  dotOn: glyph("●", "o"),
  dotOff: glyph("○", "."),
  // misc affordances
  bolt: glyph("⚡", "!"),
  warn: glyph("⚠", "!"),
} as const

/** Map a mode id to its capability-safe glyph. */
export function modeGlyph(id: "plan" | "default" | "accept-edit" | "yolo"): string {
  return id === "plan" ? G.modePlan : id === "default" ? G.modeDefault : id === "accept-edit" ? G.modeAcceptEdit : G.modeYolo
}
