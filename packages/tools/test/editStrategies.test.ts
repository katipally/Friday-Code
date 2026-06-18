import { test, expect } from "bun:test"
import { replaceInContent, EditError } from "../src/builtin/editStrategies.ts"

test("exact match replaces uniquely", () => {
  expect(replaceInContent("a\nfoo\nb", "foo", "bar", false)).toBe("a\nbar\nb")
})

test("empty old_string appends", () => {
  expect(replaceInContent("abc", "", "X", false)).toBe("abcX")
})

test("non-unique without replace_all throws; replace_all replaces all", () => {
  expect(() => replaceInContent("x\nx", "x", "y", false)).toThrow(EditError)
  expect(replaceInContent("x\nx", "x", "y", true)).toBe("y\ny")
})

test("tolerates trailing-whitespace drift", () => {
  const content = "function f() {\n  return 1  \n}\n" // note trailing spaces after `return 1`
  const out = replaceInContent(content, "function f() {\n  return 1\n}", "function f() {\n  return 2\n}", false)
  expect(out).toContain("return 2")
  expect(out).not.toContain("return 1")
})

test("tolerates leading-indentation drift", () => {
  const content = "class C {\n        method() {\n            return 1\n        }\n}\n" // 8/12-space indent
  const find = "method() {\n    return 1\n}" // model used 4-space indent
  const out = replaceInContent(content, find, "method() {\n    return 2\n}", false)
  expect(out).toContain("return 2")
  expect(out).not.toContain("return 1")
})

test("block-anchor matches a larger block via first/last line", () => {
  const content = ["if (cond) {", "  doA()", "  doB()", "  doC()", "}"].join("\n")
  // Middle lines differ from the file; first+last anchor still pins the block.
  const find = ["if (cond) {", "  whatever()", "}"].join("\n")
  const out = replaceInContent(content, find, "if (cond) {\n  done()\n}", false)
  expect(out).toBe("if (cond) {\n  done()\n}")
})

test("genuinely-absent string throws not-found", () => {
  expect(() => replaceInContent("hello world", "absent", "x", false)).toThrow(/not found/)
})
