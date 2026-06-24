import { spawn } from "node:child_process"
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
  execute(input, ctx): Promise<ToolResult> {
    const timeout = Math.min(input.timeout ?? 120_000, 600_000)
    // `detached: true` makes bash a process-GROUP leader (setsid), so killing the negative pid takes
    // down the whole tree — any dev server / watcher / npm the command forks dies with it. Without
    // this, aborting the agent killed only the bash shell and orphaned its children (the CPU leak that
    // kept "running" after Friday closed). Falls back to a plain kill if the group kill isn't permitted.
    const child = spawn("bash", ["-lc", input.command], { cwd: ctx.cwd, detached: true })
    const killTree = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig)
        else child.kill(sig)
      } catch {
        try {
          child.kill(sig)
        } catch {
          /* already gone */
        }
      }
    }

    return new Promise<ToolResult>((resolve) => {
      let stdout = ""
      let stderr = ""
      let settled = false
      const onAbort = () => killTree("SIGTERM")
      const killer = setTimeout(() => killTree("SIGKILL"), timeout)
      ctx.signal?.addEventListener("abort", onAbort, { once: true })

      const finish = (code: number, errMsg?: string) => {
        if (settled) return
        settled = true
        clearTimeout(killer)
        ctx.signal?.removeEventListener("abort", onAbort)
        if (errMsg) return resolve({ output: `Error: ${errMsg}`, isError: true, title: "bash" })
        let combined = [stdout, stderr].filter(Boolean).join("\n").trim()
        if (combined.length > MAX_OUTPUT) combined = `${combined.slice(0, MAX_OUTPUT)}\n… (truncated)`
        const head = input.command.length > 40 ? `${input.command.slice(0, 40)}…` : input.command
        resolve({
          output: combined || `(no output, exit ${code})`,
          isError: code !== 0,
          title: `bash: ${head}${code !== 0 ? ` (exit ${code})` : ""}`,
        })
      }

      // If the run was already aborted before we got here, stop immediately.
      if (ctx.signal?.aborted) {
        killTree("SIGTERM")
        return finish(130, "aborted")
      }
      child.stdout?.on("data", (d) => {
        stdout += d
      })
      child.stderr?.on("data", (d) => {
        stderr += d
      })
      child.on("error", (e) => finish(1, e.message))
      child.on("close", (code) => finish(code ?? 0))
    })
  },
}
