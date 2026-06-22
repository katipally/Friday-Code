import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { EngineEvent, Message, ProviderEvent } from "@friday/shared"
import { Engine, type StreamFn } from "../src/index.ts"

// Keep tests hermetic: never touch the real ~/.friday.
process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

function collect(engine: Engine): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  return events
}

async function waitFor(cond: () => boolean, timeoutMs = 5000, stepMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond() && Date.now() < deadline) await Bun.sleep(stepMs)
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const readCall = (id: string, file: string): ProviderEvent[] => [
  { type: "tool_start", index: 0, id, name: "read" },
  { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ path: file }) },
  { type: "tool_stop", index: 0 },
  { type: "done", stopReason: "tool_use" },
]

/**
 * Captures each request's messages, and holds the FIRST turn open on `gate` so the loop is reliably
 * "busy" mid-step while the test injects — the realistic mid-task scenario, not a fast race that ends
 * before the injection lands.
 */
function makeGatedStream(scripts: ProviderEvent[][], requests: Message[][], gate: Promise<void>): StreamFn {
  let turn = 0
  return async function* (_p, _k, req) {
    requests.push(req.messages as Message[])
    if (turn === 0) await gate // park the loop inside the first model call until the test releases it
    const events = scripts[Math.min(turn, scripts.length - 1)]!
    turn++
    for (const e of events) yield e
  }
}

test("/add: a mid-task injection reaches the model's next request and lands at the end of history", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  fs.writeFileSync(path.join(dir, "hello.txt"), "one\ntwo\n")
  const requests: Message[][] = []
  const gate = deferred()
  const streamFn = makeGatedStream(
    [
      readCall("c1", "hello.txt"),
      [
        { type: "text", delta: "done" },
        { type: "done", stopReason: "stop" },
      ],
    ],
    requests,
    gate.promise,
  )

  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)

  engine.send({ type: "prompt", text: "read hello.txt" })
  await waitFor(() => requests.length >= 1) // loop is now parked in turn 0 (busy)
  const marker = "USE TABS NOT SPACES"
  engine.send({ type: "inject", id: "chip-1", text: marker })
  gate.resolve() // release: turn 0 finishes, read runs, step 1 builds the next request

  await waitFor(() => requests.some((msgs) => msgs.some((m) => m.role === "user" && m.text?.includes(marker))))
  // The UI chip flip is driven by inject-attached, carrying back the id we sent.
  expect(events.some((e) => e.type === "inject-attached" && (e as any).id === "chip-1")).toBe(true)
  const withNote = requests.find((msgs) => msgs.some((m) => m.role === "user" && m.text?.includes(marker)))!

  // Lands at the END of history (after the original prompt + the tool result) so the cached prefix holds.
  const userIdxs = withNote.flatMap((m, i) => (m.role === "user" && m.text?.includes(marker) ? [i] : []))
  const lastUserIdx = userIdxs[userIdxs.length - 1]!
  expect(withNote.slice(0, lastUserIdx).some((m) => m.role === "tool")).toBe(true)

  await waitFor(() => events.some((e) => e.type === "turn-done"))
  expect(events.map((e) => e.type)).toContain("turn-done")
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Reject when `signal` aborts (mimics a real fetch stream rejecting mid-read on abort). */
function untilAbort(signal: AbortSignal, gate?: Promise<void>): Promise<void> {
  return new Promise<void>((res, rej) => {
    if (signal.aborted) return rej(new Error("aborted"))
    signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true })
    gate?.then(res)
  })
}

