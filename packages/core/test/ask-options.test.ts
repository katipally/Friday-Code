import { expect, test } from "bun:test"
import { extractInlineOptions } from "../src/runner.ts"

test("pulls out inline Options: [a, b, c]", () => {
  const r = extractInlineOptions("What type of project? Options: [web, api, cli]")
  expect(r.options).toEqual(["web", "api", "cli"])
  expect(r.question).toBe("What type of project?")
})

test("pulls out Options: a, b, c (no brackets)", () => {
  const r = extractInlineOptions("Pick a color. Options: red, green, blue")
  expect(r.options).toEqual(["red", "green", "blue"])
})

test("strips surrounding quotes", () => {
  const r = extractInlineOptions("Choose: Options: ['Node.js', 'Go', 'Rust']")
  expect(r.options).toEqual(["Node.js", "Go", "Rust"])
})

test("pulls out a trailing bulleted list", () => {
  const r = extractInlineOptions("Which approach?\n- fast\n- safe\n- cheap")
  expect(r.options).toEqual(["fast", "safe", "cheap"])
  expect(r.question).toBe("Which approach?")
})

test("pulls out a numbered list", () => {
  const r = extractInlineOptions("Choose one:\n1. One\n2. Two\n3. Three")
  expect(r.options).toEqual(["One", "Two", "Three"])
})

test("leaves a plain question untouched", () => {
  const r = extractInlineOptions("Are you sure you want to continue?")
  expect(r.options).toBeUndefined()
  expect(r.question).toBe("Are you sure you want to continue?")
})

test("ignores a single option (needs at least two)", () => {
  const r = extractInlineOptions("Path? Options: [just-one]")
  expect(r.options).toBeUndefined()
})
