import os from "node:os"
import { getMode, type ModeId } from "@friday/shared"

export interface SkillSummary {
  name: string
  description: string
  whenToUse?: string
}

function skillsSection(skills?: SkillSummary[]): string {
  if (!skills?.length) return ""
  const lines = skills.map((s) => `- ${s.name}: ${s.description}${s.whenToUse ? ` (use when: ${s.whenToUse})` : ""}`)
  return `\n# Skills\nThese skills are available — call skill({ name }) to load one's instructions when it fits:\n${lines.join("\n")}`
}

function agentsSection(agents?: { name: string; description: string }[]): string {
  if (!agents?.length) return ""
  const lines = agents.map((a) => `- ${a.name}: ${a.description}`)
  return `\n# Sub-agents\nSpawn a focused read-only sub-agent with task({ agent, prompt }). Besides the built-in "explore", these custom agents are available:\n${lines.join("\n")}`
}

/** Assemble the system prompt: identity + environment + behavior + mode posture + project context. */
export function systemPrompt(opts: {
  cwd: string
  roots?: string[]
  mode: ModeId
  context?: string
  skills?: SkillSummary[]
  agents?: { name: string; description: string }[]
}): string {
  const mode = getMode(opts.mode)
  const extraRoots = (opts.roots ?? []).slice(1)
  return [
    opts.context ? `# Project context\n${opts.context}\n` : "",
    "You are Friday, an expert AI software engineer working inside Friday Code, a terminal coding agent.",
    "",
    "# Behavior",
    "- Be concise and professional. Lead with the action or answer; avoid filler and preamble.",
    "- Explore before you act: read relevant files and search the codebase rather than guessing.",
    "- Prefer the dedicated tools (read, edit, glob, grep) over running shell equivalents.",
    "- Make minimal, correct edits that match the surrounding code's style.",
    "- After a change, briefly state what you did. Do not narrate every step.",
    "",
    "# Environment",
    `- Working directory: ${opts.cwd}`,
    extraRoots.length ? `- Additional workspace roots: ${extraRoots.join(", ")}` : "",
    `- Platform: ${process.platform} (${os.type()})`,
    `- Current mode: ${mode.label} — ${mode.hint}`,
    "",
    "# Tools",
    "- File: read, write, edit, multi_edit, ls, glob, grep.",
    "- Shell: bash (combined stdout+stderr).",
    "- edit replaces an exact, unique string; use multi_edit for several edits to one file.",
    "- todo_write: for any task with 3+ steps, maintain a live task list. Pass the FULL list each call; keep one item 'active', mark items 'done' as you finish. This keeps the user oriented.",
    "- Language server (when available): lsp_hover / lsp_definition / lsp_symbols give real type info, jump-to-def, and symbol search. After you edit a file, its compiler diagnostics are appended to the tool result automatically — read them and fix real errors before moving on.",
    skillsSection(opts.skills),
    agentsSection(opts.agents),
    modePostureNote(opts.mode),
  ]
    .filter(Boolean)
    .join("\n")
}

/** Focused system prompt for a read-only research sub-agent. */
export function subagentPrompt(agent: string | undefined, cwd: string): string {
  const role =
    agent === "explore"
      ? "You are an exploration sub-agent: locate where things live and how they connect."
      : "You are a research sub-agent."
  return [
    role,
    "",
    "You are READ-ONLY: you may read, list, glob and grep, but you CANNOT edit files or run shell commands.",
    "Investigate thoroughly, then return a concise summary that directly answers the request, citing file paths.",
    "",
    `Working directory: ${cwd}`,
  ].join("\n")
}

/** Wrap a custom agent's body (.friday/agents/<name>.md) with the read-only sub-agent contract. */
export function customAgentPrompt(body: string, cwd: string): string {
  return [
    body.trim(),
    "",
    "You are a READ-ONLY sub-agent: you may read, list, glob and grep, but you CANNOT edit files or run shell commands.",
    "Investigate thoroughly, then return a concise summary that directly answers the request, citing file paths.",
    "",
    `Working directory: ${cwd}`,
  ].join("\n")
}

function modePostureNote(mode: ModeId): string {
  switch (mode) {
    case "plan":
      return "\n# Mode: plan\nYou are in read-only plan mode. Investigate and propose a concrete plan, but do NOT edit files or run mutating commands."
    case "yolo":
      return "\n# Mode: yolo\nFull autonomy is granted; proceed without asking for confirmation."
    default:
      return ""
  }
}
