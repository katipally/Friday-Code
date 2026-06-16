import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { Engine } from "@friday/core"
import { App } from "../src/App.tsx"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

function ready(cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))) {
  const e = new Engine({ cwd })
  e.selectModel("anthropic", "claude")
  return e
}

test("tab-completing a slash command keeps the cursor at the end", async () => {
  const t = await testRender(() => <App engine={ready()} />, { width: 100, height: 28 })
  await t.renderOnce()
  t.mockInput.pressEnter() // shell
  await t.flush()

  await t.mockInput.typeText("/ne")
  await t.flush()
  expect(t.captureCharFrame()).toContain("/new") // suggestion visible

  t.mockInput.pressTab()
  await t.flush()
  await t.mockInput.typeText("z")
  await t.flush()

  const frame = t.captureCharFrame()
  expect(frame).toContain("new z") // appended at end (cursor fix), not "z/new"
  expect(frame).not.toContain("z/new")

  t.renderer.destroy()
})

test("Ctrl+Y opens session history grouped by directory", async () => {
  const e = ready()
  const t = await testRender(() => <App engine={e} />, { width: 100, height: 28 })
  await t.renderOnce()
  t.mockInput.pressEnter()
  await t.flush()

  t.mockInput.pressKey("y", { ctrl: true })
  await t.flush()
  const frame = t.captureCharFrame()
  expect(frame).toContain("history")
  expect(frame).toContain("all sessions")
  expect(frame).toContain("new session") // the auto-created session

  t.renderer.destroy()
})
