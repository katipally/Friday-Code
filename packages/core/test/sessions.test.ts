import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import type { EngineEvent, ProviderEvent } from "@friday/shared"
import { Engine, SessionStore, type StreamFn } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "friday-db-"))

const textOnly: StreamFn = async function* () {
  const evs: ProviderEvent[] = [{ type: "text", delta: "ok" }, { type: "done", stopReason: "stop" }]
  for (const e of evs) yield e
}

test("SessionStore: create / append / load / rename / list", () => {
  const store = new SessionStore(path.join(tmp, "store.db"))
  store.create("/cwd", "id1", 1000)
  store.appendMessage("id1", 0, { role: "user", text: "hi" })
  store.appendMessage("id1", 1, { role: "assistant", text: "hello" })
  expect(store.loadMessages("id1").length).toBe(2)
  store.rename("id1", "my title", 2000)
  expect(store.get("id1")?.title).toBe("my title")
  expect(store.list().length).toBe(1)
})

test("Engine resumes a persisted session", async () => {
  const store = new SessionStore(path.join(tmp, "engine.db"))
  const e1 = new Engine({ cwd: "/x", streamFn: textOnly, store })
  e1.selectModel("mock", "m")
  e1.send({ type: "prompt", text: "remember this" })
  await Bun.sleep(20)
  const id = e1.currentSessionId()
  expect(e1.currentTitle()).toBe("Remember this")

  const e2 = new Engine({ cwd: "/x", streamFn: textOnly, store, resumeId: id })
  const events: EngineEvent[] = []
  e2.subscribe((e) => events.push(e))
  e2.ready()
  const loaded = events.find((e) => e.type === "session-loaded") as Extract<EngineEvent, { type: "session-loaded" }>
  expect(loaded).toBeTruthy()
  expect(loaded.messages.some((m) => m.role === "user" && m.text === "remember this")).toBe(true)
})

test("title is derived cleanly from the first prompt (mentions stripped)", async () => {
  const store = new SessionStore(path.join(tmp, "title.db"))
  const e = new Engine({ cwd: "/z", streamFn: textOnly, store })
  e.selectModel("mock", "m")
  e.send({ type: "prompt", text: "add a dark theme toggle @src/app.ts please." })
  await Bun.sleep(20)
  expect(e.currentTitle()).toBe("Add a dark theme toggle please")
})

test("delete session removes it; deleting the active one falls back", async () => {
  const store = new SessionStore(path.join(tmp, "del.db"))
  const e = new Engine({ cwd: "/d", streamFn: textOnly, store })
  e.selectModel("mock", "m")
  e.send({ type: "prompt", text: "one" })
  await Bun.sleep(20)
  const first = e.currentSessionId()
  e.newSession()
  const second = e.currentSessionId()
  expect(e.listSessions().length).toBe(2)
  // delete the non-active one
  e.deleteSession(first)
  expect(e.listSessions().length).toBe(1)
  expect(e.currentSessionId()).toBe(second)
  // delete the active one -> falls back to a fresh session
  e.deleteSession(second)
  expect(e.currentSessionId()).not.toBe(second)
})

test("listAllSessions spans directories", async () => {
  const store = new SessionStore(path.join(tmp, "all.db"))
  const a = new Engine({ cwd: "/dirA", streamFn: textOnly, store })
  a.selectModel("mock", "m")
  a.send({ type: "prompt", text: "in A" })
  await Bun.sleep(20)
  const b = new Engine({ cwd: "/dirB", streamFn: textOnly, store })
  b.send({ type: "prompt", text: "in B" })
  await Bun.sleep(20)
  const all = b.listAllSessions()
  const dirs = new Set(all.map((s) => s.cwd))
  expect(dirs.has("/dirA")).toBe(true)
  expect(dirs.has("/dirB")).toBe(true)
})

test("Engine new + switch session", async () => {
  const store = new SessionStore(path.join(tmp, "switch.db"))
  const e = new Engine({ cwd: "/y", streamFn: textOnly, store })
  e.selectModel("mock", "m")
  e.send({ type: "prompt", text: "first" })
  await Bun.sleep(20)
  const first = e.currentSessionId()
  e.newSession()
  expect(e.currentSessionId()).not.toBe(first)
  e.send({ type: "prompt", text: "second" })
  await Bun.sleep(20)
  expect(e.listSessions().length).toBe(2)

  const events: EngineEvent[] = []
  e.subscribe((ev) => events.push(ev))
  e.switchSession(first)
  const loaded = events.find((ev) => ev.type === "session-loaded") as Extract<EngineEvent, { type: "session-loaded" }>
  expect(loaded.messages.some((m) => m.role === "user" && m.text === "first")).toBe(true)
})
