import { expect, test } from "bun:test"
import { voiceSetupSteps, voiceStatus } from "../src/voice.ts"

// The voice setup screen shows iff voice isn't ready — `ready` must track voiceStatus().ok exactly,
// and the checklist must never be empty (the user always needs to see what to do).
test("voiceSetupSteps: ready tracks voiceStatus, lines are always actionable", () => {
  const steps = voiceSetupSteps()
  expect(steps.ready).toBe(voiceStatus().ok)
  expect(steps.lines.length).toBeGreaterThan(0)
  // every checklist item is prefixed ✓ (done) or • (todo), or is a plain context/heading line
  expect(steps.lines.every((l) => typeof l === "string" && l.length > 0)).toBe(true)
})
