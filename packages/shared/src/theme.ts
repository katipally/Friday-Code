/**
 * Friday Code theme tokens.
 *
 * Clean, readable neutral dark theme with crisp borders and clear surface separation.
 * The single dynamic value is `accent`, which the UI swaps to the current mode's color
 * (see modes.ts) and applies to the frame border + active focus rings.
 */
export const theme = {
  // surfaces — true-black canvas (like opencode) with neutral grey layers stepped far
  // enough apart to survive 256-color quantization (Terminal.app has no truecolor).
  bg: "#000000", // chat / base canvas — true black
  bgComposer: "#0d0d0f", // the input box — first step above black
  bgPanel: "#0d0d0f", // side panels — distinct from canvas
  bgElevated: "#161618", // cards / modals — a clear step up
  bgHover: "#1f1f23", // selection / hover — readable without shouting

  // text — high contrast, but never harsh
  text: "#f2f3f5",
  textMuted: "#9aa0a8", // secondary info
  textFaint: "#7a818c", // tertiary info, still legible

  // lines — borders are visible enough to define panels but not noisy
  border: "#2a2a2e", // panel / card edges
  borderMuted: "#1f1f23",
  /** hover / active edge — brighter than `border` for clear affordance */
  borderActive: "#3a3a42",
  /** the single outermost frame around the whole app — subtle, clean */
  frame: "#161618",

  // roles
  user: "#9aa5ce", // user message accent (calm)
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  info: "#7dcfff",

  // syntax highlighting (tree-sitter scopes) — drives native <code>/<markdown>/<diff>.
  // Calm, balanced palette that reads clearly on the near-black canvas.
  syntaxComment: "#6b7280",
  syntaxKeyword: "#bb9af7", // soft violet
  syntaxFunction: "#7aa2f7", // blue
  syntaxVariable: "#f2f3f5", // base text
  syntaxString: "#9ece6a", // green
  syntaxNumber: "#e0af68", // amber
  syntaxType: "#2ac3de", // cyan
  syntaxOperator: "#89ddff", // light cyan
  syntaxPunctuation: "#a5adba",

  // markdown markup
  markdownHeading: "#7dcfff",
  markdownStrong: "#f2f3f5",
  markdownEmph: "#c0caf5",
  markdownLink: "#7dcfff",
  markdownLinkText: "#9ece6a",
  markdownCode: "#e0af68",
  markdownQuote: "#9aa0a8",
  markdownListMarker: "#7aa2f7",

  // diff
  diffAdded: "#9ece6a",
  diffRemoved: "#f7768e",
  diffAddedBg: "#16241a",
  diffRemovedBg: "#2a1620",
  diffContextBg: "#000000",
} as const

export type Theme = typeof theme
