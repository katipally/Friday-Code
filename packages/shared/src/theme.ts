/**
 * Friday Code theme tokens.
 *
 * Dark-grey, never pure black. The single dynamic value is `accent`, which the UI swaps to the
 * current mode's color (see modes.ts) and applies to the frame border + active focus rings.
 */
export const theme = {
  // surfaces (darkest -> lightest)
  bg: "#1a1b1e",
  bgComposer: "#16161a",
  bgPanel: "#1e2024",
  bgElevated: "#24262b",
  bgHover: "#2a2d33",

  // text
  text: "#e6e6e6",
  textMuted: "#8a8f98",
  textFaint: "#565b64",

  // lines
  border: "#2c2f36",
  borderMuted: "#23262c",

  // roles
  user: "#9aa5ce", // user message accent (calm)
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  info: "#7dcfff",
} as const

export type Theme = typeof theme
