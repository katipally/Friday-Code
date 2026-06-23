import { expect, test } from "bun:test"
import { resolvePending } from "../src/store.tsx"

test("focused session's own pending wins", () => {
  const map = { main: { requestId: "r1" }, bg: { requestId: "r2" } }
  expect(resolvePending(map, "main")).toEqual({ sid: "main", val: { requestId: "r1" } })
})

test("a background agent's pending surfaces when the focused session has none", () => {
  const map = { bg: { requestId: "r2" } }
  expect(resolvePending(map, "main")).toEqual({ sid: "bg", val: { requestId: "r2" } })
})

test("nothing pending → null", () => {
  expect(resolvePending({}, "main")).toBeNull()
})
