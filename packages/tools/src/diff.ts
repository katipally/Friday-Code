/**
 * Minimal LCS line diff -> unified-style string with collapsed context.
 * Lines are prefixed with " " (context), "-" (removed), "+" (added).
 */
export function unifiedDiff(oldText: string, newText: string): string {
  const a = oldText.length ? oldText.split("\n") : []
  const b = newText.length ? newText.split("\n") : []
  const n = a.length
  const m = b.length

  // Guard against pathologically large O(n*m) diffs.
  if (n * m > 4_000_000) {
    return [`@@ file replaced (${n} → ${m} lines) @@`, ...b.slice(0, 200).map((l) => `+${l}`)].join("\n")
  }

  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  const raw: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push(` ${a[i]}`)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      raw.push(`-${a[i++]}`)
    } else {
      raw.push(`+${b[j++]}`)
    }
  }
  while (i < n) raw.push(`-${a[i++]}`)
  while (j < m) raw.push(`+${b[j++]}`)

  return collapseContext(raw, 3)
}

/** Collapse runs of unchanged context lines to `ctx` head + tail with a marker. */
function collapseContext(lines: string[], ctx: number): string {
  const out: string[] = []
  let run: string[] = []
  const flush = () => {
    if (run.length <= ctx * 2) {
      out.push(...run)
    } else {
      out.push(...run.slice(0, ctx), "  ⋮", ...run.slice(run.length - ctx))
    }
    run = []
  }
  for (const l of lines) {
    if (l.startsWith(" ")) run.push(l)
    else {
      flush()
      out.push(l)
    }
  }
  flush()
  return out.join("\n")
}

export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of diff.split("\n")) {
    if (l.startsWith("+")) added++
    else if (l.startsWith("-")) removed++
  }
  return { added, removed }
}
