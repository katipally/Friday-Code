import { expect, test } from "bun:test"
import { createThinkSplitter } from "../src/think.ts"

/** Feed chunks through a splitter and concatenate all reasoning/text it produces. */
function run(chunks: string[]) {
  const s = createThinkSplitter()
  let reasoning = ""
  let text = ""
  for (const c of chunks) {
    const r = s.process(c)
    reasoning += r.reasoning
    text += r.text
  }
  const tail = s.flush()
  reasoning += tail.reasoning
  text += tail.text
  return { reasoning, text }
}

test("no tags: content passes through as text", () => {
  expect(run(["hello ", "world"])).toEqual({ reasoning: "", text: "hello world" })
})

test("whole think span in one chunk", () => {
  expect(run(["<think>planning</think>answer"])).toEqual({ reasoning: "planning", text: "answer" })
})

test("tag split across chunk boundaries", () => {
  expect(run(["pre<thi", "nk>secret</thi", "nk>post"])).toEqual({ reasoning: "secret", text: "prepost" })
})

test("reasoning streamed in several chunks", () => {
  expect(run(["<think>", "step 1 ", "step 2", "</think>", "done"])).toEqual({
    reasoning: "step 1 step 2",
    text: "done",
  })
})

test("<thinking> variant", () => {
  expect(run(["<thinking>x</thinking>y"])).toEqual({ reasoning: "x", text: "y" })
})

test("unterminated think span flushes as reasoning", () => {
  expect(run(["<think>never closed"])).toEqual({ reasoning: "never closed", text: "" })
})

test("less-than in normal prose is not eaten", () => {
  expect(run(["if a ", "< b and b ", "> c"])).toEqual({ reasoning: "", text: "if a < b and b > c" })
})

test("partial open tag at very end of stream flushes as text", () => {
  expect(run(["answer <thi"])).toEqual({ reasoning: "", text: "answer <thi" })
})

test("multiple think spans", () => {
  expect(run(["<think>a</think>X<think>b</think>Y"])).toEqual({ reasoning: "ab", text: "XY" })
})
