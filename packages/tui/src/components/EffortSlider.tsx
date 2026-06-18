import { allowedEfforts, type Effort, getMode, theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { shimmerAccent } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { narrowGlyphs } from "../util/term.ts"
import { Scrim } from "./Scrim.tsx"

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
  // A hand-drawn track (●━━━○━━━○): nodes joined by segments, filled up to the current level.
  // (`@opentui/solid` has no native <slider>, and a text track aligns cleanly in every terminal.)
  const SEG = 6
  const track = () => {
    let full = ""
    let thumb = 0
    props.levels.forEach((_lv, i) => {
      if (i === props.index) thumb = full.length
      full += i < props.index ? "●" : i === props.index ? "◉" : "○"
      if (i < props.levels.length - 1) full += (i < props.index ? "━" : "─").repeat(SEG)
    })
    return { filled: full.slice(0, thumb + 1), rest: full.slice(thumb + 1) }
  }
  return (
    <Show
      when={props.levels.length}
      fallback={<text fg={theme.textMuted}>the current model has no adjustable reasoning effort.</text>}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={color()}>{badge(cur())}</text>
        <text fg={theme.text}>{cur()}</text>
      </box>
      <box flexDirection="row">
        <text fg={cur() === "max" ? shimmerAccent(color()) : color()}>{track().filled}</text>
        <text fg={theme.border}>{track().rest}</text>
      </box>
      <box flexDirection="row" gap={1}>
        {props.levels.map((lv, i) => (
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={hov() === i ? theme.bgHover : "transparent"}
            onMouseOver={() => setHov(i)}
            onMouseOut={() => setHov(-1)}
            onMouseDown={() => props.onPick(i)}
          >
            <text fg={i === props.index ? RAMP[lv].color : hov() === i ? theme.text : theme.textFaint}>{lv}</text>
          </box>
        ))}
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
  const accent = () => getMode(app.mode()).accent
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
      <box
        flexDirection="column"
        width={52}
        border
        borderStyle="rounded"
        borderColor={accent()}
        backgroundColor={theme.bgElevated}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <box flexDirection="row" gap={1}>
          <text fg={accent()}>/effort</text>
          <text fg={theme.textFaint}>· reasoning effort for this model</text>
        </box>
        <EffortGauge levels={levels()} index={idx()} onScrub={setIdx} onPick={setTo} />
        <text fg={theme.textFaint}>←/→ move · click · ⏎ set · esc cancel</text>
      </box>
    </Scrim>
  )
}
