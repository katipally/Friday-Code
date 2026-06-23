import fs from "node:fs"
import { fridayDir, keybindingsPath } from "@friday/providers"

/**
 * Rebindable keymap. The global shortcut handler dispatches NAMED actions; the chord each action
 * fires on lives here, overridable per-user via ~/.friday/keybindings.json. Only the simple,
 * single-chord global actions are rebindable — the armed/double-tap keys (Ctrl+C quit, Esc-Esc
 * stop/checkpoints) and Ctrl+1-9 session switch keep their bespoke handling in the TUI.
 */
export const DEFAULT_KEYBINDINGS = {
  "panel.toggle": "ctrl+b",
  "mic.toggle": "ctrl+r",
  "console.toggle": "ctrl+t",
  "dashboard.toggle": "ctrl+o",
  "history.open": "ctrl+y",
  "mode.cycle": "shift+tab",
  // Ctrl+P transmits in every terminal (Shift+Esc could not — Shift never modifies the Esc byte, so
  // it arrived as plain Esc). On kitty-protocol terminals Cmd/Super+Enter also fires pause; that's
  // handled in App.tsx's global handler, not here, since the textarea can't tell Option from Cmd.
  "pause.open": "ctrl+p",
  // Ctrl+G (BEL) — reliable across terminals. Ctrl+, can't be used: terminals fold it onto Ctrl+\ (0x1c).
  "settings.open": "ctrl+g",
  "help.open": "f1",
} as const

export type KeyAction = keyof typeof DEFAULT_KEYBINDINGS
export type Keymap = Record<KeyAction, string>

/** Chords that must never be rebound (a stray binding could trap the user). */
export const RESERVED = ["ctrl+c"]

const MODS = ["ctrl", "shift", "meta", "option", "alt", "super", "cmd"]

type ParsedChord = { name: string; ctrl: boolean; shift: boolean; meta: boolean; option: boolean; super: boolean }

/** "Ctrl+Shift+B" → structured chord. `alt`→option, `cmd`→meta, `esc`→escape. */
export function parseChord(s: string): ParsedChord {
  const parts = s
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
  const set = new Set(parts)
  const raw = parts.find((p) => !MODS.includes(p)) ?? ""
  const name = raw === "esc" ? "escape" : raw === "return" ? "return" : raw
  return {
    name,
    ctrl: set.has("ctrl"),
    shift: set.has("shift"),
    meta: set.has("meta") || set.has("cmd"),
    option: set.has("option") || set.has("alt"),
    super: set.has("super"),
  }
}

/** Canonical string form, mods in a fixed order, so two spellings of the same chord compare equal. */
export function chordToString(c: ParsedChord): string {
  const out: string[] = []
  if (c.ctrl) out.push("ctrl")
  if (c.shift) out.push("shift")
  if (c.option) out.push("option")
  if (c.meta) out.push("meta")
  if (c.super) out.push("super")
  if (c.name) out.push(c.name)
  return out.join("+")
}

export function normalizeChord(s: string): string {
  return chordToString(parseChord(s))
}

export type KeyLike = {
  name?: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  option?: boolean
  super?: boolean
}

/** Does a live key event match a chord string? */
export function matchesChord(key: KeyLike, chord: string): boolean {
  const c = parseChord(chord)
  return (
    (key.name ?? "").toLowerCase() === c.name &&
    !!key.ctrl === c.ctrl &&
    !!key.shift === c.shift &&
    !!key.option === c.option &&
    !!key.meta === c.meta &&
    !!key.super === c.super
  )
}

/** The action a key event triggers under the given keymap, or undefined. */
export function actionForKey(key: KeyLike, map: Keymap): KeyAction | undefined {
  for (const action of Object.keys(map) as KeyAction[]) {
    if (matchesChord(key, map[action])) return action
  }
  return undefined
}

/** Merge ~/.friday/keybindings.json over the defaults; ignore unknown actions and reserved chords. */
export function loadKeybindings(): Keymap {
  const merged: Record<string, string> = { ...DEFAULT_KEYBINDINGS }
  try {
    const user = JSON.parse(fs.readFileSync(keybindingsPath(), "utf8"))
    for (const [k, v] of Object.entries(user)) {
      if (k in DEFAULT_KEYBINDINGS && typeof v === "string" && v.trim()) {
        const norm = normalizeChord(v)
        if (!RESERVED.includes(norm)) merged[k] = norm
      }
    }
  } catch {
    /* no file / bad json → defaults */
  }
  return merged as Keymap
}

/** Persist only the overrides that differ from defaults (and aren't reserved). */
export function saveKeybindings(map: Partial<Keymap>): void {
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    if (k in DEFAULT_KEYBINDINGS && typeof v === "string" && v.trim()) {
      const norm = normalizeChord(v)
      if (RESERVED.includes(norm)) continue
      if (norm !== DEFAULT_KEYBINDINGS[k as KeyAction]) clean[k] = norm
    }
  }
  try {
    fs.mkdirSync(fridayDir(), { recursive: true })
    fs.writeFileSync(keybindingsPath(), JSON.stringify(clean, null, 2))
  } catch {
    /* ignore I/O errors — same as saveConfig */
  }
}
