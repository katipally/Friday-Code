import { test, expect } from "bun:test"
import { parseMarkdown, parseInline } from "../src/util/markdown.ts"
import { highlightLine } from "../src/util/highlight.ts"

test("parseMarkdown splits headings, lists, code fences, paragraphs", () => {
  const blocks = parseMarkdown("# Title\n\n- one\n- two\n\n```ts\nconst x = 1\n```\n\nHello world.")
  expect(blocks[0]).toEqual({ type: "heading", level: 1, text: "Title" })
  expect(blocks[1]).toMatchObject({ type: "list" })
  expect((blocks[1] as any).items.map((i: any) => i.text)).toEqual(["one", "two"])
  expect(blocks[2]).toMatchObject({ type: "code", lang: "ts", lines: ["const x = 1"] })
  expect(blocks[3]).toMatchObject({ type: "para", text: "Hello world." })
})

test("parseMarkdown handles tables, nested lists, task items and strikethrough", () => {
  const blocks = parseMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [ ] todo\n- [x] done\n  - nested")
  const table = blocks.find((b) => b.type === "table") as any
  expect(table.headers).toEqual(["a", "b"])
  expect(table.rows).toEqual([["1", "2"]])
  const list = blocks.find((b) => b.type === "list") as any
  expect(list.items[0]).toMatchObject({ task: true, checked: false, text: "todo" })
  expect(list.items[1]).toMatchObject({ task: true, checked: true, text: "done" })
  expect(list.items[2]).toMatchObject({ depth: 1, text: "nested" })
  expect(parseInline("~~gone~~").find((s) => s.strike)?.text).toBe("gone")
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
