import fs from "node:fs"
import path from "node:path"
import type { McpServerConfig } from "@friday/mcp"
import { configPath, fridayDir, projectConfigPath, projectLocalConfigPath } from "@friday/providers"
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
  /** model ids spawned agents may draw from (per-agent def.model wins; else first pool entry). */
  modelPool?: string[]
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
  /** newest version seen by a background check — lets the next reopen auto-update instantly */
  latestKnown?: string
  /** fraction of the context window at which the chat auto-compacts (0–1, default 0.85) */
  autoCompactThreshold?: number
}

/** Read & parse one JSON config file; missing/invalid files contribute nothing. */
function readLayer(file: string): Partial<FridayConfig> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

/** Deep-merge plain objects (later wins); arrays and scalars are replaced, not concatenated. */
function deepMerge<T>(base: T, over: Partial<T>): T {
  const out: any = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue
    const b = (out as any)[k]
    out[k] =
      b && v && typeof b === "object" && typeof v === "object" && !Array.isArray(b) && !Array.isArray(v)
        ? deepMerge(b, v)
        : v
  }
  return out
}

/**
 * Resolved config, layered like Claude Code: user (~/.friday/config.json) → project
 * (.friday/settings.json, committed) → project-local (.friday/settings.local.json, gitignored).
 * Later layers win; nested objects deep-merge so a project can override one key without dropping the
 * rest. `cwd` defaults to the process cwd (the project root friday runs in).
 */
export function loadConfig(cwd: string = process.cwd()): FridayConfig {
  let cfg = readLayer(configPath()) as FridayConfig
  cfg = deepMerge(cfg, readLayer(projectConfigPath(cwd)))
  cfg = deepMerge(cfg, readLayer(projectLocalConfigPath(cwd)))
  return cfg
}

/**
 * Persist a patch. Writes to the USER config by default (the resolved view still layers project files
 * on top at read time). Pass scope "project"/"local" to write the committed/gitignored project file.
 */
export function saveConfig(patch: Partial<FridayConfig>, scope: "user" | "project" | "local" = "user"): FridayConfig {
  const file = scope === "project" ? projectConfigPath() : scope === "local" ? projectLocalConfigPath() : configPath()
  const next = { ...readLayer(file), ...patch }
  try {
    fs.mkdirSync(scope === "user" ? fridayDir() : path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(next, null, 2))
  } catch {
    /* ignore */
  }
  return loadConfig()
}
