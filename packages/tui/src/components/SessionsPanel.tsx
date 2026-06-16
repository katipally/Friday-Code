import { For, Show } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { useSpinner } from "../util/useSpinner.ts"
import { useBreathe } from "../motion/index.ts"

/**
 * Left panel — the active sessions for the current workspace. A session only
 * appears once the user has actually sent a message in it (so empty "new session"
 * placeholders never clutter the list); the focused session always shows. Full
 * cross-workspace history lives in the /history modal.
 */
export function SessionsPanel() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const spin = useSpinner()
  const liveDot = useBreathe(accent, app.busy)

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
        <box flexDirection="row" alignItems="center" paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>sessions</text>
          <box flexGrow={1} />
          <box onMouseDown={() => app.setLeftOpen(false)}>
            <text fg={theme.textFaint}>‹</text>
          </box>
        </box>

        <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
          <For each={app.activeSessions()}>
            {(s, i) => {
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
                      {i() < 9 ? `${i() + 1} ` : "  "}
                      {s.title}
                    </text>
                    <Show when={unseen()}>
                      <text fg={accent()}>•</text>
                    </Show>
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
