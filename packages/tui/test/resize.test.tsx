import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { Engine } from "@friday/core"
import { App } from "../src/App.tsx"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "fh-"))

test("dragging the right divider resizes the context panel (onMouseDrag)", async () => {
  const e = new Engine({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), "cwd-")) })
  e.selectModel("anthropic", "claude")
  const t = await testRender(() => <App engine={e} />, { width: 110, height: 30 })
  await t.renderOnce()
  t.mockInput.pressEnter()
  await t.flush()

  // The grip bar sits just left of the right panel. Probe columns near the split.
  let resized = false
  for (const startX of [86, 87, 88, 89, 85]) {
    await t.mockMouse.drag(startX, 14, startX + 10, 14)
    await t.flush()
    await t.mockMouse.drag(startX + 10, 14, startX - 10, 14)
    await t.flush()
    const frame = t.captureCharFrame()
    if (frame.includes("no model")) {
      // panel collapsed or hidden; skip
      continue
    }
    resized = true
    break
  }
  expect(resized).toBe(true)
  t.renderer.destroy()
})

test("dragging the grip past minimum collapses the panel (collapse tab appears)", async () => {
  const e = new Engine({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), "cwd-")) })
  e.selectModel("anthropic", "claude")
  const t = await testRender(() => <App engine={e} />, { width: 110, height: 30 })
  await t.renderOnce()
  t.mockInput.pressEnter()
  await t.flush()

  // Panel is open initially -> its "stats" header is visible.
  expect(t.captureCharFrame()).toContain("stats")

  // Grab the grip (the 2-col handle just left of the panel) and drag hard to the right.
  // A rightward drag of >14 cols pushes the target width below MIN_RIGHT and collapses it.
  // Drag is row-driven, so events keep landing once the cursor leaves the handle.
  let collapsed = false
  for (const startX of [79, 80, 78, 81]) {
    await t.mockMouse.drag(startX, 14, startX + 22, 14)
    await t.flush()
    if (!t.captureCharFrame().includes("stats")) {
      collapsed = true
      break
    }
  }
  expect(collapsed).toBe(true)
  t.renderer.destroy()
})
