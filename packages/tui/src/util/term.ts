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

const term = process.env.TERM ?? ""

/**
 * True when the terminal advertises 24-bit color. COLORTERM=truecolor is the standard signal
 * (set by VSCode, kitty, WezTerm, Ghostty, Alacritty, etc.); the rest cover terminals that support
 * truecolor without setting it. Apple Terminal sets none of these, so it correctly falls through.
 */
export const hasTruecolor =
  // FRIDAY_NO_TRUECOLOR=1 forces the 256-color path so it can be previewed from any terminal.
  !/^(1|true)$/i.test(process.env.FRIDAY_NO_TRUECOLOR ?? "") &&
  (/truecolor|24bit/i.test(process.env.COLORTERM ?? "") ||
    /direct|kitty|ghostty|alacritty/i.test(term) ||
    !!process.env.WT_SESSION ||
    !!process.env.KITTY_WINDOW_ID ||
    ["iTerm.app", "WezTerm", "ghostty", "vscode", "Hyper"].includes(termProgram))

/**
 * Whether to avoid wide/emoji glyphs. We render the FULL glyph set in every terminal (like opencode)
 * so the UI looks identical everywhere — automatic degradation is OFF. `FRIDAY_ASCII=1` is the only
 * way to opt into the narrow/ASCII set, for the rare font that truly can't render the box/geometric
 * glyphs we use.
 */
export const narrowGlyphs = forceAscii

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
  modeYolo: glyph("⚡", "!"),
  // pencil affordance (e.g. "type your own answer") — not a mode glyph
  pencil: glyph("✎", "+"),
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
export function modeGlyph(id: "plan" | "default" | "yolo"): string {
  return id === "plan" ? G.modePlan : id === "default" ? G.modeDefault : G.modeYolo
}
