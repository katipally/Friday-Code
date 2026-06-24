import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { EngineEvent, ProviderEvent } from "@friday/shared"
import { Engine, SessionStore, type StreamFn } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "friday-db-"))

const textOnly: StreamFn = async function* () {
  const evs: ProviderEvent[] = [
    { type: "text", delta: "ok" },
    { type: "done", stopReason: "stop" },
  ]
  for (const e of evs) yield e
}

test("SessionStore: presence heartbeat / staleness / pid-prune / control", () => {
  const store = new SessionStore(path.join(tmp, "presence.db"))
  // A row from THIS process (alive pid) and one from a fake dead pid.
  store.heartbeat([
    { sessionId: "s1", pid: process.pid, root: "/proj", title: "alpha", kind: "session", busy: true },
    { sessionId: "t1", pid: process.pid, root: "/proj", title: "task", kind: "task", busy: false },
  ])
  // Fresh rows are visible, scoped by root.
  expect(store.livePresence(10_000, "/proj").map((p) => p.sessionId).sort()).toEqual(["s1", "t1"])
  expect(store.livePresence(10_000, "/other").length).toBe(0)
  // busy flag round-trips.
  expect(store.livePresence(10_000).find((p) => p.sessionId === "s1")?.busy).toBe(true)
  // Staleness: a 0ms freshness window hides everything (all heartbeats are "old").
  expect(store.livePresence(0).length).toBe(0)
  // Dead-pid prune removes that pid's rows; live pid survives.
  store.heartbeat([{ sessionId: "z1", pid: 2 ** 30, root: "/proj", title: "ghost", kind: "task", busy: false }])
  store.prunePresence(10_000)
  expect(store.livePresence(10_000).some((p) => p.sessionId === "z1")).toBe(false)
  expect(store.livePresence(10_000).some((p) => p.sessionId === "s1")).toBe(true)
  // Control: a queued stop is taken exactly once.
  store.requestControl("s1", "stop")
  expect(store.takeControl(["s1"]).map((c) => c.action)).toEqual(["stop"])
  expect(store.takeControl(["s1"]).length).toBe(0)
  // Dropping presence clears a row.
  store.dropPresence("s1")
  expect(store.livePresence(10_000).some((p) => p.sessionId === "s1")).toBe(false)
})

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

test("Engine restores a session's own model/mode/effort on resume (per-session, not global default)", async () => {
  const store = new SessionStore(path.join(tmp, "meta.db"))
  // Session 1: pick model-A, yolo, high — and run a prompt so the session + its meta persist.
  const e1 = new Engine({ cwd: "/x", streamFn: textOnly, store })
  e1.selectModel("mock", "model-A", true, 4242)
  e1.send({ type: "set-mode", mode: "yolo" })
  e1.send({ type: "set-effort", effort: "high" })
  e1.send({ type: "prompt", text: "do a thing" })
  await Bun.sleep(20)
  const id = e1.currentSessionId()
  // The selection was written to THIS session's meta (not just global config).
  expect(store.loadMeta(id).model).toBe("model-A")
  expect(store.loadMeta(id).mode).toBe("yolo")
  expect(store.loadMeta(id).effort).toBe("high")

  // Shift the GLOBAL default to model-B via a separate session, so a correct resume can only get
  // model-A/yolo/high back from session 1's own meta.
  const e2 = new Engine({ cwd: "/y", streamFn: textOnly, store })
  e2.selectModel("mock", "model-B")
  e2.send({ type: "set-mode", mode: "plan" })

  // Resume session 1 — its own selection must come back, overriding the new global default.
  const e3 = new Engine({ cwd: "/x", streamFn: textOnly, store, resumeId: id })
  const sel = e3.selection()
  expect(sel.model).toBe("model-A")
  expect(sel.mode).toBe("yolo")
  expect(sel.effort).toBe("high")
  expect(sel.reasoning).toBe(true)
  expect(sel.contextWindow).toBe(4242)
})

test("pinned context files persist and restore on resume", async () => {
  const store = new SessionStore(path.join(tmp, "pins.db"))
  const e1 = new Engine({ cwd: "/x", streamFn: textOnly, store })
  e1.send({ type: "prompt", text: "start" })
  await Bun.sleep(20)
  const id = e1.currentSessionId()

  e1.pinContextFile("README.md")
  expect(e1.contextInfo().pinned).toContain("README.md")
  expect(store.loadPinned(id)).toContain("README.md") // persisted, not just in memory

  e1.unpinContextFile("README.md")
  expect(e1.contextInfo().pinned).not.toContain("README.md")
  e1.pinContextFile("docs/spec.md")

  const e2 = new Engine({ cwd: "/x", streamFn: textOnly, store, resumeId: id })
  expect(e2.contextInfo().pinned).toEqual(["docs/spec.md"]) // restored exactly on resume
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

test("empty sessions are reused by /new and discarded on switch", async () => {
  const store = new SessionStore(path.join(tmp, "empty.db"))
  const e = new Engine({ cwd: "/e", streamFn: textOnly, store })
  e.selectModel("mock", "m")

  // The initial session is empty — /new should reuse it instead of spawning a duplicate.
  const a = e.currentSessionId()
  e.newSession()
  expect(e.currentSessionId()).toBe(a)
  expect(e.listSessions().length).toBe(1)

  // Once it has a message it's real; /new now creates a genuine second session.
  e.send({ type: "prompt", text: "hi" })
  await Bun.sleep(20)
  e.newSession()
  const b = e.currentSessionId()
  expect(b).not.toBe(a)
  expect(e.listSessions().length).toBe(2)

  // Switching away from the still-empty `b` discards it (never reaches history).
  e.switchSession(a)
  expect(e.listSessions().length).toBe(1)
  expect(e.listSessions()[0]!.id).toBe(a)
  expect(store.get(b)).toBeUndefined()
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
