import fs from "node:fs"
import path from "node:path"
import { fridayDir } from "@friday/providers"

export interface CustomCommand {
  name: string
  description: string
  template: string
  source: "project" | "user"
}

function parseFrontmatter(raw: string): { description: string; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { description: "", body: raw.trim() }
  const meta = m[1]!
  const desc = meta.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ""
  return { description: desc.replace(/^["']|["']$/g, ""), body: m[2]!.trim() }
}

/** Load markdown slash commands from .friday/commands (project) and ~/.friday/commands (user). */
export function loadCommands(cwd: string): CustomCommand[] {
  const out: CustomCommand[] = []
  const dirs: { dir: string; source: "project" | "user" }[] = [
    { dir: path.join(cwd, ".friday", "commands"), source: "project" },
    { dir: path.join(fridayDir(), "commands"), source: "user" },
  ]
  for (const { dir, source } of dirs) {
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue
      try {
        const raw = fs.readFileSync(path.join(dir, entry), "utf8")
        const { description, body } = parseFrontmatter(raw)
        const name = entry.replace(/\.md$/, "")
        if (!out.some((c) => c.name === name)) {
          out.push({ name, description: description || `custom command`, template: body, source })
        }
      } catch {
        /* skip */
      }
    }
  }
  return out
}
