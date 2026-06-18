/**
 * Multi-strategy string replacement for the edit tools. Models often produce an `old_string` whose
 * whitespace/indentation drifts slightly from the file (re-indented, trailing spaces, collapsed blank
 * lines). Exact match alone then fails. We try a ladder of progressively looser matchers and use the
 * FIRST one that yields a single unambiguous match (or all matches, for replace_all). The replacement
 * text is always spliced over the real spans found in the original content, so the file's own
 * formatting is preserved.
 */

export type Range = { start: number; end: number }

/** Char-offset of the start of each line, plus the line text (newline excluded). */
function lineTable(content: string): { lines: string[]; offsets: number[] } {
  const lines = content.split("\n")
  const offsets: number[] = []
  let off = 0
  for (const l of lines) {
    offsets.push(off)
    off += l.length + 1 // + the "\n"
  }
  return { lines, offsets }
}

/** Exact substring matches (most precise — char level, not line aligned). */
function exactRanges(content: string, find: string): Range[] {
  const out: Range[] = []
  let i = content.indexOf(find)
  while (i !== -1) {
    out.push({ start: i, end: i + find.length })
    i = content.indexOf(find, i + find.length)
  }
  return out
}

/** Line-window matches where each line pair is compared via `eq` (used for whitespace-tolerant modes). */
function windowRanges(content: string, find: string, eq: (a: string, b: string) => boolean): Range[] {
  const { lines: cLines, offsets } = lineTable(content)
  const fLines = find.split("\n")
  if (fLines.length === 0) return []
  const out: Range[] = []
  for (let i = 0; i + fLines.length <= cLines.length; i++) {
    let ok = true
    for (let j = 0; j < fLines.length; j++) {
      if (!eq(cLines[i + j]!, fLines[j]!)) {
        ok = false
        break
      }
    }
    if (!ok) continue
    const last = i + fLines.length - 1
    out.push({ start: offsets[i]!, end: offsets[last]! + cLines[last]!.length })
  }
  return out
}

/** Anchor a multi-line block by its first and last (trimmed) lines, matching the variable-length span
 * between them (the file's block may have a different number of inner lines than `find`). */
function blockAnchorRanges(content: string, find: string): Range[] {
  const fLines = find.split("\n")
  if (fLines.length < 3) return [] // anchoring only helps for real blocks
  const first = fLines[0]!.trim()
  const last = fLines[fLines.length - 1]!.trim()
  if (!first || !last) return []
  const { lines: cLines, offsets } = lineTable(content)
  const out: Range[] = []
  for (let i = 0; i < cLines.length; i++) {
    if (cLines[i]!.trim() !== first) continue
    for (let j = i + 1; j < cLines.length; j++) {
      if (cLines[j]!.trim() === last) {
        out.push({ start: offsets[i]!, end: offsets[j]! + cLines[j]!.length })
        break // nearest closing anchor
      }
    }
  }
  return out
}

const trimEnd = (s: string) => s.replace(/\s+$/, "")
const collapse = (s: string) => s.trim().replace(/\s+/g, " ")

/** The matcher ladder, strictest first. The first strategy with a usable match wins. */
const STRATEGIES: ((content: string, find: string) => Range[])[] = [
  exactRanges,
  (c, f) => windowRanges(c, f, (a, b) => trimEnd(a) === trimEnd(b)), // trailing-whitespace drift
  (c, f) => windowRanges(c, f, (a, b) => a.trim() === b.trim()), // leading-indent drift
  (c, f) => windowRanges(c, f, (a, b) => collapse(a) === collapse(b)), // internal-whitespace drift
  blockAnchorRanges, // first/last line anchor for larger blocks
]

export class EditError extends Error {}

/**
 * Replace `oldStr` with `newStr` in `content`. Empty `oldStr` appends. Without `replaceAll`, requires
 * a single unambiguous match under the first strategy that matches at all; a strategy that produces
 * multiple matches is skipped in favor of a stricter (unique) one before giving up.
 */
export function replaceInContent(content: string, oldStr: string, newStr: string, replaceAll: boolean): string {
  if (oldStr === "") return content + newStr
  let sawMultiple = false
  for (const strat of STRATEGIES) {
    const matches = strat(content, oldStr)
    if (matches.length === 0) continue
    if (matches.length > 1 && !replaceAll) {
      sawMultiple = true
      continue // ambiguous here — a stricter strategy may pin a unique span
    }
    if (replaceAll) {
      // Splice from the end so earlier ranges keep their offsets.
      let out = content
      for (let k = matches.length - 1; k >= 0; k--) {
        const m = matches[k]!
        out = out.slice(0, m.start) + newStr + out.slice(m.end)
      }
      return out
    }
    const m = matches[0]!
    return content.slice(0, m.start) + newStr + content.slice(m.end)
  }
  throw new EditError(
    sawMultiple
      ? "old_string is not unique; pass replace_all or add more surrounding context"
      : "old_string not found (tried exact + whitespace/indent-tolerant matching)",
  )
}
