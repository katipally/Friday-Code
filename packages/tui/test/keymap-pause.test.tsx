import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Engine } from "@friday/core"
import { testRender } from "@opentui/solid"
import { App } from "../src/App.tsx"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

function newEngine() {
  return new Engine({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-")) })
}

async function shell(opts: { kittyKeyboard?: boolean } = {}) {
  const t = await testRender(() => <App engine={newEngine()} />, { width: 120, height: 36, ...opts })
  await t.renderOnce()
  t.mockInput.pressEnter() // trust the workspace
  await t.flush()
  await t.mockMouse.click(2, 2) // dismiss first-run /model picker
  await t.flush()
  return t
}

/** Flush a few render cycles, then return the frame (toasts settle a couple of frames after the key). */
async function settle(t: Awaited<ReturnType<typeof shell>>): Promise<string> {
  for (let i = 0; i < 6; i++) await t.flush()
  return t.captureCharFrame()
}

// Pause moved off the un-encodable Shift+Esc onto Ctrl+P (everywhere) and Cmd/Super+Enter (kitty).
// When idle there's nothing to pause, so both should surface the same "nothing to pause" toast —
// proof the binding actually fired and routed to the pause command.
test("Ctrl+P routes to pause", async () => {
  const t = await shell()
  t.mockInput.pressKey("p", { ctrl: true })
  expect(await settle(t)).toContain("nothing to pause")
  t.renderer.destroy()
})

test("Cmd/Super+Enter routes to pause (kitty protocol)", async () => {
  const t = await shell({ kittyKeyboard: true })
  t.mockInput.pressEnter({ super: true })
  expect(await settle(t)).toContain("nothing to pause")
  t.renderer.destroy()
})

// The side panel header no longer carries a title — just the close affordance with its shortcut,
// right-aligned. (The "CONTEXT" further down is the legit context-window usage gauge, not a title.)
test("context panel header shows the close shortcut, no title", async () => {
  const t = await shell()
  const frame = t.captureCharFrame()
  expect(frame).toContain("ctrl+b ✕") // right-aligned close with its shortcut
  expect(frame).toContain("📎 0 context") // permanent context-files chip
  t.renderer.destroy()
})
