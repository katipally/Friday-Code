import { test, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cron-"))
const { parseInterval, loadCron, saveCron } = await import("../src/cron.ts")

test("parseInterval understands units and keywords", () => {
  expect(parseInterval("30s")).toBe(30_000)
  expect(parseInterval("5m")).toBe(300_000)
  expect(parseInterval("2h")).toBe(7_200_000)
  expect(parseInterval("1d")).toBe(86_400_000)
  expect(parseInterval("hourly")).toBe(3_600_000)
  expect(parseInterval("daily")).toBe(86_400_000)
  expect(parseInterval("nonsense")).toBeNull()
  expect(parseInterval("0m")).toBeNull()
})

test("cron jobs persist and round-trip", () => {
  saveCron([{ id: "a1", description: "nightly", prompt: "do it", everyMs: 86_400_000, nextRun: 123 }])
  const jobs = loadCron()
  expect(jobs).toHaveLength(1)
  expect(jobs[0]!.id).toBe("a1")
})
