import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import type { ChatRequest, EngineEvent, ProviderEvent } from "@friday/shared"
import { Engine, loadAgents, type StreamFn } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

function scripted(turns: ProviderEvent[][]): StreamFn {
  let i = 0
  return async function* () {
    const t = turns[Math.min(i, turns.length - 1)]!
    i++
    for (const e of t) yield e
  }
}

/** A stream fn that records every request it receives, then replays scripted turns. */
function capturing(turns: ProviderEvent[][], sink: ChatRequest[]): StreamFn {
  let i = 0
  return async function* (_p, _k, req) {
    sink.push(req)
    const t = turns[Math.min(i, turns.length - 1)]!
    i++
    for (const e of t) yield e
  }
}

function cwdWithAgent(body: string, meta: string): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const dir = path.join(cwd, ".friday", "agents")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "reviewer.md"), `---\n${meta}\n---\n${body}`)
  return cwd
}

test("loadAgents parses name/description/tools/model from frontmatter", () => {
  const cwd = cwdWithAgent("You are a code reviewer.", "name: reviewer\ndescription: reviews code\ntools: grep, glob\nmodel: some-model")
  const agents = loadAgents([cwd])
  const a = agents.find((x) => x.name === "reviewer")!
  expect(a.description).toBe("reviews code")
  expect(a.tools).toEqual(["grep", "glob"])
  expect(a.model).toBe("some-model")
  expect(a.content).toBe("You are a code reviewer.")
})

test("a custom agent supplies the sub-agent's prompt and narrows its tools", async () => {
  const cwd = cwdWithAgent("You are a meticulous code reviewer.", "name: reviewer\ndescription: reviews code\ntools: grep")
  const requests: ChatRequest[] = []
  const engine = new Engine({
    cwd,
    streamFn: capturing(
      [
        // main turn 1: spawn the custom agent
        [
          { type: "tool_start", index: 0, id: "t1", name: "task" },
          { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ description: "review", prompt: "review the diff", agent: "reviewer" }) },
          { type: "done", stopReason: "tool_use" },
        ],
        // sub-agent turn: returns text, no tools
        [{ type: "text", delta: "Looks good." }, { type: "done", stopReason: "stop" }],
        // main turn 2: final answer
        [{ type: "text", delta: "Done." }, { type: "done", stopReason: "stop" }],
      ],
      requests,
    ),
  })
  engine.selectModel("mock", "m")
  engine.send({ type: "prompt", text: "review please" })
  await Bun.sleep(40)

  // requests[1] is the sub-agent's first turn.
  const sub = requests[1]!
  expect((sub.messages[0] as any).text).toContain("meticulous code reviewer")
  expect((sub.messages[0] as any).text).toContain("READ-ONLY")
  // Tools are narrowed to the agent's allowlist (only grep).
  expect(sub.tools.map((t) => t.name)).toEqual(["grep"])
})

test("sub-agent tool calls fire the PreToolUse hook", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const marker = path.join(cwd, "pretool-fired")
  // A PreToolUse hook (loaded from FRIDAY_HOME/config.json) that touches a marker file.
  fs.writeFileSync(
    path.join(process.env.FRIDAY_HOME!, "config.json"),
    JSON.stringify({ hooks: { PreToolUse: [{ command: `touch ${marker}` }] } }),
  )
  const engine = new Engine({
    cwd,
    streamFn: scripted([
      // main turn: spawn an explore sub-agent
      [
        { type: "tool_start", index: 0, id: "t1", name: "task" },
        { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ description: "scan", prompt: "search", agent: "explore" }) },
        { type: "done", stopReason: "tool_use" },
      ],
      // sub-agent step 0: call a read tool (grep)
      [
        { type: "tool_start", index: 0, id: "g1", name: "grep" },
        { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ pattern: "x" }) },
        { type: "done", stopReason: "tool_use" },
      ],
      // sub-agent step 1: finish
      [{ type: "text", delta: "nothing found" }, { type: "done", stopReason: "stop" }],
      // main turn 2: final answer
      [{ type: "text", delta: "done" }, { type: "done", stopReason: "stop" }],
    ]),
  })
  engine.selectModel("mock", "m")
  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.send({ type: "prompt", text: "go" })
  await Bun.sleep(60)

  expect(fs.existsSync(marker)).toBe(true)
  // clean up the global hook config so it doesn't leak into other tests in this file
  fs.writeFileSync(path.join(process.env.FRIDAY_HOME!, "config.json"), JSON.stringify({}))
})
