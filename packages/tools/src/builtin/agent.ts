import { obj, type Tool } from "../tool.ts"

export const SKILL_TOOL = "skill"
export const TASK_TOOL = "task"
export const TODO_WRITE = "todo_write"

/** These tools are handled specially by the engine; `execute` is never called. */

export const skillTool: Tool = {
  name: SKILL_TOOL,
  description:
    "Load a skill's instructions into context. Call this when one of the listed skills matches the task at hand.",
  permission: "read",
  parameters: obj({ name: { type: "string", description: "the skill name" } }, ["name"]),
  async execute() {
    return { output: "" }
  },
}

export const todoWriteTool: Tool = {
  name: TODO_WRITE,
  description:
    "Maintain a visible task list for multi-step work. Pass the FULL list every call — it replaces the previous list. Keep exactly one item 'active' while you work it, mark it 'done' when finished, and add new items as they emerge. Use this for any task with 3+ steps so the user can follow along.",
  permission: "read",
  parameters: obj(
    {
      todos: {
        type: "array",
        description: "the complete, ordered task list",
        items: obj(
          {
            text: { type: "string", description: "short imperative task description" },
            status: { type: "string", enum: ["pending", "active", "done"], description: "current state" },
          },
          ["text", "status"],
        ),
      },
    },
    ["todos"],
  ),
  async execute() {
    return { output: "" }
  },
}

export const taskTool: Tool = {
  name: TASK_TOOL,
  description:
    "Alias of delegate (inline read-only sub-agent). Prefer delegate({ prompt }). Spawns a focused, read-only sub-agent to research the codebase and return a concise summary.",
  permission: "read",
  deferred: true,
  parameters: obj(
    {
      description: { type: "string", description: "short label for the subtask" },
      prompt: { type: "string", description: "the full instruction for the sub-agent" },
      agent: { type: "string", description: "agent type: general | explore" },
    },
    ["description", "prompt"],
  ),
  async execute() {
    return { output: "" }
  },
}