test("/add!: interrupt-steer cuts the generation, keeps the partial reply, and folds the note in", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const requests: Message[][] = []
  // Turn 0 streams a partial hallucination then parks until aborted; turn 1+ completes normally.
  const streamFn: StreamFn = async function* (_p, _k, req, signal) {
    requests.push(req.messages as Message[])
    if (requests.length === 1) {
      yield { type: "text", delta: "I will rewrite the whole auth system" }
      await untilAbort(signal) // parked mid-stream; the interrupt rejects this → stream ends partial
      return
    }
    yield { type: "text", delta: "ok, keeping the old API" }
    yield { type: "usage", input: 10, output: 5 }
    yield { type: "done", stopReason: "stop" }
  }

  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)

  engine.send({ type: "prompt", text: "fix auth" })
  await waitFor(() => events.some((e) => e.type === "text" && (e as any).delta?.includes("rewrite"))) // mid-stream
  engine.send({ type: "inject", id: "chip-2", interrupt: true, text: "keep the old API, do NOT rewrite" })

  // The loop must CONTINUE (not Stop): a second request goes out with the partial reply + the note.
  await waitFor(() =>
    requests.some(
      (msgs) =>
        msgs.some((m) => m.role === "assistant" && m.text?.includes("rewrite the whole auth system")) &&
        msgs.some((m) => m.role === "user" && m.text?.includes("keep the old API")),
    ),
  )
  const withBoth = requests.find(
    (msgs) =>
      msgs.some((m) => m.role === "assistant" && m.text?.includes("rewrite the whole auth system")) &&
      msgs.some((m) => m.role === "user" && m.text?.includes("keep the old API")),
  )!
  // The note comes AFTER the truncated assistant reply.
  const aIdx = withBoth.findIndex((m) => m.role === "assistant" && m.text?.includes("rewrite the whole auth system"))
  const uIdx = withBoth.findIndex((m) => m.role === "user" && m.text?.includes("keep the old API"))
  expect(aIdx).toBeGreaterThanOrEqual(0)
  expect(uIdx).toBeGreaterThan(aIdx)

  expect(events.some((e) => e.type === "inject-attached" && (e as any).id === "chip-2")).toBe(true)
  expect(events.some((e) => e.type === "message-stop" && (e as any).interrupted === true)).toBe(true)
  await waitFor(() => events.some((e) => e.type === "turn-done")) // run continued to completion, never Stopped
  fs.rmSync(dir, { recursive: true, force: true })
})

test("true Stop during streaming still ends the turn (interrupt-steer must not regress it)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const requests: Message[][] = []
  const streamFn: StreamFn = async function* (_p, _k, req, signal) {
    requests.push(req.messages as Message[])
    yield { type: "text", delta: "working…" }
    await untilAbort(signal)
  }
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)

  engine.send({ type: "prompt", text: "do a thing" })
  await waitFor(() => events.some((e) => e.type === "text"))
  engine.send({ type: "abort" })
  await waitFor(() => events.some((e) => e.type === "status" && (e as any).text === "stopped"))
  expect(events.map((e) => e.type)).toContain("turn-done")
  // A true Stop discards the partial — only one request was ever sent (no continuation).
  expect(requests.length).toBe(1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("/add (bare, interrupt-on-open): inject-pause interrupt cuts the generation now and parks the agent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const requests: Message[][] = []
  const streamFn: StreamFn = async function* (_p, _k, req, signal) {
    requests.push(req.messages as Message[])
    if (requests.length === 1) {
      yield { type: "text", delta: "spinning up a big wrong answer" }
      await untilAbort(signal) // parked mid-stream until the interrupt-on-open cuts it
      return
    }
    yield { type: "text", delta: "ok" }
    yield { type: "done", stopReason: "stop" }
  }
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)

  engine.send({ type: "prompt", text: "go" })
  await waitFor(() => events.some((e) => e.type === "text" && (e as any).delta?.includes("wrong"))) // mid-stream
  // Opening the bare /add modal: interrupt NOW + arm the pause.
  engine.send({ type: "inject-pause", interrupt: true })
  // The generation is cut and the agent idles waiting — no second request yet.
  await waitFor(() => events.some((e) => e.type === "status" && (e as any).text === "waiting for you…"))
  expect(requests.length).toBe(1)
  expect(events.some((e) => e.type === "message-stop" && (e as any).interrupted === true)).toBe(true)

  // Send from the modal → resumes with the note folded in.
  engine.send({ type: "inject", text: "actually do the small thing" })
  await waitFor(() => requests.some((m) => m.some((x) => x.role === "user" && x.text?.includes("small thing"))))
  await waitFor(() => events.some((e) => e.type === "turn-done"))
  fs.rmSync(dir, { recursive: true, force: true })
})

