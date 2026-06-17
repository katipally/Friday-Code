import { theme } from "@friday/shared"

export type Segment = { text: string; color: string }

const KEYWORDS = new Set(
  (
    "function return const let var if else for while class new import from export default async await " +
    "try catch finally throw typeof instanceof interface type enum extends implements public private protected " +
    "static readonly void null undefined true false this super switch case break continue of in do yield " +
    "def lambda elif except with as pass raise fn pub use struct impl match mut self package func go defer chan range " +
    "select map int string bool float double print echo end then begin module"
  ).split(" "),
)

const KEYWORD_COLOR = "#7dcfff"
const STRING_COLOR = "#9ece6a"
const NUMBER_COLOR = "#e0af68"
const COMMENT_COLOR = "#7b818c" // legible-but-quiet on the near-black canvas

/** A small, language-agnostic syntax highlighter (reliable, no tree-sitter). */
export function highlightLine(line: string): Segment[] {
  const segs: Segment[] = []
  let i = 0
  const n = line.length
  const push = (text: string, color: string) => text && segs.push({ text, color })

  while (i < n) {
    const ch = line[i]!
    const rest = line.slice(i)

    // line comments
    if (rest.startsWith("//") || ch === "#" || rest.startsWith("--")) {
      push(line.slice(i), COMMENT_COLOR)
      break
    }
    // strings
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1
      while (j < n && line[j] !== ch) {
        if (line[j] === "\\") j++
        j++
      }
      push(line.slice(i, Math.min(j + 1, n)), STRING_COLOR)
      i = j + 1
      continue
    }
    // numbers
    if (/[0-9]/.test(ch)) {
      let j = i
      while (j < n && /[0-9._xa-fA-F]/.test(line[j]!)) j++
      push(line.slice(i, j), NUMBER_COLOR)
      i = j
      continue
    }
    // identifiers / keywords
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$]/.test(line[j]!)) j++
      const word = line.slice(i, j)
      push(word, KEYWORDS.has(word) ? KEYWORD_COLOR : theme.text)
      i = j
      continue
    }
    // single other char
    push(ch, theme.textMuted)
    i++
  }
  return segs.length ? segs : [{ text: line || " ", color: theme.text }]
}
