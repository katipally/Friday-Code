/**
 * Friday Code theme tokens.
 *
 * Clean, readable neutral dark theme. Chrome is greyscale; color carries meaning only.
 *
 * Two distinct accents:
 *  - `brand` (amber) — Friday's identity. Used (sparingly) for chrome: panel/overlay titles,
 *    the wordmark, chrome selection bands, active chrome affordances. Never the per-mode color.
 *  - the per-mode `accent` (see modes.ts) — scoped to the CHAT view + COMPOSER only. It must not
 *    leak into chrome; the rest of the UI uses `brand`.
 */
export const theme = {
  // brand — Friday amber. Reserved for IDENTITY only (titles, wordmark, brand marks). Never used
  // for selection/hover, so the brand color and the "this row is selected" cue can't be confused.
  brand: "#ffaf00", // exact xterm-256 cube member (214)
  brandDim: "#a6731f", // resting brand where full amber would shout
  // selection — a neutral grey fill band, clearly brighter than bgHover, distinct from brand.
  bgSelected: "#3a3c45",
  textOnAccent: "#ffffff", // bright text drawn ON a selection / colored fill band (high contrast)

  // surfaces — true-black canvas (like opencode) with neutral grey layers stepped far enough apart
  // to read clearly against black AND survive 256-color quantization (Terminal.app has no truecolor).
  bg: "#000000", // chat / base canvas — true black
  bgComposer: "#141518", // the input box — a clear, visible step above black
  bgPanel: "#141518", // side panels — distinct from canvas
  bgElevated: "#1f2025", // cards / modals — a clear step up again
  bgHover: "#2b2c33", // selection / hover — readable without shouting

  // text — high contrast, but never harsh
  text: "#f2f3f5",
  textMuted: "#9aa0a8", // secondary info
  textFaint: "#7a818c", // tertiary info, still legible

  // lines — borders are bright enough to clearly define panels/cards against the dark surfaces
  border: "#3a3c44", // panel / card edges — visible
  borderMuted: "#26272d",
  /** hover / active edge — brighter than `border` for clear affordance */
  borderActive: "#50525d",

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
  dark: {}, // the default — Friday's signature near-black palette
  // Brighter text + edges on the same black canvas; for low-vision / harsh-light terminals. Pushed
  // clearly past `dark`: pure-white text, near-white muted/faint, bright surfaces and edges, and a
  // selection band light enough to be unmistakable — so the two themes never look interchangeable.
  "high-contrast": {
    bgComposer: "#1f2228",
    bgPanel: "#1f2228",
    bgElevated: "#2b2f37",
    bgHover: "#3c414b",
    text: "#ffffff",
    textMuted: "#e4e6eb",
    textFaint: "#c4c8d0",
    border: "#9aa0ab",
    borderMuted: "#5a5e68",
    borderActive: "#ffffff",
    bgSelected: "#6a6e7a",
  },
  // Warm-paper light palette (Claude-Code-style) — a soft cream canvas, not harsh pure white, with
  // Friday's amber brand kept (darkened to read on light). Every token is overridden so dark-theme
  // values can't bleed through. The selection band is a saturated warm amber so the shared white
  // `textOnAccent` reads on it AND on the semantic (success/warning/error) bands — same single-
  // on-accent-text model the dark theme uses.
  light: {
    bg: "#faf9f5", // warm paper, not pure white
    bgComposer: "#f0eee6",
    bgPanel: "#f0eee6",
    bgElevated: "#e9e6dc",
    bgHover: "#e2ded2",
    bgSelected: "#b5751a", // saturated warm amber band — white text reads on it
    text: "#2a2824",
    textMuted: "#5c574e",
    textFaint: "#8a857a",
    textOnAccent: "#ffffff",
    brand: "#b3691a", // warm amber, darkened for the light canvas
    brandDim: "#8a5414",
    border: "#d8d3c6", // soft warm edges
    borderMuted: "#e6e1d6",
    borderActive: "#b3ad9d",
    user: "#3a5a8c",
    success: "#2f8a3e",
    warning: "#9a6a00",
    error: "#c0392b",
    info: "#1f6fb0",
    // GitHub-light-style syntax, tuned to sit on the warm canvas.
    syntaxComment: "#8a857a",
    syntaxKeyword: "#cf222e",
    syntaxFunction: "#6639ba",
    syntaxVariable: "#2a2824",
    syntaxString: "#1a7f37",
    syntaxNumber: "#0550ae",
    syntaxType: "#0550ae",
    syntaxOperator: "#cf222e",
    syntaxPunctuation: "#3a3630",
    markdownHeading: "#0550ae",
    markdownStrong: "#2a2824",
    markdownEmph: "#6639ba",
    markdownLink: "#0969da",
    markdownLinkText: "#1a7f37",
    markdownCode: "#b3691a",
    markdownQuote: "#8a857a",
    markdownListMarker: "#0550ae",
    diffAdded: "#1a7f37",
    diffRemoved: "#cf222e",
    diffAddedBg: "#e6f4ea",
    diffRemovedBg: "#fbe9e7",
    diffContextBg: "#faf9f5",
  },
}

/**
 * 256-color-safe surface/border greys for the default dark theme. The values are exact members of
 * xterm's 24-step grey ramp (232–255), so they survive 256-color quantization unchanged instead of
 * collapsing into each other the way the finely-stepped truecolor greys do on Terminal.app. Applied
 * only when the terminal lacks truecolor AND the default dark theme is active.
 */
const COARSE_DARK: Partial<Theme> = {
  bgComposer: "#1c1c1c", // 234 — clearly above black
  bgPanel: "#1c1c1c",
  bgElevated: "#262626", // 235 — cards / modals step up
  bgHover: "#3a3a3a", // 237
  borderMuted: "#303030", // 236
  border: "#585858", // 240 — visible panel edges
  borderActive: "#6c6c6c", // 242
  bgSelected: "#4e4e4e", // 239 — selection band stays clearly above bgHover (237) on 256-color
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
