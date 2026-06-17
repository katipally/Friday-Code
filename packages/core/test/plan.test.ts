import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
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

test("plan mode: a completed turn emits plan-ready with the plan text", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const plan = "# Plan\n\n1. Read the schema\n2. Write the migration\n3. Run the tests"
  const engine = new Engine({
    cwd: dir,
    streamFn: makeStreamFn([
      [
        { type: "text", delta: plan },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  engine.send({ type: "set-mode", mode: "plan" })
  engine.selectModel("mock", "mock-model")

  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.send({ type: "prompt", text: "how should we do this?" })
  await Bun.sleep(40)

  const planReady = events.find((e) => e.type === "plan-ready") as Extract<EngineEvent, { type: "plan-ready" }>
  expect(planReady).toBeTruthy()
  expect(planReady.plan).toContain("Write the migration")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("executing a plan switches the engine mode before the carry-out turn runs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const engine = new Engine({
    cwd: dir,
    streamFn: makeStreamFn([
      [
        { type: "text", delta: "a plan with enough text to qualify" },
        { type: "done", stopReason: "stop" },
      ],
      [
        { type: "text", delta: "carrying it out" },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  engine.send({ type: "set-mode", mode: "plan" })
  engine.selectModel("mock", "mock-model")
  engine.send({ type: "prompt", text: "plan it" })
  await Bun.sleep(40)
  expect(engine.selection().mode).toBe("plan")

  // Mirror store.executePlan: switch mode, then submit the carry-out prompt.
  engine.setMode("accept-edit")
  engine.send({ type: "set-mode", mode: "accept-edit" })

  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.send({ type: "prompt", text: "Carry out the plan you just proposed, step by step." })
  await Bun.sleep(40)

  // The carry-out turn ran under accept-edit, so its message-start is stamped accept-edit
  // and (crucially) no fresh plan-ready fires (that only happens while still in plan mode).
  expect(engine.selection().mode).toBe("accept-edit")
  const start = events.find((e) => e.type === "message-start") as Extract<EngineEvent, { type: "message-start" }>
  expect(start?.mode).toBe("accept-edit")
  expect(events.some((e) => e.type === "plan-ready")).toBe(false)
  fs.rmSync(dir, { recursive: true, force: true })
})
