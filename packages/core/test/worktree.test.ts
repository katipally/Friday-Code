import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { gitWorktreeAdd, gitWorktreeList, gitWorktreeRemove } from "../src/git.ts"

async function git(cwd: string, ...args: string[]) {
  await Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" }).exited
}

test("gitWorktreeAdd creates a worktree on a branch; list shows it; remove cleans up", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-wt-"))
  await git(dir, "init")
  await git(dir, "config", "user.email", "t@t")
  await git(dir, "config", "user.name", "t")
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-m", "init")

  const add = await gitWorktreeAdd(dir, "feature-x")
  expect(add.ok).toBe(true)
  expect(add.path && fs.existsSync(add.path)).toBeTruthy()

  const list = await gitWorktreeList(dir)
  expect(list.some((w) => w.branch === "feature-x")).toBe(true)

  const rm = await gitWorktreeRemove(dir, "feature-x")
  expect(rm.ok).toBe(true)
  expect(add.path && fs.existsSync(add.path)).toBeFalsy()

  fs.rmSync(dir, { recursive: true, force: true })
})
