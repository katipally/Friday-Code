import { obj, type Tool } from "../tool.ts"

export const TASK_CREATE = "task_create"
export const TASK_LIST = "task_list"
export const TASK_STATUS = "task_status"
export const TASK_STOP = "task_stop"
export const SEND_TO_TASK = "send_to_task"
// `agent` delegates to a typed subagent (its own context + tools): inline (returns a summary) or
// background (returns an id). It supersedes the old read-only `delegate` tool.
export const AGENT = "agent"
export const TASK_BG_TOOLS = new Set([TASK_CREATE, TASK_LIST, TASK_STATUS, TASK_STOP, SEND_TO_TASK, AGENT])

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

export const sendToTaskTool: Tool = {
  name: SEND_TO_TASK,
  description:
    "Send a follow-up instruction to a background task by id (e.g. to redirect, answer a question, or ask it to continue). Queues the message if the task is mid-turn.",
  permission: "bash",
  deferred: true,
  parameters: obj(
    {
      id: { type: "string", description: "task id from task_create / task_list" },
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

export const agentTool: Tool = {
  name: AGENT,
  description:
    "Delegate a task to a subagent that runs in its own context with its own tools, then reports back. `subagent_type` picks the agent type (see the Sub-agents section for the available types; defaults to 'general'). By default ({ background: false }) it runs INLINE — you wait and get its final summary; great for focused investigation or a self-contained piece of work. Pass `background: true` to run it detached (returns a task id you check with task_status / manage with task_list, task_stop, send_to_task). You may issue several inline `agent` calls in ONE turn to fan them out in parallel. `budget` caps spend ('$0.20' or a token count). `worktree` isolates a background agent's edits.",
  permission: "read",
  parameters: obj(
    {
      description: { type: "string", description: "short label for the subagent (3-5 words)" },
      prompt: { type: "string", description: "the full instruction for the subagent" },
      subagent_type: { type: "string", description: "agent type to use (e.g. general, explore, plan, review)" },
      background: {
        type: "boolean",
        description: "false (default) = inline, returns the summary; true = detached background agent",
      },
      budget: { type: "string", description: "optional spend cap, e.g. '$0.20' or '50000' tokens" },
      worktree: { type: "string", description: "optional branch/worktree name to isolate a background agent's edits" },
    },
    ["description", "prompt"],
  ),
  async execute() {
    return { output: "agent is handled by the agent runtime." }
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
  agentTool,
  taskCreateTool,
  taskListTool,
  taskStatusTool,
  taskStopTool,
  sendToTaskTool,
  cronCreateTool,
  cronListTool,
  cronDeleteTool,
]
