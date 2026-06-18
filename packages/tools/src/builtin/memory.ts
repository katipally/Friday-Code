import { obj, type Tool } from "../tool.ts"

export const MEMORY_TOOL = "memory"

// Handled by the runner (writes to the shared memory store); body is a safe fallback.
export const memoryTool: Tool = {
  name: MEMORY_TOOL,
  description:
    "Remember a durable fact across sessions (user preference, project convention) or list/forget them. Saved memories are injected into future sessions automatically. action: save | list | delete.",
  permission: "read",
  deferred: true,
  parameters: obj(
    {
      action: { type: "string", enum: ["save", "list", "delete"], description: "save, list, or delete" },
      name: { type: "string", description: "short title (required for save/delete)" },
      content: { type: "string", description: "the fact to remember (required for save)" },
    },
    ["action"],
  ),
  async execute() {
    return { output: "memory is handled by the agent runtime." }
  },
}
