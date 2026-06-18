import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import type { EngineEvent, ProviderEvent } from "@friday/shared"
import { Engine, type StreamFn } from "../src/index.ts"

// Hermetic: never touch the real ~/.friday.
process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

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

test("issue 1: an intermediate tool-call step emits message-stop, only the final step turn-done", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  fs.writeFileSync(path.join(dir, "hello.txt"), "a\nb\n")
  const streamFn = makeStreamFn([
    [
      { type: "tool_start", index: 0, id: "c1", name: "read" },
      { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ path: "hello.txt" }) },
      { type: "tool_stop", index: 0 },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text", delta: "Two lines." },
      { type: "done", stopReason: "stop" },
    ],
  ])
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)
  engine.send({ type: "prompt", text: "count lines" })
  await Bun.sleep(60)

  const starts = events.filter((e) => e.type === "message-start") as Extract<EngineEvent, { type: "message-start" }>[]
  const stops = events.filter((e) => e.type === "message-stop") as Extract<EngineEvent, { type: "message-stop" }>[]
  const dones = events.filter((e) => e.type === "turn-done")
  expect(starts.length).toBe(2) // one per agentic step
  expect(stops.length).toBe(1) // the intermediate (tool-call) step
  expect(stops[0]!.intermediate).toBe(true)
  expect(stops[0]!.id).toBe(starts[0]!.id) // finalizes the FIRST bubble
  expect(dones.length).toBe(1) // only the final step
  fs.rmSync(dir, { recursive: true, force: true })
})

test("gap E: a malformed tool-call argument is rejected, not executed with {}", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  fs.writeFileSync(path.join(dir, "hello.txt"), "data\n")
  const streamFn = makeStreamFn([
    [
      { type: "tool_start", index: 0, id: "c1", name: "read" },
      { type: "tool_delta", index: 0, argsDelta: '{"path": ' }, // truncated / invalid JSON
      { type: "tool_stop", index: 0 },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text", delta: "ok" },
      { type: "done", stopReason: "stop" },
    ],
  ])
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)
  engine.send({ type: "prompt", text: "read it" })
  await Bun.sleep(50)

  const result = events.find((e) => e.type === "tool-result") as Extract<EngineEvent, { type: "tool-result" }>
  expect(result).toBeTruthy()
  expect(result.ok).toBe(false)
  expect(result.output).toContain("valid JSON")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("gap A: aborting while an ask_user is pending unblocks the turn instead of hanging", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const streamFn = makeStreamFn([
    [
      { type: "tool_start", index: 0, id: "c1", name: "ask_user" },
      { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ question: "Which?", options: ["a", "b"] }) },
      { type: "tool_stop", index: 0 },
      { type: "done", stopReason: "tool_use" },
    ],
    [{ type: "text", delta: "ok" }, { type: "done", stopReason: "stop" }],
  ])
  const engine = new Engine({ cwd: dir, streamFn })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)
  engine.send({ type: "prompt", text: "ask me" })
  await Bun.sleep(30)
  expect(events.some((e) => e.type === "ask-user")).toBe(true)

  // Abort while waiting on the answer — previously this hung forever.
  engine.send({ type: "abort" })
  await Bun.sleep(30)

  expect(events.some((e) => e.type === "turn-done")).toBe(true)
  expect(events.some((e) => e.type === "status" && (e as any).text === "stopped")).toBe(true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("gap D: hitting the step limit emits a notice instead of stopping silently", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  fs.writeFileSync(path.join(dir, "hello.txt"), "x\n")
  // Every step calls a tool and never finishes → the loop exhausts MAX_STEPS.
  const streamFn = makeStreamFn([
    [
      { type: "tool_start", index: 0, id: "c", name: "read" },
      { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ path: "hello.txt" }) },
      { type: "tool_stop", index: 0 },
      { type: "done", stopReason: "tool_use" },
    ],
  ])
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)
  engine.send({ type: "prompt", text: "loop forever" })
  await Bun.sleep(800)

  const notice = events.find((e) => e.type === "notice" && /step limit/i.test((e as any).text))
  expect(notice).toBeTruthy()
  expect(events.some((e) => e.type === "turn-done")).toBe(true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("issue 4: auto-compaction triggers off the real input-token count", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  // Each normal turn reports a large real input (≈170k); the summarizer call (recognized by its
  // system prompt) returns a short summary so compaction can complete.
  const streamFn: StreamFn = async function* (_p, _k, req) {
    const isSummary = req.messages.some((m) => m.role === "system" && (m.text ?? "").includes("compress coding-session transcripts"))
    if (isSummary) {
      yield { type: "text", delta: "SUMMARY of earlier turns." }
      yield { type: "done", stopReason: "stop" }
      return
    }
    yield { type: "text", delta: "ok" }
    yield { type: "usage", input: 170_000, output: 10 } // real context size > 160k limit (200k window)
    yield { type: "done", stopReason: "stop" }
  }
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model", false, 200_000) // 200k context window
  const events = collect(engine)

  // Build enough history (>keepRecent) so a safe cut exists, then the next turn compacts.
  for (let i = 0; i < 6; i++) {
    engine.send({ type: "prompt", text: `turn ${i}` })
    await Bun.sleep(40)
  }

  expect(events.some((e) => e.type === "compaction")).toBe(true)
  // Lifecycle: a start event precedes the done event, and the done event carries the summary text.
  expect(events.some((e) => e.type === "compaction-start")).toBe(true)
  const done = events.find((e) => e.type === "compaction") as Extract<EngineEvent, { type: "compaction" }>
  expect(done.summary).toContain("SUMMARY of earlier turns")
  expect(done.pctAfter).toBeGreaterThanOrEqual(0)

  // Undo restores full history (emits a notice) and is idempotent afterwards.
  events.length = 0
  engine.send({ type: "undo-compaction" })
  await Bun.sleep(10)
  expect(events.some((e) => e.type === "notice" && /undone/i.test((e as any).text))).toBe(true)
  events.length = 0
  engine.send({ type: "undo-compaction" })
  await Bun.sleep(10)
  expect(events.some((e) => e.type === "notice")).toBe(false) // nothing left to undo
  fs.rmSync(dir, { recursive: true, force: true })
})

