import { createMemo, For, Show } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { useSpinner } from "../util/useSpinner.ts"
import { useBreathe } from "../motion/index.ts"

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/**
 * Left panel — splits live RUNNING sessions (current workspace) from HISTORY
 * (sessions in other directories). The active session shows a live status glyph.
 * Full per-session concurrency lands in M10; today the active session is the
 * one that can be "running".
 */
export function SessionsPanel() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const spin = useSpinner()
  const liveDot = useBreathe(accent, app.busy)

  // HISTORY = sessions whose primary dir differs from the current workspace.
  const history = createMemo(() =>
    app
      .allSessions()
      .filter((s) => s.cwd !== app.currentCwd())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12),
  )

  return (
    <Show
      when={app.leftOpen()}
      fallback={
        <box
          width={3}
          height="100%"
          backgroundColor={theme.bgPanel}
          alignItems="center"
          paddingTop={1}
          onMouseDown={() => app.setLeftOpen(true)}
        >
          <text fg={theme.textMuted}>›</text>
        </box>
      }
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
        <box flexDirection="row" paddingLeft={1} paddingRight={1} alignItems="center">
          <text fg={theme.textMuted}>sessions</text>
          <box flexGrow={1} />
          <box onMouseDown={() => app.setLeftOpen(false)}>
            <text fg={theme.textFaint}>‹</text>
          </box>
        </box>

        <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
          {/* RUNNING — sessions in this workspace, each with its own live status. */}
          <text fg={theme.textFaint}>running</text>
          <For each={app.sessions()}>
            {(s, i) => {
              const isActive = () => app.activeSession() === s.id
              const isBusy = () => app.sessionRunning(s.id)
              const needs = () => app.sessionNeedsInput(s.id)
              const dot = () => (needs() ? "⚠" : isBusy() ? spin() : isActive() ? "●" : "○")
              const dotColor = () => (needs() ? theme.warning : isBusy() ? accent() : isActive() ? liveDot() : theme.textFaint)
              return (
                <box flexDirection="row" gap={1}>
                  <box flexGrow={1} flexDirection="row" gap={1} onMouseDown={() => app.switchSession(s.id)}>
                    <text fg={dotColor()}>{dot()}</text>
                    <text fg={isActive() ? theme.text : theme.textMuted}>
                      {i() < 9 ? `${i() + 1} ` : "  "}
                      {s.title}
                    </text>
                  </box>
                  <box onMouseDown={() => app.deleteSession(s.id)}>
                    <text fg={theme.textFaint}>✗</text>
                  </box>
                </box>
              )
            }}
          </For>
          <Show when={app.busy()}>
            <box paddingLeft={2}>
              <text fg={theme.textFaint}>{app.status()}</text>
            </box>
          </Show>
          <box onMouseDown={() => app.newSession()}>
            <text fg={theme.textFaint}>+ new</text>
          </box>

          {/* HISTORY — sessions from other directories. */}
          <Show when={history().length}>
            <box height={1} />
            <text fg={theme.textFaint}>history</text>
            <For each={history()}>
              {(s) => (
                <box flexDirection="row" gap={1} onMouseDown={() => app.switchSession(s.id)}>
                  <text fg={theme.success}>✓</text>
                  <box flexGrow={1}>
                    <text fg={theme.textMuted}>{s.title}</text>
                  </box>
                  <text fg={theme.textFaint}>{ago(s.updatedAt)}</text>
                </box>
              )}
            </For>
          </Show>
        </scrollbox>

        <box paddingLeft={1} paddingRight={1} onMouseDown={() => app.setHistoryOpen(true)}>
          <text fg={theme.textFaint}>⏲ all history</text>
        </box>
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.textFaint}>⌃1–9 switch</text>
        </box>
      </box>
    </Show>
  )
}
