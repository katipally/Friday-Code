import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { EngineEvent } from "@friday/shared"
import { Engine, type StreamFn } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))
process.env.FRIDAY_NO_NOTIFY = "1"

/** A content-driven streamer: echoes the latest user prompt back as text. */
const echoStream: StreamFn = async function* (_p, _k, req) {
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user") as { text?: string } | undefined
  await Promise.resolve()
  yield { type: "text", delta: `reply to ${lastUser?.text ?? ""}` }
  yield { type: "done", stopReason: "stop" }
}

test("every event is tagged with its session id", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const engine = new Engine({ cwd: dir, streamFn: echoStream })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.send({ type: "prompt", text: "hello" })
  await Bun.sleep(20)
  expect(events.length).toBeGreaterThan(0)
  expect(events.every((e) => typeof e.sessionId === "string" && e.sessionId.length > 0)).toBe(true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("two sessions keep separate transcripts and event streams", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const engine = new Engine({ cwd: dir, streamFn: echoStream })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")

  const s1 = engine.currentSessionId()
  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))

  engine.send({ type: "prompt", text: "task A" })
  await Bun.sleep(20)

  // Open a second session (focus moves to it) and run a different prompt.
  engine.send({ type: "new-session" })
  const s2 = engine.currentSessionId()
  expect(s2).not.toBe(s1)
  engine.send({ type: "prompt", text: "task B" })
  await Bun.sleep(20)

  const textBy: Record<string, string> = {}
  for (const e of events) if (e.type === "text") textBy[e.sessionId] = (textBy[e.sessionId] ?? "") + e.delta

  expect(textBy[s1]).toContain("task A")
  expect(textBy[s2]).toContain("task B")
  // No cross-contamination.
  expect(textBy[s1]).not.toContain("task B")
  expect(textBy[s2]).not.toContain("task A")

  fs.rmSync(dir, { recursive: true, force: true })
})
