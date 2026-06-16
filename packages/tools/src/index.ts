import type { ToolDef } from "@friday/shared"
import { toToolDef, type Tool } from "./tool.ts"
import { editTool, lsTool, multiEditTool, readTool, writeTool } from "./builtin/file.ts"
import { globTool, grepTool } from "./builtin/search.ts"
import { bashTool } from "./builtin/bash.ts"
import { webfetchTool, websearchTool } from "./builtin/web.ts"
import { askUserTool } from "./builtin/ask.ts"

export * from "./tool.ts"
export * from "./diff.ts"
export { ASK_USER } from "./builtin/ask.ts"

export const BUILTIN_TOOLS: Tool[] = [
  readTool,
  writeTool,
  editTool,
  multiEditTool,
  lsTool,
  globTool,
  grepTool,
  bashTool,
  webfetchTool,
  websearchTool,
  askUserTool,
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
