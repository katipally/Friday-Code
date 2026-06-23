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

test("plan mode: plain prose does NOT fabricate a plan-ready (only exit_plan does)", async () => {
  // Regression: a trivial answer (e.g. a file listing) must not masquerade as a "PLAN READY" gate.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const engine = new Engine({
    cwd: dir,
    streamFn: makeStreamFn([
      [
        { type: "text", delta: "Files in this folder: a.txt, b.txt, README.md" },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  engine.send({ type: "set-mode", mode: "plan" })
  engine.selectModel("mock", "mock-model")

  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.send({ type: "prompt", text: "list everything in the folder" })
  await Bun.sleep(40)

  // No exit_plan was called → no plan gate; the prose just stands as a normal answer.
  expect(events.some((e) => e.type === "plan-ready")).toBe(false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("plan mode: exit_plan emits plan-ready deterministically with the tool's plan and locks the turn", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const plan = "# Plan\n\n1. Add the exit_plan tool\n2. Wire the runner\n3. Test it"
  const engine = new Engine({
    cwd: dir,
    streamFn: makeStreamFn([
      [
        // The model investigates (some prose) then presents the plan via exit_plan.
        { type: "text", delta: "Here's what I found." },
        { type: "tool_start", index: 0, id: "call_1", name: "exit_plan" },
        { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ plan }) },
        { type: "tool_stop", index: 0 },
        { type: "done", stopReason: "tool_use" },
      ],
      // A second turn is scripted but must NOT run — exit_plan locks the turn.
      [
        { type: "text", delta: "this turn should never execute" },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  engine.send({ type: "set-mode", mode: "plan" })
  engine.selectModel("mock", "mock-model")

  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.send({ type: "prompt", text: "make exit_plan work" })
  await Bun.sleep(40)

  // The plan-ready carries EXACTLY the tool's plan argument (not the prose), and fires once.
  const planReadys = events.filter((e) => e.type === "plan-ready") as Extract<EngineEvent, { type: "plan-ready" }>[]
  expect(planReadys.length).toBe(1)
  expect(planReadys[0]!.plan).toBe(plan)
  // The locked turn never streamed the second script's text.
  expect(events.some((e) => e.type === "text" && (e as any).delta === "this turn should never execute")).toBe(false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("plan mode is read-only: bash and edit tools are not offered, exit_plan is", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  let toolNames: string[] = []
  const streamFn: StreamFn = async function* (_p, _k, req: any) {
    toolNames = (req.tools ?? []).map((t: any) => t.name)
    yield { type: "text", delta: "ok" }
    yield { type: "done", stopReason: "stop" }
  }
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "plan" })
  engine.selectModel("mock", "mock-model")
  engine.send({ type: "prompt", text: "look around" })
  await Bun.sleep(40)

  expect(toolNames).toContain("read")
  expect(toolNames).toContain("exit_plan")
  // The mutating tools must be absent so the agent physically cannot act while planning.
  expect(toolNames).not.toContain("bash")
  expect(toolNames).not.toContain("edit")
  expect(toolNames).not.toContain("write")
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
  engine.setMode("yolo")
  engine.send({ type: "set-mode", mode: "yolo" })

  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.send({ type: "prompt", text: "Carry out the plan you just proposed, step by step." })
  await Bun.sleep(40)

  // The carry-out turn ran under yolo, so its message-start is stamped yolo
  // and (crucially) no fresh plan-ready fires (that only happens while still in plan mode).
  expect(engine.selection().mode).toBe("yolo")
  const start = events.find((e) => e.type === "message-start") as Extract<EngineEvent, { type: "message-start" }>
  expect(start?.mode).toBe("yolo")
  expect(events.some((e) => e.type === "plan-ready")).toBe(false)
  fs.rmSync(dir, { recursive: true, force: true })
})
