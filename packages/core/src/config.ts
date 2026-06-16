import fs from "node:fs"
import { configPath, fridayDir } from "@friday/providers"
import type { McpServerConfig } from "@friday/mcp"
import type { Effort, ModeId } from "@friday/shared"

export interface FridayConfig {
  providerId?: string
  model?: string
  /** whether the selected model exposes a reasoning channel (gates reasoning_effort) */
  reasoning?: boolean
  effort?: Effort
  mode?: ModeId
  mcp?: Record<string, McpServerConfig>
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
