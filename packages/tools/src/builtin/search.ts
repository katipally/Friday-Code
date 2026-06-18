import fs from "node:fs/promises"
import path from "node:path"
import { obj, type Tool, type ToolContext, type ToolResult } from "../tool.ts"

const IGNORE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage)(\/|$)/

/** Display a file (found under `root`) as a path relative to the primary cwd. */
function display(ctx: ToolContext, root: string, file: string): string {
  const abs = path.join(root, file)
  const rel = path.relative(ctx.cwd, abs)
  return rel && !rel.startsWith("..") ? rel : abs
}

/** Roots to search: explicit `path` arg (single) or all workspace roots. */
function searchRoots(ctx: ToolContext, p?: string): string[] {
  if (p) return [path.isAbsolute(p) ? p : path.join(ctx.cwd, p)]
  return ctx.roots.length ? ctx.roots : [ctx.cwd]
}

export const globTool: Tool = {
  name: "glob",
  description: "Find files matching a glob pattern (e.g. **/*.ts) across all workspace roots. Returns paths.",
  permission: "read",
  parameters: obj(
    {
      pattern: { type: "string", description: "glob pattern" },
      path: { type: "string", description: "limit to this base dir (default: all roots)" },
    },
    ["pattern"],
  ),
  async execute(input, ctx): Promise<ToolResult> {
    const results: string[] = []
    try {
      const glob = new Bun.Glob(input.pattern)
      for (const base of searchRoots(ctx, input.path)) {
        for await (const file of glob.scan({ cwd: base, onlyFiles: true, dot: false })) {
          if (IGNORE.test(file)) continue
          results.push(display(ctx, base, file))
          if (results.length >= 300) break
        }
        if (results.length >= 300) break
      }
    } catch (e: any) {
      return { output: `Error: ${e.message}`, isError: true }
    }
    results.sort()
    return {
      output: results.length ? results.join("\n") : "(no matches)",
      title: `glob ${input.pattern} (${results.length})`,
    }
  },
}

export const grepTool: Tool = {
  name: "grep",
  description: "Search file contents with a regular expression across all workspace roots. Returns file:line: match.",
  permission: "read",
  parameters: obj(
    {
      pattern: { type: "string", description: "JS regular expression" },
      path: { type: "string", description: "limit to this base dir (default: all roots)" },
      glob: { type: "string", description: "filter files by glob (default **/*)" },
    },
    ["pattern"],
  ),
  async execute(input, ctx): Promise<ToolResult> {
    let re: RegExp
    try {
      re = new RegExp(input.pattern)
    } catch (e: any) {
      return { output: `Error: invalid regex: ${e.message}`, isError: true }
    }
    const out: string[] = []
    let files = 0
    try {
      const glob = new Bun.Glob(input.glob ?? "**/*")
      outer: for (const base of searchRoots(ctx, input.path)) {
        for await (const file of glob.scan({ cwd: base, onlyFiles: true, dot: false })) {
          if (IGNORE.test(file)) continue
          if (ctx.signal.aborted) break outer
          if (++files > 5000) break outer
          const full = path.join(base, file)
          let content: string
          try {
            const stat = await fs.stat(full)
            if (stat.size > 1_000_000) continue
            content = await fs.readFile(full, "utf8")
          } catch {
            continue
          }
          const lines = content.split("\n")
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i]!)) {
              out.push(`${display(ctx, base, file)}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`)
              if (out.length >= 100) break outer
            }
          }
        }
      }
    } catch (e: any) {
      return { output: `Error: ${e.message}`, isError: true }
    }
    return { output: out.length ? out.join("\n") : "(no matches)", title: `grep ${input.pattern} (${out.length})` }
  },
}
