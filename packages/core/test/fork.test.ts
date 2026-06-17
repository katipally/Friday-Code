import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import type { EngineEvent, ProviderEvent } from "@friday/shared"
import { Engine, type StreamFn } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

function scripted(turns: ProviderEvent[][]): StreamFn {
  let i = 0
  return async function* () {
    const t = turns[Math.min(i, turns.length - 1)]!
    i++
    for (const e of t) yield e
  }
}

async function seededEngine() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const engine = new Engine({
    cwd,
    streamFn: scripted([
      [{ type: "text", delta: "answer one" }, { type: "done", stopReason: "stop" }],
      [{ type: "text", delta: "answer two" }, { type: "done", stopReason: "stop" }],
    ]),
  })
  engine.selectModel("mock", "m")
  engine.send({ type: "prompt", text: "question one" })
  await Bun.sleep(30)
  engine.send({ type: "prompt", text: "question two" })
  await Bun.sleep(30)
  return engine
}

test("forkPoints lists the user turns with their message index", async () => {
  const engine = await seededEngine()
  const points = engine.forkPoints()
  expect(points.map((p) => p.text)).toEqual(["question one", "question two"])
  // user turn 1 at index 0, user turn 2 after (user, assistant) at index 2
  expect(points[0]!.index).toBe(0)
  expect(points[1]!.index).toBe(2)
})

test("forking from the first turn branches a new focused session with only that turn", async () => {
  const engine = await seededEngine()
  const before = engine.listSessions().length

  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.forkSession(0) // fork up to and including message index 0 (first user turn)
  await Bun.sleep(10)

  // A new session exists and is focused, titled as a fork.
  expect(engine.listSessions().length).toBe(before + 1)
  const changed = events.find((e) => e.type === "session-changed") as Extract<EngineEvent, { type: "session-changed" }>
  expect(changed?.title).toContain("fork")

  // The forked session carries only the first user turn (not the second).
  const points = engine.forkPoints()
  expect(points.map((p) => p.text)).toEqual(["question one"])
})

test("forking the whole conversation copies every turn", async () => {
  const engine = await seededEngine()
  engine.forkSession() // no index = whole conversation
  await Bun.sleep(10)
  expect(engine.forkPoints().map((p) => p.text)).toEqual(["question one", "question two"])
})
