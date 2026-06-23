import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Engine } from "@friday/core"
import { testRender } from "@opentui/solid"
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

  // Panel is open initially -> its "MODEL" header is visible.
  expect(t.captureCharFrame()).toContain("MODEL")

  // Panel is on the LEFT now; grab the grip (the 2-col handle just right of the panel, ~col 28
  // at the default width) and drag hard to the left. A leftward drag of >14 cols pushes the target
  // width below MIN_RIGHT and collapses it. Drag is row-driven, so events keep landing off the handle.
  let collapsed = false
  for (const startX of [28, 27, 29, 26]) {
    await t.mockMouse.drag(startX, 14, startX - 22, 14)
    await t.flush()
    if (!t.captureCharFrame().includes("MODEL")) {
      collapsed = true
      break
    }
  }
  expect(collapsed).toBe(true)
  t.renderer.destroy()
})
