import fs from "node:fs/promises"
import path from "node:path"
import { obj, type Tool, type ToolContext, type ToolResult } from "../tool.ts"
import { diffStats, unifiedDiff } from "../diff.ts"
import { replaceInContent } from "./editStrategies.ts"

function resolve(ctx: ToolContext, p: string): string {
  return path.isAbsolute(p) ? p : path.join(ctx.cwd, p)
}

function rel(ctx: ToolContext, p: string): string {
  const r = path.relative(ctx.cwd, p)
  return r.startsWith("..") ? p : r
}

async function readFileOr(p: string, fallback = ""): Promise<string> {
  try {
    return await fs.readFile(p, "utf8")
  } catch {
    return fallback
  }
}

export const readTool: Tool = {
  name: "read",
  description:
    "Read a file from the filesystem. Returns the contents with 1-based line numbers. Use offset/limit for large files.",
  permission: "read",
  parameters: obj(
    {
      path: { type: "string", description: "File path (absolute or relative to cwd)" },
      offset: { type: "number", description: "1-based start line" },
      limit: { type: "number", description: "max lines to read (default 2000)" },
    },
    ["path"],
  ),
  async execute(input, ctx): Promise<ToolResult> {
    const full = resolve(ctx, input.path)
    let content: string
    try {
      content = await fs.readFile(full, "utf8")
    } catch (e: any) {
      return { output: `Error: cannot read ${input.path}: ${e.message}`, isError: true }
    }
    const lines = content.split("\n")
    const start = Math.max(1, input.offset ?? 1)
    const limit = input.limit ?? 2000
    const slice = lines.slice(start - 1, start - 1 + limit)
    const width = String(start + slice.length - 1).length
    const body = slice.map((l, i) => `${String(start + i).padStart(width)}  ${l}`).join("\n")
    const more = lines.length > start - 1 + limit ? `\n… (${lines.length} lines total)` : ""
    return { output: body + more, title: `read ${rel(ctx, full)}` }
  },
}

export const writeTool: Tool = {
  name: "write",
  description: "Write (create or overwrite) a file with the given content. Creates parent dirs.",
  permission: "edit",
  parameters: obj(
    {
      path: { type: "string", description: "File path" },
      content: { type: "string", description: "Full file content" },
    },
    ["path", "content"],
  ),
  async execute(input, ctx): Promise<ToolResult> {
    const full = resolve(ctx, input.path)
    const old = await readFileOr(full)
    try {
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, input.content, "utf8")
    } catch (e: any) {
      return { output: `Error: cannot write ${input.path}: ${e.message}`, isError: true }
    }
    const diff = unifiedDiff(old, input.content)
    const { added, removed } = diffStats(diff)
    return {
      output: `Wrote ${rel(ctx, full)} (${old ? "overwrote" : "created"}, +${added} -${removed})`,
      title: `write ${rel(ctx, full)} (+${added} -${removed})`,
      diff,
    }
  },
}

/** Replace via the multi-strategy matcher: exact first, then whitespace/indent-tolerant fallbacks so
 * a slightly-drifted old_string still applies instead of hard-failing. */
function applyEdit(content: string, oldStr: string, newStr: string, replaceAll: boolean): string {
  return replaceInContent(content, oldStr, newStr, replaceAll)
}

export const editTool: Tool = {
  name: "edit",
  description:
    "Replace a string in a file. old_string should match exactly and be unique unless replace_all is true; minor whitespace/indentation drift is tolerated automatically.",
  permission: "edit",
  parameters: obj(
    {
      path: { type: "string" },
      old_string: { type: "string", description: "exact text to replace" },
      new_string: { type: "string", description: "replacement text" },
      replace_all: { type: "boolean", description: "replace every occurrence" },
    },
    ["path", "old_string", "new_string"],
  ),
  async execute(input, ctx): Promise<ToolResult> {
    const full = resolve(ctx, input.path)
    const old = await readFileOr(full, "\0missing")
    if (old === "\0missing") return { output: `Error: ${input.path} does not exist`, isError: true }
    let next: string
    try {
      next = applyEdit(old, input.old_string, input.new_string, !!input.replace_all)
    } catch (e: any) {
      return { output: `Error: ${e.message}`, isError: true }
    }
    await fs.writeFile(full, next, "utf8")
    const diff = unifiedDiff(old, next)
    const { added, removed } = diffStats(diff)
    return { output: `Edited ${rel(ctx, full)} (+${added} -${removed})`, title: `edit ${rel(ctx, full)} (+${added} -${removed})`, diff }
  },
}

export const multiEditTool: Tool = {
  name: "multi_edit",
  description: "Apply multiple exact-string edits to one file, in order, atomically.",
  permission: "edit",
  parameters: obj(
    {
      path: { type: "string" },
      edits: {
        type: "array",
        items: obj(
          {
            old_string: { type: "string" },
            new_string: { type: "string" },
            replace_all: { type: "boolean" },
          },
          ["old_string", "new_string"],
        ),
      },
    },
    ["path", "edits"],
  ),
  async execute(input, ctx): Promise<ToolResult> {
    const full = resolve(ctx, input.path)
    const old = await readFileOr(full, "\0missing")
    if (old === "\0missing") return { output: `Error: ${input.path} does not exist`, isError: true }
    let next = old
    try {
      for (const e of input.edits ?? []) next = applyEdit(next, e.old_string, e.new_string, !!e.replace_all)
    } catch (e: any) {
      return { output: `Error: ${e.message}`, isError: true }
    }
    await fs.writeFile(full, next, "utf8")
    const diff = unifiedDiff(old, next)
    const { added, removed } = diffStats(diff)
    return {
      output: `Applied ${input.edits?.length ?? 0} edits to ${rel(ctx, full)} (+${added} -${removed})`,
      title: `multi_edit ${rel(ctx, full)} (+${added} -${removed})`,
      diff,
    }
  },
}

export const lsTool: Tool = {
  name: "ls",
  description: "List the entries of a directory (directories first).",
  permission: "read",
  parameters: obj({ path: { type: "string", description: "directory (default cwd)" } }),
  async execute(input, ctx): Promise<ToolResult> {
    const full = resolve(ctx, input.path ?? ".")
    let entries: import("node:fs").Dirent[]
    try {
      entries = await fs.readdir(full, { withFileTypes: true })
    } catch (e: any) {
      return { output: `Error: ${e.message}`, isError: true }
    }
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name + "/")
    const files = entries.filter((e) => !e.isDirectory()).map((e) => e.name)
    dirs.sort()
    files.sort()
    const lines = [...dirs, ...files]
    return { output: lines.join("\n") || "(empty)", title: `ls ${rel(ctx, full) || "."}` }
  },
}
