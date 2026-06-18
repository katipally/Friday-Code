/**
 * Lightweight recurring schedules persisted at ~/.friday/cron.json. The engine runs an in-process
 * ticker (only while the app is open — no daemon) that fires due jobs as background tasks. Intervals
 * are simple human strings: "30s", "5m", "2h", "1d", or "hourly"/"daily".
 */
import fs from "node:fs"
import path from "node:path"
import { fridayDir } from "@friday/providers"

export type CronJob = { id: string; description: string; prompt: string; everyMs: number; nextRun: number }

function cronFile(): string {
  return path.join(fridayDir(), "cron.json")
}

export function loadCron(): CronJob[] {
  try {
    const v = JSON.parse(fs.readFileSync(cronFile(), "utf8"))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function saveCron(jobs: CronJob[]): void {
  try {
    fs.mkdirSync(fridayDir(), { recursive: true })
    fs.writeFileSync(cronFile(), JSON.stringify(jobs, null, 2))
  } catch {
    /* best-effort */
  }
}

/** Parse an interval string to milliseconds, or null if unrecognized. */
export function parseInterval(s: string): number | null {
  const t = s.trim().toLowerCase()
  if (t === "hourly") return 3_600_000
  if (t === "daily") return 86_400_000
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(t)
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2]
  if (!n) return null
  return n * (unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000)
}
