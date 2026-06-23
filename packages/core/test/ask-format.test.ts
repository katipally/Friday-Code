import { expect, test } from "bun:test"
import { formatAskAnswers } from "../src/runner.ts"

const q = (id: string, question: string) => ({ id, question })

test("formatAskAnswers: single answer is verbatim, multi is labeled Q/A", () => {
  expect(formatAskAnswers([q("q0", "Which?")], { q0: "Solid" })).toBe("Solid")
  expect(formatAskAnswers([q("q0", "A?"), q("q1", "B?")], { q0: "x", q1: "y" })).toBe("Q: A?\nA: x\n\nQ: B?\nA: y")
})

test("formatAskAnswers: an empty map (Esc-Esc dismiss / abort) reports a dismissal, not (no answer)", () => {
  const out = formatAskAnswers([q("q0", "Which?"), q("q1", "Other?")], {})
  expect(out).toContain("dismissed")
  expect(out).not.toContain("(no answer)")
})
