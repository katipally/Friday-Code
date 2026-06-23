import { expect, test } from "bun:test"
import { tmuxAvailable, WALL, wallAttachCommand } from "../src/tmux.ts"

async function tmux(args: string[]): Promise<{ ok: boolean; out: string }> {
  const p = Bun.spawn(["tmux", ...args], { stdout: "pipe", stderr: "ignore" })
  const out = await new Response(p.stdout).text()
  return { ok: (await p.exited) === 0, out }
}

test("wallAttachCommand targets our session", () => {
  expect(wallAttachCommand()).toBe(`tmux attach -t ${WALL}`)
})

// Validate the exact tmux subcommands/flags the control center relies on, against a throwaway session
// (never the real `friday` wall, never launching friday). Skips cleanly where tmux isn't installed.
test.skipIf(!tmuxAvailable())("tmux new/split/list/layout/kill flags work on this tmux", async () => {
  const sess = `friday-test-${process.pid}`
  try {
    // new-session -d with an inline command (a harmless long-lived shell).
    expect((await tmux(["new-session", "-d", "-s", sess, "-n", "wall", "sleep 30"])).ok).toBe(true)
    await tmux(["select-pane", "-T", "p1"])
    // split-window adds a second pane.
    expect((await tmux(["split-window", "-t", sess, "sleep 30"])).ok).toBe(true)
    await tmux(["select-pane", "-T", "p2"])
    expect((await tmux(["select-layout", "-t", sess, "tiled"])).ok).toBe(true)

    // list-panes with our exact format string parses to two panes.
    const lp = await tmux(["list-panes", "-t", sess, "-F", "#{pane_id}\t#{pane_title}\t#{pane_active}"])
    const panes = lp.out
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => l.split("\t"))
    expect(panes.length).toBe(2)
    expect(panes[0]![0]).toMatch(/^%\d+$/) // pane id like %0

    // kill one pane → one left.
    expect((await tmux(["kill-pane", "-t", panes[0]![0]!])).ok).toBe(true)
    const after = await tmux(["list-panes", "-t", sess, "-F", "#{pane_id}"])
    expect(after.out.split("\n").filter((l) => l.trim()).length).toBe(1)
  } finally {
    await tmux(["kill-session", "-t", sess])
  }
})
