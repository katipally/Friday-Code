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

async function boot(engine: Engine) {
  const t = await testRender(() => <App engine={engine} />, { width: 120, height: 40 })
  await t.renderOnce()
  t.mockInput.pressEnter() // dismiss splash
  await t.flush()
  return t
}

test("issue 1: no stray ▋ caret after a multi-step (tool call + text) turn settles", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  fs.writeFileSync(path.join(cwd, "foo.txt"), "hi\n")
  const engine = new Engine({
    cwd,
    streamFn: scripted([
      [
        { type: "text", delta: "Let me read it." },
        { type: "tool_start", index: 0, id: "c1", name: "read" },
        { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ path: "foo.txt" }) },
        { type: "tool_stop", index: 0 },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text", delta: "It says hi." },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("anthropic", "mock-model")

  const t = await boot(engine)
  await t.mockInput.typeText("read foo")
  await t.flush()
  t.mockInput.pressEnter()
  await Bun.sleep(120)
  await t.flush()

  const frame = t.captureCharFrame()
  expect(frame).toContain("Let me read it.") // intermediate bubble text rendered
  expect(frame).toContain("It says hi.") // final bubble text rendered
  expect(frame).not.toContain("▋") // ...but no streaming caret left behind anywhere

  t.renderer.destroy()
  fs.rmSync(cwd, { recursive: true, force: true })
})

test("issue 2: todos render live in the panel after a todo_write", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const todos = [
    { text: "read the schema", status: "done" },
    { text: "write migration", status: "active" },
    { text: "run the tests", status: "pending" },
  ]
  const engine = new Engine({
    cwd,
    streamFn: scripted([
      [
        { type: "tool_start", index: 0, id: "t", name: "todo_write" },
        { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ todos }) },
        { type: "tool_stop", index: 0 },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text", delta: "Plan set." },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("anthropic", "mock-model")

  const t = await boot(engine)
  await t.mockInput.typeText("plan the work")
  await t.flush()
  t.mockInput.pressEnter()
  await Bun.sleep(100)
  await t.flush()

  const frame = t.captureCharFrame()
  // The Todos section (default-open) shows every task live, without the user clicking to expand.
  expect(frame).toContain("read the schema")
  expect(frame).toContain("write migration")
  expect(frame).toContain("run the tests")

  t.renderer.destroy()
  fs.rmSync(cwd, { recursive: true, force: true })
})
