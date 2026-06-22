/**
 * Fleet display backends: open a read-only viewer window per background agent so the user can
 * watch several agents work in parallel. Each window runs `friday attach <id>`, which tails that
 * session's transcript from the shared store (no IPC, no server).
 *
 * Backend is auto-detected: tmux (when we're inside it) → tiled panes; else a known OS terminal
 * emulator → one window per agent; else give up and let the caller fall back to the in-TUI list.
 *
 * ponytail: covers tmux + macOS Terminal + the common Linux emulators; other emulators degrade to
 * "none" rather than guessing. Add more as users hit them.
 */

/** Reconstruct how to launch friday itself. Dev: `bun <script>`; compiled: just the binary. */
function selfCmd(): string[] {
  const a1 = process.argv[1]
  if (a1 && /\.(tsx?|jsx?|mjs)$/.test(a1)) return [process.argv[0]!, a1]
  return [process.argv[0]!]
}

function sh(parts: string[]): string {
  // POSIX-quote each arg so paths with spaces survive the shell hop.
  return parts.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(" ")
}

function attachCommand(id: string): string {
  return sh([...selfCmd(), "attach", id])
}

function run(cmd: string[]): boolean {
  try {
    const p = Bun.spawnSync(cmd, { stdout: "ignore", stderr: "ignore" })
    return p.success
  } catch {
    return false
  }
}

function openTmux(ids: string[]): number {
  let opened = 0
  for (const id of ids) {
    if (run(["tmux", "split-window", "-h", attachCommand(id)])) opened++
  }
  run(["tmux", "select-layout", "tiled"])
  return opened
}

function openMacTerminal(ids: string[]): number {
  let opened = 0
  for (const id of ids) {
    const script = `tell application "Terminal" to do script "${attachCommand(id).replace(/"/g, '\\"')}"`
    if (run(["osascript", "-e", script])) opened++
  }
  return opened
}

function openLinuxTerminal(ids: string[]): { opened: number; backend: string } {
  const emulators: { bin: string; argv: (cmd: string) => string[] }[] = [
    { bin: "wezterm", argv: (c) => ["wezterm", "start", "--", "sh", "-c", c] },
    { bin: "gnome-terminal", argv: (c) => ["gnome-terminal", "--", "sh", "-c", c] },
    { bin: "konsole", argv: (c) => ["konsole", "-e", "sh", "-c", c] },
    { bin: "x-terminal-emulator", argv: (c) => ["x-terminal-emulator", "-e", "sh", "-c", c] },
  ]
  for (const e of emulators) {
    if (!Bun.which(e.bin)) continue
    let opened = 0
    for (const id of ids) if (run(e.argv(attachCommand(id)))) opened++
    if (opened) return { opened, backend: e.bin }
  }
  return { opened: 0, backend: "none" }
}

export function openFleetWindows(ids: string[]): { ok: boolean; backend: string; opened: number } {
  if (process.env.TMUX) {
    const opened = openTmux(ids)
    return { ok: opened > 0, backend: "tmux", opened }
  }
  if (process.platform === "darwin") {
    const opened = openMacTerminal(ids)
    return { ok: opened > 0, backend: "Terminal.app", opened }
  }
  if (process.platform === "linux") {
    const { opened, backend } = openLinuxTerminal(ids)
    return { ok: opened > 0, backend, opened }
  }
  return { ok: false, backend: "none", opened: 0 }
}
