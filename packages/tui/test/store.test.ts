import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Engine, type StreamFn } from "@friday/core"
import { createRoot } from "solid-js"
import { createAppStore } from "../src/store.tsx"
import { waitFor } from "./helpers.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))
process.env.FRIDAY_NO_NOTIFY = "1"

// A stream that emits one text delta then blocks on `release` so we can switch mid-turn.
let release: (() => void) | null = null
const gatedStream: StreamFn = async function* (_p, _k, req) {
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user") as { text?: string } | undefined
  yield { type: "text", delta: `reply to ${lastUser?.text ?? ""}` }
  await new Promise<void>((r) => (release = r))
  yield { type: "done", stopReason: "stop" }
}

// All async state transitions are awaited via `waitFor` (predicate + timeout)
// rather than fixed sleeps. The store is event-driven — the runner drains the
// queue through a setTimeout(0) chain — so the time between submit / release
// and the resulting state change is non-deterministic on slow CI runners.
// `waitFor` is O(K) faster in the happy path and self-failing in the sad path.
const TIMEOUT = 5000

test("switching mid-stream keeps each session's own transcript + status", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  await createRoot(async (dispose) => {
    const engine = new Engine({ cwd: dir, streamFn: gatedStream })
    engine.send({ type: "set-mode", mode: "yolo" })
    engine.selectModel("mock", "mock-model")
    const app = createAppStore(engine)
    engine.ready()
    const s1 = app.activeSession()

    // Start a turn on s1; it streams a delta then blocks.
    app.submit("task A")
    await waitFor(() => app.busy() && app.status().includes("Responding"), { timeoutMs: TIMEOUT })
    expect(app.items().some((i) => i.kind === "assistant" && i.text.includes("task A"))).toBe(true)

    // Open a fresh session — it must NOT inherit s1's "thinking" status or transcript.
    engine.send({ type: "new-session" })
    await waitFor(
      () =>
        app.activeSession() !== s1 && app.status() === "ready" && app.items().length === 0 && app.sessionRunning(s1),
      { timeoutMs: TIMEOUT },
    )
    const s2 = app.activeSession()
    expect(s2).not.toBe(s1)
    // s1 is still busy in the background.
    expect(app.sessionRunning(s1)).toBe(true)

    // Switch back to s1 — the in-flight turn is still there (not lost on switch).
    engine.send({ type: "switch-session", sessionId: s1 })
    await waitFor(
      () =>
        app.activeSession() === s1 &&
        app.items().some((i) => i.kind === "assistant" && i.text.includes("task A")) &&
        app.busy(),
      { timeoutMs: TIMEOUT },
    )

    // Let it finish.
    release?.()
    await waitFor(() => !app.busy() && app.items().some((i) => i.kind === "assistant" && i.done), {
      timeoutMs: TIMEOUT,
    })

    dispose()
  })
  fs.rmSync(dir, { recursive: true, force: true })
})

test("a prompt submitted mid-turn is queued, then drained at the turn boundary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  await createRoot(async (dispose) => {
    const engine = new Engine({ cwd: dir, streamFn: gatedStream })
    engine.send({ type: "set-mode", mode: "yolo" })
    engine.selectModel("mock", "mock-model")
    const app = createAppStore(engine)
    engine.ready()

    app.submit("first")
    // Wait for the text delta to land in items — that signals the stream has
    // yielded and is now blocked on `release`. Without this, calling
    // `release?.()` below is a no-op (release is still null) and the queue
    // never drains. Same rationale as test 1.
    await waitFor(() => app.busy() && app.items().some((i) => i.kind === "assistant" && i.text.includes("first")), {
      timeoutMs: TIMEOUT,
    })

    // Submitting while busy queues instead of racing the engine.
    app.submit("second")
    await waitFor(() => app.queued().length === 1 && app.queued()[0] === "second", { timeoutMs: TIMEOUT })
    expect(app.items().filter((i) => i.kind === "user").length).toBe(1) // not appended yet

    // Finish the first turn → the queue drains and "second" starts.
    release?.()
    await waitFor(
      () => app.queued().length === 0 && app.items().filter((i) => i.kind === "user").length === 2 && app.busy(),
      { timeoutMs: TIMEOUT },
    )

    release?.()
    await waitFor(() => !app.busy(), { timeoutMs: TIMEOUT })
    dispose()
  })
  fs.rmSync(dir, { recursive: true, force: true })
})

test("aborting discards queued prompts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  await createRoot(async (dispose) => {
    const engine = new Engine({ cwd: dir, streamFn: gatedStream })
    engine.send({ type: "set-mode", mode: "yolo" })
    engine.selectModel("mock", "mock-model")
    const app = createAppStore(engine)
    engine.ready()

    app.submit("first")
    // Wait for the text delta (stream blocked on release) — see test 2.
    await waitFor(() => app.busy() && app.items().some((i) => i.kind === "assistant" && i.text.includes("first")), {
      timeoutMs: TIMEOUT,
    })
    app.submit("queued one")
    app.submit("queued two")
    await waitFor(() => app.queued().length === 2, { timeoutMs: TIMEOUT })

    app.abort()
    await waitFor(() => app.queued().length === 0, { timeoutMs: TIMEOUT }) // interrupting clears the queue
    release?.()
    await waitFor(() => !app.busy(), { timeoutMs: TIMEOUT })
    dispose()
  })
  fs.rmSync(dir, { recursive: true, force: true })
})
