import { SyntaxStyle } from "@opentui/core"
import { theme } from "@friday/shared"

/**
 * Maps tree-sitter capture scopes + markdown markup scopes to Friday's theme tokens.
 * These are the *real* scope names OpenTUI's CodeRenderable/MarkdownRenderable look up
 * (registering arbitrary names like "text"/"accent" yields no highlighting at all).
 * Ported from opencode's getSyntaxRules, which drives the identical @opentui renderers.
 */
type Rule = { scope: string[]; style: { foreground?: string; background?: string; bold?: boolean; italic?: boolean; underline?: boolean; dim?: boolean } }

function getSyntaxRules(): Rule[] {
  return [
    { scope: ["default"], style: { foreground: theme.text } },

    // comments
    { scope: ["comment", "comment.documentation"], style: { foreground: theme.syntaxComment, italic: true } },
    { scope: ["comment.error"], style: { foreground: theme.error, italic: true, bold: true } },
    { scope: ["comment.warning"], style: { foreground: theme.warning, italic: true, bold: true } },
    { scope: ["comment.todo", "comment.note"], style: { foreground: theme.info, italic: true, bold: true } },

    // literals
    { scope: ["string", "symbol", "character", "character.special"], style: { foreground: theme.syntaxString } },
    { scope: ["string.escape", "string.regexp"], style: { foreground: theme.syntaxKeyword } },
    { scope: ["number", "boolean", "float", "constant"], style: { foreground: theme.syntaxNumber } },

    // keywords
    { scope: ["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"], style: { foreground: theme.syntaxKeyword, italic: true } },
    { scope: ["keyword.type"], style: { foreground: theme.syntaxType, bold: true, italic: true } },
    { scope: ["keyword.function", "function.method"], style: { foreground: theme.syntaxFunction } },
    { scope: ["keyword"], style: { foreground: theme.syntaxKeyword, italic: true } },
    { scope: ["keyword.import", "keyword.directive", "keyword.modifier", "keyword.exception"], style: { foreground: theme.syntaxKeyword } },

    // operators / punctuation
    { scope: ["operator", "keyword.operator", "punctuation.delimiter", "keyword.conditional.ternary"], style: { foreground: theme.syntaxOperator } },
    { scope: ["punctuation", "punctuation.bracket"], style: { foreground: theme.syntaxPunctuation } },
    { scope: ["punctuation.special"], style: { foreground: theme.syntaxOperator } },

    // identifiers
    { scope: ["variable", "variable.parameter", "function.method.call", "function.call", "parameter", "property"], style: { foreground: theme.syntaxVariable } },
    { scope: ["variable.member", "function", "constructor"], style: { foreground: theme.syntaxFunction } },
    { scope: ["type", "module", "class"], style: { foreground: theme.syntaxType } },
    { scope: ["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin", "variable.super"], style: { foreground: theme.error } },

    // markdown markup
    { scope: ["markup.heading", "markup.heading.1", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"], style: { foreground: theme.markdownHeading, bold: true } },
    { scope: ["markup.bold", "markup.strong"], style: { foreground: theme.markdownStrong, bold: true } },
    { scope: ["markup.italic"], style: { foreground: theme.markdownEmph, italic: true } },
    { scope: ["markup.list"], style: { foreground: theme.markdownListMarker } },
    { scope: ["markup.quote"], style: { foreground: theme.markdownQuote, italic: true } },
    { scope: ["markup.raw", "markup.raw.block"], style: { foreground: theme.markdownCode } },
    { scope: ["markup.raw.inline"], style: { foreground: theme.markdownCode, background: theme.bg } },
    { scope: ["markup.link", "markup.link.url"], style: { foreground: theme.markdownLink, underline: true } },
    { scope: ["markup.link.label", "label"], style: { foreground: theme.markdownLinkText, underline: true } },
    { scope: ["string.special", "string.special.url"], style: { foreground: theme.markdownLink, underline: true } },

    { scope: ["conceal"], style: { foreground: theme.textMuted } },
    { scope: ["spell", "nospell"], style: { foreground: theme.text } },
  ]
}

let _cached: SyntaxStyle | null = null

/**
 * The shared SyntaxStyle for every native <code>/<markdown>/<diff>. Built lazily on first
 * use (after the renderer is live) and cached as a true singleton — building it per-render
 * leaks a native handle on every streaming token.
 */
export function syntaxStyle(): SyntaxStyle {
  return (_cached ??= SyntaxStyle.fromTheme(getSyntaxRules()))
}
