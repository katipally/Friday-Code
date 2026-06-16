import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { runHooks } from "../src/hooks.ts"

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-hooks-"))
const payload = { event: "PreToolUse" as const, session_id: "s1", cwd, tool_name: "bash" }

test("a PreToolUse hook can block a tool via JSON decision", async () => {
  const r = await runHooks("PreToolUse", { PreToolUse: [{ command: `echo '{"decision":"block","reason":"nope"}'` }] }, payload, "bash")
  expect(r.block).toBe(true)
  expect(r.reason).toBe("nope")
})

test("a non-zero exit blocks a PreToolUse tool", async () => {
  const r = await runHooks("PreToolUse", { PreToolUse: [{ command: `exit 3` }] }, payload, "bash")
  expect(r.block).toBe(true)
})

test("matcher filters which hooks run", async () => {
  const r = await runHooks("PreToolUse", { PreToolUse: [{ matcher: "write", command: `exit 1` }] }, payload, "bash")
  expect(r.block).toBe(false) // matcher 'write' doesn't match tool 'bash'
})

test("UserPromptSubmit hook stdout becomes injected context", async () => {
  const r = await runHooks(
    "UserPromptSubmit",
    { UserPromptSubmit: [{ command: `echo "remember: be terse"` }] },
    { event: "UserPromptSubmit", session_id: "s1", cwd, prompt: "hi" },
  )
  expect(r.block).toBe(false)
  expect(r.context).toContain("be terse")
})
