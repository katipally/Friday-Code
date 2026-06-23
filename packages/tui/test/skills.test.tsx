import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Engine } from "@friday/core"
import { testRender } from "@opentui/solid"
import { App } from "../src/App.tsx"

// Seed a user skill BEFORE the engine loads (loadSkills reads ~/.friday/skills via FRIDAY_HOME).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))
process.env.FRIDAY_HOME = HOME
fs.mkdirSync(path.join(HOME, "skills"), { recursive: true })
fs.writeFileSync(
  path.join(HOME, "skills", "tidy.md"),
  "---\nname: tidy\ndescription: clean up imports and format\n---\nDo the tidy thing.\n",
)

function newEngine() {
  return new Engine({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-")) })
}

test("/skills opens the Skills modal and lists installed skills", async () => {
  const t = await testRender(() => <App engine={newEngine()} />, { width: 120, height: 36 })
  await t.renderOnce()
  t.mockInput.pressEnter() // trust the workspace
  await t.flush()
  await t.mockMouse.click(2, 2) // dismiss first-run /model picker
  await t.flush()

  await t.mockInput.typeText("/skills")
  await t.flush()
  t.mockInput.pressEnter() // run the highlighted command
  await t.flush()

  const frame = t.captureCharFrame()
  expect(frame).toContain("/SKILLS") // overlay title (uppercased)
  expect(frame).toContain("tidy") // the seeded skill is listed

  await t.mockMouse.click(2, 2) // backdrop click dismisses the modal
  await t.flush()
  expect(t.captureCharFrame()).not.toContain("reusable instructions")

  t.renderer.destroy()
})
