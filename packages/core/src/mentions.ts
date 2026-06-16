import fs from "node:fs"
import path from "node:path"

/** Resolve a mention against the workspace roots; returns the absolute path of the first file match. */
function resolveMention(rel: string, roots: string[]): string | undefined {
  if (path.isAbsolute(rel)) {
    try {
      return fs.statSync(rel).isFile() ? rel : undefined
    } catch {
      return undefined
    }
  }
  for (const root of roots) {
    const full = path.join(root, rel)
    try {
      if (fs.statSync(full).isFile()) return full
    } catch {
      /* try next root */
    }
  }
  return undefined
}

/** Expand `@path` file mentions in a prompt into appended <file> blocks (searched across all roots). */
export function expandMentions(text: string, roots: string[]): { text: string; files: string[] } {
  const matches: { rel: string; full: string }[] = []
  const re = /(?:^|\s)@([^\s@]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const rel = m[1]!
    const full = resolveMention(rel, roots)
    if (full && !matches.some((x) => x.full === full)) matches.push({ rel, full })
  }
  if (!matches.length) return { text, files: [] }
  const blocks = matches
    .map((x) => {
      try {
        return `<file path="${x.rel}">\n${fs.readFileSync(x.full, "utf8").slice(0, 20_000)}\n</file>`
      } catch {
        return ""
      }
    })
    .filter(Boolean)
  return { text: `${text}\n\n${blocks.join("\n\n")}`, files: matches.map((x) => x.rel) }
}