test("reactive compaction: an overflow error triggers a compaction + retry, not a hard failure", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  let overflowed = false
  // Normal turns return "ok" (no usage → no proactive compaction). Once enough history exists, the
  // next request throws a 413-style overflow exactly once; the runner should compact and retry.
  const streamFn: StreamFn = async function* (_p, _k, req) {
    const isSummary = req.messages.some((m) => m.role === "system" && (m.text ?? "").includes("compress coding-session transcripts"))
    if (isSummary) {
      yield { type: "text", delta: "SUMMARY of earlier turns." }
      yield { type: "done", stopReason: "stop" }
      return
    }
    if (!overflowed && req.messages.length > 10) {
      overflowed = true
      throw new Error("HTTP 413: request_too_large — prompt is too long")
    }
    yield { type: "text", delta: "ok" }
    yield { type: "done", stopReason: "stop" }
  }
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model", false, 200_000)
  const events = collect(engine)

  for (let i = 0; i < 7; i++) {
    engine.send({ type: "prompt", text: `turn ${i}` })
    await Bun.sleep(40)
  }

  expect(overflowed).toBe(true) // the overflow path was exercised
  expect(events.some((e) => e.type === "compaction")).toBe(true) // it compacted reactively
  // No surfaced error from the overflow, and the retried turn produced output.
  expect(events.some((e) => e.type === "error" && /413|too long/i.test((e as any).message))).toBe(false)
  expect(events.some((e) => e.type === "text" && (e as any).delta === "ok")).toBe(true)
  fs.rmSync(dir, { recursive: true, force: true })
})
