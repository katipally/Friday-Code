import { theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { bandBg, HintChip, Overlay } from "./ui.tsx"

/** Branch a new session from any past user turn (fork / timeline). The new session carries the
 * conversation up to the chosen turn, so you can explore an alternative without losing this thread. */
export function ForkPicker() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const points = createMemo(() => app.engine.forkPoints())
  const [sel, setSel] = createSignal(0)

  useKeyboard((key) => {
    if (!app.forkOpen()) return
    const n = points().length
    if (key.name === "escape") return app.setForkOpen(false)
    if (key.name === "up" || key.name === "k") return setSel((s) => (s - 1 + Math.max(1, n)) % Math.max(1, n))
    if (key.name === "down" || key.name === "j") return setSel((s) => (s + 1) % Math.max(1, n))
    if (key.name === "return" || key.name === "enter") {
      const p = points()[sel()]
      if (p) app.forkFrom(p.index)
    }
  })

  return (
    <Scrim onClose={() => app.setForkOpen(false)}>
      <Overlay title="fork" hint="branch a new session from a past turn" width={Math.min(70, dims().width - 4)}>
        <Show
          when={points().length}
          fallback={<text fg={theme.textFaint}>no turns to fork from yet — send a prompt first</text>}
        >
          <scrollbox maxHeight={14}>
            <For each={points()}>
              {(p, i) => {
                const on = () => sel() === i()
                return (
                  <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={bandBg(on())}
                    onMouseOver={() => setSel(i())}
                    onMouseDown={() => app.forkFrom(p.index)}
                  >
                    <text fg={on() ? theme.textOnAccent : theme.textFaint}>{on() ? "⑂" : " "}</text>
                    <text fg={on() ? theme.textOnAccent : theme.textFaint}>{i() + 1}.</text>
                    <box flexGrow={1}>
                      <text fg={on() ? theme.textOnAccent : theme.textMuted}>{p.text || "(empty)"}</text>
                    </box>
                  </box>
                )
              }}
            </For>
          </scrollbox>
        </Show>
        <box flexDirection="row" gap={1}>
          <HintChip label="↑↓ move" />
          <HintChip
            label="⏎ fork from here"
            accent={theme.success}
            onClick={() => {
              const p = points()[sel()]
              if (p) app.forkFrom(p.index)
            }}
          />
          <HintChip label="esc close" onClick={() => app.setForkOpen(false)} />
        </box>
      </Overlay>
    </Scrim>
  )
}
