import fs from "node:fs/promises"
import path from "node:path"
import { obj, type Tool, type ToolResult } from "../tool.ts"

const IGNORE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage)(\/|$)/

export const globTool: Tool = {
  name: "glob",
  description: "Find files matching a glob pattern (e.g. **/*.ts). Returns relative paths.",
  permission: "read",
  parameters: obj(
    {
      pattern: { type: "string", description: "glob pattern" },
      path: { type: "string", description: "base dir (default cwd)" },
    },
    ["pattern"],
  ),
  async execute(input, ctx): Promise<ToolResult> {
    const base = input.path ? (path.isAbsolute(input.path) ? input.path : path.join(ctx.cwd, input.path)) : ctx.cwd
    const results: string[] = []
    try {
      const glob = new Bun.Glob(input.pattern)
      for await (const file of glob.scan({ cwd: base, onlyFiles: true, dot: false })) {
        if (IGNORE.test(file)) continue
        results.push(file)
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
  description: "Search file contents with a regular expression. Returns file:line: matched text.",
  permission: "read",
  parameters: obj(
    {
      pattern: { type: "string", description: "JS regular expression" },
      path: { type: "string", description: "base dir (default cwd)" },
      glob: { type: "string", description: "filter files by glob (default **/*)" },
    },
    ["pattern"],
  ),
  async execute(input, ctx): Promise<ToolResult> {
    const base = input.path ? (path.isAbsolute(input.path) ? input.path : path.join(ctx.cwd, input.path)) : ctx.cwd
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
      for await (const file of glob.scan({ cwd: base, onlyFiles: true, dot: false })) {
        if (IGNORE.test(file)) continue
        if (ctx.signal.aborted) break
        if (++files > 5000) break
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
            out.push(`${file}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`)
            if (out.length >= 100) break
          }
        }
        if (out.length >= 100) break
      }
    } catch (e: any) {
      return { output: `Error: ${e.message}`, isError: true }
    }
    return {
      output: out.length ? out.join("\n") : "(no matches)",
      title: `grep ${input.pattern} (${out.length})`,
    }
  },
}
