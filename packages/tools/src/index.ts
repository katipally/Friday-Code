import type { ToolDef } from "@friday/shared"
import { toToolDef, type Tool } from "./tool.ts"
import { editTool, lsTool, multiEditTool, readTool, writeTool } from "./builtin/file.ts"
import { applyPatchTool } from "./builtin/patch.ts"
import { globTool, grepTool } from "./builtin/search.ts"
import { bashTool } from "./builtin/bash.ts"
import { webfetchTool, websearchTool } from "./builtin/web.ts"
import { askUserTool } from "./builtin/ask.ts"
import { skillTool, taskTool, todoWriteTool } from "./builtin/agent.ts"
import { exitPlanTool } from "./builtin/plan.ts"
import { lspHoverTool, lspDefinitionTool, lspSymbolsTool } from "./builtin/lsp.ts"
import { toolSearchTool } from "./builtin/toolsearch.ts"
import { TASK_BG_TOOL_LIST } from "./builtin/tasks.ts"
import { WORKTREE_TOOL_LIST } from "./builtin/worktree.ts"
import { memoryTool } from "./builtin/memory.ts"
import { notebookEditTool } from "./builtin/notebook.ts"

export * from "./tool.ts"
export * from "./diff.ts"
export { ASK_USER } from "./builtin/ask.ts"
export { SKILL_TOOL, TASK_TOOL, TODO_WRITE } from "./builtin/agent.ts"
export { EXIT_PLAN } from "./builtin/plan.ts"
export { LSP_HOVER, LSP_DEFINITION, LSP_SYMBOLS, LSP_TOOLS } from "./builtin/lsp.ts"
export { TOOL_SEARCH, searchTools } from "./builtin/toolsearch.ts"
export { TASK_CREATE, TASK_LIST, TASK_STATUS, TASK_STOP, TASK_BG_TOOLS, CRON_CREATE, CRON_LIST, CRON_DELETE, CRON_TOOLS } from "./builtin/tasks.ts"
export { ENTER_WORKTREE, EXIT_WORKTREE, WORKTREE_LIST, WORKTREE_TOOLS } from "./builtin/worktree.ts"
export { MEMORY_TOOL } from "./builtin/memory.ts"

export const BUILTIN_TOOLS: Tool[] = [
  readTool,
  writeTool,
  editTool,
  multiEditTool,
  applyPatchTool,
  lsTool,
  globTool,
  grepTool,
  bashTool,
  webfetchTool,
  websearchTool,
  askUserTool,
  skillTool,
  taskTool,
  todoWriteTool,
  exitPlanTool,
  lspHoverTool,
  lspDefinitionTool,
  lspSymbolsTool,
  toolSearchTool,
  ...TASK_BG_TOOL_LIST,
  ...WORKTREE_TOOL_LIST,
  memoryTool,
  notebookEditTool,
]

export function buildRegistry(tools: Tool[] = BUILTIN_TOOLS): {
  list: Tool[]
  defs: ToolDef[]
  get(name: string): Tool | undefined
} {
  const byName = new Map(tools.map((t) => [t.name, t]))
  return {
    list: tools,
    defs: tools.map(toToolDef),
    get: (name) => byName.get(name),
  }
}
