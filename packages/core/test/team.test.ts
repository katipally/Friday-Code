import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { EngineEvent, ProviderEvent } from "@friday/shared"
import { Engine, type StreamFn } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-team-"))

// Every turn (workers AND the orchestrator re-prompt) just emits text and stops.
function streamFn(): StreamFn {
  return async function* () {
    yield { type: "text", delta: "done with my part" } as ProviderEvent
    yield { type: "done", stopReason: "stop" } as ProviderEvent
  }
}

test("spawn_team gathers workers and re-prompts the orchestrator (no hang, no deadlock)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-team-"))
  const engine = new Engine({ cwd: dir, streamFn: streamFn() })
  engine.send({ type: "set-mode", mode: "yolo" })
  engine.selectModel("mock", "mock-model")

  const teamEvents: Extract<EngineEvent, { type: "team" }>[] = []
  engine.subscribe((e) => {
    if (e.type === "team") teamEvents.push(e)
  })

  const orchestrator = engine.currentSessionId()
  const teamId = engine.spawnTeam(orchestrator, "build a feature", [
    { role: "backend", prompt: "do backend" },
    { role: "tests", prompt: "write tests" },
  ])
  expect(teamId).toBeTruthy()

  // initial team event: 2 members, running
  const first = teamEvents.find((e) => e.team?.status === "running")
  expect(first?.team?.members.length).toBe(2)

  // let workers run, finish, and the gather fire
  await Bun.sleep(400)

  // team converged to done
  const snap = engine.teamSnapshot()
  expect(snap?.status).toBe("done")
  expect(snap?.members.every((m) => m.status === "done")).toBe(true)

  // a "team" event with status done was broadcast
  expect(teamEvents.some((e) => e.team?.status === "done")).toBe(true)
  fs.rmSync(dir, { recursive: true, force: true })
})
