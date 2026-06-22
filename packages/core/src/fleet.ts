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
 * ponytail: covers tmux + macOS (open .command) + common Linux emulators; add more as users hit them.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/** Reconstruct how to launch friday itself. Dev: `bun <script>`; compiled: just the binary. */
function selfCmd(): string[] {
  const a1 = process.argv[1]
  if (a1 && /\.(tsx?|jsx?|mjs)$/.test(a1)) return [process.argv[0]!, a1]
  return [process.argv[0]!]
}

function sh(parts: string[]): string {
  return parts.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(" ")
}

/** A shell command string for one window: optionally cd into `cwd`, then run friday with `args`.
 * Keeps the window open if friday ever exits (or fails to start) so it's never a blank black window —
 * the exit screen's resume hint stays visible, and any startup error is readable. */
function fridayCommand(args: string[], cwd?: string): string {
  const cmd = sh([...selfCmd(), ...args])
  const run = cwd ? `cd ${sh([cwd])} && ${cmd}` : cmd
  return `${run}; echo; echo '[friday exited — press Enter to close]'; read _`
}

function run(cmd: string[]): boolean {
  try {
    return Bun.spawnSync(cmd, { stdout: "ignore", stderr: "ignore" }).success
  } catch {
    return false
  }
}

function openTmux(cmds: string[], tile: boolean): number {
  let opened = 0
  for (const c of cmds) {
    // tile=watch panes (split); otherwise a fresh interactive window.
    const ok = tile ? run(["tmux", "split-window", "-h", c]) : run(["tmux", "new-window", c])
    if (ok) opened++
  }
  if (tile) run(["tmux", "select-layout", "tiled"])
  return opened
}

/**
 * Open each command in its own macOS terminal window via a temp .command file + `open`. Unlike
 * AppleScript's `do script`, `open` needs no Automation permission (the usual reason new windows
 * silently failed from the VS Code terminal) and it raises the terminal to the front. Defaults to
 * Terminal.app; honors iTerm when that's the host terminal.
 */
function openMacWindows(cmds: string[]): number {
  const app = process.env.TERM_PROGRAM === "iTerm.app" ? "iTerm" : "Terminal"
  let opened = 0
  for (const c of cmds) {
    try {
      const file = path.join(os.tmpdir(), `friday-${process.pid}-${opened}-${Date.now()}.command`)
      // Self-delete on launch so temp files never accumulate, then run the command.
      fs.writeFileSync(file, `#!/bin/bash\nrm -f ${sh([file])}\n${c}\n`, { mode: 0o755 })
      if (run(["open", "-a", app, file])) opened++
    } catch {
      /* ignore and try the next */
    }
  }
  return opened
}

function openLinuxTerminal(cmds: string[]): { opened: number; backend: string } {
  const emulators: { bin: string; argv: (cmd: string) => string[] }[] = [
    { bin: "wezterm", argv: (c) => ["wezterm", "start", "--", "sh", "-c", c] },
    { bin: "gnome-terminal", argv: (c) => ["gnome-terminal", "--", "sh", "-c", c] },
    { bin: "konsole", argv: (c) => ["konsole", "-e", "sh", "-c", c] },
    { bin: "x-terminal-emulator", argv: (c) => ["x-terminal-emulator", "-e", "sh", "-c", c] },
  ]
  for (const e of emulators) {
    if (!Bun.which(e.bin)) continue
    let opened = 0
    for (const c of cmds) if (run(e.argv(c))) opened++
    if (opened) return { opened, backend: e.bin }
  }
  return { opened: 0, backend: "none" }
}

type WinResult = { ok: boolean; backend: string; opened: number }

/** Open one window per command, picking the backend for the current environment. */
function openWindows(cmds: string[], tile: boolean): WinResult {
  if (!cmds.length) return { ok: false, backend: "none", opened: 0 }
  if (process.env.TMUX) {
    const opened = openTmux(cmds, tile)
    return { ok: opened > 0, backend: "tmux", opened }
  }
  if (process.platform === "darwin") {
    const opened = openMacWindows(cmds)
    const backend = process.env.TERM_PROGRAM === "iTerm.app" ? "iTerm" : "Terminal.app"
    return { ok: opened > 0, backend, opened }
  }
  if (process.platform === "linux") {
    const { opened, backend } = openLinuxTerminal(cmds)
    return { ok: opened > 0, backend, opened }
  }
  return { ok: false, backend: "none", opened: 0 }
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
