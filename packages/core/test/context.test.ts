import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { expandMentions, loadCommands, loadProjectContext } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

test("expandMentions inlines @file contents", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  fs.writeFileSync(path.join(cwd, "foo.ts"), "export const x = 1")
  const { text, files } = expandMentions("look at @foo.ts please", [cwd])
  expect(files).toEqual(["foo.ts"])
  expect(text).toContain('<file path="foo.ts">')
  expect(text).toContain("export const x = 1")
})

test("loadProjectContext finds FRIDAY.md", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  fs.writeFileSync(path.join(cwd, "FRIDAY.md"), "Always write tests.")
  const ctx = loadProjectContext([cwd])
  expect(ctx.files).toContain("FRIDAY.md")
  expect(ctx.content).toContain("Always write tests.")
})

test("loadCommands reads markdown slash commands with frontmatter", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cwd-"))
  const dir = path.join(cwd, ".friday", "commands")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "review.md"), "---\ndescription: review the diff\n---\nReview the current changes.")
  const cmds = loadCommands([cwd])
  const review = cmds.find((c) => c.name === "review")
  expect(review?.description).toBe("review the diff")
  expect(review?.template).toBe("Review the current changes.")
})
