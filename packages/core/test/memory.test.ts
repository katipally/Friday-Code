import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-mem-"))
const { saveMemory, listMemory, deleteMemory, memoryDigest } = await import("../src/memory.ts")

test("save → list → digest → delete round-trips", () => {
  saveMemory("indent style", "Use 2-space indent for web files.")
  expect(listMemory().some((f) => f.name === "indent-style")).toBe(true)
  expect(memoryDigest()).toContain("Use 2-space indent")
  expect(deleteMemory("indent style")).toBe(true)
  expect(listMemory()).toHaveLength(0)
  expect(memoryDigest()).toBe("")
})
