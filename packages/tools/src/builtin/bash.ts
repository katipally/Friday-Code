import { obj, type Tool, type ToolResult } from "../tool.ts"

const MAX_OUTPUT = 30_000

export const bashTool: Tool = {
  name: "bash",
  description:
    "Run a shell command in the project directory and return combined stdout+stderr. Prefer the dedicated read/edit/glob/grep tools when possible.",
  permission: "bash",
  parameters: obj(
    {
      command: { type: "string", description: "the shell command" },
      timeout: { type: "number", description: "ms before kill (default 120000)" },
    },
    ["command"],
  ),
  async execute(input, ctx): Promise<ToolResult> {
    const timeout = Math.min(input.timeout ?? 120_000, 600_000)
    const proc = Bun.spawn(["bash", "-lc", input.command], {
      cwd: ctx.cwd,
      stdout: "pipe",
      stderr: "pipe",
      signal: ctx.signal,
    })

    const killer = setTimeout(() => proc.kill(), timeout)
    let stdout = ""
    let stderr = ""
    try {
      ;[stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      await proc.exited
    } catch (e: any) {
      return { output: `Error: ${e.message}`, isError: true, title: `bash` }
    } finally {
      clearTimeout(killer)
    }

    const code = proc.exitCode ?? 0
    let combined = [stdout, stderr].filter(Boolean).join("\n").trim()
    if (combined.length > MAX_OUTPUT) combined = combined.slice(0, MAX_OUTPUT) + "\n… (truncated)"
    const head = input.command.length > 40 ? input.command.slice(0, 40) + "…" : input.command
    return {
      output: combined || `(no output, exit ${code})`,
      isError: code !== 0,
      title: `bash: ${head}${code !== 0 ? ` (exit ${code})` : ""}`,
    }
  },
}
