import fs from "node:fs"
import path from "node:path"
import { fridayDir } from "@friday/providers"

const NAMES = ["FRIDAY.md", "AGENTS.md"]

export interface ProjectContext {
  /** rendered <context> blocks for the system prompt */
  content: string
  /** relative file names found (for the context panel) */
  files: string[]
}

/** Load FRIDAY.md / AGENTS.md walking up from cwd, plus a global ~/.friday/FRIDAY.md. */
export function loadProjectContext(cwd: string): ProjectContext {
  const found: { file: string; content: string }[] = []
  const seen = new Set<string>()

  const tryAdd = (full: string, label: string) => {
    try {
      const real = fs.realpathSync(full)
      if (seen.has(real)) return
      const content = fs.readFileSync(full, "utf8")
      if (content.trim()) {
        seen.add(real)
        found.push({ file: label, content })
      }
    } catch {
      /* not present */
    }
  }

  let dir = cwd
  for (let i = 0; i < 8; i++) {
    for (const n of NAMES) tryAdd(path.join(dir, n), path.relative(cwd, path.join(dir, n)) || n)
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  tryAdd(path.join(fridayDir(), "FRIDAY.md"), "~/.friday/FRIDAY.md")

  return {
    content: found.map((f) => `<context file="${f.file}">\n${f.content}\n</context>`).join("\n\n"),
    files: found.map((f) => f.file),
  }
}
