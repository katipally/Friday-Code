/**
 * Lifecycle hooks — deterministic shell scripts run at defined points (Claude-Code parity).
 * Configured under `hooks` in ~/.friday/config.json:
 *
 *   "hooks": {
 *     "PreToolUse":  [{ "matcher": "bash|write", "command": "./gate.sh" }],
 *     "PostToolUse": [{ "command": "prettier --write $FILE" }],
 *     "UserPromptSubmit": [{ "command": "./inject-context.sh" }],
 *     "Stop": [{ "command": "say done" }]
 *   }
 *
 * Each hook receives a JSON payload on stdin and may emit JSON on stdout:
 *   { "decision": "block", "reason": "...", "additionalContext": "...", "input": {...} }
 * For PreToolUse, a non-zero exit also blocks the tool.
 */
export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Stop"
  | "SessionStart"
  | "SubagentStop"
  | "PreCompact"
  | "Notification"

export interface HookSpec {
  /** regex matched against the tool name (PreToolUse/PostToolUse). Omit/"*" = all. */
  matcher?: string
  /** shell command to run */
  command: string
}
export type HooksConfig = Partial<Record<HookEvent, HookSpec[]>>

export interface HookPayload {
  event: HookEvent
  session_id: string
  cwd: string
  tool_name?: string
  tool_input?: unknown
  tool_response?: unknown
  prompt?: string
  message?: string
}

export interface HookOutcome {
  block: boolean
  reason?: string
  /** text to inject (UserPromptSubmit) or surface */
  context: string
  /** optional replacement tool input (PreToolUse) */
  input?: unknown
}

function matches(spec: HookSpec, key?: string): boolean {
  if (!spec.matcher || spec.matcher === "*") return true
  if (key == null) return false
  try {
    return new RegExp(spec.matcher).test(key)
  } catch {
    return spec.matcher === key
  }
}

/** Run all hooks registered for `event` (filtered by `matchKey`) and aggregate their outcome. */
export async function runHooks(event: HookEvent, hooks: HooksConfig | undefined, payload: HookPayload, matchKey?: string): Promise<HookOutcome> {
  const specs = (hooks?.[event] ?? []).filter((h) => matches(h, matchKey))
  const out: HookOutcome = { block: false, context: "" }
  for (const spec of specs) {
    try {
      const proc = Bun.spawn(["sh", "-c", spec.command], { cwd: payload.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
      proc.stdin.write(JSON.stringify(payload))
      proc.stdin.end()
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      let json: any
      try {
        json = stdout.trim() ? JSON.parse(stdout) : undefined
      } catch {
        json = undefined
      }
      if (json?.decision === "block") {
        out.block = true
        out.reason = json.reason ?? out.reason
      } else if (event === "PreToolUse" && code !== 0) {
        out.block = true
        out.reason = stderr.trim() || out.reason || `hook exited ${code}`
      }
      const ctx = json?.additionalContext ?? (!json && event === "UserPromptSubmit" ? stdout.trim() : "")
      if (ctx) out.context += (out.context ? "\n" : "") + ctx
      if (json?.input !== undefined) out.input = json.input
    } catch {
      /* a broken hook never breaks the run */
    }
  }
  return out
}
