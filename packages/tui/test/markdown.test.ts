import { test, expect } from "bun:test"
import { parseMarkdown, parseInline } from "../src/util/markdown.ts"
import { highlightLine } from "../src/util/highlight.ts"

test("parseMarkdown splits headings, lists, code fences, paragraphs", () => {
  const blocks = parseMarkdown("# Title\n\n- one\n- two\n\n```ts\nconst x = 1\n```\n\nHello world.")
  expect(blocks[0]).toEqual({ type: "heading", level: 1, text: "Title" })
  expect(blocks[1]).toMatchObject({ type: "list", ordered: false, items: ["one", "two"] })
  expect(blocks[2]).toMatchObject({ type: "code", lang: "ts", lines: ["const x = 1"] })
  expect(blocks[3]).toMatchObject({ type: "para", text: "Hello world." })
})

test("parseInline extracts bold / italic / code / links", () => {
  const segs = parseInline("a **b** and `c` and [d](http://x)")
  expect(segs.find((s) => s.bold)?.text).toBe("b")
  expect(segs.find((s) => s.code)?.text).toBe("c")
  expect(segs.find((s) => s.href)?.text).toBe("d")
})

test("highlightLine colors keywords, strings and comments distinctly", () => {
  const segs = highlightLine('const s = "hi" // note')
  const constSeg = segs.find((s) => s.text === "const")
  const strSeg = segs.find((s) => s.text.includes('"hi"'))
  const comment = segs.find((s) => s.text.includes("// note"))
  expect(constSeg && strSeg && comment).toBeTruthy()
  expect(constSeg!.color).not.toBe(strSeg!.color)
})
