import { createMemo, createSignal, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

/** Snapshot history: rewind files + conversation to any checkpoint, or redo the last rewind. */
export function CheckpointHistory() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const [sel, setSel] = createSignal(0)
  const checkpoints = createMemo(() => app.engine.listCheckpoints())

  useKeyboard((key) => {
    if (!app.checkpointsOpen()) return
    const n = checkpoints().length
    if (key.name === "escape") return app.setCheckpointsOpen(false)
    if (key.name === "up") return setSel((s) => (s - 1 + Math.max(1, n)) % Math.max(1, n))
    if (key.name === "down") return setSel((s) => (s + 1) % Math.max(1, n))
    if (key.name === "return" || key.name === "enter") {
      const c = checkpoints()[sel()]
      if (c) app.restoreCheckpoint(c.id)
    }
    if (key.name === "r" && app.engine.hasRedo()) app.redoLast()
  })

  return (
    <Scrim onClose={() => app.setCheckpointsOpen(false)}>
      <box
        flexDirection="column"
        width={68}
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
          <text fg={accent()}>checkpoints</text>
          <text fg={theme.textFaint}>· rewind files + conversation</text>
        </box>
        <Show
          when={checkpoints().length}
          fallback={<text fg={theme.textFaint}>no checkpoints yet — send a prompt first</text>}
        >
          <scrollbox maxHeight={14}>
            <For each={checkpoints()}>
              {(c, i) => (
                <box
                  flexDirection="row"
                  gap={1}
                  paddingLeft={1}
                  backgroundColor={sel() === i() ? theme.bgHover : "transparent"}
                  onMouseDown={() => app.restoreCheckpoint(c.id)}
                >
                  <text fg={sel() === i() ? accent() : theme.textFaint}>{sel() === i() ? "↺" : " "}</text>
                  <box flexGrow={1}>
                    <text fg={sel() === i() ? theme.text : theme.textMuted}>{c.label}</text>
                  </box>
                  <text fg={theme.textFaint}>
                    {c.files > 0 ? `${c.files} file${c.files === 1 ? "" : "s"} · ` : ""}
                    {ago(c.createdAt)}
                  </text>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>
        <box flexDirection="row" gap={2}>
          <text fg={theme.textFaint}>↑↓ move · ⏎ rewind · esc close</text>
          <Show when={app.engine.hasRedo()}>
            <text fg={theme.info}>r redo</text>
          </Show>
        </box>
      </box>
    </Scrim>
  )
}
