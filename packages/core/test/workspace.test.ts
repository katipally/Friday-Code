import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Engine, SessionStore } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "friday-db-"))

const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "A-"))
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "B-"))

test("addRoot adds a directory to the session; the session appears under both roots", () => {
  const store = new SessionStore(path.join(tmp, "ws.db"))
  const a = new Engine({ cwd: dirA, store })
  const sid = a.currentSessionId()
  a.addRoot(dirB)
  expect(a.currentRoots()).toEqual([dirA, dirB])
  expect(store.get(sid)?.roots).toEqual([dirA, dirB])

  // A fresh engine opened in dirB sees the shared session in history (its roots include dirB).
  // (listSessions is now this-run "live" sessions only; cross-run sessions live in listAllSessions.)
  const b = new Engine({ cwd: dirB, store })
  expect(b.listAllSessions().some((s) => s.id === sid && s.roots.includes(dirB))).toBe(true)
})

test("setRoot starts a new session in the new directory (changing dir = new session)", () => {
  const store = new SessionStore(path.join(tmp, "ws2.db"))
  const e = new Engine({ cwd: dirA, store })
  const first = e.currentSessionId()
  e.setRoot(dirB)
  expect(e.currentSessionId()).not.toBe(first)
  expect(e.currentRoots()).toEqual([dirB])
})

test("new empty sessions stay out of history until their first real action (no duplicate rows)", () => {
  const store = new SessionStore(path.join(tmp, "ws-empty.db"))
  // Opening a session (what every `new chat` window does) must NOT write a history row.
  new Engine({ cwd: dirA, store })
  expect(store.list().length).toBe(0)
  // buildRow is in-memory; ensure() persists once and is idempotent.
  const row = store.buildRow([dirA], "id1", 1)
  expect(store.get("id1")).toBeUndefined()
  store.ensure(row)
  store.ensure(row)
  expect(store.list().filter((s) => s.id === "id1").length).toBe(1)
})

test("workspace trust is prefix-based: a subfolder of a trusted root is trusted", () => {
  const sub = fs.mkdtempSync(path.join(dirA, "nested-"))
  const e = new Engine({ cwd: sub, store: new SessionStore(path.join(tmp, "ws-trust1.db")) })
  expect(e.isCwdTrusted()).toBe(false)
  const root = new Engine({ cwd: dirA, store: new SessionStore(path.join(tmp, "ws-trust2.db")) })
  root.trustCwd() // trust the parent
  expect(e.isCwdTrusted()).toBe(true) // the subfolder is now covered
})

test("MCP config persists even if the server can't connect; removeMcpServer drops it", async () => {
  const store = new SessionStore(path.join(tmp, "ws3.db"))
  const e = new Engine({ cwd: dirA, store })
  const ok = await e.addMcpServer("x", { type: "http", url: "http://127.0.0.1:1/mcp" })
  expect(ok).toBe(false) // nothing listening
  expect(Object.keys(e.mcpConfig())).toContain("x") // but the config was saved
  e.removeMcpServer("x")
  expect(Object.keys(e.mcpConfig())).not.toContain("x")
})
