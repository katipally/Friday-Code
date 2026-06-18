import fs from "node:fs/promises"
import path from "node:path"
import { obj, type Tool, type ToolContext, type ToolResult } from "../tool.ts"

type Cell = {
  cell_type: string
  source: string[]
  metadata?: Record<string, unknown>
  outputs?: unknown[]
  execution_count?: number | null
}

function toSource(s: string): string[] {
  // Jupyter stores source as an array of lines, each keeping its trailing newline except the last.
  const lines = s.split("\n")
  return lines.map((l, i) => (i < lines.length - 1 ? `${l}\n` : l))
}

export const notebookEditTool: Tool = {
  name: "notebook_edit",
  description:
    "Edit a Jupyter notebook (.ipynb) by cell. action: edit (replace a cell's source), insert (add a cell), or delete (remove a cell). Cells are 0-indexed.",
  permission: "edit",
  deferred: true,
  parameters: obj(
    {
      path: { type: "string", description: "path to the .ipynb file" },
      action: { type: "string", enum: ["edit", "insert", "delete"], description: "edit | insert | delete" },
      cell: { type: "number", description: "0-based cell index (target for edit/delete; insert position)" },
      cell_type: { type: "string", enum: ["code", "markdown"], description: "for insert (default code)" },
      source: { type: "string", description: "new cell source (for edit/insert)" },
    },
    ["path", "action"],
  ),
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const full = path.isAbsolute(input.path) ? input.path : path.join(ctx.cwd, input.path)
    let nb: { cells?: Cell[] } & Record<string, unknown>
    try {
      nb = JSON.parse(await fs.readFile(full, "utf8"))
    } catch (e: any) {
      return { output: `Error: cannot read notebook ${input.path}: ${e.message}`, isError: true }
    }
    if (!Array.isArray(nb.cells)) return { output: "Error: not a valid notebook (no cells array)", isError: true }
    const cells = nb.cells
    const idx = input.cell ?? 0

    if (input.action === "edit") {
      if (idx < 0 || idx >= cells.length)
        return { output: `Error: cell ${idx} out of range (0..${cells.length - 1})`, isError: true }
      cells[idx]!.source = toSource(String(input.source ?? ""))
      if (cells[idx]!.cell_type === "code") cells[idx]!.outputs = []
    } else if (input.action === "insert") {
      const cell: Cell = {
        cell_type: input.cell_type === "markdown" ? "markdown" : "code",
        source: toSource(String(input.source ?? "")),
        metadata: {},
        ...(input.cell_type === "markdown" ? {} : { outputs: [], execution_count: null }),
      }
      cells.splice(Math.max(0, Math.min(idx, cells.length)), 0, cell)
    } else if (input.action === "delete") {
      if (idx < 0 || idx >= cells.length) return { output: `Error: cell ${idx} out of range`, isError: true }
      cells.splice(idx, 1)
    } else {
      return { output: `Error: unknown action ${input.action}`, isError: true }
    }

    try {
      await fs.writeFile(full, `${JSON.stringify(nb, null, 1)}\n`)
    } catch (e: any) {
      return { output: `Error: cannot write notebook: ${e.message}`, isError: true }
    }
    return {
      output: `Notebook ${input.action} on cell ${idx} (${cells.length} cells)`,
      title: `notebook_edit ${path.basename(full)}`,
    }
  },
}
