import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expandMentions } from "../src/index.ts"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "friday-men-"))
fs.writeFileSync(path.join(root, "a.txt"), "L1\nL2\nL3\nL4\nL5\n")

test("@file inlines the whole file", () => {
  const { text, files } = expandMentions("see @a.txt", [root])
  expect(files).toEqual(["a.txt"])
  expect(text).toContain('<file path="a.txt">')
  expect(text).toContain("L1\nL2\nL3\nL4\nL5")
})

test("@file#Lx-y inlines only that 1-based inclusive range", () => {
  const { text, files } = expandMentions("look at @a.txt#L2-4", [root])
  expect(files).toEqual(["a.txt#L2-4"])
  expect(text).toContain('<file path="a.txt#L2-4">')
  const block = text.split('<file path="a.txt#L2-4">')[1]!
  expect(block).toContain("L2\nL3\nL4")
  expect(block).not.toContain("L1")
  expect(block).not.toContain("L5")
})

test("@file#Lx inlines a single line", () => {
  const { text } = expandMentions("@a.txt#L3", [root])
  const block = text.split('<file path="a.txt#L3">')[1]!.split("</file>")[0]!
  expect(block.trim()).toBe("L3")
})
