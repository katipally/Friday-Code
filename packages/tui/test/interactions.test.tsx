import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Engine, type StreamFn } from "@friday/core"
import type { ProviderEvent } from "@friday/shared"
import { testRender } from "@opentui/solid"
import { App } from "../src/App.tsx"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

function ready(cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))) {
  const e = new Engine({ cwd })
  e.selectModel("anthropic", "claude")
  return e
}

function makeStreamFn(scripts: ProviderEvent[][]): StreamFn {
  let turn = 0
  return async function* () {
    const events = scripts[Math.min(turn, scripts.length - 1)]!
    turn++
    for (const e of events) yield e
  }
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

test("permission modal: shows the inline allow/deny row and a hotkey dismisses it", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const e = new Engine({
    cwd,
    streamFn: makeStreamFn([
      [
        // default mode → bash is "ask", so this triggers a permission-request.
        { type: "tool_start", index: 0, id: "c1", name: "bash" },
        { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ command: "ls" }) },
        { type: "tool_stop", index: 0 },
        { type: "done", stopReason: "tool_use" },
      ],
      // After the deny, finish cleanly so the agent doesn't re-request (avoids a prompt loop).
      [
        { type: "text", delta: "Understood, I won't run that." },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  e.selectModel("anthropic", "claude")
  const t = await testRender(() => <App engine={e} />, { width: 100, height: 28 })
  await t.renderOnce()
  t.mockInput.pressEnter() // enter the shell
  await t.flush()

  t.mockInput.typeText("run ls")
  await t.flush()
  t.mockInput.pressEnter() // submit → agent calls bash → permission gate
  for (let i = 0; i < 8; i++) await t.flush()

  // The rebuilt modal renders the inline row with visible a/s/d hotkeys (not a native select).
  const frame = t.captureCharFrame()
  expect(frame).toContain("permission")
  expect(frame).toContain("allow once")
  expect(frame).toContain("allow always")
  expect(frame).toContain("deny")

  // 'd' denies — the modal closes and the tool reports the denial.
  t.mockInput.pressKey("d")
  for (let i = 0; i < 8; i++) await t.flush()
  const after = t.captureCharFrame()
  expect(after).not.toContain("allow always")

  t.renderer.destroy()
})

test("ask_user modal: renders rich options and captures a typed custom answer", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const e = new Engine({
    cwd,
    streamFn: makeStreamFn([
      [
        { type: "tool_start", index: 0, id: "qa", name: "ask_user" },
        {
          type: "tool_delta",
          index: 0,
          argsDelta: JSON.stringify({
            question: "Which framework?",
            header: "Framework",
            options: [
              { label: "Solid", description: "fine-grained reactivity" },
              { label: "React", description: "ubiquitous" },
            ],
          }),
        },
        { type: "tool_stop", index: 0 },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text", delta: "Got it." },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  e.selectModel("anthropic", "claude")
  const t = await testRender(() => <App engine={e} />, { width: 100, height: 30 })
  await t.renderOnce()
  t.mockInput.pressEnter()
  await t.flush()
  t.mockInput.typeText("help")
  await t.flush()
  t.mockInput.pressEnter() // submit → agent calls ask_user
  for (let i = 0; i < 8; i++) await t.flush()

  // The redesigned modal shows the question, both options WITH descriptions, and the custom row.
  const frame = t.captureCharFrame()
  expect(frame).toContain("question")
  expect(frame).toContain("Which framework?")
  expect(frame).toContain("Solid")
  expect(frame).toContain("fine-grained reactivity")
  expect(frame).toContain("type your own answer")

  // Open the free-text editor (i), type, and submit — the input must be captured (the old bug).
  t.mockInput.pressKey("i")
  await t.flush()
  t.mockInput.typeText("svelte please")
  await t.flush()
  t.mockInput.pressEnter() // submit custom answer → replies → agent continues
  for (let i = 0; i < 8; i++) await t.flush()

  const after = t.captureCharFrame()
  expect(after).not.toContain("Which framework?") // modal dismissed → answer was accepted
  t.renderer.destroy()
})

test("ask_user modal: renders an option's ASCII preview in a side panel", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const e = new Engine({
    cwd,
    streamFn: makeStreamFn([
      [
        { type: "tool_start", index: 0, id: "qp", name: "ask_user" },
        {
          type: "tool_delta",
          index: 0,
          argsDelta: JSON.stringify({
            question: "Which layout?",
            options: [
              { label: "Sidebar", description: "nav on the left", preview: "PREVIEW_SIDEBAR_BOX" },
              { label: "Topbar", description: "nav on top", preview: "PREVIEW_TOPBAR_BOX" },
            ],
          }),
        },
        { type: "tool_stop", index: 0 },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text", delta: "ok" },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  e.selectModel("anthropic", "claude")
  const t = await testRender(() => <App engine={e} />, { width: 120, height: 36 })
  await t.renderOnce()
  t.mockInput.pressEnter()
  await t.flush()
  t.mockInput.typeText("go")
  await t.flush()
  t.mockInput.pressEnter()
  for (let i = 0; i < 8; i++) await t.flush()

  // The focused option's preview is shown in the side panel.
  const frame = t.captureCharFrame()
  expect(frame).toContain("Which layout?")
  expect(frame).toContain("PREVIEW_SIDEBAR_BOX")

  // Moving the selection (vim 'j') swaps the preview to the next option.
  t.mockInput.pressKey("j")
  for (let i = 0; i < 4; i++) await t.flush()
  const after = t.captureCharFrame()
  expect(after).toContain("PREVIEW_TOPBAR_BOX")
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

test("permission hotkey is not leaked into the composer", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const e = new Engine({
    cwd,
    streamFn: makeStreamFn([
      [
        { type: "tool_start", index: 0, id: "c1", name: "bash" },
        { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ command: "ls" }) },
        { type: "tool_stop", index: 0 },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text", delta: "done" },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  e.selectModel("anthropic", "claude")
  const t = await testRender(() => <App engine={e} />, { width: 100, height: 30 })
  await t.renderOnce()
  t.mockInput.pressEnter()
  await t.flush()
  await t.mockInput.typeText("count files")
  await t.flush()
  t.mockInput.pressEnter() // submit -> bash -> permission
  await t.flush()
  await t.flush()
  expect(t.captureCharFrame()).toContain("permission")
  t.mockInput.pressKey("a") // allow-once
  await t.flush()
  await t.flush()
  // The composer is empty again (placeholder shows) — the `a` did NOT leak into it.
  expect(t.captureCharFrame()).toContain("ask anything")
  t.renderer.destroy()
})

test("plan custom input lets you type directly in the modal", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const e = new Engine({
    cwd,
    streamFn: makeStreamFn([
      [
        { type: "tool_start", index: 0, id: "c1", name: "exit_plan" },
        { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ plan: "# Plan\n- step" }) },
        { type: "tool_stop", index: 0 },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text", delta: "ok" },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  e.selectModel("anthropic", "claude")
  const t = await testRender(() => <App engine={e} />, { width: 100, height: 34 })
  await t.renderOnce()
  t.mockInput.pressEnter()
  await t.flush()
  t.mockInput.pressTab({ shift: true }) // default -> plan
  await t.flush()
  await t.mockInput.typeText("plan it")
  await t.flush()
  t.mockInput.pressEnter() // submit -> exit_plan -> plan gate
  await t.flush()
  await t.flush()
  for (let i = 0; i < 4; i++) {
    t.mockInput.pressArrow("down") // navigate to "custom input…"
    await t.flush()
  }
  t.mockInput.pressEnter() // select custom -> reveal editor (deferred mount)
  await t.flush()
  await t.flush()
  await t.mockInput.typeText("ZQX-refine")
  await t.flush()
  // The text lands in the modal's editor, not lost or leaked.
  expect(t.captureCharFrame()).toContain("ZQX-refine")
  t.renderer.destroy()
})
