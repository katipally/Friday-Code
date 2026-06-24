import fs from "node:fs"
import path from "node:path"
import type { ModeId } from "@friday/shared"
import { fridayDir } from "@friday/providers"

export interface AgentDef {
  name: string
  description: string
  /** Optional allowlist of tool names to scope the agent to (default: all the parent's tools). */
  tools?: string[]
  /** Optional model override for this agent type. */
  model?: string
  /** Optional skills (by name) this agent should be told it can load. */
  skills?: string[]
  /** Optional MCP server names this agent's tools should be drawn from. */
  mcp?: string[]
  /** Default permission posture (plan/default/yolo). Falls back to the session mode when unset. */
  posture?: ModeId
  /** Presentation hints for the dashboard. */
  color?: string
  glyph?: string
  /** The system prompt (markdown body). */
  content: string
  source: "project" | "user" | "builtin"
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
  const list = (k: string) => {
    const raw = field(k)
    return raw
      ? raw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined
  }
  const posture = field("posture")
  return {
    name: field("name") || fallbackName,
    description: field("description") || "",
    tools: list("tools"),
    model: field("model") || undefined,
    skills: list("skills"),
    mcp: list("mcp"),
    posture: posture === "plan" || posture === "default" || posture === "yolo" ? posture : undefined,
    color: field("color") || undefined,
    glyph: field("glyph") || undefined,
    content: m[2]!.trim(),
  }
}

/** Built-in agents that always exist, independent of what's on disk. Friday is the default agent;
 * explore is the read-only investigator used by `delegate` when no agent is named. Users can
 * override either by authoring a same-named def under .friday/agents. */
export const BUILTIN_AGENTS: AgentDef[] = [
  {
    name: "friday",
    description: "The default Friday agent — full tools, asks before edits & commands.",
    posture: "default",
    glyph: "◈",
    color: "#87afd7",
    content: "You are Friday, an expert AI software engineer working inside Friday Code.",
    source: "builtin",
  },
  {
    name: "explore",
    description: "Read-only investigator: locates where things live and how they connect, returns a concise answer.",
    posture: "plan",
    glyph: "◐",
    color: "#5fafff",
    content: "You are an exploration sub-agent: locate where things live and how they connect.",
    source: "builtin",
  },
  {
    name: "reviewer",
    description: "Reviews a diff or files for correctness bugs, edge cases, and risky changes; reports findings only.",
    posture: "plan",
    glyph: "⊚",
    color: "#d7af5f",
    content:
      "You are a code reviewer. Read the relevant diff and files and report concrete correctness bugs, missing edge cases, and risky changes — file:line, what's wrong, and the fix. Do not edit; reporting only. Be specific and skip nitpicks.",
    source: "builtin",
  },
  {
    name: "security-auditor",
    description: "Audits code for security vulnerabilities (injection, authz, secrets, unsafe input); reports only.",
    posture: "plan",
    glyph: "⊘",
    color: "#ff5f5f",
    content:
      "You are a security auditor. Inspect the code for injection, broken authz, secret handling, path traversal, and unsafe input. Report each issue with a severity rating, the file:line, and a concrete remediation. Read-only.",
    source: "builtin",
  },
  {
    name: "doc-writer",
    description: "Writes and updates docs/comments to match the code. Runs as a background agent.",
    posture: "default",
    glyph: "✎",
    color: "#87afd7",
    content:
      "You are a documentation writer. Update READMEs, doc comments, and guides to match the current code. Keep prose tight and accurate; match the existing doc style. Only touch docs/comments unless told otherwise.",
    source: "builtin",
  },
  {
    name: "refactorer",
    description: "Performs focused, behavior-preserving refactors. Runs as a background agent in a worktree.",
    posture: "default",
    glyph: "↻",
    color: "#5fd7af",
    content:
      "You are a refactoring specialist. Make focused, behavior-preserving improvements (extract, rename, dedupe, simplify) without changing observable behavior. Keep diffs minimal and run the project's checks if available.",
    source: "builtin",
  },
]

/** All agents: built-ins plus on-disk defs, with on-disk taking precedence over a same-named built-in. */
export function resolveAgents(roots: string[]): AgentDef[] {
  const disk = loadAgents(roots)
  const names = new Set(disk.map((a) => a.name))
  return [...disk, ...BUILTIN_AGENTS.filter((b) => !names.has(b.name))]
}

/** Look up one agent by name (on-disk wins over built-in). */
export function resolveAgent(name: string | undefined, roots: string[]): AgentDef | undefined {
  if (!name) return undefined
  return resolveAgents(roots).find((a) => a.name === name)
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
