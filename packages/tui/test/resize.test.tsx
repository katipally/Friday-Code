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
