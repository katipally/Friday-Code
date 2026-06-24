/**
 * Optional, permission-gated window arrangement (macOS). Friday opens plain OS terminal windows; this
 * lets the user TILE them into a preset layout via AppleScript. It's gated by macOS Automation
 * permission — the first attempt to control Terminal triggers the system prompt; if denied, the caller
 * gets a clear message pointing at System Settings. Everything degrades gracefully (no-op + reason off
 * macOS or without permission), so the base "open a window" path never depends on it.
 */

export type WindowPreset = "grid" | "columns" | "rows" | "cascade" | "stack"

export const WINDOW_PRESETS: { key: WindowPreset; label: string }[] = [
  { key: "grid", label: "grid" },
  { key: "columns", label: "cols" },
  { key: "rows", label: "rows" },
  { key: "cascade", label: "cascade" },
  { key: "stack", label: "stack" },
]

const MENU_BAR = 25 // macOS menu bar height to avoid

function osa(script: string): string | null {
  try {
    const p = Bun.spawnSync(["osascript", "-e", script], { stdout: "pipe", stderr: "pipe" })
    if (!p.success) return null
    return new TextDecoder().decode(p.stdout).trim()
  } catch {
    return null
  }
}

/** Compute {x1,y1,x2,y2} bounds for each of `n` windows under `preset`, within the screen. Exported
 * for testing (the geometry is the only non-trivial part; the AppleScript can't run in CI). */
export function windowLayout(preset: WindowPreset, n: number, w: number, h: number): [number, number, number, number][] {
  const top = MENU_BAR
  const avail = h - top
  const out: [number, number, number, number][] = []
  if (preset === "stack") {
    for (let i = 0; i < n; i++) out.push([0, top, w, h])
    return out
  }
  if (preset === "cascade") {
    const step = 30
    const cw = Math.floor(w * 0.6)
    const ch = Math.floor(avail * 0.7)
    for (let i = 0; i < n; i++) {
      const x = (i * step) % Math.max(1, w - cw)
      const y = top + ((i * step) % Math.max(1, avail - ch))
      out.push([x, y, x + cw, y + ch])
    }
    return out
  }
  let cols: number
  let rows: number
  if (preset === "columns") {
    cols = n
    rows = 1
  } else if (preset === "rows") {
    cols = 1
    rows = n
  } else {
    cols = Math.ceil(Math.sqrt(n))
    rows = Math.ceil(n / cols)
  }
  const cw = Math.floor(w / cols)
  const ch = Math.floor(avail / rows)
  for (let i = 0; i < n; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    const x = c * cw
    const y = top + r * ch
    out.push([x, y, x + cw, y + ch])
  }
  return out
}

/** Tile the open Terminal windows into `preset`. Returns how many were arranged, or a reason it
 * couldn't (off macOS / Automation permission denied / no windows). */
export function arrangeTerminals(preset: WindowPreset): { ok: boolean; count: number; error?: string } {
  if (process.platform !== "darwin") return { ok: false, count: 0, error: "window arrange is macOS-only" }
  const screen = osa('tell application "Finder" to get bounds of window of desktop')
  if (!screen) {
    return {
      ok: false,
      count: 0,
      error: "Automation permission needed — System Settings → Privacy & Security → Automation → enable Terminal",
    }
  }
  const parts = screen.split(",").map((s) => Number.parseInt(s.trim(), 10))
  const w = parts[2] || 1440
  const h = parts[3] || 900
  const idsRaw = osa('tell application "Terminal" to get id of windows')
  if (idsRaw == null) return { ok: false, count: 0, error: "couldn't read Terminal windows (Automation permission?)" }
  const ids = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (!ids.length) return { ok: false, count: 0, error: "no Terminal windows open" }
  const bounds = windowLayout(preset, ids.length, w, h)
  const lines = ids.map((id, i) => `set bounds of window id ${id} to {${bounds[i]!.join(", ")}}`).join("\n")
  const ok = osa(`tell application "Terminal"\n${lines}\nend tell`)
  return ok == null ? { ok: false, count: 0, error: "failed to set window bounds" } : { ok: true, count: ids.length }
}
