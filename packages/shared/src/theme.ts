/**
 * Friday Code theme tokens.
 *
 * Clean, readable neutral dark theme with crisp borders and clear surface separation.
 * The single dynamic value is `accent`, which the UI swaps to the current mode's color
 * (see modes.ts) and applies to bordered elements + active focus rings.
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
}

export type Theme = typeof theme

/** The default palette, captured so applyTheme() can reset before layering a preset. */
const BASE: Theme = { ...theme }

/**
 * Named theme presets — partial overrides of the default. Applied at startup (the UI reads `theme`
 * directly, so a preset must be in place before first render; switching mid-session takes effect on
 * the next launch). Keep overrides to the high-impact surface/text/role tokens.
 */
export const THEMES: Record<string, Partial<Theme>> = {
  dark: {}, // the default
  light: {
    bg: "#ffffff",
    bgComposer: "#f3f4f6",
    bgPanel: "#f3f4f6",
    bgElevated: "#e9ebef",
    bgHover: "#dfe2e8",
    text: "#1b1f24",
    textMuted: "#4b525c",
    textFaint: "#6b7280",
    border: "#d0d4da",
    borderMuted: "#e2e5ea",
    borderActive: "#b3b9c2",
    success: "#2f8f3e",
    warning: "#b3791a",
    error: "#c0384b",
    info: "#1f6feb",
  },
  nord: {
    bg: "#2e3440",
    bgComposer: "#323846",
    bgPanel: "#323846",
    bgElevated: "#3b4252",
    bgHover: "#434c5e",
    text: "#eceff4",
    textMuted: "#d8dee9",
    textFaint: "#9aa3b2",
    border: "#434c5e",
    borderMuted: "#3b4252",
    borderActive: "#5e81ac",
    success: "#a3be8c",
    warning: "#ebcb8b",
    error: "#bf616a",
    info: "#88c0d0",
  },
}

/**
 * 256-color-safe surface/border greys for the default dark theme. The values are exact members of
 * xterm's 24-step grey ramp (232–255), so they survive 256-color quantization unchanged instead of
 * collapsing into each other the way the finely-stepped truecolor greys do on Terminal.app. Applied
 * only when the terminal lacks truecolor AND the default dark theme is active.
 */
const COARSE_DARK: Partial<Theme> = {
  bgComposer: "#121212", // 233
  bgPanel: "#121212",
  bgElevated: "#1c1c1c", // 234
  bgHover: "#303030", // 236
  borderMuted: "#262626", // 235
  border: "#444444", // 238
  borderActive: "#585858", // 240
}

/**
 * Layer the terminal color profile onto the live `theme`. Call AFTER applyTheme(). When the terminal
 * has no truecolor and we're on the default dark theme, swap in the 256-safe greys so panels/borders
 * read the same as they do in a truecolor terminal.
 */
export function applyTerminalProfile(opts: { truecolor: boolean; themeName?: string }): void {
  const isDefaultDark = !opts.themeName || opts.themeName === "dark"
  if (!opts.truecolor && isDefaultDark) Object.assign(theme, COARSE_DARK)
}

export function themeNames(): string[] {
  return Object.keys(THEMES)
}

/** Reset to the default palette, then layer the named preset's overrides onto the live `theme`. */
export function applyTheme(name?: string): void {
  Object.assign(theme, BASE)
  const preset = name ? THEMES[name] : undefined
  if (preset) Object.assign(theme, preset)
}
