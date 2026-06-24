import fs from "node:fs"
import path from "node:path"
import { fridayDir } from "@friday/providers"

/** One role in a reusable team, backed by an agent def. */
export interface TeamMemberDef {
  role: string
  /** agent def name backing this role (see agents.ts); optional → generic worker. */
  agent?: string
  /** default focus for this member; the launcher appends the concrete goal. */
  prompt: string
}

/** A reusable, named team: a roster + a coordination goal template. Invoked by name (slash command,
 * Agents dashboard tab) or proposed by Friday. Premade ones ship built-in; users add their own under
 * .friday/teams/<name>.json. */
export interface TeamDef {
  name: string
  description: string
  members: TeamMemberDef[]
  source: "project" | "user" | "builtin"
}

/** Premade teams. Members reference built-in agent defs (see BUILTIN_AGENTS). */
export const BUILTIN_TEAMS: TeamDef[] = [
  {
    name: "software-team",
    description: "Build a feature end to end: architect → coder → tester → reviewer.",
    source: "builtin",
    members: [
      { role: "architect", agent: "explore", prompt: "Investigate the affected code and propose the approach." },
      { role: "coder", agent: "refactorer", prompt: "Implement the feature following the architect's approach." },
      { role: "tester", prompt: "Write and run tests covering the new behavior and edge cases." },
      { role: "reviewer", agent: "reviewer", prompt: "Review the implementation for correctness bugs and risks." },
    ],
  },
  {
    name: "qa-team",
    description: "Harden existing code: write tests, run them, hunt edge cases.",
    source: "builtin",
    members: [
      { role: "test-writer", prompt: "Write thorough tests for the target code, including edge cases." },
      { role: "test-runner", prompt: "Run the test suite, triage failures, and report what breaks." },
      { role: "edge-hunter", agent: "reviewer", prompt: "Find untested edge cases and risky paths to cover." },
    ],
  },
  {
    name: "research-team",
    description: "Investigate with competing hypotheses, then synthesize a consensus.",
    source: "builtin",
    members: [
      { role: "investigator-a", agent: "explore", prompt: "Investigate one hypothesis; try to disprove the others." },
      { role: "investigator-b", agent: "explore", prompt: "Investigate a different hypothesis; challenge the others." },
      { role: "investigator-c", agent: "explore", prompt: "Investigate a third angle; challenge the others." },
      { role: "synthesizer", prompt: "Read the board and synthesize the consensus the evidence supports." },
    ],
  },
]

/** Load user/project team defs from .friday/teams/<name>.json (mirrors loadAgents). */
export function loadTeams(roots: string[]): TeamDef[] {
  const out: TeamDef[] = []
  const dirs: { dir: string; source: "project" | "user" }[] = [
    ...roots.map((r) => ({ dir: path.join(r, ".friday", "teams"), source: "project" as const })),
    { dir: path.join(fridayDir(), "teams"), source: "user" },
  ]
  for (const { dir, source } of dirs) {
    let entries: string[]
    try {
      entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
    } catch {
      continue
    }
    for (const f of entries) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Partial<TeamDef>
        const name = raw.name || f.replace(/\.json$/, "")
        if (raw.members?.length && !out.some((t) => t.name === name)) {
          out.push({ name, description: raw.description || "", members: raw.members, source })
        }
      } catch {
        /* skip malformed */
      }
    }
  }
  return out
}

/** All teams: on-disk defs plus built-ins (on-disk wins over a same-named built-in). */
export function resolveTeams(roots: string[]): TeamDef[] {
  const disk = loadTeams(roots)
  const names = new Set(disk.map((t) => t.name))
  return [...disk, ...BUILTIN_TEAMS.filter((b) => !names.has(b.name))]
}

export function resolveTeam(name: string | undefined, roots: string[]): TeamDef | undefined {
  if (!name) return undefined
  return resolveTeams(roots).find((t) => t.name === name)
}
