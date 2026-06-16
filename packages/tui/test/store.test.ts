import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { createRoot } from "solid-js"
import { Engine, type StreamFn } from "@friday/core"
import { createAppStore } from "../src/store.tsx"

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
    await Bun.sleep(20)
    expect(app.busy()).toBe(true)
    expect(app.items().some((i) => i.kind === "assistant" && i.text.includes("task A"))).toBe(true)
    expect(app.status()).toContain("thinking")

    // Open a fresh session — it must NOT inherit s1's "thinking" status or transcript.
    engine.send({ type: "new-session" })
    await Bun.sleep(20)
    const s2 = app.activeSession()
    expect(s2).not.toBe(s1)
    expect(app.status()).toBe("ready")
    expect(app.items().length).toBe(0)
    // s1 is still busy in the background.
    expect(app.sessionRunning(s1)).toBe(true)

    // Switch back to s1 — the in-flight turn is still there (not lost on switch).
    engine.send({ type: "switch-session", sessionId: s1 })
    await Bun.sleep(20)
    expect(app.activeSession()).toBe(s1)
    expect(app.items().some((i) => i.kind === "assistant" && i.text.includes("task A"))).toBe(true)
    expect(app.busy()).toBe(true)

    // Let it finish.
    release?.()
    await Bun.sleep(20)
    expect(app.busy()).toBe(false)
    expect(app.items().some((i) => i.kind === "assistant" && i.done)).toBe(true)

    dispose()
  })
  fs.rmSync(dir, { recursive: true, force: true })
})
