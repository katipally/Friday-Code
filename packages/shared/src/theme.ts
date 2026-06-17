/**
 * Friday Code theme tokens.
 *
 * Clean, readable neutral dark theme with crisp borders and clear surface separation.
 * The single dynamic value is `accent`, which the UI swaps to the current mode's color
 * (see modes.ts) and applies to the frame border + active focus rings.
 */
export const theme = {
  // surfaces — clearly separated greys (no blue tint). Each step is visibly distinct so
  // panels, composer and modals read as separate layers.
  bg: "#101012", // chat / base canvas (clean dark grey)
  bgComposer: "#151517", // the input box — clearly above the canvas
  bgPanel: "#18181b", // side panels — distinct from canvas
  bgElevated: "#222226", // cards / modals — a clear step up
  bgHover: "#2a2a2e", // selection / hover — readable without shouting

  // text — high contrast, but never harsh
  text: "#f2f3f5",
  textMuted: "#9aa0a8", // secondary info
  textFaint: "#7a818c", // tertiary info, still legible

  // lines — borders are visible enough to define panels but not noisy
  border: "#35353a", // panel / card edges
  borderMuted: "#2a2a2e",
  /** hover / active edge — brighter than `border` for clear affordance */
  borderActive: "#4a4a52",
  /** the single outermost frame around the whole app — subtle, clean */
  frame: "#1c1c1f",

  // roles
  user: "#9aa5ce", // user message accent (calm)
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  info: "#7dcfff",
} as const

export type Theme = typeof theme
