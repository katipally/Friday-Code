import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { gitStatus, gitDiff, gitCommitAll } from "../src/git.ts"

async function sh(cwd: string, args: string[]): Promise<void> {
  await Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" }).exited
}

test("git status / diff / commit round-trip on a fresh repo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-git-"))
  await sh(dir, ["init"])
  await sh(dir, ["config", "user.email", "t@t.t"])
  await sh(dir, ["config", "user.name", "t"])
  fs.writeFileSync(path.join(dir, "a.txt"), "hello\n")
  await sh(dir, ["add", "-A"])
  await sh(dir, ["commit", "-m", "init"])

  // Non-repo dir reports repo:false.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "friday-norepo-"))
  expect((await gitStatus(tmp)).repo).toBe(false)

  // Dirty the tree.
  fs.appendFileSync(path.join(dir, "a.txt"), "world\n")
  const st = await gitStatus(dir)
  expect(st.repo).toBe(true)
  expect(st.dirty).toBe(true)
  expect(st.files.some((f) => f.path === "a.txt")).toBe(true)

  const diff = await gitDiff(dir)
  expect(diff).toContain("world")

  const res = await gitCommitAll(dir, "chore: add world")
  expect(res.ok).toBe(true)
  expect((await gitStatus(dir)).dirty).toBe(false)

  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
})
