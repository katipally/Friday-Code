import { theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { bandBg, Overlay } from "./ui.tsx"

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

/** Snapshot history: rewind files + conversation to any checkpoint, or redo the last rewind. */
export function CheckpointHistory() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const [sel, setSel] = createSignal(0)
  const checkpoints = createMemo(() => app.engine.listCheckpoints())
  let sb: { scrollTo?: (p: number | { x: number; y: number }) => void } | null = null

  // Newest checkpoint sits at the bottom — focus it and scroll it into view whenever the list
  // grows or the panel opens.
  createEffect(() => {
    const n = checkpoints().length
    if (!app.checkpointsOpen() || n === 0) return
    setSel(n - 1)
    queueMicrotask(() => sb?.scrollTo?.({ x: 0, y: Number.MAX_SAFE_INTEGER }))
  })

  useKeyboard((key) => {
    if (!app.checkpointsOpen()) return
    const n = checkpoints().length
    if (key.name === "escape") return app.setCheckpointsOpen(false)
    if (key.name === "up") return setSel((s) => (s - 1 + Math.max(1, n)) % Math.max(1, n))
    if (key.name === "down") return setSel((s) => (s + 1) % Math.max(1, n))
    const c = () => checkpoints()[sel()]
    // Restore matrix: Enter/b = files + conversation, c = code only, m = conversation only.
    if (key.name === "return" || key.name === "enter" || key.name === "b") {
      if (c()) app.restoreCheckpoint(c()!.id, "both")
    }
    if (key.name === "c" && c()) return app.restoreCheckpoint(c()!.id, "code")
    if (key.name === "m" && c()) return app.restoreCheckpoint(c()!.id, "conversation")
    if (key.name === "r" && app.engine.hasRedo()) app.redoLast()
  })

  return (
    <Scrim onClose={() => app.setCheckpointsOpen(false)}>
      <Overlay title="checkpoints" hint="rewind code, conversation, or both" width={Math.min(68, dims().width - 4)}>
        <Show
          when={checkpoints().length}
          fallback={<text fg={theme.textFaint}>no checkpoints yet — send a prompt first</text>}
        >
          <scrollbox ref={(r: any) => (sb = r)} maxHeight={14} stickyScroll stickyStart="bottom">
            <For each={checkpoints()}>
              {(c, i) => {
                const on = () => sel() === i()
                return (
                  <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={bandBg(on())}
                    onMouseOver={() => setSel(i())}
                    onMouseDown={() => app.restoreCheckpoint(c.id)}
                  >
                    <text fg={on() ? theme.textOnAccent : theme.textFaint}>{on() ? "↺" : " "}</text>
                    <box flexGrow={1}>
                      <text fg={on() ? theme.textOnAccent : theme.textMuted}>{c.label}</text>
                    </box>
                    <text fg={on() ? theme.textOnAccent : theme.textFaint}>
                      {c.files > 0 ? `${c.files} file${c.files === 1 ? "" : "s"} · ` : ""}
                      {ago(c.createdAt)}
                    </text>
                  </box>
                )
              }}
            </For>
          </scrollbox>
        </Show>
        <box flexDirection="row" gap={2}>
          <text fg={theme.textFaint}>↑↓ move · ⏎ both · c code · m conversation · esc close</text>
          <Show when={app.engine.hasRedo()}>
            <text fg={theme.info}>r redo</text>
          </Show>
        </box>
      </Overlay>
    </Scrim>
  )
}
