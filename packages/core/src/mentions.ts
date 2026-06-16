import fs from "node:fs"
import path from "node:path"

/** Expand `@path` file mentions in a prompt into appended <file> blocks. */
export function expandMentions(text: string, cwd: string): { text: string; files: string[] } {
  const files: string[] = []
  const re = /(?:^|\s)@([^\s@]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const rel = m[1]!
    const full = path.isAbsolute(rel) ? rel : path.join(cwd, rel)
    try {
      if (fs.statSync(full).isFile() && !files.includes(rel)) files.push(rel)
    } catch {
      /* not a file */
    }
  }
  if (!files.length) return { text, files: [] }
  const blocks = files
    .map((f) => {
      try {
        const full = path.isAbsolute(f) ? f : path.join(cwd, f)
        return `<file path="${f}">\n${fs.readFileSync(full, "utf8").slice(0, 20_000)}\n</file>`
      } catch {
        return ""
      }
    })
    .filter(Boolean)
  return { text: `${text}\n\n${blocks.join("\n\n")}`, files }
}
