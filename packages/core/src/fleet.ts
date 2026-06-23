/**
 * Window backends: open separate terminal/IDE windows so the dashboard can stay the "console" while
 * each new chat/session/agent gets its own window. Two flavors:
 *   - INTERACTIVE  → `friday [args]` you can type in (new chat / resumed session).
 *   - WATCH (tiled)→ `friday attach <id>`, a read-only tail of a background agent's transcript.
 *
 * Backend is auto-detected and adaptive: inside tmux → panes/windows; macOS → a temp .command file
 * opened with `open` (no Automation/AppleScript permission needed — that was why windows silently
 * failed or opened blank behind the editor); the common emulators on Linux. Unknown env degrades to
 * "none" so the caller can fall back to the in-TUI view rather than guessing.
 *
 * Failures are never swallowed: `run()` captures stderr and every result carries an `error` string so
 * the dashboard can tell the user WHY a window didn't open instead of a generic "no backend".
 *
 * ponytail: covers tmux + macOS (open .command) + common Linux emulators; add more as users hit them.
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
 * the exit screen's resume hint stays visible, and any startup error is readable. Exported so the tmux
 * control center can run the SAME command inside a pane. */
export function fridayCommand(args: string[], cwd?: string): string {
  const cmd = sh([...selfCmd(), ...args])
  const run = cwd ? `cd ${sh([cwd])} && ${cmd}` : cmd
  return `${run}; echo; echo '[friday exited — press Enter to close]'; read _`
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

function openTmux(cmds: string[], tile: boolean): { opened: number; error?: string } {
  let opened = 0
  let error: string | undefined
  for (const c of cmds) {
    // tile=watch panes (split); otherwise a fresh interactive window.
    const r = tile ? run(["tmux", "split-window", "-h", c]) : run(["tmux", "new-window", c])
    if (r.ok) opened++
    else error ??= r.error
  }
  if (tile) run(["tmux", "select-layout", "tiled"])
  return { opened, error }
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

/** Open one window per command, picking the backend for the current environment. */
function openWindows(cmds: string[], tile: boolean): WinResult {
  if (!cmds.length) return { ok: false, backend: "none", opened: 0 }
  if (process.env.TMUX) {
    const { opened, error } = openTmux(cmds, tile)
    return { ok: opened > 0, backend: "tmux", opened, error }
  }
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

/** Read-only tiled watch windows, one per background agent (`friday attach <id>`). */
export function openFleetWindows(ids: string[]): WinResult {
  return openWindows(
    ids.map((id) => fridayCommand(["attach", id])),
    true,
  )
}

/** A new interactive friday window (new chat, or `-s <id>` to resume), in `cwd` if given. */
export function openInteractiveWindow(args: string[] = [], cwd?: string): WinResult {
  return openWindows([fridayCommand(args, cwd)], false)
}

/** Open ONE real OS terminal window running an arbitrary shell command — used to attach a window to
 * the tmux wall so the user can watch every pane tiled. Always a separate OS window (not a tmux split),
 * even when friday itself is running inside tmux. */
export function openTerminalRunning(cmd: string): WinResult {
  const full = `${cmd}; echo; echo '[closed — press Enter to close]'; read _`
  if (process.platform === "darwin") {
    const { opened, error } = openMacWindows([full])
    const backend = process.env.TERM_PROGRAM === "iTerm.app" ? "iTerm" : "Terminal.app"
    return { ok: opened > 0, backend, opened, error }
  }
  if (process.platform === "linux") {
    const { opened, backend, error } = openLinuxTerminal([full])
    return { ok: opened > 0, backend, opened, error }
  }
  return { ok: false, backend: "none", opened: 0, error: `unsupported platform: ${process.platform}` }
}
