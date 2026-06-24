import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { EngineEvent, ProviderEvent } from "@friday/shared"
import { Engine, type StreamFn } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

/** Stream script keyed by turn index, shared by main + subagent (turn counter is global to the fn). */
function makeStreamFn(scripts: ProviderEvent[][]): StreamFn {
  let turn = 0
  return async function* () {
    const events = scripts[Math.min(turn, scripts.length - 1)]!
    turn++
    for (const e of events) yield e
  }
}

test("inline agent delegation: spawns a child, surfaces it in the agent tree, returns its summary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-deleg-"))
  // turn 0: main agent calls the `agent` tool inline. turn 1: the subagent answers with text.
  const streamFn = makeStreamFn([
    [
      {
        type: "tool_start",
        index: 0,
        id: "c1",
        name: "agent",
      } as ProviderEvent,
      {
        type: "tool_delta",
        index: 0,
        argsDelta: JSON.stringify({ description: "find it", prompt: "where?", subagent_type: "explore" }),
      } as ProviderEvent,
      { type: "done", stopReason: "tool_use" } as ProviderEvent,
    ],
    [
      { type: "text", delta: "found in src/foo.ts" } as ProviderEvent,
      { type: "done", stopReason: "stop" } as ProviderEvent,
    ],
    // turn 2: main agent wraps up after receiving the subagent summary.
    [{ type: "text", delta: "done" } as ProviderEvent, { type: "done", stopReason: "stop" } as ProviderEvent],
  ])
  const engine = new Engine({ cwd: dir, streamFn })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")

  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))

  engine.send({ type: "prompt", text: "investigate" })
  await Bun.sleep(250)

  // The agent tree now has the main agent plus the spawned explore subagent.
  const tree = [...events].reverse().find((e) => e.type === "agents") as (EngineEvent & { type: "agents" }) | undefined
  expect(tree).toBeTruthy()
  expect(tree!.items.some((a) => a.isMain)).toBe(true)
  expect(tree!.items.some((a) => a.name === "explore")).toBe(true)

  // The subagent's summary came back into the main transcript as the agent tool's result.
  const toolResult = events.find((e) => e.type === "tool-result" && (e as any).output?.includes("found in src/foo.ts"))
  expect(toolResult).toBeTruthy()
  fs.rmSync(dir, { recursive: true, force: true })
})
