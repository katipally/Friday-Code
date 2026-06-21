import { getMode } from "@friday/shared"
import { For } from "solid-js"
import { motion } from "../motion/config.ts"
import { shimmerPhase } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { lighten } from "../util/colors.ts"
import { hasTruecolor } from "../util/term.ts"

/**
 * The `friday` wordmark, hand-built from half-block subpixels (▀ ▄ █) like opencode's logo.
 * A bright highlight sweeps left→right across the columns (gaussian "shimmer") over a quiet
 * ambient breathe, driven by the *shared* shimmer clock so the logo pulses in sync with every
 * other accent in the app. Reduced-motion shows it static.
 *
 * Each glyph is three text rows authored by eye; one reactive <text> per character lets each
 * column carry its own live shimmer color.
 */
const GLYPHS: Record<string, string[]> = {
  F: ["█▀▀▀", "█▀▀ ", "▀   "],
  R: ["█▀▀▄", "█▀▀▄", "▀  ▀"],
  I: ["▀█▀", " █ ", "▀▀▀"],
  D: ["█▀▀▄", "█  █", "▀▀▀ "],
  A: ["▄▀▀▄", "█▀▀█", "▀  ▀"],
  Y: ["█ █", " █ ", " ▀ "],
}

const WORD = "FRIDAY"
// Three full-width rows; letters joined by a single-column gap.
const ROWS: string[] = [0, 1, 2].map((r) =>
  WORD.split("")
    .map((c) => GLYPHS[c]![r]!)
    .join(" "),
)
const WIDTH = ROWS[0]!.length

// Sweep tuning (lively): a soft gaussian highlight travels across the mark each cycle.
const HILITE_WIDTH = 6 // gaussian sigma, in columns
const HILITE_AMT = 0.6 // peak lighten toward white at the crest
const BREATHE_BASE = 0.1 // resting glow so the mark never goes flat

export function Logo() {
  const app = useApp()

  const colorAt = (col: number): string => {
    const accent = getMode(app.mode()).accent
    // 256-color terminals (Terminal.app) can't render the smooth per-column sweep without banding,
    // so hold the solid accent — an exact palette member — for a clean, identical wordmark.
    if (!hasTruecolor) return accent
    if (motion.reduced()) return lighten(accent, 0.12)
    const phase = shimmerPhase() // 0..1, shared clock
    // Highlight center travels across the full width plus a margin so it enters/exits cleanly.
    const head = phase * (WIDTH + HILITE_WIDTH * 3) - HILITE_WIDTH * 1.5
    const d = col - head
    const hi = Math.exp(-(d * d) / (2 * HILITE_WIDTH * HILITE_WIDTH))
    const breathe = BREATHE_BASE + 0.06 * ((Math.sin(phase * Math.PI * 2) + 1) / 2)
    return lighten(accent, Math.min(0.78, hi * HILITE_AMT + breathe))
  }

  return (
    <box flexDirection="column" alignItems="center">
      <For each={ROWS}>
        {(row) => (
          <box flexDirection="row">
            <For each={row.split("")}>{(ch, i) => <text fg={colorAt(i())}>{ch}</text>}</For>
          </box>
        )}
      </For>
    </box>
  )
}
