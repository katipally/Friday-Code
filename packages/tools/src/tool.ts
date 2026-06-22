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
  /** images to feed BACK to the model in the tool result (e.g. a screenshot) — the vision loop that
   *  lets computer-use actually see the screen. Carried on Anthropic; ignored by providers without
   *  image-in-tool-result support. */
  images?: import("@friday/shared").ImagePart[]
}

export interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
  permission: PermissionCategory
  /** Long-tail tool: its schema is NOT advertised every turn. The model discovers it via `tool_search`,
   * which activates it for the rest of the session. Keeps the always-on tool list lean as tools grow. */
  deferred?: boolean
  execute(input: any, ctx: ToolContext): Promise<ToolResult>
}

export function toToolDef(t: Tool): ToolDef {
  return { name: t.name, description: t.description, parameters: t.parameters }
}

/** JSON-Schema object helper. */
export function obj(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false }
}
