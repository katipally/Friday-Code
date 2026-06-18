/**
 * Inline paste tokens for the composer. A large/multi-line paste is collapsed to a short
 * placeholder token inserted at the cursor (so the "chip" sits exactly where it was pasted and the
 * buffer stays compact), while the real content is held in a side map and expanded back on submit.
 */

function fmtSize(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
}

/** The visible placeholder for the Nth paste of `len` chars, e.g. `⟦paste 1 · 2.3k⟧`. */
export function makePasteToken(n: number, len: number): string {
  return `⟦paste ${n} · ${fmtSize(len)}⟧`
}

/**
 * Whether a pasted string is "big" enough to collapse into a token rather than inserting inline.
 * Short single-line pastes (a path, a word) flow in as normal text; only bulky/multi-line content
 * becomes a chip.
 */
export function isBigPaste(text: string): boolean {
  return text.length > 240 || (text.includes("\n") && text.length > 80)
}

/** Replace every still-present token in `text` with its stored content (orphaned tokens are skipped). */
export function expandTokens(text: string, map: Map<string, string>): string {
  let out = text
  for (const [token, content] of map) {
    if (out.includes(token)) out = out.split(token).join(content)
  }
  return out
}
