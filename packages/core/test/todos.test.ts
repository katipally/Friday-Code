import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { EngineEvent, ProviderEvent } from "@friday/shared"
import { Engine, type StreamFn } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

function makeStreamFn(scripts: ProviderEvent[][]): StreamFn {
  let turn = 0
  return async function* () {
    const events = scripts[Math.min(turn, scripts.length - 1)]!
    turn++
    for (const e of events) yield e
  }
}

test("todo_write updates the todo list and stays out of the chat transcript", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const todos = [
    { text: "read the schema", status: "done" },
    { text: "write the migration", status: "active" },
    { text: "run the tests", status: "pending" },
  ]
  const streamFn = makeStreamFn([
    [
      { type: "tool_start", index: 0, id: "call_t", name: "todo_write" },
      { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ todos }) },
      { type: "tool_stop", index: 0 },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text", delta: "Plan set." },
      { type: "done", stopReason: "stop" },
    ],
  ])

  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")

  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.send({ type: "prompt", text: "plan the work" })
  await Bun.sleep(40)

  const todoEvent = events.find((e) => e.type === "todos") as Extract<EngineEvent, { type: "todos" }>
  expect(todoEvent).toBeTruthy()
  expect(todoEvent.items.map((t) => t.status)).toEqual(["done", "active", "pending"])
  expect(todoEvent.items[1]!.text).toBe("write the migration")

  // todo_write must NOT surface as a chat tool-card.
  const toolCalls = events.filter((e) => e.type === "tool-call") as Extract<EngineEvent, { type: "tool-call" }>[]
  expect(toolCalls.some((e) => e.name === "todo_write")).toBe(false)

  fs.rmSync(dir, { recursive: true, force: true })
})
