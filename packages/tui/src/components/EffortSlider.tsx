import { allowedEfforts, type Effort, theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { shimmerAccent } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { narrowGlyphs } from "../util/term.ts"
import { Scrim } from "./Scrim.tsx"
import { bandBg, Overlay } from "./ui.tsx"

const BLURB: Record<Effort, string> = {
  low: "quick, minimal thinking",
  medium: "balanced",
  high: "deeper reasoning",
  xhigh: "very deep (Anthropic/Google)",
  max: "maximum budget (Anthropic/Google)",
}

// A cool→warm ramp: the track and the active label shift color, and an emoji grows more intense
// as the effort rises. Emoji fall back to single-width ASCII on terminals without truecolor
// (e.g. Terminal.app) so column widths stay aligned.
const RAMP: Record<Effort, { emoji: string; ascii: string; color: string }> = {
  low: { emoji: "🌱", ascii: "▁", color: "#7dcfff" },
  medium: { emoji: "🍃", ascii: "▃", color: "#2ac3de" },
  high: { emoji: "🔥", ascii: "▅", color: "#e0af68" },
  xhigh: { emoji: "🚀", ascii: "▆", color: "#f5a623" },
  max: { emoji: "🧠", ascii: "█", color: "#f7768e" },
}

function badge(e: Effort): string {
  return narrowGlyphs ? RAMP[e].ascii : RAMP[e].emoji
}

/**
 * The reasoning-effort gauge: a horizontal slider whose color/emoji ramps with the level.
 * Pure visuals + click targets — the caller owns keyboard handling so it can be reused inside
 * the standalone /effort modal and the /model flow's effort step.
 */
export function EffortGauge(props: {
  levels: readonly Effort[]
  index: number
  onPick: (i: number) => void
  onScrub?: (i: number) => void
}) {
  const cur = () => props.levels[props.index] ?? props.levels[0]!
  const color = () => RAMP[cur()].color
  const [hov, setHov] = createSignal(-1)
  // The gauge is an intensity bar-ramp (▁▃▅▆█): each level is its block glyph, colored on its
  // cool→warm hue up to and including the current level, dim grey beyond it. This reads as a rising
  // "more effort = taller, warmer" slider far more clearly than a flat dotted track, and the block
  // glyphs are single-width so columns stay aligned in every terminal.
  return (
    <Show
      when={props.levels.length}
      fallback={<text fg={theme.textMuted}>the current model has no adjustable reasoning effort.</text>}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={color()}>{badge(cur())}</text>
        <text fg={theme.text}>
          <strong>{cur()}</strong>
        </text>
      </box>
      {/* Clickable ramp: each cell is the level's bar over its label; click or hover to target it. */}
      <box flexDirection="row" gap={1}>
        {props.levels.map((lv, i) => {
          const active = () => i <= props.index
          const on = () => hov() === i
          const barFg = () =>
            on()
              ? theme.textOnAccent
              : active()
                ? lv === "max"
                  ? shimmerAccent(RAMP[lv].color)
                  : RAMP[lv].color
                : theme.border
          return (
            <box
              flexDirection="column"
              alignItems="center"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={bandBg(on())}
              onMouseOver={() => setHov(i)}
              onMouseOut={() => setHov(-1)}
              onMouseDown={() => props.onPick(i)}
            >
              <text fg={barFg()}>{RAMP[lv].ascii}</text>
              <text fg={on() ? theme.textOnAccent : i === props.index ? RAMP[lv].color : theme.textFaint}>
                {i === props.index ? <strong>{lv}</strong> : lv}
              </text>
            </box>
          )
        })}
      </box>
      <text fg={theme.textMuted}>{BLURB[cur()]}</text>
    </Show>
  )
}

/**
 * The standalone /effort modal (also opened from the side panel + status strip). Centered over a
 * scrim like the other modals; ←/→ scrub, click a label, ⏎ set, esc cancel.
 */
export function EffortSlider() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const levels = () => allowedEfforts(app.providerProtocol(), app.reasoningModel())

  const initial = () => {
    const i = levels().indexOf(app.effort())
    return i >= 0 ? i : Math.min(1, Math.max(0, levels().length - 1))
  }
  const [idx, setIdx] = createSignal(initial())

  function setTo(i: number) {
    const lv = levels()[i]
    if (lv) app.setEffort(lv)
    app.setEffortOpen(false)
  }

  useKeyboard((key) => {
    if (key.name === "escape") return app.setEffortOpen(false)
    if (key.name === "left") return setIdx((i) => Math.max(0, i - 1))
    if (key.name === "right") return setIdx((i) => Math.min(levels().length - 1, i + 1))
    if (key.name === "return" || key.name === "enter") return setTo(idx())
  })

  return (
    <Scrim onClose={() => app.setEffortOpen(false)}>
      <Overlay title="/effort" hint="reasoning effort for this model" width={Math.min(52, dims().width - 4)}>
        <EffortGauge levels={levels()} index={idx()} onScrub={setIdx} onPick={setTo} />
        <text fg={theme.textFaint}>←/→ move · click · ⏎ set · esc cancel</text>
      </Overlay>
    </Scrim>
  )
}
