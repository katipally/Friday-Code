/**
 * Window backends: open separate terminal/IDE windows so the dashboard can stay the "console" while
 * each new chat/session/agent gets its own window. Two flavors:
 *   - INTERACTIVE  → `friday [args]` you can type in (new chat / resumed session).
 *   - WATCH (tiled)→ `friday attach <id>`, a read-only tail of a background agent's transcript.
 *
 * Backend is auto-detected and adaptive: inside tmux → panes/windows; iTerm/Terminal on macOS; the
 * common emulators on Linux. Unknown env degrades to "none" so the caller can fall back to the in-TUI
 * view rather than guessing.
 *
 * ponytail: covers tmux + iTerm + macOS Terminal + common Linux emulators; add more as users hit them.
 */

/** Reconstruct how to launch friday itself. Dev: `bun <script>`; compiled: just the binary. */
function selfCmd(): string[] {
  const a1 = process.argv[1]
  if (a1 && /\.(tsx?|jsx?|mjs)$/.test(a1)) return [process.argv[0]!, a1]
  return [process.argv[0]!]
}

function sh(parts: string[]): string {
  return parts.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(" ")
}

/** A shell command string for one window: optionally cd into `cwd`, then run friday with `args`. */
function fridayCommand(args: string[], cwd?: string): string {
  const cmd = sh([...selfCmd(), ...args])
  return cwd ? `cd ${sh([cwd])} && ${cmd}` : cmd
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

function openITerm(cmds: string[]): number {
  let opened = 0
  for (const c of cmds) {
    const script = `tell application "iTerm2"
      create window with default profile
      tell current session of current window to write text "${c.replace(/"/g, '\\"')}"
    end tell`
    if (run(["osascript", "-e", script])) opened++
  }
  return opened
}

function openMacTerminal(cmds: string[]): number {
  let opened = 0
  for (const c of cmds) {
    const script = `tell application "Terminal" to do script "${c.replace(/"/g, '\\"')}"`
    if (run(["osascript", "-e", script])) opened++
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
    const iterm = process.env.TERM_PROGRAM === "iTerm.app" && Bun.which("osascript")
    const opened = iterm ? openITerm(cmds) : openMacTerminal(cmds)
    return { ok: opened > 0, backend: iterm ? "iTerm" : "Terminal.app", opened }
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
