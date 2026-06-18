import fs from "node:fs"
import path from "node:path"
import { fridayDir } from "@friday/providers"

export interface AgentDef {
  name: string
  description: string
  /** Optional allowlist of read-only tool names to scope the sub-agent to (default: all read-only). */
  tools?: string[]
  /** Optional model override for this agent type. */
  model?: string
  /** The system prompt (markdown body). */
  content: string
  source: "project" | "user"
}

function parse(raw: string, fallbackName: string): Omit<AgentDef, "source"> {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { name: fallbackName, description: "", content: raw.trim() }
  const meta = m[1]!
  const field = (k: string) =>
    meta
      .match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "")
  const toolsRaw = field("tools")
  return {
    name: field("name") || fallbackName,
    description: field("description") || "",
    tools: toolsRaw
      ? toolsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined,
    model: field("model") || undefined,
    content: m[2]!.trim(),
  }
}

/** Load custom sub-agent types from .friday/agents (project) and ~/.friday/agents (user).
 * Supports a flat `<name>.md` file or a `<name>/AGENT.md` directory — mirrors loadSkills. */
export function loadAgents(roots: string[]): AgentDef[] {
  const out: AgentDef[] = []
  const dirs: { dir: string; source: "project" | "user" }[] = [
    ...roots.map((r) => ({ dir: path.join(r, ".friday", "agents"), source: "project" as const })),
    { dir: path.join(fridayDir(), "agents"), source: "user" },
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
        const agentFile = path.join(dir, e.name, "AGENT.md")
        if (fs.existsSync(agentFile)) file = agentFile
      } else if (e.name.endsWith(".md")) {
        file = path.join(dir, e.name)
        fallback = e.name.replace(/\.md$/, "")
      }
      if (!file) continue
      try {
        const parsed = parse(fs.readFileSync(file, "utf8"), fallback)
        if (parsed.content && !out.some((a) => a.name === parsed.name)) out.push({ ...parsed, source })
      } catch {
        /* skip */
      }
    }
  }
  return out
}
