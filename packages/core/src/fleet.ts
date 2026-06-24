/**
 * Direct OS terminal windows — Friday opens a real, separate terminal window per chat/session/agent so
 * the main view stays put. No tmux: the user wants direct device control. Two flavors:
 *   - INTERACTIVE  → `friday [args]` you can type in (new chat / resumed session).
 *   - WATCH        → `friday attach <id>`, a read-only tail of a background agent's transcript.
 *
 * macOS opens a temp .command file with `open` (no Automation/AppleScript permission needed — that was
 * why windows silently failed or opened blank behind the editor); Linux uses the common emulators.
 * Unknown env degrades to "none" so the caller can fall back to the in-TUI view rather than guessing.
 *
 * Failures are never swallowed: `run()` captures stderr and every result carries an `error` string so
 * the dashboard can tell the user WHY a window didn't open instead of a generic "no backend".
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Reconstruct how to launch friday itself, as an ABSOLUTE command that survives a fresh shell with a
 * different PATH (the usual reason a launched window opened then immediately died: bare `friday` not
 * found). Dev: `<runtime> <abs script>`; compiled: the resolved binary (process.execPath), falling
 * back to `friday` on PATH only as a last resort.
 */
function selfCmd(): string[] {
  const a1 = process.argv[1]
  if (a1 && /\.(tsx?|jsx?|mjs)$/.test(a1)) return [process.execPath, path.resolve(a1)]
  const exec = process.execPath
  if (exec && fs.existsSync(exec)) return [exec]
  const onPath = Bun.which("friday")
  return onPath ? [onPath] : ["friday"]
}

function sh(parts: string[]): string {
  return parts.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(" ")
}

/** A shell command string for one window: optionally cd into `cwd`, then run friday with `args`.
 * Keeps the window open if friday ever exits (or fails to start) so it's never a blank black window —
 * the exit screen's resume hint stays visible, and any startup error is readable. */
export function fridayCommand(args: string[], cwd?: string): string {
  const cmd = sh([...selfCmd(), ...args])
  const run = cwd ? `cd ${sh([cwd])} && ${cmd}` : cmd
  // Clean exit → let the window close (don't wait on Enter, which left dead terminals lying around).
  // Only a crash keeps it open so the error stays readable. `exit` ends the script so Terminal can
  // close the window per its profile.
  return `${run}; code=$?; if [ $code -ne 0 ]; then echo; echo "[friday exited ($code) — press Enter to close]"; read _; fi; exit`
}

/** Run a command, capturing stderr so a failure carries a real reason instead of vanishing. */
function run(cmd: string[]): { ok: boolean; error?: string } {
  try {
    const p = Bun.spawnSync(cmd, { stdout: "ignore", stderr: "pipe" })
    if (p.success) return { ok: true }
    const err = (p.stderr ? new TextDecoder().decode(p.stderr) : "").trim()
    return { ok: false, error: err || `${cmd[0]} exited ${p.exitCode}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Open each command in its own macOS terminal window via a temp .command file + `open`. Unlike
 * AppleScript's `do script`, `open` needs no Automation permission (the usual reason new windows
 * silently failed from the VS Code terminal) and it raises the terminal to the front. Defaults to
 * Terminal.app; honors iTerm when that's the host terminal.
 */
function openMacWindows(cmds: string[]): { opened: number; error?: string } {
  const app = process.env.TERM_PROGRAM === "iTerm.app" ? "iTerm" : "Terminal"
  let opened = 0
  let error: string | undefined
  for (const c of cmds) {
    try {
      const file = path.join(os.tmpdir(), `friday-${process.pid}-${opened}-${Date.now()}.command`)
      // Self-delete on launch so temp files never accumulate, then run the command.
      fs.writeFileSync(file, `#!/bin/bash\nrm -f ${sh([file])}\n${c}\n`, { mode: 0o755 })
      const r = run(["open", "-a", app, file])
      if (r.ok) opened++
      else error ??= r.error
    } catch (e) {
      error ??= e instanceof Error ? e.message : String(e)
    }
  }
  return { opened, error }
}

function openLinuxTerminal(cmds: string[]): { opened: number; backend: string; error?: string } {
  const emulators: { bin: string; argv: (cmd: string) => string[] }[] = [
    { bin: "wezterm", argv: (c) => ["wezterm", "start", "--", "sh", "-c", c] },
    { bin: "gnome-terminal", argv: (c) => ["gnome-terminal", "--", "sh", "-c", c] },
    { bin: "konsole", argv: (c) => ["konsole", "-e", "sh", "-c", c] },
    { bin: "x-terminal-emulator", argv: (c) => ["x-terminal-emulator", "-e", "sh", "-c", c] },
  ]
  for (const e of emulators) {
    if (!Bun.which(e.bin)) continue
    let opened = 0
    let error: string | undefined
    for (const c of cmds) {
      const r = run(e.argv(c))
      if (r.ok) opened++
      else error ??= r.error
    }
    if (opened) return { opened, backend: e.bin }
    return { opened: 0, backend: e.bin, error }
  }
  return { opened: 0, backend: "none", error: "no supported terminal emulator found on PATH" }
}

type WinResult = { ok: boolean; backend: string; opened: number; error?: string }

/** Detect the OS-window backend for THIS environment without opening anything — so the dashboard can
 * tell the user what "↗ window" will use (and whether it's available at all). Direct OS terminal
 * windows only; Friday never uses tmux. */
export function detectWindowBackend(): { backend: string; osWindows: boolean } {
  if (process.platform === "darwin") {
    return { backend: process.env.TERM_PROGRAM === "iTerm.app" ? "iTerm" : "Terminal.app", osWindows: true }
  }
  if (process.platform === "linux") {
    const found = ["wezterm", "gnome-terminal", "konsole", "x-terminal-emulator"].find((b) => Bun.which(b))
    return { backend: found ?? "none", osWindows: !!found }
  }
  return { backend: "none", osWindows: false }
}

/** Open one real OS terminal window per command. Direct device control — no tmux. */
function openWindows(cmds: string[]): WinResult {
  if (!cmds.length) return { ok: false, backend: "none", opened: 0 }
  if (process.platform === "darwin") {
    const { opened, error } = openMacWindows(cmds)
    const backend = process.env.TERM_PROGRAM === "iTerm.app" ? "iTerm" : "Terminal.app"
    return { ok: opened > 0, backend, opened, error }
  }
  if (process.platform === "linux") {
    const { opened, backend, error } = openLinuxTerminal(cmds)
    return { ok: opened > 0, backend, opened, error }
  }
  return { ok: false, backend: "none", opened: 0, error: `unsupported platform: ${process.platform}` }
}

/** Read-only watch windows, one OS terminal per background agent (`friday attach <id>`). */
export function openFleetWindows(ids: string[]): WinResult {
  return openWindows(ids.map((id) => fridayCommand(["attach", id])))
}

/** A new interactive friday window (new chat, or `-s <id>` to resume), in `cwd` if given. */
export function openInteractiveWindow(args: string[] = [], cwd?: string): WinResult {
  return openWindows([fridayCommand(args, cwd)])
}
