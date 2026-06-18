import { createMemo, createSignal, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { theme, getMode, type ModeId } from "@friday/shared"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { Markdown } from "./Markdown.tsx"
import { shimmerAccent } from "../motion/index.ts"
import { G } from "../util/term.ts"

type Choice =
  | { kind: "mode"; mode: ModeId; label: string; hint: string }
  | { kind: "keep"; label: string; hint: string }
  | { kind: "custom"; label: string; hint: string }

const CHOICES: Choice[] = [
  { kind: "mode", mode: "default", label: "run · default", hint: "execute, asking before edits & commands" },
  { kind: "mode", mode: "accept-edit", label: "run · accept-edit", hint: "auto-apply edits, ask for bash/network" },
  { kind: "mode", mode: "yolo", label: "run · yolo", hint: "full auto, no prompts" },
  { kind: "keep", label: "keep planning", hint: "stay read-only, refine the plan" },
  { kind: "custom", label: "custom input…", hint: "close and type your own next step" },
]

/**
 * Plan card. Two modes, driven by `app.planReadOnly()`:
 *  - EXECUTE GATE (a fresh plan-ready): shows the full plan plus a chooser for how to run it
 *    (default / accept-edit / yolo), keep planning, or custom input.
 *  - READ-ONLY VIEWER (a plan re-opened from the Context panel): just renders the plan for review,
 *    scrollable, with no execute options — viewing only.
 */
export function PlanCard() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const plan = () => app.planPending()
  const readOnly = () => app.planReadOnly()
  const [sel, setSel] = createSignal(0)
  let sb: { scrollBy?: (n: number) => void } | null = null

  function choose(c: Choice) {
    if (c.kind === "mode") app.executePlan(c.mode, app.planPending() ?? undefined)
    else app.dismissPlan() // keep planning + custom input both just close the gate
  }

  useKeyboard((key) => {
    if (!plan()) return
    if (key.name === "escape") return app.dismissPlan()
    // Read-only viewer: arrows scroll the plan; there are no choices to move through.
    if (readOnly()) {
      if (key.name === "up" || key.name === "k") return sb?.scrollBy?.(-3)
      if (key.name === "down" || key.name === "j") return sb?.scrollBy?.(3)
      if (key.name === "pageup") return sb?.scrollBy?.(-12)
      if (key.name === "pagedown") return sb?.scrollBy?.(12)
      return
    }
    if (key.name === "up" || key.name === "k") return setSel((s) => (s + CHOICES.length - 1) % CHOICES.length)
    if (key.name === "down" || key.name === "j") return setSel((s) => (s + 1) % CHOICES.length)
    if (key.name === "return" || key.name === "enter") return choose(CHOICES[sel()]!)
  })

  const lines = createMemo(() => plan()?.text ?? "")

  return (
    <Show when={plan()}>
      <Scrim onClose={() => app.dismissPlan()}>
        <box
          flexDirection="column"
          width={78}
          border
          borderStyle="rounded"
          borderColor={shimmerAccent(getMode("plan").accent)}
          backgroundColor={theme.bgElevated}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          gap={1}
        >
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={getMode("plan").accent}>{G.modePlan} {readOnly() ? "plan" : "plan ready"}</text>
            <text fg={theme.textFaint}>· {readOnly() ? "viewing a saved plan" : "review it, then choose how to proceed"}</text>
          </box>

          {/* full plan detail — taller in the viewer since there are no choices below it */}
          <scrollbox ref={(r: any) => (sb = r)} maxHeight={readOnly() ? 24 : 18} paddingLeft={1} paddingRight={1}>
            <Markdown content={lines()} />
          </scrollbox>

          <Show
            when={!readOnly()}
            fallback={<text fg={theme.textFaint}>↑↓ scroll · esc close</text>}
          >
            <text fg={theme.borderMuted}>{"─".repeat(72)}</text>
            <box flexDirection="column">
              <For each={CHOICES}>
                {(c, i) => (
                  <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={sel() === i() ? theme.bgHover : "transparent"}
                    onMouseDown={() => choose(c)}
                    onMouseOver={() => setSel(i())}
                  >
                    <text fg={sel() === i() ? accent() : theme.textFaint}>{sel() === i() ? G.caret : " "}</text>
                    <box width={20}>
                      <text fg={sel() === i() ? theme.text : theme.textMuted}>{c.label}</text>
                    </box>
                    <text fg={theme.textFaint}>{c.hint}</text>
                  </box>
                )}
              </For>
            </box>
            <text fg={theme.textFaint}>↑↓ move · ⏎ choose · esc keep planning</text>
          </Show>
        </box>
      </Scrim>
    </Show>
  )
}
