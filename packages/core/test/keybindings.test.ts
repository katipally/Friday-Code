import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { keybindingsPath } from "@friday/providers"
import {
  actionForKey,
  DEFAULT_KEYBINDINGS,
  loadKeybindings,
  normalizeChord,
  RESERVED,
  saveKeybindings,
} from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-kb-"))

test("normalizeChord canonicalizes mod order + aliases", () => {
  expect(normalizeChord("Shift+Ctrl+B")).toBe("ctrl+shift+b")
  expect(normalizeChord("alt+return")).toBe("option+return")
  expect(normalizeChord("cmd+k")).toBe("meta+k")
  expect(normalizeChord("shift+esc")).toBe("shift+escape")
})

test("actionForKey matches the default chords exactly", () => {
  const map = { ...DEFAULT_KEYBINDINGS }
  expect(actionForKey({ name: "b", ctrl: true }, map)).toBe("panel.toggle")
  expect(actionForKey({ name: "escape", shift: true }, map)).toBe("pause.open")
  // a plain Esc must NOT resolve to pause.open (shift differs) — keeps Esc-Esc stop working
  expect(actionForKey({ name: "escape" }, map)).toBeUndefined()
  expect(actionForKey({ name: "tab", shift: true }, map)).toBe("mode.cycle")
})

test("load merges user overrides over defaults; save ignores reserved", () => {
  saveKeybindings({ "panel.toggle": "ctrl+p", "palette.open": "ctrl+c" }) // ctrl+c is reserved
  const written = JSON.parse(fs.readFileSync(keybindingsPath(), "utf8"))
  expect(written["panel.toggle"]).toBe("ctrl+p")
  expect(written["palette.open"]).toBeUndefined() // reserved chord dropped on save

  const map = loadKeybindings()
  expect(map["panel.toggle"]).toBe("ctrl+p") // override applied
  expect(map["palette.open"]).toBe(DEFAULT_KEYBINDINGS["palette.open"]) // default retained
  expect(RESERVED).toContain("ctrl+c")
})

test("resetting (empty save) returns pure defaults", () => {
  saveKeybindings({})
  expect(loadKeybindings()).toEqual({ ...DEFAULT_KEYBINDINGS })
})
