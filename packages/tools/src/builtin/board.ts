import { obj, type Tool } from "../tool.ts"

export const SPAWN_TEAM = "spawn_team"
export const TEAM = "team"
export const BOARD_POST = "board_post"
export const BOARD_READ = "board_read"
export const BOARD_CLAIM = "board_claim_file"
export const BOARD_RELEASE = "board_release_file"
export const BOARD_TOOLS = new Set([SPAWN_TEAM, TEAM, BOARD_POST, BOARD_READ, BOARD_CLAIM, BOARD_RELEASE])

// Like the task_* tools, these run inside the engine; the runner intercepts the calls (the bodies
// below are safe fallbacks). spawn_team is deferred (search "team"); the board_* tools are
// auto-activated for team members and the orchestrator when a team is spawned.

export const spawnTeamTool: Tool = {
  name: SPAWN_TEAM,
  description:
    "Launch a coordinated team of agents working toward one goal — the orchestrator pattern. You define a `goal` and a list of `roles` (each a focused agent with its own prompt and isolated git worktree). The team posts findings/handoffs to a shared board as they work; when ALL members finish, you are automatically re-prompted with a digest of their results so you can merge the worktrees and report. Use this (not spawn_agents) when the work must be coordinated and merged. Workers can read/write the board with board_read/board_post and avoid edit collisions with board_claim_file.",
  permission: "bash",
  deferred: true,
  parameters: obj(
    {
      goal: { type: "string", description: "the shared objective for the whole team" },
      roles: {
        type: "array",
        description: "the team members to spawn, one focused agent per role",
        items: obj(
          {
            role: { type: "string", description: "short role name, e.g. 'backend', 'tests', 'docs'" },
            prompt: { type: "string", description: "the full instruction for this member" },
            worktree: {
              type: "string",
              description: "optional branch/worktree name; defaults to an isolated per-role worktree",
            },
          },
          ["role", "prompt"],
        ),
      },
    },
    ["goal", "roles"],
  ),
  async execute() {
    return { output: "spawn_team is handled by the agent runtime." }
  },
}

export const teamTool: Tool = {
  name: TEAM,
  description:
    "Launch a coordinated TEAM of agents toward one shared goal — the orchestrator pattern. Define a `goal` and `members`, each a role backed by an agent def (set `agent` to a premade/custom agent like 'coder' or 'reviewer', plus an optional `prompt` to focus it) running in its own isolated git worktree. Members share a blackboard (board_post / board_read) and claim files to avoid collisions; when ALL finish you're automatically re-prompted with a digest to merge the worktrees and report. Use this (not `swarm`) when the work must be coordinated and merged. `budget` caps each member's spend ('$0.50' or a token count).",
  permission: "bash",
  deferred: true,
  parameters: obj(
    {
      goal: { type: "string", description: "the shared objective for the whole team" },
      members: {
        type: "array",
        description: "the team members to spawn, one focused agent per role",
        items: obj(
          {
            role: { type: "string", description: "short role name, e.g. 'backend', 'tests', 'docs'" },
            agent: { type: "string", description: "optional agent def name backing this role" },
            prompt: { type: "string", description: "the full instruction for this member" },
            worktree: {
              type: "string",
              description: "optional branch/worktree name; defaults to an isolated per-role worktree",
            },
          },
          ["role", "prompt"],
        ),
      },
      budget: { type: "string", description: "optional per-member spend cap, e.g. '$0.50' or '100000'" },
    },
    ["goal", "members"],
  ),
  async execute() {
    return { output: "team is handled by the agent runtime." }
  },
}

export const boardPostTool: Tool = {
  name: BOARD_POST,
  description:
    "Post to your team's shared board so teammates and the orchestrator can see it. Use kind 'finding' for results/discoveries, 'handoff' to pass work to another role (set to_role), 'message' for general notes, 'status' for progress. No-op if you're not part of a team.",
  permission: "read",
  deferred: true,
  parameters: obj(
    {
      kind: {
        type: "string",
        description: "finding | handoff | message | status",
        enum: ["finding", "handoff", "message", "status"],
      },
      text: { type: "string", description: "the content to post" },
      to_role: { type: "string", description: "optional target role for a handoff/message" },
    },
    ["kind", "text"],
  ),
  async execute() {
    return { output: "board_post is handled by the agent runtime." }
  },
}

export const boardReadTool: Tool = {
  name: BOARD_READ,
  description:
    "Read your team's shared board (members, their statuses, and posted findings/handoffs/messages). Optionally filter by role. Returns nothing if you're not part of a team.",
  permission: "read",
  deferred: true,
  parameters: obj(
    {
      role: { type: "string", description: "optional: only posts from/to this role" },
      since: { type: "number", description: "optional: only posts with id greater than this" },
    },
    [],
  ),
  async execute() {
    return { output: "board_read is handled by the agent runtime." }
  },
}

export const boardClaimTool: Tool = {
  name: BOARD_CLAIM,
  description:
    "Advisory claim on a file path so teammates avoid editing it at the same time. Returns whether you got it (and who holds it otherwise). Claims auto-expire, never block, and are only hints — check before editing shared files. No-op outside a team.",
  permission: "read",
  deferred: true,
  parameters: obj(
    {
      path: { type: "string", description: "the file path to claim" },
      ttl_minutes: { type: "number", description: "how long to hold the claim (default 10)" },
    },
    ["path"],
  ),
  async execute() {
    return { output: "board_claim_file is handled by the agent runtime." }
  },
}

export const boardReleaseTool: Tool = {
  name: BOARD_RELEASE,
  description: "Release a file claim you hold once you're done editing it.",
  permission: "read",
  deferred: true,
  parameters: obj({ path: { type: "string", description: "the file path to release" } }, ["path"]),
  async execute() {
    return { output: "board_release_file is handled by the agent runtime." }
  },
}

export const BOARD_TOOL_LIST: Tool[] = [
  teamTool,
  spawnTeamTool,
  boardPostTool,
  boardReadTool,
  boardClaimTool,
  boardReleaseTool,
]
