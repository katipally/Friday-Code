import { createMemo, createSignal, For, Show } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
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
  { kind: "keep", label: "keep planning", hint: "close — type your next step in the composer" },
  { kind: "custom", label: "custom input…", hint: "type here to refine the plan, stay in plan mode" },
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
  const dims = useTerminalDimensions()
  const accent = () => getMode(app.mode()).accent
  const plan = () => app.planPending()
  const readOnly = () => app.planReadOnly()
  const [sel, setSel] = createSignal(0)
  // "custom input…" reveals an inline editor; only focused while typing so it never steals choice keys.
  const [typing, setTyping] = createSignal(false)
  let sb: { scrollBy?: (n: number) => void } | null = null
  let input: any

  // Fill ~70% of the terminal, then the plan body scrolls. The execute gate reserves more vertical
  // chrome (divider + 5 choices + footer) than the read-only viewer.
  const W = () => Math.min(dims().width - 4, Math.max(64, Math.round(dims().width * 0.7)))
  const planMaxH = () => Math.max(6, Math.round(dims().height * 0.7) - (readOnly() ? 6 : 14))

  function choose(c: Choice) {
    if (c.kind === "mode") app.executePlan(c.mode, app.planPending() ?? undefined)
    else if (c.kind === "custom") setTyping(true) // reveal the inline refine editor
    else app.dismissPlan() // "keep planning" just closes the gate; user types in the composer
  }

  function submitRefine() {
    const text: string = (input?.plainText ?? "").trim()
    input?.clear?.()
    setTyping(false)
    if (text) app.refinePlan(text) // stay in plan mode; the agent revises and re-opens the gate
  }

  useKeyboard((key) => {
    if (!plan()) return
    if (typing()) {
      if (key.name === "escape") return setTyping(false)
      return // the textarea owns the rest while typing
    }
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
          width={W()}
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
          <scrollbox ref={(r: any) => (sb = r)} maxHeight={planMaxH()} paddingLeft={1} paddingRight={1}>
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

            {/* Inline refine editor — revealed by "custom input…"; stays in plan mode on submit. */}
            <Show when={typing()}>
              <box border borderStyle="rounded" borderColor={accent()} paddingLeft={1} paddingRight={1} marginTop={1}>
                <textarea
                  ref={(r: any) => (input = r)}
                  onSubmit={submitRefine}
                  keyBindings={[{ name: "return", action: "submit" }]}
                  focused={typing()}
                  placeholder="refine the plan — ⏎ to send, esc to cancel"
                  placeholderColor={theme.textFaint}
                  minHeight={1}
                  maxHeight={4}
                />
              </box>
            </Show>

            <text fg={theme.textFaint}>
              {typing() ? "⏎ refine · esc cancel" : "↑↓ move · ⏎ choose · esc keep planning"}
            </text>
          </Show>
        </box>
      </Scrim>
    </Show>
  )
}
