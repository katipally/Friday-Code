import { expect, test } from "bun:test"
import { applyTheme, theme, themeNames } from "../src/theme.ts"

test("applyTheme resets back to the default palette", () => {
  const defaultBg = theme.bg
  applyTheme("dark")
  expect(theme.bg).toBe(defaultBg)
  applyTheme() // reset to default
  expect(theme.bg).toBe(defaultBg)
})

test("themeNames includes the dark preset (Friday is dark-only)", () => {
  expect(themeNames()).toEqual(["dark"])
})
