/**
 * Friday Code theme tokens.
 *
 * Dark-grey, never pure black. The single dynamic value is `accent`, which the UI swaps to the
 * current mode's color (see modes.ts) and applies to the frame border + active focus rings.
 */
export const theme = {
  // surfaces — near-black & unified: each step is only *barely* lighter than the last, so
  // sections blend into one canvas and the rounded borders (not big fills) do the separating.
  bg: "#0a0b0e", // chat / base canvas (near-black)
  bgComposer: "#0d0e12", // the input box — a hair above the canvas
  bgPanel: "#0f1115", // side panels — barely lighter than the canvas
  bgElevated: "#14161b", // cards / modals — a quiet step up
  bgHover: "#1d2027", // selection / hover — visible but never shouty

  // text
  text: "#edeff3",
  textMuted: "#8a909b", // slightly dimmer to sit calmly on the darker base
  textFaint: "#5b626d",

  // lines
  border: "#2a2f38", // panel / card edges — soft, just enough to read
  borderMuted: "#1c2027",
  /** hover / active edge — a step brighter than `border` (opencode borderActive idea) */
  borderActive: "#3a414d",
  /** the single outermost frame around the whole app — faint, not a hard outline */
  frame: "#1a1d23",

  // roles
  user: "#9aa5ce", // user message accent (calm)
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  info: "#7dcfff",
} as const

export type Theme = typeof theme
