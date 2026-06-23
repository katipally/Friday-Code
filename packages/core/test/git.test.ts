import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { gitCommitAll, gitDiff, gitRevParse, gitSessionChanges, gitStatus } from "../src/git.ts"

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

test("gitSessionChanges reports committed + uncommitted + removed since a base", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-gitsc-"))
  await sh(dir, ["init"])
  await sh(dir, ["config", "user.email", "t@t.t"])
  await sh(dir, ["config", "user.name", "t"])
  fs.writeFileSync(path.join(dir, "keep.txt"), "a\n")
  fs.writeFileSync(path.join(dir, "gone.txt"), "x\n")
  await sh(dir, ["add", "-A"])
  await sh(dir, ["commit", "-m", "init"])

  // Capture the base as the session would, at "session start".
  const base = await gitRevParse(dir)
  expect(base).toBeTruthy()

  // Simulate a session: COMMIT a modification, leave an UNCOMMITTED new file, and DELETE a file.
  fs.appendFileSync(path.join(dir, "keep.txt"), "b\n")
  await sh(dir, ["commit", "-am", "edit keep"]) // committed change — the snapshot tracker would lose this
  fs.writeFileSync(path.join(dir, "new.txt"), "fresh\n") // uncommitted untracked
  fs.rmSync(path.join(dir, "gone.txt")) // removal
  await sh(dir, ["add", "-A"]) // stage the deletion so the diff sees it

  const changes = await gitSessionChanges(dir, base!)
  const byPath = Object.fromEntries(changes.map((c) => [c.path, c.status]))
  expect(byPath["keep.txt"]).toBe("M") // committed edit still shows
  expect(byPath["new.txt"]).toBe("A") // uncommitted new file shows
  expect(byPath["gone.txt"]).toBe("D") // removal shows

  fs.rmSync(dir, { recursive: true, force: true })
})
