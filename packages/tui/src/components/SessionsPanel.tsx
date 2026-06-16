import { For, Show } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"

/** Left panel: session tabs. Collapses to a thin clickable strip. */
export function SessionsPanel() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent

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
        <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1} paddingTop={1}>
          <For each={app.sessions()}>
            {(s, i) => {
              const isActive = () => app.activeSession() === s.id
              return (
                <box flexDirection="row" gap={1} onMouseDown={() => app.switchSession(s.id)}>
                  <text fg={isActive() ? accent() : theme.textFaint}>{isActive() ? "●" : "○"}</text>
                  <text fg={isActive() ? theme.text : theme.textMuted}>
                    {i() < 9 ? `${i() + 1} ` : "  "}
                    {s.title}
                  </text>
                </box>
              )
            }}
          </For>
          <box height={1} />
          <box onMouseDown={() => app.newSession()}>
            <text fg={theme.textFaint}>+ new</text>
          </box>
        </scrollbox>
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.textFaint}>⌃1–9 switch</text>
        </box>
      </box>
    </Show>
  )
}
