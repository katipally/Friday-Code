import { expect, test } from "bun:test"
import { applyTheme, theme, themeNames } from "../src/theme.ts"

test("applyTheme layers a preset and resets back to default", () => {
  const defaultBg = theme.bg
  applyTheme("light")
  expect(theme.bg).toBe("#ffffff")
  applyTheme("nord")
  expect(theme.bg).toBe("#2e3440")
  applyTheme() // reset to default
  expect(theme.bg).toBe(defaultBg)
})

test("themeNames includes the presets", () => {
  expect(themeNames()).toEqual(expect.arrayContaining(["dark", "light", "nord"]))
})