test("/add: a note sent BEFORE the loop reaches the pause does not deadlock (pause disarms on input)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  fs.writeFileSync(path.join(dir, "hello.txt"), "one\ntwo\n")
  const requests: Message[][] = []
  const gate = deferred()
  // Plain gated stream: turn 0 is "running" (parked on the gate, NOT abort-aware) so the loop hasn't
  // reached its pause point yet when we arm the pause and immediately send the note.
  const streamFn = makeGatedStream(
    [
      readCall("c1", "hello.txt"),
      [
        { type: "text", delta: "done" },
        { type: "done", stopReason: "stop" },
      ],
    ],
    requests,
    gate.promise,
  )
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)

  engine.send({ type: "prompt", text: "read hello.txt" })
  await waitFor(() => requests.length >= 1)
  engine.send({ type: "inject-pause" }) // armed, but the loop is still inside turn 0 (not parked yet)
  engine.send({ type: "inject", text: "BEFORE PARK" }) // note arrives first → must disarm the pause
  gate.resolve()
  // If the pause didn't disarm, the loop would park forever waiting for a resume that never comes.
  await waitFor(() => requests.some((m) => m.some((x) => x.role === "user" && x.text?.includes("BEFORE PARK"))))
  await waitFor(() => events.some((e) => e.type === "turn-done"))
  fs.rmSync(dir, { recursive: true, force: true })
})

test("/add (bare): soft-pause idles the agent, then a sent note resumes it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  fs.writeFileSync(path.join(dir, "hello.txt"), "one\ntwo\n")
  const requests: Message[][] = []
  const gate = deferred()
  const streamFn = makeGatedStream(
    [
      readCall("c1", "hello.txt"),
      [
        { type: "text", delta: "done" },
        { type: "done", stopReason: "stop" },
      ],
    ],
    requests,
    gate.promise,
  )
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)

  engine.send({ type: "prompt", text: "read hello.txt" })
  await waitFor(() => requests.length >= 1)
  engine.send({ type: "inject-pause" }) // arm while genuinely busy (parked in turn 0)
  gate.resolve() // turn 0 finishes; step 1 should hit the armed pause and idle

  await waitFor(() => events.some((e) => e.type === "status" && (e as any).text === "waiting for you…"))
  const parked = requests.length
  await Bun.sleep(60)
  expect(requests.length).toBe(parked) // genuinely idle — no new model calls while paused

  engine.send({ type: "inject", text: "AFTER PAUSE" })
  await waitFor(() => requests.some((msgs) => msgs.some((m) => m.role === "user" && m.text?.includes("AFTER PAUSE"))))
  await waitFor(() => events.some((e) => e.type === "turn-done"))
  fs.rmSync(dir, { recursive: true, force: true })
})

test("/add (bare): aborting while soft-paused unwinds the loop (no hang)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  fs.writeFileSync(path.join(dir, "hello.txt"), "one\ntwo\n")
  const requests: Message[][] = []
  const gate = deferred()
  const streamFn = makeGatedStream(
    [
      readCall("c1", "hello.txt"),
      [
        { type: "text", delta: "done" },
        { type: "done", stopReason: "stop" },
      ],
    ],
    requests,
    gate.promise,
  )
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)

  engine.send({ type: "prompt", text: "read hello.txt" })
  await waitFor(() => requests.length >= 1)
  engine.send({ type: "inject-pause" })
  gate.resolve()
  await waitFor(() => events.some((e) => e.type === "status" && (e as any).text === "waiting for you…"))

  engine.send({ type: "abort" })
  await waitFor(() => events.some((e) => e.type === "turn-done"))
  expect(events.map((e) => e.type)).toContain("turn-done") // resolved, not hung
  fs.rmSync(dir, { recursive: true, force: true })
})

test("/add: injecting when idle behaves like a normal prompt", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const requests: Message[][] = []
  const streamFn = makeGatedStream(
    [
      [
        { type: "text", delta: "ok" },
        { type: "done", stopReason: "stop" },
      ],
    ],
    requests,
    Promise.resolve(), // no gating needed for the idle case
  )

  const engine = new Engine({ cwd: dir, streamFn })
  engine.selectModel("mock", "mock-model")
  const events = collect(engine)

  // No active turn → inject should start a turn with the text as the user prompt.
  engine.send({ type: "inject", text: "hello idle" })
  await waitFor(() => events.some((e) => e.type === "turn-done"))
  expect(requests.some((msgs) => msgs.some((m) => m.role === "user" && m.text?.includes("hello idle")))).toBe(true)
  fs.rmSync(dir, { recursive: true, force: true })
})
