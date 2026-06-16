/**
 * Centralized UI glyphs. Keep terminal-unsafe codepoints out of components so a single
 * swap here fixes rendering across every terminal/font.
 *
 * NOTE: `⎿` (U+23BF) used to be the timeline branch character, but it has no glyph in many
 * terminal fonts and falls back to byte-level mojibake (shows as "â¿"). `╰` (U+2570) is a
 * standard rounded box-drawing corner that renders everywhere, and matches our rounded borders.
 */
export const GLYPH = {
  /** the timeline branch under a tool call / thinking block */
  branch: "╰",
  /** assistant / tool marker on the timeline */
  marker: "⏺",
} as const
