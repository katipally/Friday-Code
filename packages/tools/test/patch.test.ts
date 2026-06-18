import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { applyPatchTool } from "../src/builtin/patch.ts"

function ctxFor(dir: string) {
  return { cwd: dir, roots: [dir], signal: new AbortController().signal }
}

test("apply_patch modifies an existing file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-"))
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\n")
  const patch = ["--- a/a.txt", "+++ b/a.txt", "@@ -1,3 +1,3 @@", " one", "-two", "+TWO", " three"].join("\n")
  const res = await applyPatchTool.execute({ patch }, ctxFor(dir))
  expect(res.isError).toBeFalsy()
  expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("one\nTWO\nthree\n")
})

test("apply_patch creates a new file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-"))
  const patch = ["--- /dev/null", "+++ b/sub/new.txt", "@@ -0,0 +1,2 @@", "+hello", "+world"].join("\n")
  const res = await applyPatchTool.execute({ patch }, ctxFor(dir))
  expect(res.isError).toBeFalsy()
  expect(fs.readFileSync(path.join(dir, "sub/new.txt"), "utf8")).toBe("hello\nworld")
})

test("apply_patch deletes a file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-"))
  fs.writeFileSync(path.join(dir, "gone.txt"), "bye\n")
  const patch = ["--- a/gone.txt", "+++ /dev/null", "@@ -1 +0,0 @@", "-bye"].join("\n")
  const res = await applyPatchTool.execute({ patch }, ctxFor(dir))
  expect(res.isError).toBeFalsy()
  expect(fs.existsSync(path.join(dir, "gone.txt"))).toBe(false)
})

test("apply_patch spans multiple files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-"))
  fs.writeFileSync(path.join(dir, "x.txt"), "x1\n")
  fs.writeFileSync(path.join(dir, "y.txt"), "y1\n")
  const patch = [
    "--- a/x.txt",
    "+++ b/x.txt",
    "@@ -1 +1 @@",
    "-x1",
    "+x2",
    "--- a/y.txt",
    "+++ b/y.txt",
    "@@ -1 +1 @@",
    "-y1",
    "+y2",
  ].join("\n")
  const res = await applyPatchTool.execute({ patch }, ctxFor(dir))
  expect(res.isError).toBeFalsy()
  expect(fs.readFileSync(path.join(dir, "x.txt"), "utf8")).toContain("x2")
  expect(fs.readFileSync(path.join(dir, "y.txt"), "utf8")).toContain("y2")
})
