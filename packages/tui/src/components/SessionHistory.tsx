import { getMode, theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For } from "solid-js"
import { useApp } from "../store.tsx"
import { groupSessionsByDir, homeDir as home } from "../util/sessions.ts"
import { Scrim } from "./Scrim.tsx"

/** Full session history across all directories, grouped by directory. Resume or delete any. */
export function SessionHistory() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const accent = () => getMode(app.mode()).accent
  const [sel, setSel] = createSignal(0)

  // Flat, navigable list ordered by directory then recency; rows carry their flat index for headers.
  const grouped = createMemo(() => groupSessionsByDir(app.allSessions()))

  function resume(i: number) {
    const s = grouped().flat[i]
    if (!s) return
    app.setHistoryOpen(false)
    app.switchSession(s.id)
  }

  useKeyboard((key) => {
    if (!app.historyOpen()) return
    const n = grouped().flat.length
    if (key.name === "escape") return app.setHistoryOpen(false)
    if (key.name === "up") return setSel((s) => (s - 1 + n) % Math.max(1, n))
    if (key.name === "down") return setSel((s) => (s + 1) % Math.max(1, n))
    if (key.name === "return" || key.name === "enter") return resume(sel())
    if (key.name === "d") {
      const s = grouped().flat[sel()]
      if (s) app.deleteSession(s.id)
    }
  })

  return (
    <Scrim onClose={() => app.setHistoryOpen(false)}>
      <box
        flexDirection="column"
        width={Math.min(72, dims().width - 4)}
        maxHeight={Math.max(10, 24)}
        border
        borderStyle="single"
        borderColor={theme.border}
        backgroundColor={theme.bgElevated}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>history</text>
          <text fg={theme.textFaint}>· all sessions, grouped by directory</text>
        </box>
        <scrollbox maxHeight={18}>
          <For each={grouped().rows}>
            {(row) => {
              if ("dir" in row) {
                return (
                  <box marginTop={1}>
                    <text fg={theme.textMuted}>{home(row.dir)}</text>
                  </box>
                )
              }
              const s = row.session
              const active = () => sel() === row.index
              return (
                <box
                  flexDirection="row"
                  gap={1}
                  paddingLeft={1}
                  backgroundColor={active() ? theme.bgHover : "transparent"}
                  onMouseOver={() => setSel(row.index)}
                >
                  <box flexGrow={1} onMouseDown={() => resume(row.index)}>
                    <text fg={active() ? accent() : theme.text}>
                      {app.activeSession() === s.id ? "● " : "  "}
                      {s.title}
                    </text>
                  </box>
                  <box onMouseDown={() => app.deleteSession(s.id)}>
                    <text fg={theme.error}>✗</text>
                  </box>
                </box>
              )
            }}
          </For>
        </scrollbox>
        <text fg={theme.textFaint}>↑↓ move · ⏎ resume · d / ✗ delete · esc close</text>
      </box>
    </Scrim>
  )
}
