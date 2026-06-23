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

test("App mounts straight to the shell; untrusted dir shows the trust gate, then the model picker", async () => {
  const t = await testRender(() => <App engine={newEngine()} />, { width: 120, height: 36 })
  await t.renderOnce()

  // No splash. A fresh (untrusted) directory shows the trust gate first.
  const trust = t.captureCharFrame()
  expect(trust).toContain("TRUST THIS FOLDER?")

  t.mockInput.pressEnter() // trust & continue
  await t.flush()

  // No model yet -> the model picker opens directly (no welcome tour).
  const picker = t.captureCharFrame()
  expect(picker).toContain("connect a provider and pick a model")

  // dismiss it (backdrop click); the underlying shell is present
  await t.mockMouse.click(2, 2)
  await t.flush()
  const bare = t.captureCharFrame()
  expect(bare).toContain("STATS")

  t.renderer.destroy()
})

test("Shift+Tab cycles modes, Ctrl+B toggles context panel, F1 overlay + mouse dismiss", async () => {
  const t = await testRender(() => <App engine={newEngine()} />, { width: 120, height: 36 })
  await t.renderOnce()
  t.mockInput.pressEnter() // trust the workspace
  await t.flush()
  await t.mockMouse.click(2, 2) // dismiss first-run /model picker
  await t.flush()

  t.mockInput.pressTab({ shift: true }) // default -> plan (new order)
  await t.flush()
  expect(t.captureCharFrame()).toContain("plan")

  t.mockInput.pressKey("b", { ctrl: true })
  await t.flush()
  expect(t.captureCharFrame()).not.toContain("STATS")

  t.mockInput.pressKey("b", { ctrl: true })
  await t.flush()

  t.mockInput.pressKey("F1")
  await t.flush()
  expect(t.captureCharFrame()).toContain("KEYBOARD")
  await t.mockMouse.click(2, 2)
  await t.flush()
  expect(t.captureCharFrame()).not.toContain("esc or click to close")

  // `?` opens the keymap too (composer is empty); dismiss via backdrop click.
  t.mockInput.pressKey("?")
  await t.flush()
  expect(t.captureCharFrame()).toContain("KEYBOARD")
  await t.mockMouse.click(2, 2)
  await t.flush()
  expect(t.captureCharFrame()).not.toContain("esc or click to close")

  t.renderer.destroy()
})
