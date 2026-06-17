import { createSignal, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { allowedEfforts, getMode, theme, type Effort } from "@friday/shared"
import { useApp } from "../store.tsx"
import { shimmerAccent } from "../motion/index.ts"

const BLURB: Record<Effort, string> = {
  low: "quick, minimal thinking",
  medium: "balanced",
  high: "deeper reasoning",
  xhigh: "very deep (Anthropic/Google)",
  max: "maximum budget (Anthropic/Google)",
}

/**
 * A compact horizontal slider for the model's reasoning effort using OpenTUI's native <slider>.
 * Levels are capped to what the connected provider protocol actually supports (see `allowedEfforts`).
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

      <Show
        when={levels().length}
        fallback={<text fg={theme.textMuted}>the current model has no adjustable reasoning effort.</text>}
      >
        <slider
          orientation="horizontal"
          min={0}
          max={levels().length - 1}
          value={idx()}
          onChange={(v: number) => setIdx(Math.round(v))}
          backgroundColor={theme.border}
          foregroundColor={shimmerAccent(accent())}
        />
        <box flexDirection="row" gap={1}>
          {levels().map((lv, i) => (
            <box onMouseDown={() => setTo(i)}>
              <text fg={i === idx() ? theme.text : theme.textFaint}>{lv}</text>
            </box>
          ))}
        </box>
        <text fg={theme.textMuted}>{BLURB[levels()[idx()]!]}</text>
        <text fg={theme.textFaint}>←/→ move · click track · ⏎ set · esc cancel</text>
      </Show>
    </box>
  )
}
