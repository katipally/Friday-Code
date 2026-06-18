import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ProviderEvent } from "@friday/shared"
import { Engine, SessionStore, type StreamFn } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

function scripted(turns: ProviderEvent[][]): StreamFn {
  let i = 0
  return async function* () {
    const t = turns[Math.min(i, turns.length - 1)]!
    i++
    for (const e of t) yield e
  }
}

// Poll until the file reaches the expected content (or time out). The tool runs async after
// send(); a fixed sleep under-waits on slower CI runners (notably Windows).
async function waitForContent(file: string, expected: string, timeoutMs = 3000): Promise<void> {
  const start = Bun.nanoseconds()
  while ((Bun.nanoseconds() - start) / 1e6 < timeoutMs) {
    try {
      if (fs.readFileSync(file, "utf8") === expected) return
    } catch {
      /* not written yet */
    }
    await Bun.sleep(20)
  }
}

function toolTurn(id: string, name: string, args: object): ProviderEvent[] {
  return [
    { type: "tool_start", index: 0, id, name },
    { type: "tool_delta", index: 0, argsDelta: JSON.stringify(args) },
    { type: "done", stopReason: "tool_use" },
  ]
}

test("undo rewinds files + conversation; redo re-applies", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cp-"))
  const store = new SessionStore(path.join(cwd, "s.db"))
  const file = path.join(cwd, "foo.txt")

  const engine = new Engine({
    cwd,
    store,
    streamFn: scripted([
      toolTurn("w", "write", { path: "foo.txt", content: "v1" }), // turn A
      [
        { type: "text", delta: "made v1" },
        { type: "done", stopReason: "stop" },
      ],
      toolTurn("e", "edit", { path: "foo.txt", old_string: "v1", new_string: "v2" }), // turn B
      [
        { type: "text", delta: "made v2" },
        { type: "done", stopReason: "stop" },
      ],
    ]),
  })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "m")

  engine.send({ type: "prompt", text: "create foo" })
  await waitForContent(file, "v1")
  expect(fs.readFileSync(file, "utf8")).toBe("v1")

  engine.send({ type: "prompt", text: "change foo to v2" })
  await waitForContent(file, "v2")
  expect(fs.readFileSync(file, "utf8")).toBe("v2")

  const cps = engine.listCheckpoints()
  expect(cps.length).toBe(2)
  expect(cps[0]!.label).toBe("change foo to v2") // newest first

  // Rewind the second turn: file back to v1, conversation drops turn B.
  engine.restoreCheckpoint(cps[0]!.id)
  expect(fs.readFileSync(file, "utf8")).toBe("v1")
  expect(
    store.loadMessages(engine.currentSessionId()).some((m) => m.role === "user" && m.text.includes("change foo")),
  ).toBe(false)
  expect(engine.hasRedo()).toBe(true)

  // Redo: file back to v2.
  engine.redoLast()
  expect(fs.readFileSync(file, "utf8")).toBe("v2")
})
