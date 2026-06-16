import { createMemo, For, Show } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp, type SessionItem } from "../store.tsx"
import { useSpinner } from "../util/useSpinner.ts"
import { useBreathe, shimmerAccent } from "../motion/index.ts"
import { CloseButton, ReopenStub } from "./PanelChrome.tsx"

function shortDir(p: string): string {
  const h = process.env.HOME
  const rel = h && p.startsWith(h) ? "~" + p.slice(h.length) : p
  // Keep the panel narrow: show the last two path segments.
  const parts = rel.split("/").filter(Boolean)
  return parts.length <= 2 ? rel : "…/" + parts.slice(-2).join("/")
}

/**
 * Left panel — the LIVE sessions opened in this run of Friday (they end when Friday closes),
 * grouped by their working directory so multi-project work is easy to scan. Empty "new session"
 * placeholders are discarded automatically. Full persisted history lives in the /history modal.
 */
export function SessionsPanel() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const spin = useSpinner()
  const liveDot = useBreathe(accent, app.busy)

  // Group the flat active-session list by directory, carrying each session's flat index so the
  // ⌃1–9 quick-switch numbering stays consistent with app.switchSessionByIndex.
  const groups = createMemo(() => {
    const byDir = new Map<string, { s: SessionItem; index: number }[]>()
    app.activeSessions().forEach((s, i) => {
      if (!byDir.has(s.cwd)) byDir.set(s.cwd, [])
      byDir.get(s.cwd)!.push({ s, index: i })
    })
    return [...byDir.entries()]
  })

  return (
    <Show
      when={app.leftOpen()}
      fallback={<ReopenStub glyph="›" onOpen={() => app.setLeftOpen(true)} />}
    >
      <box
        width={app.leftWidth()}
        height="100%"
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={theme.border}
        backgroundColor={theme.bgPanel}
      >
        <box flexDirection="row" alignItems="center" paddingLeft={1}>
          <text fg={theme.textMuted}>sessions</text>
          <box flexGrow={1} />
          <CloseButton hint="⌃B" onClose={() => app.setLeftOpen(false)} />
        </box>

        <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
          <For each={groups()}>
            {([dir, rows]) => (
              <box flexDirection="column">
                {/* Directory header — only worth showing when sessions span more than one. */}
                <Show when={groups().length > 1}>
                  <box marginTop={1}>
                    <text fg={theme.textFaint}>{shortDir(dir)}</text>
                  </box>
                </Show>
                <For each={rows}>
                  {({ s, index }) => {
                    const isActive = () => app.activeSession() === s.id
                    const isBusy = () => app.sessionRunning(s.id)
                    const needs = () => app.sessionNeedsInput(s.id)
                    const unseen = () => app.sessionActivity(s.id)
                    const dot = () => (needs() ? "⚠" : isBusy() ? spin() : isActive() ? "●" : "○")
                    const dotColor = () => (needs() ? theme.warning : isBusy() ? accent() : isActive() ? liveDot() : theme.textFaint)
                    return (
                      <box flexDirection="row" gap={1}>
                        <box flexGrow={1} flexDirection="row" gap={1} onMouseDown={() => app.switchSession(s.id)}>
                          <text fg={dotColor()}>{dot()}</text>
                          <text fg={isActive() ? theme.text : theme.textMuted}>
                            {index < 9 ? `${index + 1} ` : "  "}
                            {s.title}
                          </text>
                          <Show when={unseen()}>
                            <text fg={shimmerAccent(accent())}>•</text>
                          </Show>
                        </box>
                        <box onMouseDown={() => app.deleteSession(s.id)}>
                          <text fg={theme.textFaint}>✗</text>
                        </box>
                      </box>
                    )
                  }}
                </For>
              </box>
            )}
          </For>
          <Show when={app.busy()}>
            <box paddingLeft={2}>
              <text fg={theme.textFaint}>{app.status()}</text>
            </box>
          </Show>
          <box marginTop={1} onMouseDown={() => app.newSession()}>
            <text fg={theme.textFaint}>+ new session</text>
          </box>
        </scrollbox>

        <box flexDirection="column" paddingLeft={1} paddingRight={1}>
          <box onMouseDown={() => app.setHistoryOpen(true)}>
            <text fg={theme.textFaint}>⏲ /history</text>
          </box>
          <text fg={theme.textFaint}>⌃1–9 switch</text>
        </box>
      </box>
    </Show>
  )
}
