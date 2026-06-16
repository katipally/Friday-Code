import { test, expect } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/App.tsx"

test("App mounts and renders the splash, then the shell", async () => {
  const t = await testRender(() => <App />, { width: 120, height: 34 })
  await t.renderOnce()

  const splash = t.captureCharFrame()
  expect(splash).toContain("a new kind of terminal coding agent")
  expect(splash).toContain("to begin")

  // Enter the shell.
  t.mockInput.pressEnter()
  await t.flush()

  const shell = t.captureCharFrame()
  expect(shell).toContain("sessions")
  expect(shell).toContain("context")
  expect(shell).toContain("friday")
  expect(shell).toContain("default") // mode badge
  expect(shell).toContain("send") // footer hint

  t.renderer.destroy()
})

test("Shift+Tab cycles modes, Ctrl+B toggles the sessions panel, ? overlay opens & Esc closes", async () => {
  const t = await testRender(() => <App />, { width: 120, height: 34 })
  await t.renderOnce()
  t.mockInput.pressEnter() // enter shell
  await t.flush()

  // default -> accept edits
  t.mockInput.pressTab({ shift: true })
  await t.flush()
  expect(t.captureCharFrame()).toContain("accept edits")

  // collapse sessions panel
  t.mockInput.pressKey("b", { ctrl: true })
  await t.flush()
  expect(t.captureCharFrame()).not.toContain("friday code shell")

  // reopen
  t.mockInput.pressKey("b", { ctrl: true })
  await t.flush()
  expect(t.captureCharFrame()).toContain("friday code shell")

  // keymap overlay open via F1, close via clicking the backdrop (mouse dismiss path = no dead-end)
  t.mockInput.pressKey("F1")
  await t.flush()
  expect(t.captureCharFrame()).toContain("keyboard")
  await t.mockMouse.click(2, 2)
  await t.flush()
  expect(t.captureCharFrame()).not.toContain("esc or click to close")

  t.renderer.destroy()
})
