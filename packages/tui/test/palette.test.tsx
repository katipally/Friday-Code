import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { Engine } from "@friday/core"
import { App } from "../src/App.tsx"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

function newEngine() {
  return new Engine({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-")) })
}

test("Ctrl+K opens the command palette with built-in commands", async () => {
  const t = await testRender(() => <App engine={newEngine()} />, { width: 120, height: 36 })
  await t.renderOnce()
  t.mockInput.pressEnter() // dismiss splash
  await t.flush()
  await t.mockMouse.click(2, 2) // dismiss first-run /model
  await t.flush()

  t.mockInput.pressKey("k", { ctrl: true })
  await t.flush()
  const frame = t.captureCharFrame()
  expect(frame).toContain("run a command")
  expect(frame).toContain("/model")
  expect(frame).toContain("new")

  t.renderer.destroy()
})
