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
