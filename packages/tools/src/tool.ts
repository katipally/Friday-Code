import type { PermissionCategory, ToolDef } from "@friday/shared"

export interface ToolContext {
  /** primary working directory (= roots[0]) */
  cwd: string
  /** all workspace roots; search tools span these */
  roots: string[]
  signal: AbortSignal
}

export interface ToolResult {
  output: string
  isError?: boolean
  /** short label for the tool card, e.g. "edit src/app.ts (+4 -1)" */
  title?: string
  /** unified diff for edit-like tools */
  diff?: string
}

export interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
  permission: PermissionCategory
  execute(input: any, ctx: ToolContext): Promise<ToolResult>
}

export function toToolDef(t: Tool): ToolDef {
  return { name: t.name, description: t.description, parameters: t.parameters }
}

/** JSON-Schema object helper. */
export function obj(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false }
}
