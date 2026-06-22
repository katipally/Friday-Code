import { obj, type Tool } from "../tool.ts"

export const TASK_CREATE = "task_create"
export const TASK_LIST = "task_list"
export const TASK_STATUS = "task_status"
export const TASK_STOP = "task_stop"
export const SPAWN_AGENTS = "spawn_agents"
export const SEND_TO_TASK = "send_to_task"
export const TASK_BG_TOOLS = new Set([TASK_CREATE, TASK_LIST, TASK_STATUS, TASK_STOP, SPAWN_AGENTS, SEND_TO_TASK])

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
    "Fan out several subtasks as parallel background agents in one call — the coordinator pattern. Each runs independently and returns a task id; collect results later with task_status. Pass `worktree: true` on a job to isolate its edits in a git worktree (recommended when several agents write code at once).",
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
