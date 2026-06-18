import fs from "node:fs"
import type { McpServerConfig } from "@friday/mcp"
import { configPath, fridayDir } from "@friday/providers"
import type { Effort, ModeId } from "@friday/shared"
import type { HooksConfig } from "./hooks.ts"

export interface FridayConfig {
  providerId?: string
  model?: string
  /** whether the selected model exposes a reasoning channel (gates reasoning_effort) */
  reasoning?: boolean
  effort?: Effort
  mode?: ModeId
  mcp?: Record<string, McpServerConfig>
  /** context window (tokens) of the selected model — drives auto-compaction */
  contextWindow?: number
  /** USD per 1M tokens for the selected model — drives the cost meter */
  cost?: { input: number; output: number }
  /** lifecycle hooks (deterministic scripts) */
  hooks?: HooksConfig
  /** bash command allow/deny lists (prefix or `*` glob) */
  bash?: { allow?: string[]; deny?: string[] }
  /** named UI theme (see @friday/shared THEMES); applied at startup */
  theme?: string
  /** optional per-session budget; the context panel warns when usage exceeds it */
  budget?: { tokens?: number; usd?: number }
}

export function loadConfig(): FridayConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"))
  } catch {
    return {}
  }
}

export function saveConfig(patch: Partial<FridayConfig>): FridayConfig {
  const next = { ...loadConfig(), ...patch }
  try {
    fs.mkdirSync(fridayDir(), { recursive: true })
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2))
  } catch {
    /* ignore */
  }
  return next
}
