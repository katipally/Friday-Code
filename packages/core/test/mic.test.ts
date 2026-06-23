import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { decodeWav, micSetupSteps, micStatus } from "../src/mic.ts"

// The mic setup screen shows iff the mic isn't ready — `ready` must track micStatus().ok exactly,
// and the checklist must never be empty (the user always needs to see what to do).
test("micSetupSteps: ready tracks micStatus, lines are always actionable", () => {
  const steps = micSetupSteps()
  expect(steps.ready).toBe(micStatus().ok)
  expect(steps.lines.length).toBeGreaterThan(0)
  expect(steps.lines.every((l) => typeof l === "string" && l.length > 0)).toBe(true)
})

// Live transcription reads a WAV that's still being written, so its data-chunk size is a placeholder
// (0 here). decodeWav must fall back to the bytes actually on disk instead of returning nothing.
test("decodeWav: decodes a WAV whose data-chunk size is an unfinished placeholder", () => {
  const samples = 1600 // 0.1s @ 16kHz mono
  const buf = Buffer.alloc(44 + samples * 2)
  buf.write("RIFF", 0, "ascii")
  buf.writeUInt32LE(0, 4) // unfinished RIFF size
  buf.write("WAVE", 8, "ascii")
  buf.write("fmt ", 12, "ascii")
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(16000, 24)
  buf.writeUInt32LE(32000, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34) // 16-bit
  buf.write("data", 36, "ascii")
  buf.writeUInt32LE(0, 40) // placeholder data size — recorder hasn't closed the file yet
  for (let i = 0; i < samples; i++) buf.writeInt16LE(1000, 44 + i * 2)
  const file = path.join(os.tmpdir(), `friday-mic-test-${process.pid}.wav`)
  fs.writeFileSync(file, buf)
  try {
    const out = decodeWav(file)
    expect(out?.length).toBe(samples)
    expect(out![0]).toBeCloseTo(1000 / 32768, 4)
  } finally {
    fs.unlinkSync(file)
  }
})
