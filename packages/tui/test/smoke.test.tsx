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

test("App mounts, splash, then the shell; first-run shows onboarding", async () => {
  const t = await testRender(() => <App engine={newEngine()} />, { width: 120, height: 36 })
  await t.renderOnce()

  const splash = t.captureCharFrame()
  expect(splash).toContain("a new kind of terminal coding agent")

  t.mockInput.pressEnter()
  await t.flush()

  // first run with no model -> welcome/onboarding overlay
  const shell = t.captureCharFrame()
  expect(shell).toContain("connect a model")
  expect(shell).toContain("reduced motion")

  // skip it (backdrop click); underlying shell is present
  await t.mockMouse.click(2, 2)
  await t.flush()
  const bare = t.captureCharFrame()
  expect(bare).toContain("stats")
  expect(bare).not.toContain("sessions")

  t.renderer.destroy()
})

test("Shift+Tab cycles modes, Ctrl+B toggles context panel, F1 overlay + mouse dismiss", async () => {
  const t = await testRender(() => <App engine={newEngine()} />, { width: 120, height: 36 })
  await t.renderOnce()
  t.mockInput.pressEnter()
  await t.flush()
  await t.mockMouse.click(2, 2) // dismiss first-run /model
  await t.flush()

  t.mockInput.pressTab({ shift: true }) // default -> plan (new order)
  await t.flush()
  expect(t.captureCharFrame()).toContain("plan")

  t.mockInput.pressKey("b", { ctrl: true })
  await t.flush()
  expect(t.captureCharFrame()).not.toContain("stats")

  t.mockInput.pressKey("b", { ctrl: true })
  await t.flush()

  t.mockInput.pressKey("F1")
  await t.flush()
  expect(t.captureCharFrame()).toContain("keyboard")
  await t.mockMouse.click(2, 2)
  await t.flush()
  expect(t.captureCharFrame()).not.toContain("esc or click to close")

  // `?` opens the keymap too (composer is empty); dismiss via backdrop click.
  t.mockInput.pressKey("?")
  await t.flush()
  expect(t.captureCharFrame()).toContain("keyboard")
  await t.mockMouse.click(2, 2)
  await t.flush()
  expect(t.captureCharFrame()).not.toContain("esc or click to close")

  t.renderer.destroy()
})
