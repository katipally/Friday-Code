import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { Engine, type StreamFn } from "@friday/core"
import type { ProviderEvent } from "@friday/shared"
import { App } from "../src/App.tsx"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

function scripted(turns: ProviderEvent[][]): StreamFn {
  let i = 0
  return async function* () {
    const t = turns[Math.min(i, turns.length - 1)]!
    i++
    for (const e of t) yield e
  }
}

test("full render path: prompt -> tool card + diff -> assistant text", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const streamFn = scripted([
    [
      { type: "tool_start", index: 0, id: "c1", name: "write" },
      { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ path: "foo.txt", content: "hello\nworld\n" }) },
      { type: "tool_stop", index: 0 },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text", delta: "Created foo.txt with two lines." },
      { type: "done", stopReason: "stop" },
    ],
  ])

  const engine = new Engine({ cwd, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("anthropic", "mock-model")

  const t = await testRender(() => <App engine={engine} />, { width: 120, height: 40 })
  await t.renderOnce()
  t.mockInput.pressEnter() // dismiss splash
  await t.flush()

  await t.mockInput.typeText("create foo.txt")
  await t.flush()
  t.mockInput.pressEnter() // submit
  await Bun.sleep(80)
  await t.flush()

  const frame = t.captureCharFrame()
  expect(frame).toContain("create foo.txt") // user bubble
  expect(frame).toContain("write foo.txt") // tool card title
  // Tool output/diff auto-collapses once the tool finishes (click the title to expand), so the diff
  // body is not shown by default — only the title + a ▸ affordance.
  expect(frame).not.toContain("+ hello")
  expect(frame).toContain("Created foo.txt") // assistant text
  expect(fs.existsSync(path.join(cwd, "foo.txt"))).toBe(true)

  t.renderer.destroy()
  fs.rmSync(cwd, { recursive: true, force: true })
})

test("/fork opens the fork picker listing the conversation's user turns", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const engine = new Engine({
    cwd,
    streamFn: scripted([[{ type: "text", delta: "ok" }, { type: "done", stopReason: "stop" }]]),
  })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("anthropic", "mock-model")

  const t = await testRender(() => <App engine={engine} />, { width: 120, height: 40 })
  await t.renderOnce()
  t.mockInput.pressEnter()
  await t.flush()
  await t.mockInput.typeText("teach me about closures")
  await t.flush()
  t.mockInput.pressEnter()
  await Bun.sleep(40)
  await t.flush()

  // Run /fork. With the command highlighted in the autocomplete, Enter runs it directly
  // (Tab would complete to "/fork " for adding args).
  await t.mockInput.typeText("/fork")
  await t.flush()
  t.mockInput.pressEnter() // run /fork
  await t.flush()

  const frame = t.captureCharFrame()
  expect(frame).toContain("branch a new session from a past turn")
  expect(frame).toContain("teach me about closures")

  t.renderer.destroy()
  fs.rmSync(cwd, { recursive: true, force: true })
})

test("native markdown renders headings + fenced code blocks", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const md = "# Overview\n\nHere is some code:\n\n```js\nconst answer = 42\n```\n\n- first\n- second\n"
  const streamFn = scripted([
    [
      { type: "text", delta: md },
      { type: "done", stopReason: "stop" },
    ],
  ])

  const engine = new Engine({ cwd, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("anthropic", "mock-model")

  const t = await testRender(() => <App engine={engine} />, { width: 120, height: 40 })
  await t.renderOnce()
  t.mockInput.pressEnter()
  await t.flush()
  await t.mockInput.typeText("show me code")
  await t.flush()
  t.mockInput.pressEnter()
  // Native markdown highlights code via async tree-sitter; allow time under full-suite load.
  await Bun.sleep(250)
  await t.flush()

  const frame = t.captureCharFrame()
  expect(frame).toContain("Overview") // heading text
  expect(frame).toContain("const answer = 42") // fenced code content
  expect(frame).toContain("first") // list item

  t.renderer.destroy()
  fs.rmSync(cwd, { recursive: true, force: true })
})
