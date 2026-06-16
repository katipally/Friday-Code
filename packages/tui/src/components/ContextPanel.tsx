import { For, Show } from "solid-js"
import { theme } from "@friday/shared"
import { useApp } from "../store.tsx"

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Right panel: context (FRIDAY.md, files, token meter, tools). Mostly placeholder in M0. */
export function ContextPanel() {
  const app = useApp()

  return (
    <Show
      when={app.rightOpen()}
      fallback={
        <box
          width={3}
          height="100%"
          backgroundColor={theme.bgPanel}
          alignItems="center"
          paddingTop={1}
          onMouseDown={() => app.setRightOpen(true)}
        >
          <text fg={theme.textMuted}>‹</text>
        </box>
      }
    >
      <box
        width={app.rightWidth()}
        height="100%"
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={theme.border}
        backgroundColor={theme.bgPanel}
      >
        <box flexDirection="row" paddingLeft={1} paddingRight={1} alignItems="center">
          <box onMouseDown={() => app.setRightOpen(false)}>
            <text fg={theme.textFaint}>›</text>
          </box>
          <box flexGrow={1} />
          <text fg={theme.textMuted}>context</text>
        </box>
        <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} paddingTop={1} gap={1}>
          <box flexDirection="column">
            <text fg={theme.textMuted}>context files</text>
            <Show when={app.contextFiles().length} fallback={<text fg={theme.textFaint}>none (add FRIDAY.md)</text>}>
              <For each={app.contextFiles()}>{(f) => <text fg={theme.success}>✓ {f}</text>}</For>
            </Show>
          </box>
          <box flexDirection="column">
            <text fg={theme.textMuted}>tokens</text>
            <text fg={theme.textFaint}>{fmtTokens(app.tokens())} used this turn</text>
          </box>
          <box flexDirection="column">
            <text fg={theme.textMuted}>model</text>
            <text fg={theme.textFaint}>{app.model()}</text>
          </box>
          <Show when={app.skills().length}>
            <box flexDirection="column">
              <text fg={theme.textMuted}>skills</text>
              <For each={app.skills()}>{(s) => <text fg={theme.textFaint}>• {s.name}</text>}</For>
            </box>
          </Show>
          <Show when={app.runningTools().length}>
            <box flexDirection="column">
              <text fg={theme.textMuted}>active</text>
              <For each={app.runningTools()}>{(t) => <text fg={theme.warning}>⟳ {t}</text>}</For>
            </box>
          </Show>
        </box>
      </box>
    </Show>
  )
}
