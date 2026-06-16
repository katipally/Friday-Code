import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import type { EngineEvent, StreamFn } from "@friday/core"
import { Engine } from "@friday/core"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

const usageStream: StreamFn = async function* () {
  yield { type: "usage", input: 1_000_000, output: 500_000 }
  yield { type: "text", delta: "ok" }
  yield { type: "done", stopReason: "stop" }
}

test("usage events carry a computed costUsd from the model's pricing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-test-"))
  const engine = new Engine({ cwd: dir, streamFn: usageStream })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model", false, 200_000, { input: 3, output: 15 })

  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.send({ type: "prompt", text: "hi" })
  await Bun.sleep(20)

  const usage = events.find((e) => e.type === "usage") as Extract<EngineEvent, { type: "usage" }>
  expect(usage).toBeTruthy()
  // 1M input @ $3 + 0.5M output @ $15 = 3 + 7.5 = 10.5
  expect(usage.costUsd).toBeCloseTo(10.5, 5)

  fs.rmSync(dir, { recursive: true, force: true })
})
