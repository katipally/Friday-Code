import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Engine, type StreamFn } from "@friday/core"
import type { ProviderEvent } from "@friday/shared"
import { testRender } from "@opentui/solid"
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

// Poll the rendered frame until every `needle` appears (or we time out). Fixed sleeps are flaky on
// slower CI runners — especially when waiting on multiple model turns or async tree-sitter
// highlighting — so we re-flush and re-check instead of guessing a single duration. Requiring ALL
// needles avoids capturing a half-rendered frame where one element has landed but another hasn't.
async function waitForFrame(
  t: { flush: () => Promise<void>; captureCharFrame: () => string },
  needles: string | string[],
  timeoutMs = 5000,
): Promise<string> {
  const wanted = Array.isArray(needles) ? needles : [needles]
  const start = Bun.nanoseconds()
  let frame = t.captureCharFrame()
  while (!wanted.every((n) => frame.includes(n)) && (Bun.nanoseconds() - start) / 1e6 < timeoutMs) {
    await Bun.sleep(20)
    await t.flush()
    frame = t.captureCharFrame()
  }
  return frame
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
  // Two model turns run here (tool_use -> auto-continue -> assistant text); wait for the final
  // assistant text rather than a fixed sleep, which under-waits on slower CI runners.
  const frame = await waitForFrame(t, ["create foo.txt", "write foo.txt", "Created foo.txt"])
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
    streamFn: scripted([
      [
        { type: "text", delta: "ok" },
        { type: "done", stopReason: "stop" },
      ],
    ]),
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
  await waitForFrame(t, "teach me about closures")

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
  // Native markdown highlights code via async tree-sitter; poll until every asserted element has
  // landed instead of a fixed sleep, which is flaky under full-suite load on CI.
  const frame = await waitForFrame(t, ["Overview", "const answer = 42", "first"])
  expect(frame).toContain("Overview") // heading text
  expect(frame).toContain("const answer = 42") // fenced code content
  expect(frame).toContain("first") // list item

  t.renderer.destroy()
  fs.rmSync(cwd, { recursive: true, force: true })
})
