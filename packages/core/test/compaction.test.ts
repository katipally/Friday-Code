import { test, expect } from "bun:test"
import type { Message } from "@friday/shared"
import { estimateTokens, safeCutIndex, renderTranscript } from "../src/compaction.ts"

const convo: Message[] = [
  { role: "user", text: "first request" },
  { role: "assistant", toolCalls: [{ id: "c1", name: "read", arguments: '{"path":"a.ts"}' }] },
  { role: "tool", callId: "c1", name: "read", result: "file contents here" },
  { role: "assistant", text: "done with step one" },
  { role: "user", text: "second request" },
  { role: "assistant", text: "working on it" },
]

test("estimateTokens scales with content", () => {
  const small = estimateTokens([{ role: "user", text: "hi" }])
  const big = estimateTokens([{ role: "user", text: "x".repeat(4000) }])
  expect(big).toBeGreaterThan(small)
  expect(big).toBeGreaterThanOrEqual(900) // ~4000 chars / 4
})

test("safeCutIndex returns a safe boundary that never splits a tool pair", () => {
  // No user turn exists in (0, 3], so it falls back to a clean assistant boundary (one not preceded
  // by a tool result) — here index 1, which keeps the assistant tool_use + its tool_result together.
  const cut = safeCutIndex(convo, 3)
  expect(convo[cut]?.role).not.toBe("tool") // never start the kept slice on an orphan tool_result
  const safe = cut === 0 || convo[cut]?.role === "user" || (convo[cut]?.role === "assistant" && convo[cut - 1]?.role !== "tool")
  expect(safe).toBe(true)
  // A user boundary is always preferred when one is in range: target at the later user turn → 4.
  expect(safeCutIndex(convo, 5)).toBe(4)
})

test("safeCutIndex respects the floor (already-compacted prefix)", () => {
  // floor=4 means everything before index 4 is summarized; no earlier boundary qualifies.
  expect(safeCutIndex(convo, 3, 4)).toBe(0)
})

test("renderTranscript captures roles, tool calls, and results", () => {
  const t = renderTranscript(convo)
  expect(t).toContain("USER: first request")
  expect(t).toContain("called read")
  expect(t).toContain("TOOL read → file contents here")
})
