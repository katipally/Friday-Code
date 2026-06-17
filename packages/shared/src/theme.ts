/**
 * Friday Code theme tokens.
 *
 * Dark-grey, never pure black. The single dynamic value is `accent`, which the UI swaps to the
 * current mode's color (see modes.ts) and applies to the frame border + active focus rings.
 */
export const theme = {
  // surfaces — neutral near-black (zero blue tint): each step is only *barely* lighter than the last,
  // so sections blend into one canvas and the rounded borders (not big fills) do the separating.
  bg: "#0c0c0d", // chat / base canvas (neutral near-black)
  bgComposer: "#0e0e10", // the input box — a hair above the canvas
  bgPanel: "#111113", // side panels — barely lighter than the canvas
  bgElevated: "#161618", // cards / modals — a quiet step up
  bgHover: "#1e1e21", // selection / hover — visible but never shouty

  // text
  text: "#edeef0",
  textMuted: "#9096a0", // slightly dimmer to sit calmly on the darker base
  textFaint: "#6b7280", // lifted for legibility on the near-black canvas

  // lines
  border: "#2c2c30", // panel / card edges — soft, just enough to read
  borderMuted: "#232327",
  /** hover / active edge — a step brighter than `border` (opencode borderActive idea) */
  borderActive: "#3a3a40",
  /** the single outermost frame around the whole app — faint, not a hard outline */
  frame: "#161618",

  // roles
  user: "#9aa5ce", // user message accent (calm)
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  info: "#7dcfff",
} as const

export type Theme = typeof theme
