/**
 * Friday Code theme tokens.
 *
 * Dark-grey, never pure black. The single dynamic value is `accent`, which the UI swaps to the
 * current mode's color (see modes.ts) and applies to the frame border + active focus rings.
 */
export const theme = {
  // surfaces — monotonic, clearly-separated layers (darkest base -> lightest pop)
  bg: "#141519", // chat / base canvas
  bgComposer: "#1b1d23", // the input box, a step above the canvas
  bgPanel: "#1f2229", // side panels, clearly lighter than the canvas
  bgElevated: "#272b34", // cards / modals pop above everything
  bgHover: "#333947", // selection / hover — clearly visible

  // text
  text: "#edeff3",
  textMuted: "#9aa0ab",
  textFaint: "#6b7280",

  // lines
  border: "#3a404b", // panel / card edges read clearly
  borderMuted: "#2a2f38",
  /** the single outermost frame around the whole app — a subtle visible outline */
  frame: "#2f343d",

  // roles
  user: "#9aa5ce", // user message accent (calm)
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  info: "#7dcfff",
} as const

export type Theme = typeof theme
