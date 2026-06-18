import { obj, type Tool } from "../tool.ts"

export const TOOL_SEARCH = "tool_search"

/** Lightweight keyword scoring over a tool's name + description. */
export function searchTools(
  query: string,
  pool: { name: string; description: string }[],
  max = 8,
): { name: string; description: string }[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean)
  if (!terms.length) return pool.slice(0, max)
  const scored = pool.map((t) => {
    const name = t.name.toLowerCase()
    const desc = t.description.toLowerCase()
    let score = 0
    for (const term of terms) {
      if (name === term) score += 5
      else if (name.includes(term)) score += 3
      if (desc.includes(term)) score += 1
    }
    return { t, score }
  })
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.t)
}

/**
 * Discover deferred (not-always-loaded) tools by keyword. The runner intercepts this call: it scores
 * the deferred pool, activates the matches for the rest of the session (so their full schemas are sent
 * on subsequent turns), and returns the matches here so the model knows what's now callable.
 */
export const toolSearchTool: Tool = {
  name: TOOL_SEARCH,
  description:
    "Search for additional tools by capability when the loaded set doesn't cover what you need (e.g. background tasks, scheduling, git worktrees, notebooks, memory). Returns matching tools and makes them available to call.",
  permission: "read",
  parameters: obj(
    {
      query: { type: "string", description: "what you want to do, e.g. 'run a background task' or 'edit a notebook'" },
    },
    ["query"],
  ),
  async execute() {
    // Intercepted by the runner (needs session-level activation state); this body is a safe fallback.
    return { output: "tool_search is handled by the agent runtime." }
  },
}
