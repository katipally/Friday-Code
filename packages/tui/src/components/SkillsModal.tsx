import type { SkillInfo } from "@friday/core"
import { theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { bandBg, HintChip, Meta, Overlay, Pill } from "./ui.tsx"

/**
 * View installed skills and run one inline. Skills are reusable instruction files Friday loads on
 * demand (the model picks them via the `skill` tool, or you run one here). They're auto-discovered
 * from `.friday/skills` (project) and `~/.friday/skills` (user) — add or edit the `.md` files to
 * manage them, then reopen this list. Running one folds an invoke prompt into the conversation.
 */
export function SkillsModal() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const skills = () => app.skills() as SkillInfo[]
  const [sel, setSel] = createSignal(0)
  const clamped = () => Math.min(sel(), Math.max(0, skills().length - 1))
  const current = () => skills()[clamped()]

  // Keep the highlighted skill in view as the user arrows through a list longer than the viewport.
  let sb: any
  createEffect(() => {
    const i = clamped()
    queueMicrotask(() => sb?.scrollChildIntoView?.(`skill-${i}`))
  })

  useKeyboard((key) => {
    if (!app.skillsModalOpen()) return
    const n = skills().length
    if (key.name === "escape") return app.setSkillsModalOpen(false)
    if (!n) return
    if (key.name === "up" || key.name === "k") return setSel((s) => (s - 1 + n) % n)
    if (key.name === "down" || key.name === "j") return setSel((s) => (s + 1) % n)
    if (key.name === "return" || key.name === "enter") return app.runSkill(current()!.name)
  })

  return (
    <Scrim onClose={() => app.setSkillsModalOpen(false)}>
      <Overlay
        title="/skills"
        hint="reusable instructions Friday loads on demand"
        width={Math.min(72, dims().width - 4)}
      >
        <Show
          when={skills().length}
          fallback={
            <box flexDirection="column">
              <text fg={theme.textFaint}>no skills yet</text>
              <Meta text="add .md files under .friday/skills (project) or ~/.friday/skills (user)" />
            </box>
          }
        >
          <scrollbox ref={(r: any) => (sb = r)} maxHeight={14}>
            <For each={skills()}>
              {(s, i) => {
                const on = () => clamped() === i()
                return (
                  <box
                    id={`skill-${i()}`}
                    flexDirection="column"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={bandBg(on())}
                    onMouseOver={() => setSel(i())}
                    onMouseDown={() => app.runSkill(s.name)}
                  >
                    <box flexDirection="row" gap={1}>
                      <text fg={on() ? theme.textOnAccent : theme.text}>
                        {on() ? <strong>{s.name}</strong> : s.name}
                      </text>
                      <box flexGrow={1} />
                      <text fg={on() ? theme.textOnAccent : theme.textFaint}>{s.source}</text>
                    </box>
                    <text fg={on() ? theme.textOnAccent : theme.textFaint}>
                      {s.description || s.whenToUse || "(no description)"}
                    </text>
                  </box>
                )
              }}
            </For>
          </scrollbox>
        </Show>

        {/* Selected skill detail: a clear run action + where it lives (so you can edit it). */}
        <Show when={current()}>
          <box flexDirection="column" gap={1}>
            <box flexDirection="row">
              <Pill label="▷ run" accent={theme.success} onClick={() => app.runSkill(current()!.name)} />
            </box>
            <Meta text={`edit: ${current()!.path}`} />
          </box>
        </Show>
        <box flexDirection="row" gap={1}>
          <HintChip label="↑↓ move" />
          <HintChip label="⏎ run" accent={theme.success} onClick={() => current() && app.runSkill(current()!.name)} />
          <HintChip label="esc close" onClick={() => app.setSkillsModalOpen(false)} />
        </box>
      </Overlay>
    </Scrim>
  )
}
