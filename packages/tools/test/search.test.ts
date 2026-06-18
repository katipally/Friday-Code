import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { globTool, grepTool } from "../src/builtin/search.ts"

test("glob + grep span all workspace roots", async () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "A-"))
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "B-"))
  fs.writeFileSync(path.join(a, "alpha.ts"), "const needle = 1")
  fs.writeFileSync(path.join(b, "beta.ts"), "const other = 2")
  const ctx = { cwd: a, roots: [a, b], signal: new AbortController().signal }

  const glob = await globTool.execute({ pattern: "**/*.ts" }, ctx)
  expect(glob.output).toContain("alpha.ts")
  expect(glob.output).toContain("beta.ts") // from the second root (relative to primary)

  const grep = await grepTool.execute({ pattern: "needle" }, ctx)
  expect(grep.output).toContain("alpha.ts")
})
