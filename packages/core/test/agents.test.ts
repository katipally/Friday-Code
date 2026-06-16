import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import type { EngineEvent, ProviderEvent } from "@friday/shared"
import { Engine, loadSkills, type StreamFn } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

function scripted(turns: ProviderEvent[][]): StreamFn {
  let i = 0
  return async function* () {
    const t = turns[Math.min(i, turns.length - 1)]!
    i++
    for (const e of t) yield e
  }
}

function cwdWithSkill(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const dir = path.join(cwd, ".friday", "skills")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "foo.md"), "---\ndescription: do the foo\nwhenToUse: foo tasks\n---\nDo the foo thing carefully.")
  fs.mkdirSync(path.join(dir, "bar"), { recursive: true })
  fs.writeFileSync(path.join(dir, "bar", "SKILL.md"), "---\nname: bar\ndescription: the bar skill\n---\nBar instructions.")
  return cwd
}

test("loadSkills reads flat files and SKILL.md directories", () => {
  const cwd = cwdWithSkill()
  const skills = loadSkills([cwd])
  expect(skills.find((s) => s.name === "foo")?.whenToUse).toBe("foo tasks")
  expect(skills.find((s) => s.name === "bar")?.content).toBe("Bar instructions.")
})

test("skill tool loads the skill's instructions as the tool result", async () => {
  const cwd = cwdWithSkill()
  const engine = new Engine({
    cwd,
    streamFn: scripted([
      [
        { type: "tool_start", index: 0, id: "c1", name: "skill" },
        { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ name: "foo" }) },
        { type: "done", stopReason: "tool_use" },
      ],
      [{ type: "text", delta: "done" }, { type: "done", stopReason: "stop" }],
    ]),
  })
  engine.selectModel("mock", "m")
  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.send({ type: "prompt", text: "use the foo skill" })
  await Bun.sleep(30)
  const result = events.find((e) => e.type === "tool-result") as Extract<EngineEvent, { type: "tool-result" }>
  expect(result.output).toContain("Do the foo thing carefully.")
})

test("task tool runs a read-only sub-agent and returns its summary", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const engine = new Engine({
    cwd,
    streamFn: scripted([
      // main turn 1: spawn a task
      [
        { type: "tool_start", index: 0, id: "t1", name: "task" },
        { type: "tool_delta", index: 0, argsDelta: JSON.stringify({ description: "scan", prompt: "find the entrypoint", agent: "explore" }) },
        { type: "done", stopReason: "tool_use" },
      ],
      // sub-agent turn: returns text, no tools
      [{ type: "text", delta: "The entrypoint is src/index.ts." }, { type: "done", stopReason: "stop" }],
      // main turn 2: final answer
      [{ type: "text", delta: "Summary: entrypoint located." }, { type: "done", stopReason: "stop" }],
    ]),
  })
  engine.selectModel("mock", "m")
  const events: EngineEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.send({ type: "prompt", text: "where is the entrypoint?" })
  await Bun.sleep(40)
  const taskResult = events.find((e) => e.type === "tool-result") as Extract<EngineEvent, { type: "tool-result" }>
  expect(taskResult.output).toContain("entrypoint is src/index.ts")
  const text = events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")
  expect(text).toContain("Summary: entrypoint located")
})
