import { expect, test } from "bun:test"
import { windowLayout } from "../src/oswindow.ts"

const W = 1440
const H = 900

test("windowLayout: grid covers the screen without exceeding it", () => {
  const b = windowLayout("grid", 4, W, H)
  expect(b.length).toBe(4)
  for (const [x1, y1, x2, y2] of b) {
    expect(x1).toBeGreaterThanOrEqual(0)
    expect(y1).toBeGreaterThanOrEqual(25) // below the menu bar
    expect(x2).toBeLessThanOrEqual(W)
    expect(y2).toBeLessThanOrEqual(H)
    expect(x2).toBeGreaterThan(x1)
    expect(y2).toBeGreaterThan(y1)
  }
  // 4 windows → 2×2; window 0 top-left, window 3 bottom-right of its cell.
  expect(b[0]![0]).toBe(0)
  expect(b[3]![0]).toBeGreaterThan(0)
})

test("windowLayout: columns are side-by-side, rows stacked", () => {
  const cols = windowLayout("columns", 3, W, H)
  expect(cols[0]![0]).toBe(0)
  expect(cols[1]![0]).toBeGreaterThan(cols[0]![0]) // shifted right
  expect(cols[0]![1]).toBe(cols[1]![1]) // same top

  const rows = windowLayout("rows", 3, W, H)
  expect(rows[0]![1]).toBe(rows[0]![1])
  expect(rows[1]![1]).toBeGreaterThan(rows[0]![1]) // shifted down
  expect(rows[0]![0]).toBe(rows[1]![0]) // same left
})

test("windowLayout: stack maximizes every window", () => {
  const b = windowLayout("stack", 3, W, H)
  for (const [x1, , x2, y2] of b) {
    expect(x1).toBe(0)
    expect(x2).toBe(W)
    expect(y2).toBe(H)
  }
})
