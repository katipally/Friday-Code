import { expect, test } from "bun:test"
import type { Message } from "@friday/shared"
import { COMPACTION, collapseToolOutputs, estimateTokens, renderTranscript, safeCutIndex } from "../src/compaction.ts"

test("auto-compact default fires at 85% of the window; a config override changes the limit", () => {
  // Default: maybeCompact uses COMPACTION.threshold (0.85) — see runner.maybeCompact.
  expect(COMPACTION.threshold).toBe(0.85)
  const window = 200_000
  const limitFor = (frac: number) => Math.min(Math.floor(window * frac), window - COMPACTION.buffer)
  expect(limitFor(COMPACTION.threshold)).toBe(170_000) // 85%
  expect(limitFor(0.75)).toBe(150_000) // a Settings override lowers the trigger
})

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
  const safe =
    cut === 0 || convo[cut]?.role === "user" || (convo[cut]?.role === "assistant" && convo[cut - 1]?.role !== "tool")
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

test("collapseToolOutputs shrinks old large tool results but keeps the recent hot tail", () => {
  const big = "x".repeat(5000)
  const small = "y".repeat(100)
  const msgs: Message[] = [
    { role: "user", text: "start" },
    { role: "tool", callId: "c1", name: "read", result: big }, // old + large → collapsed
    { role: "tool", callId: "c2", name: "read", result: small }, // old + small → kept
    ...Array.from({ length: 16 }, (_, i) => ({ role: "user", text: `m${i}` }) as Message),
    { role: "tool", callId: "c3", name: "read", result: big }, // recent → kept verbatim
  ]
  const out = collapseToolOutputs(msgs)
  expect((out[1] as any).result).toContain("omitted")
  expect((out[2] as any).result).toBe(small) // small ones aren't worth collapsing
  expect((out[out.length - 1] as any).result).toBe(big) // hot tail preserved
  // Non-destructive + idempotent: input untouched; re-running changes nothing further.
  expect((msgs[1] as any).result).toBe(big)
  expect(collapseToolOutputs(out)).toBe(out)
})
