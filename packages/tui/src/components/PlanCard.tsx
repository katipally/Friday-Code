import { type ModeId, theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { G } from "../util/term.ts"
import { Markdown } from "./Markdown.tsx"
import { Overlay, Row } from "./ui.tsx"
import { Scrim } from "./Scrim.tsx"

type Choice =
  | { kind: "mode"; mode: ModeId; label: string; hint: string }
  | { kind: "keep"; label: string; hint: string }
  | { kind: "custom"; label: string; hint: string }

const CHOICES: Choice[] = [
  { kind: "mode", mode: "default", label: "run · default", hint: "execute, asking before edits & commands" },
  { kind: "mode", mode: "yolo", label: "run · yolo", hint: "full auto, no prompts" },
  { kind: "keep", label: "keep planning", hint: "close — type your next step in the composer" },
  { kind: "custom", label: "custom input…", hint: "type here to refine the plan, stay in plan mode" },
]

/**
 * Plan card. Two modes, driven by `app.planReadOnly()`:
 *  - EXECUTE GATE (a fresh plan-ready): shows the full plan plus a chooser for how to run it
 *    (default / yolo), keep planning, or custom input.
 *  - READ-ONLY VIEWER (a plan re-opened from the Context panel): just renders the plan for review,
 *    scrollable, with no execute options — viewing only.
 */
export function PlanCard() {
  const app = useApp()
  const dims = useTerminalDimensions()
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
    // Reveal the inline editor on the NEXT tick so the selecting Enter finishes dispatching first —
    // otherwise that same Enter reaches the freshly-mounted textarea (Enter = submit) and instantly
    // closes it with empty text. (AskCard avoids this because it opens its editor with `i`, not Enter.)
    else if (c.kind === "custom") queueMicrotask(() => setTyping(true))
    else app.dismissPlan() // "keep planning" just closes the gate; user types in the composer
  }

  // Explicitly grab focus when the inline editor appears — relying on the reactive `focused` prop
  // alone is unreliable when it mounts mid-keypress-dispatch (the selecting Enter), so the textarea
  // would render but never receive input.
  createEffect(() => {
    if (typing())
      queueMicrotask(() => {
        try {
          input?.focus?.()
        } catch {}
      })
  })

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
        <Overlay
          width={W()}
          title={readOnly() ? "plan" : "plan ready"}
          hint={readOnly() ? "viewing a saved plan" : "review it, then choose how to proceed"}
        >
          {/* full plan detail — taller in the viewer since there are no choices below it */}
          <scrollbox ref={(r: any) => (sb = r)} maxHeight={planMaxH()} paddingLeft={1} paddingRight={1}>
            <Markdown content={lines()} />
          </scrollbox>

          <Show when={!readOnly()} fallback={<text fg={theme.textFaint}>↑↓ scroll · esc close</text>}>
            <text fg={theme.borderMuted}>{"─".repeat(72)}</text>
            <box flexDirection="column">
              <For each={CHOICES}>
                {(c, i) => (
                  // band is brand amber — the run mode is conveyed by the label, not the band color.
                  <Row
                    label={c.label}
                    hint={c.hint}
                    labelWidth={20}
                    selected={sel() === i()}
                    onSelect={() => setSel(i())}
                    onActivate={() => choose(c)}
                  />
                )}
              </For>
            </box>

            <text fg={theme.textFaint}>
              {typing() ? "⏎ refine · esc cancel" : "↑↓ move · ⏎ choose · esc keep planning"}
            </text>
          </Show>

          {/* Inline refine editor — revealed by "custom input…"; stays in plan mode on submit.
              Kept as a TOP-LEVEL sibling (not nested inside the !readOnly Show) so re-renders never
              destroy/recreate it mid-typing, which would silently drop focus. */}
          <Show when={!readOnly() && typing()}>
            <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
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
        </Overlay>
      </Scrim>
    </Show>
  )
}
