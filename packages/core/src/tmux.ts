/**
 * tmux-backed "control center": one persistent tmux session (default name `friday`) whose panes are
 * the live terminals for sessions / team members / swarm agents. The dashboard drives it — add a pane
 * (open a real terminal running friday), kill one, kill all, re-tile, and "open the wall" (attach in a
 * real terminal so you watch every pane in one tiled view).
 *
 * Why tmux: OpenTUI can't embed PTYs, and OS windows can't be tiled/closed programmatically without
 * automation permission. tmux gives real terminals you CAN arrange and close from code. When tmux
 * isn't installed the caller falls back to the per-window backends in fleet.ts.
 *
 * ponytail: shell out to the tmux CLI (already the de-facto API); no library, no daemon of our own.
 */
import { fridayCommand } from "./fleet.ts"

export const WALL = "friday" // the tmux session name we own

export type TmuxLayout = "tiled" | "even-horizontal" | "even-vertical" | "main-vertical"
export type TmuxPane = { id: string; title: string; active: boolean }

async function tmux(args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const p = Bun.spawn(["tmux", ...args], { stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    return { ok: code === 0, out, err }
  } catch (e) {
    return { ok: false, out: "", err: e instanceof Error ? e.message : String(e) }
  }
}

/** Is the tmux CLI available at all? (The control center degrades to fleet windows when not.) */
export function tmuxAvailable(): boolean {
  return !!Bun.which("tmux")
}

async function hasWall(): Promise<boolean> {
  return (await tmux(["has-session", "-t", WALL])).ok
}

/** Add a friday pane to the wall and re-tile. Creates the wall (detached) on first use. `title` labels
 * the pane; `watch` runs `friday attach <id>` (read-only) vs an interactive `friday -s <id>`. */
export async function wallAdd(
  args: string[],
  cwd: string | undefined,
  title: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!tmuxAvailable()) return { ok: false, error: "tmux is not installed" }
  const cmd = fridayCommand(args, cwd)
  if (!(await hasWall())) {
    // First pane: create the detached session running this command directly.
    const r = await tmux(["new-session", "-d", "-s", WALL, "-n", "wall", cmd])
    if (!r.ok) return { ok: false, error: r.err.trim() || "tmux new-session failed" }
  } else {
    const r = await tmux(["split-window", "-t", WALL, cmd])
    if (!r.ok) return { ok: false, error: r.err.trim() || "tmux split-window failed" }
  }
  await tmux(["select-pane", "-T", title]) // name the just-created (active) pane
  await tmux(["select-layout", "-t", WALL, "tiled"])
  return { ok: true }
}

/** The wall's panes, or [] when there's no wall. */
export async function wallPanes(): Promise<TmuxPane[]> {
  if (!tmuxAvailable() || !(await hasWall())) return []
  const r = await tmux(["list-panes", "-t", WALL, "-F", "#{pane_id}\t#{pane_title}\t#{pane_active}"])
  if (!r.ok) return []
  return r.out
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const [id, title, active] = l.split("\t")
      return { id: id!, title: title || id!, active: active === "1" }
    })
}

/** Kill one pane and re-tile the rest. */
export async function wallKill(paneId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await tmux(["kill-pane", "-t", paneId])
  if (!r.ok) return { ok: false, error: r.err.trim() || "tmux kill-pane failed" }
  await tmux(["select-layout", "-t", WALL, "tiled"]) // ignore error if the last pane closed the session
  return { ok: true }
}

/** Tear the whole wall down. */
export async function wallKillAll(): Promise<{ ok: boolean; error?: string }> {
  if (!(await hasWall())) return { ok: true }
  const r = await tmux(["kill-session", "-t", WALL])
  return { ok: r.ok, error: r.ok ? undefined : r.err.trim() || "tmux kill-session failed" }
}

/** Re-arrange the wall into a named layout. */
export async function wallLayout(layout: TmuxLayout): Promise<{ ok: boolean; error?: string }> {
  const r = await tmux(["select-layout", "-t", WALL, layout])
  return { ok: r.ok, error: r.ok ? undefined : r.err.trim() || "tmux select-layout failed" }
}

/** The shell command that attaches a terminal to the wall (run it in a real OS window to watch). */
export function wallAttachCommand(): string {
  return `tmux attach -t ${WALL}`
}
