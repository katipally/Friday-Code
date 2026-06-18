import { obj, type Tool } from "../tool.ts"

export const ENTER_WORKTREE = "enter_worktree"
export const EXIT_WORKTREE = "exit_worktree"
export const WORKTREE_LIST = "worktree_list"
export const WORKTREE_TOOLS = new Set([ENTER_WORKTREE, EXIT_WORKTREE, WORKTREE_LIST])

// Handled by the runner (they switch the session's working directory); bodies are safe fallbacks.

export const enterWorktreeTool: Tool = {
  name: ENTER_WORKTREE,
  description:
    "Create (or reuse) a git worktree on a branch and switch this session into it, so edits/bash run in an isolated checkout. Use for risky or parallel changes you want kept off the main branch.",
  permission: "bash",
  deferred: true,
  parameters: obj({ name: { type: "string", description: "branch / worktree name, e.g. 'feature-x'" } }, ["name"]),
  async execute() {
    return { output: "enter_worktree is handled by the agent runtime." }
  },
}

export const exitWorktreeTool: Tool = {
  name: EXIT_WORKTREE,
  description: "Leave the current git worktree and switch this session back to the original working directory.",
  permission: "bash",
  deferred: true,
  parameters: obj({}),
  async execute() {
    return { output: "exit_worktree is handled by the agent runtime." }
  },
}

export const worktreeListTool: Tool = {
  name: WORKTREE_LIST,
  description: "List the git worktrees for this repository.",
  permission: "read",
  deferred: true,
  parameters: obj({}),
  async execute() {
    return { output: "worktree_list is handled by the agent runtime." }
  },
}

export const WORKTREE_TOOL_LIST: Tool[] = [enterWorktreeTool, exitWorktreeTool, worktreeListTool]
