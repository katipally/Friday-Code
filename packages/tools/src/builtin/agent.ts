import { obj, type Tool } from "../tool.ts"

export const SKILL_TOOL = "skill"
export const TASK_TOOL = "task"

/** Both tools are handled specially by the engine; `execute` is never called. */

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

export const taskTool: Tool = {
  name: TASK_TOOL,
  description:
    "Spawn a focused, read-only sub-agent to research the codebase (search + read many files) and return a concise summary. Use for broad exploration so the main thread stays focused.",
  permission: "read",
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
