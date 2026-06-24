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

/** Drive past the trust gate + first-run /model picker into the bare shell. */
async function intoShell(width = 120, height = 36) {
  const t = await testRender(() => <App engine={newEngine()} />, { width, height })
  await t.renderOnce()
  t.mockInput.pressEnter() // trust the workspace
  await t.flush()
  await t.mockMouse.click(2, 2) // dismiss first-run /model picker
  await t.flush()
  return t
}

test("Ctrl+G opens settings with the keybindings tab reachable", async () => {
  const t = await intoShell()
  t.mockInput.pressKey("g", { ctrl: true })
  await t.flush()
  const frame = t.captureCharFrame()
  expect(frame).toContain("SETTINGS")
  expect(frame).toContain("Keybindings") // tab rail
  expect(frame).toContain("auto-update check")
  t.renderer.destroy()
})

test("/pause is refused when the agent is idle (situational guard); /add still works as an alias", async () => {
  const t = await intoShell()
  await t.mockInput.typeText("/add pause me") // /add is the back-compat alias for /pause
  await t.flush()
  t.mockInput.pressEnter()
  await t.flush()
  const frame = t.captureCharFrame()
  expect(frame).toContain("nothing to pause") // toast, not the pause modal
  expect(frame).not.toContain("paused — agent is waiting")
  t.renderer.destroy()
})

test("settings: auto-compact threshold row shows and cycles", async () => {
  const t = await intoShell()
  t.mockInput.pressKey("g", { ctrl: true })
  await t.flush()
  let frame = t.captureCharFrame()
  expect(frame).toContain("auto-compact at")
  expect(frame).toContain("85% of context") // default
  // Move down to the auto-compact row (auto-update, theme, output style, auto-format, auto-compact) and cycle.
  for (let i = 0; i < 4; i++) {
    t.mockInput.pressKey("j")
    await t.flush()
  }
  t.mockInput.pressEnter()
  await t.flush()
  frame = t.captureCharFrame()
  expect(frame).toContain("90% of context") // 0.85 → 0.90
  t.renderer.destroy()
})

test("Ctrl+K no longer opens a command palette (removed; / covers it)", async () => {
  const t = await intoShell()
  t.mockInput.pressKey("k", { ctrl: true })
  await t.flush()
  const frame = t.captureCharFrame()
  expect(frame).not.toContain("run a command")
  expect(frame).toContain("ask anything") // still the bare composer
  t.renderer.destroy()
})

test("the side panel shows MODEL/CONTEXT cards and the nav rows", async () => {
  const t = await intoShell()
  const frame = t.captureCharFrame()
  expect(frame).toContain("MODEL")
  expect(frame).toContain("CONTEXT")
  expect(frame).toContain("settings")
  expect(frame).toContain("voice")
  t.renderer.destroy()
})
