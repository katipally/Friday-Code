import fs from "node:fs"
import path from "node:path"
import { fridayDir } from "@friday/providers"
import type { ModeId } from "@friday/shared"
import type { Tool } from "@friday/tools"

/**
 * A named subagent type. The main agent delegates to one with the `agent` tool; the engine spawns a
 * child runner whose system prompt, tool access, model, and permission posture come from this def.
 *
 * Fresh design (not the removed agents.json): markdown + YAML frontmatter, like skills, merged
 * built-in < user (~/.friday/agents) < project (.friday/agents) — later wins by name.
 */
export interface AgentDef {
  name: string
  /** "whenToUse" — shown to the main agent so it knows when to pick this type. */
  description: string
  /** the agent's role/system prompt body (markdown after the frontmatter). */
  system: string
  /** explicit tool-name allowlist; undefined = inherit all tools (the general agent). */
  tools?: string[]
  /** convenience: restrict to read-only tools (+ ask_user, + extraTools). */
  readOnly?: boolean
  /** extra tool names to add on top of a readOnly set (e.g. bash for a reviewer). */
  extraTools?: string[]
  /** model id override; omitted = inherit the parent's model. */
  model?: string
  /** permission posture pinned for this agent's runs (default = engine mode). */
  posture?: ModeId
  /** bubble (default): prompts surface to the user; auto-deny: never prompt, deny instead (safe for
   * unattended background work); inherit: same as bubble. */
  permission?: "bubble" | "auto-deny" | "inherit"
  /** panel tag color (xterm-256-safe accent name handled by the UI). */
  color?: string
  source: "built-in" | "user" | "project"
}

/** Built-in agents — always available, no files needed. */
const BUILTIN_AGENTS: AgentDef[] = [
  {
    name: "general",
    description:
      "General-purpose agent for any multi-step task — searching, reading, and editing across the codebase. Use when no more specific agent fits.",
    system:
      "You are a general-purpose subagent. Carry out the delegated task end to end, then return a concise summary of what you did and any results the main agent needs. Cite file paths.",
    source: "built-in",
  },
  {
    name: "explore",
    description:
      "Read-only search agent: locate where things live and how they connect. Returns a concise summary with file paths. Use for 'where is X handled', 'how does Y work', 'find everything that calls Z'.",
    system:
      "You are a read-only research subagent. Investigate thoroughly by reading and searching, then return a concise summary that directly answers the request, citing file paths. You cannot edit files or run shell commands.",
    readOnly: true,
    color: "cyan",
    source: "built-in",
  },
  {
    name: "plan",
    description:
      "Read-only planning agent: investigates the codebase and proposes a concrete implementation plan without making changes.",
    system:
      "You are a read-only planning subagent. Investigate the relevant code, then return an ordered, concrete implementation plan: the goal, the approach, the specific steps, and the files to change. Do not edit anything.",
    readOnly: true,
    posture: "plan",
    color: "blue",
    source: "built-in",
  },
  {
    name: "review",
    description:
      "Reviews a diff or set of changes for correctness bugs, regressions, and missed edge cases. Can run git/read commands but does not edit.",
    system:
      "You are a code-review subagent. Inspect the changes (start with `git diff`) and report bugs, regressions, missing edge cases, and risky patterns, each with a specific file:line and severity. Do not make edits — just report.",
    readOnly: true,
    extraTools: ["bash"],
    color: "magenta",
    source: "built-in",
  },
]

/** Parse one `<name>.md` agent file (YAML-ish frontmatter + markdown body). */
function parseAgent(raw: string, fallbackName: string, source: "user" | "project"): AgentDef | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const meta = m ? m[1]! : ""
  const body = (m ? m[2]! : raw).trim()
  const field = (k: string) =>
    meta
      .match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "")
  // `tools: a, b, c` or `tools: [a, b, c]`
  const list = (k: string): string[] | undefined => {
    const v = field(k)
    if (!v) return undefined
    const items = v
      .replace(/^\[|\]$/g, "")
      .split(/\s*,\s*/)
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
    return items.length ? items : undefined
  }
  const name = field("name") || fallbackName
  if (!body) return null
  const perm = field("permission")
  return {
    name,
    description: field("description") || "",
    system: body,
    tools: list("tools"),
    readOnly: field("readOnly") === "true" || field("read_only") === "true",
    extraTools: list("extraTools"),
    model: field("model"),
    posture: field("posture") as ModeId | undefined,
    permission: perm === "auto-deny" || perm === "inherit" || perm === "bubble" ? perm : undefined,
    color: field("color"),
    source,
  }
}

/** Built-ins + user (~/.friday/agents) + project (.friday/agents), later overriding earlier by name. */
export function loadAgents(roots: string[]): AgentDef[] {
  const byName = new Map<string, AgentDef>()
  for (const a of BUILTIN_AGENTS) byName.set(a.name, a)
  const dirs: { dir: string; source: "user" | "project" }[] = [
    { dir: path.join(fridayDir(), "agents"), source: "user" },
    ...roots.map((r) => ({ dir: path.join(r, ".friday", "agents"), source: "project" as const })),
  ]
  for (const { dir, source } of dirs) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue
      try {
        const def = parseAgent(fs.readFileSync(path.join(dir, e.name), "utf8"), e.name.replace(/\.md$/, ""), source)
        if (def) byName.set(def.name, def)
      } catch {
        /* skip a malformed file */
      }
    }
  }
  return [...byName.values()]
}

/** Resolve a subagent_type to its def (defaults to `general`). */
export function getAgent(roots: string[], name?: string): AgentDef {
  const all = loadAgents(roots)
  return all.find((a) => a.name === (name || "general")) ?? all.find((a) => a.name === "general") ?? BUILTIN_AGENTS[0]!
}

/** Short list for the system prompt / tool description. */
export function agentSummaries(roots: string[]): { name: string; description: string }[] {
  return loadAgents(roots).map((a) => ({ name: a.name, description: a.description }))
}

/**
 * Resolve a def's tool spec against the live registry into an allowlist of tool names.
 * Returns undefined for "all tools" (the general agent). ask_user is always included so any subagent
 * can bubble a question up to the user; nested-spawn tools are intentionally left out of restricted
 * agents (depth is also capped in the engine).
 */
export function resolveAgentTools(def: AgentDef, tools: Tool[]): Set<string> | undefined {
  if (def.tools?.length) return new Set([...def.tools, "ask_user"])
  if (def.readOnly) {
    const readNames = tools.filter((t) => t.permission === "read").map((t) => t.name)
    return new Set([...readNames, "ask_user", ...(def.extraTools ?? [])])
  }
  return undefined // inherit everything
}
