import { expect, test } from "bun:test"
import { micSetupSteps, micStatus } from "../src/mic.ts"

// The mic setup screen shows iff the mic isn't ready — `ready` must track micStatus().ok exactly,
// and the checklist must never be empty (the user always needs to see what to do).
test("micSetupSteps: ready tracks micStatus, lines are always actionable", () => {
  const steps = micSetupSteps()
  expect(steps.ready).toBe(micStatus().ok)
  expect(steps.lines.length).toBeGreaterThan(0)
  expect(steps.lines.every((l) => typeof l === "string" && l.length > 0)).toBe(true)
})
