import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { bashTool } from "../src/builtin/bash.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The resource-leak fix: aborting a bash command must kill the WHOLE process group, so children it
// forked (dev servers, watchers, backgrounded subshells) die too instead of orphaning.
test("bash: aborting kills the child process tree, not just the shell", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-bash-"))
  const marker = path.join(dir, "MARKER")
  const ac = new AbortController()
  // Fork a backgrounded subshell that creates MARKER after 1s, while the main shell blocks.
  const run = bashTool.execute(
    { command: `(sleep 1; touch ${marker}) & echo started; sleep 5` },
    { cwd: dir, roots: [dir], signal: ac.signal },
  )
  await sleep(250)
  ac.abort() // kill the group before the 1s child can fire
  await run // resolves promptly once the tree is gone (no 5s hang)
  await sleep(1200) // past when the orphan would have touched MARKER
  expect(fs.existsSync(marker)).toBe(false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("bash: normal command returns output", async () => {
  const r = await bashTool.execute(
    { command: "echo hi" },
    { cwd: os.tmpdir(), roots: [os.tmpdir()], signal: undefined as any },
  )
  expect(r.output).toContain("hi")
})
