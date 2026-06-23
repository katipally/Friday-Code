import fs from "node:fs"
import type { McpServerConfig } from "@friday/mcp"
import { configPath, fridayDir } from "@friday/providers"
import type { Effort, ModeId } from "@friday/shared"
import type { HooksConfig } from "./hooks.ts"
import type { MicConfig } from "./mic.ts"

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
  /** output verbosity overlay for the system prompt: "concise" (default) | "explanatory" | "minimal" */
  outputStyle?: string
  /** auto-format touched files after edit/write; false disables. Default: auto-detect. */
  formatter?: boolean
  /** browser automation: override the binary, CDP port, or profile dir (defaults: auto-detect, 9333, ~/.friday/chrome-profile) */
  browser?: { binary?: string; port?: number; userDataDir?: string }
  /** mic input (on-device speech-to-text): recorder/model overrides */
  voice?: MicConfig
  /** directories the user has granted Friday access to (shown the trust prompt only once each) */
  trustedRoots?: string[]
  /** which key inserts a newline in the composer (Enter always submits): "shift" | "alt" | "both" (default) */
  composerNewline?: "shift" | "alt" | "both"
  /** version-update behavior: "notify" (default) checks npm + shows a modal when newer; "off" disables */
  autoupdate?: "notify" | "off"
  /** epoch ms of the last update check — throttles the startup check to once/day */
  lastUpdateCheck?: number
  /** fraction of the context window at which the chat auto-compacts (0–1, default 0.85) */
  autoCompactThreshold?: number
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
