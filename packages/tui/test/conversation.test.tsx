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
  expect(frame).toContain("+hello") // diff added line
  expect(frame).toContain("Created foo.txt") // assistant text
  expect(fs.existsSync(path.join(cwd, "foo.txt"))).toBe(true)

  t.renderer.destroy()
  fs.rmSync(cwd, { recursive: true, force: true })
})
