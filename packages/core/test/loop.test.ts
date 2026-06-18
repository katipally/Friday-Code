import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import type { EngineEvent, ProviderEvent } from "@friday/shared"
import { Engine, type StreamFn } from "../src/index.ts"

// Keep tests hermetic: never touch the real ~/.friday.
process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

/** A scripted provider: first turn calls a tool, second turn replies with text. */
function makeStreamFn(scripts: ProviderEvent[][]): StreamFn {
  let turn = 0
  return async function* () {
    const events = scripts[Math.min(turn, scripts.length - 1)]!
    turn++
    for (const e of events) yield e
  }
}

function collect(engine: Engine): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  return events
}

test("agent loop: tool-call -> result -> continue -> done", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  fs.writeFileSync(path.join(dir, "hello.txt"), "first line\nsecond line\n")

  const streamFn = makeStreamFn([
    // turn 1: model asks to read hello.txt
    [
      { type: "tool_start", index: 0, id: "call_1", name: "read" },
      { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ path: "hello.txt" }) },
      { type: "tool_stop", index: 0 },
      { type: "done", stopReason: "tool_use" },
    ],
    // turn 2: model produces final text
    [
      { type: "reasoning", delta: "The file has two lines." },
      { type: "text", delta: "The file contains two lines." },
      { type: "usage", input: 10, output: 5 },
      { type: "done", stopReason: "stop" },
    ],
  ])

  const engine = new Engine({ cwd: dir, streamFn })
  // yolo mode so the read (which is auto-allowed anyway) and any edits don't block
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")

  const events = collect(engine)
  engine.send({ type: "prompt", text: "how many lines in hello.txt?" })

  // wait for the turn to finish
  await Bun.sleep(50)

  const types = events.map((e) => e.type)
  expect(types).toContain("tool-call")
  const toolResult = events.find((e) => e.type === "tool-result") as Extract<EngineEvent, { type: "tool-result" }>
  expect(toolResult.ok).toBe(true)
  expect(toolResult.output).toContain("second line")

  const reasoning = events.filter((e) => e.type === "reasoning").map((e: any) => e.delta).join("")
  expect(reasoning).toContain("two lines")
  const text = events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")
  expect(text).toContain("two lines")
  expect(types).toContain("turn-done")

  fs.rmSync(dir, { recursive: true, force: true })
})

test("permission gate: default mode asks before an edit, deny is honored", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))

  const streamFn = makeStreamFn([
    [
      { type: "tool_start", index: 0, id: "call_w", name: "write" },
      { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ path: "new.txt", content: "hi" }) },
      { type: "tool_stop", index: 0 },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text", delta: "Okay, I won't write it." },
      { type: "done", stopReason: "stop" },
    ],
  ])

  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "default" })
  engine.selectModel("mock", "mock-model")

  const events = collect(engine)
  engine.send({ type: "prompt", text: "create new.txt" })
  await Bun.sleep(30)

  const req = events.find((e) => e.type === "permission-request") as Extract<EngineEvent, { type: "permission-request" }>
  expect(req).toBeTruthy()
  expect(req.tool).toBe("write")

  // deny it
  engine.send({ type: "permission-reply", requestId: req.requestId, decision: "deny" })
  await Bun.sleep(30)

  expect(fs.existsSync(path.join(dir, "new.txt"))).toBe(false)
  const toolResult = events.find((e) => e.type === "tool-result") as Extract<EngineEvent, { type: "tool-result" }>
  expect(toolResult.ok).toBe(false)
  expect(events.map((e) => e.type)).toContain("turn-done")

  fs.rmSync(dir, { recursive: true, force: true })
})

test("ask_user pauses the loop and feeds the answer back", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const streamFn = makeStreamFn([
    [
      { type: "tool_start", index: 0, id: "call_a", name: "ask_user" },
      { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ question: "Which framework?", options: ["solid", "react"] }) },
      { type: "tool_stop", index: 0 },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text", delta: "Great, Solid it is." },
      { type: "done", stopReason: "stop" },
    ],
  ])
  const engine = new Engine({ cwd: dir, streamFn })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)
  engine.send({ type: "prompt", text: "pick a framework" })
  await Bun.sleep(20)

  const ask = events.find((e) => e.type === "ask-user") as Extract<EngineEvent, { type: "ask-user" }>
  expect(ask).toBeTruthy()
  // Options are normalized to { label, description } objects (bare strings → just a label).
  expect(ask.questions[0]!.options).toEqual([{ label: "solid" }, { label: "react" }])

  engine.send({ type: "ask-reply", requestId: ask.requestId, answers: { [ask.questions[0]!.id]: "solid" } })
  await Bun.sleep(20)

  const result = events.find((e) => e.type === "tool-result") as Extract<EngineEvent, { type: "tool-result" }>
  expect(result.output).toBe("solid")
  const text = events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")
  expect(text).toContain("Solid")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("network tools are gated: default mode asks before webfetch, deny avoids the call", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const streamFn = makeStreamFn([
    [
      { type: "tool_start", index: 0, id: "call_f", name: "webfetch" },
      { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ url: "https://example.com" }) },
      { type: "tool_stop", index: 0 },
      { type: "done", stopReason: "tool_use" },
    ],
    [{ type: "text", delta: "ok" }, { type: "done", stopReason: "stop" }],
  ])
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "default" })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)
  engine.send({ type: "prompt", text: "fetch example.com" })
  await Bun.sleep(20)

  const req = events.find((e) => e.type === "permission-request") as Extract<EngineEvent, { type: "permission-request" }>
  expect(req.tool).toBe("webfetch")
  engine.send({ type: "permission-reply", requestId: req.requestId, decision: "deny" })
  await Bun.sleep(20)
  const result = events.find((e) => e.type === "tool-result") as Extract<EngineEvent, { type: "tool-result" }>
  expect(result.ok).toBe(false)
  fs.rmSync(dir, { recursive: true, force: true })
})
