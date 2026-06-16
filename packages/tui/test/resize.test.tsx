import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { Engine } from "@friday/core"
import { App } from "../src/App.tsx"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "fh-"))

test("dragging the left divider resizes the sessions panel (onMouseDrag)", async () => {
  const e = new Engine({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), "cwd-")) })
  e.selectModel("anthropic", "claude")
  const t = await testRender(() => <App engine={e} />, { width: 110, height: 30 })
  await t.renderOnce()
  t.mockInput.pressEnter()
  await t.flush()
  const before = t.captureCharFrame()

  // The 1-col divider sits just past the 22-wide sessions panel; probe nearby columns.
  let resized = false
  for (const x of [22, 23, 21, 24, 20]) {
    await t.mockMouse.drag(x, 14, x + 14, 14)
    await t.flush()
    if (t.captureCharFrame() !== before) {
      resized = true
      break
    }
  }
  expect(resized).toBe(true)
  t.renderer.destroy()
})
