import { getMode, theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"

/** Branch a new session from any past user turn (fork / timeline). The new session carries the
 * conversation up to the chosen turn, so you can explore an alternative without losing this thread. */
export function ForkPicker() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
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
      <box
        flexDirection="column"
        width={70}
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
          <text fg={accent()}>fork</text>
          <text fg={theme.textFaint}>· branch a new session from a past turn</text>
        </box>
        <Show
          when={points().length}
          fallback={<text fg={theme.textFaint}>no turns to fork from yet — send a prompt first</text>}
        >
          <scrollbox maxHeight={14}>
            <For each={points()}>
              {(p, i) => (
                <box
                  flexDirection="row"
                  gap={1}
                  paddingLeft={1}
                  backgroundColor={sel() === i() ? theme.bgHover : "transparent"}
                  onMouseOver={() => setSel(i())}
                  onMouseDown={() => app.forkFrom(p.index)}
                >
                  <text fg={sel() === i() ? accent() : theme.textFaint}>{sel() === i() ? "⑂" : " "}</text>
                  <text fg={theme.textFaint}>{i() + 1}.</text>
                  <box flexGrow={1}>
                    <text fg={sel() === i() ? theme.text : theme.textMuted}>{p.text || "(empty)"}</text>
                  </box>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>
        <text fg={theme.textFaint}>↑↓ move · ⏎ fork from here · esc close</text>
      </box>
    </Scrim>
  )
}
