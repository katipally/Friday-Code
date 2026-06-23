import { expect, test } from "bun:test"
import { applyTheme, theme, themeNames } from "../src/theme.ts"

test("applyTheme resets back to the default palette", () => {
  const defaultBg = theme.bg
  applyTheme("dark")
  expect(theme.bg).toBe(defaultBg)
  applyTheme() // reset to default
  expect(theme.bg).toBe(defaultBg)
})

test("themeNames lists the built-in presets with dark first", () => {
  const names = themeNames()
  expect(names[0]).toBe("dark")
  expect(names).toContain("high-contrast")
  expect(names).toContain("light")
})

test("applyTheme layers a preset, then resets to default", () => {
  const defaultText = theme.text
  applyTheme("light")
  expect(theme.bg).toBe("#faf9f5") // preset override applied (warm-paper light)
  applyTheme("dark")
  expect(theme.text).toBe(defaultText) // reset back to the default palette
})
