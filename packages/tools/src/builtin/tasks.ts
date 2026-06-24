import { obj, type Tool } from "../tool.ts"

export const TASK_CREATE = "task_create"
export const TASK_LIST = "task_list"
export const TASK_STATUS = "task_status"
export const TASK_STOP = "task_stop"
export const SPAWN_AGENTS = "spawn_agents"
export const SEND_TO_TASK = "send_to_task"
// Consolidated surface: `delegate` (subagent) and `swarm` (map-reduce fan-out) supersede
// task_create / spawn_agents; the old names stay as aliases for one release.
export const DELEGATE = "delegate"
export const SWARM = "swarm"
export const TASK_BG_TOOLS = new Set([
  TASK_CREATE,
  TASK_LIST,
  TASK_STATUS,
  TASK_STOP,
  SPAWN_AGENTS,
  SEND_TO_TASK,
  DELEGATE,
  SWARM,
])

/** Parse a spawn budget from `"$0.20"` (dollars) or `50000` / `"50000"` (tokens). */
export function parseBudget(input?: string | number): { usd?: number; tokens?: number } {
  if (input == null) return {}
  if (typeof input === "number") return Number.isFinite(input) ? { tokens: input } : {}
  const s = input.trim()
  if (!s) return {}
  if (s.startsWith("$")) {
    const usd = Number.parseFloat(s.slice(1))
    return Number.isFinite(usd) ? { usd } : {}
  }
  const tokens = Number.parseInt(s.replace(/[_,]/g, ""), 10)
  return Number.isFinite(tokens) ? { tokens } : {}
}

// These run as background sessions managed by the engine; the runner intercepts the calls (the bodies
// below are safe fallbacks). They're deferred so they don't bloat the default tool list.

export const taskCreateTool: Tool = {
  name: TASK_CREATE,
  description:
    "Start a background task: a detached agent session that works on `prompt` independently while you continue. Returns a task id. Use for long/parallel work you don't want to block on. Pass `worktree` to run it in an isolated git worktree (so parallel tasks don't collide).",
  permission: "bash",
  deferred: true,
  parameters: obj(
    {
      description: { type: "string", description: "short label for the task" },
      prompt: { type: "string", description: "the full instruction for the background agent" },
      worktree: { type: "string", description: "optional: branch/worktree name to isolate this task's edits" },
    },
    ["description", "prompt"],
  ),
  async execute() {
    return { output: "task_create is handled by the agent runtime." }
  },
}

export const taskListTool: Tool = {
  name: TASK_LIST,
  description: "List background tasks and their status (running / done).",
  permission: "read",
  deferred: true,
  parameters: obj({}),
  async execute() {
    return { output: "task_list is handled by the agent runtime." }
  },
}

export const taskStatusTool: Tool = {
  name: TASK_STATUS,
  description: "Get a background task's status and latest output by id.",
  permission: "read",
  deferred: true,
  parameters: obj({ id: { type: "string", description: "task id from task_create / task_list" } }, ["id"]),
  async execute() {
    return { output: "task_status is handled by the agent runtime." }
  },
}

export const taskStopTool: Tool = {
  name: TASK_STOP,
  description: "Stop a running background task by id.",
  permission: "bash",
  deferred: true,
  parameters: obj({ id: { type: "string", description: "task id to stop" } }, ["id"]),
  async execute() {
    return { output: "task_stop is handled by the agent runtime." }
  },
}

export const spawnAgentsTool: Tool = {
  name: SPAWN_AGENTS,
  description:
    "SWARM: fan out several INDEPENDENT background agents on different tasks in one call. They do NOT coordinate or talk — each runs to completion alone and returns a task id; YOU collect results later with task_status. For one shared goal where workers must coordinate and be merged, use spawn_team instead. Pass `worktree: true` on a job to isolate its edits in a git worktree (recommended when several agents write code at once).",
  permission: "bash",
  deferred: true,
  parameters: obj(
    {
      jobs: {
        type: "array",
        description: "the subtasks to run in parallel",
        items: obj(
          {
            description: { type: "string", description: "short label for this agent" },
            prompt: { type: "string", description: "the full instruction for this agent" },
            worktree: { type: "string", description: "optional branch/worktree name to isolate this agent's edits" },
          },
          ["description", "prompt"],
        ),
      },
    },
    ["jobs"],
  ),
  async execute() {
    return { output: "spawn_agents is handled by the agent runtime." }
  },
}

export const sendToTaskTool: Tool = {
  name: SEND_TO_TASK,
  description:
    "Send a follow-up instruction to a background task by id (e.g. to redirect, answer a question, or ask it to continue). Queues the message if the task is mid-turn.",
  permission: "bash",
  deferred: true,
  parameters: obj(
    {
      id: { type: "string", description: "task id from spawn_agents / task_create / task_list" },
      text: { type: "string", description: "the follow-up instruction to deliver" },
    },
    ["id", "text"],
  ),
  async execute() {
    return { output: "send_to_task is handled by the agent runtime." }
  },
}

