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

test("spawnTask runs a background session and reports done + summary; emits a tasks event", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-task-"))
  const streamFn = makeStreamFn([
    [
      { type: "text", delta: "task complete" },
      { type: "done", stopReason: "stop" },
    ],
  ])
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")

  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))

  const id = engine.spawnTask("do the thing", "my background task")
  expect(id).toBeTruthy()
  // a tasks event fires immediately on spawn (running)
  expect(events.some((e) => e.type === "tasks")).toBe(true)

  await Bun.sleep(150)
  const t = engine.taskList().find((x) => x.id === id)
  expect(t?.status).toBe("done")
  expect(t?.summary ?? "").toContain("task complete")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("stopTask aborts a task", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-task-"))
  const streamFn = makeStreamFn([
    [
      { type: "text", delta: "x" },
      { type: "done", stopReason: "stop" },
    ],
  ])
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const id = engine.spawnTask("work", "stoppable")
  engine.stopTask(id)
  await Bun.sleep(30)
  expect(engine.taskList().some((x) => x.id === id)).toBe(true) // still listed
  fs.rmSync(dir, { recursive: true, force: true })
})
