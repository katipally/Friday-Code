import fs from "node:fs"
import path from "node:path"
import { fridayDir } from "@friday/providers"

export interface Skill {
  name: string
  description: string
  whenToUse?: string
  content: string
  source: "project" | "user"
}

function parse(raw: string, fallbackName: string): Omit<Skill, "source"> {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { name: fallbackName, description: "", content: raw.trim() }
  const meta = m[1]!
  const field = (k: string) => meta.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "")
  return {
    name: field("name") || fallbackName,
    description: field("description") || "",
    whenToUse: field("whenToUse") || field("when_to_use"),
    content: m[2]!.trim(),
  }
}

/** Load skills from .friday/skills (project) and ~/.friday/skills (user). Supports a flat
 * `<name>.md` file or a `<name>/SKILL.md` directory. */
export function loadSkills(cwd: string): Skill[] {
  const out: Skill[] = []
  const dirs: { dir: string; source: "project" | "user" }[] = [
    { dir: path.join(cwd, ".friday", "skills"), source: "project" },
    { dir: path.join(fridayDir(), "skills"), source: "user" },
  ]
  for (const { dir, source } of dirs) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      let file: string | undefined
      let fallback = e.name
      if (e.isDirectory()) {
        const skillFile = path.join(dir, e.name, "SKILL.md")
        if (fs.existsSync(skillFile)) file = skillFile
      } else if (e.name.endsWith(".md")) {
        file = path.join(dir, e.name)
        fallback = e.name.replace(/\.md$/, "")
      }
      if (!file) continue
      try {
        const parsed = parse(fs.readFileSync(file, "utf8"), fallback)
        if (parsed.content && !out.some((s) => s.name === parsed.name)) out.push({ ...parsed, source })
      } catch {
        /* skip */
      }
    }
  }
  return out
}