export const CRON_CREATE = "cron_create"
export const CRON_LIST = "cron_list"
export const CRON_DELETE = "cron_delete"
export const CRON_TOOLS = new Set([CRON_CREATE, CRON_LIST, CRON_DELETE])

export const delegateTool: Tool = {
  name: DELEGATE,
  description:
    "Delegate work to a sub-agent. By default ({ background: false }) it runs INLINE and returns the answer with a clean context — best for read-only investigation ('where is X handled', 'how does Y work', 'find everything that calls Z'). Pass `background: true` to run it as a detached session instead (returns a task id; check with task_status). Pick a specific agent with `agent` (see the Sub-agents list); omit it for the default explorer. `budget` caps spend as '$0.20' or a token count like 50000. `worktree` isolates a background agent's edits.",
  permission: "read",
  parameters: obj(
    {
      prompt: { type: "string", description: "the full instruction for the sub-agent" },
      description: { type: "string", description: "short label" },
      agent: { type: "string", description: "optional agent def name to run as (default: explore)" },
      background: {
        type: "boolean",
        description: "true (default) = detached background session; false = inline, returns the answer",
      },
      budget: { type: "string", description: "optional spend cap, e.g. '$0.20' or '50000' tokens" },
      worktree: { type: "string", description: "optional branch/worktree name to isolate edits" },
    },
    ["prompt"],
  ),
  async execute() {
    return { output: "delegate is handled by the agent runtime." }
  },
}

export const swarmTool: Tool = {
  name: SWARM,
  description:
    "SWARM: fan out several INDEPENDENT sub-agents over a work-list in one call (map-reduce). They do NOT coordinate or talk — each runs alone and returns a task id; you collect results with task_status. Use for embarrassingly-parallel work (review N files, try N approaches, migrate N modules). For one shared goal where workers must coordinate and merge, use `team` instead. Set `agent` to run every job as a given agent def, or per-job. `budget` caps each job's spend ('$0.20' or a token count). Pass `worktree` per job to isolate edits.",
  permission: "bash",
  deferred: true,
  parameters: obj(
    {
      jobs: {
        type: "array",
        description: "the subtasks to run in parallel",
        items: obj(
          {
            description: { type: "string", description: "short label for this agent" },
            prompt: { type: "string", description: "the full instruction for this agent" },
            agent: { type: "string", description: "optional agent def name for this job" },
            worktree: { type: "string", description: "optional branch/worktree name to isolate this agent's edits" },
            budget: { type: "string", description: "optional per-job spend cap, e.g. '$0.20' or '50000'" },
          },
          ["description", "prompt"],
        ),
      },
      agent: { type: "string", description: "optional default agent def for all jobs" },
      budget: { type: "string", description: "optional default spend cap for each job" },
    },
    ["jobs"],
  ),
  async execute() {
    return { output: "swarm is handled by the agent runtime." }
  },
}

export const cronCreateTool: Tool = {
  name: CRON_CREATE,
  description:
    "Schedule a recurring background task. `every` is a simple interval: '30s', '5m', '2h', '1d', 'hourly', or 'daily'. Runs only while Friday is open (no daemon). Returns a job id.",
  permission: "bash",
  deferred: true,
  parameters: obj(
    {
      description: { type: "string", description: "short label for the schedule" },
      prompt: { type: "string", description: "the instruction to run each time" },
      every: { type: "string", description: "interval, e.g. '15m' or 'daily'" },
    },
    ["description", "prompt", "every"],
  ),
  async execute() {
    return { output: "cron_create is handled by the agent runtime." }
  },
}

export const cronListTool: Tool = {
  name: CRON_LIST,
  description: "List scheduled recurring tasks.",
  permission: "read",
  deferred: true,
  parameters: obj({}),
  async execute() {
    return { output: "cron_list is handled by the agent runtime." }
  },
}

export const cronDeleteTool: Tool = {
  name: CRON_DELETE,
  description: "Delete a scheduled recurring task by id.",
  permission: "bash",
  deferred: true,
  parameters: obj({ id: { type: "string", description: "cron job id from cron_list" } }, ["id"]),
  async execute() {
    return { output: "cron_delete is handled by the agent runtime." }
  },
}

export const TASK_BG_TOOL_LIST: Tool[] = [
  delegateTool,
  swarmTool,
  taskCreateTool,
  taskListTool,
  taskStatusTool,
  taskStopTool,
  spawnAgentsTool,
  sendToTaskTool,
  cronCreateTool,
  cronListTool,
  cronDeleteTool,
]
