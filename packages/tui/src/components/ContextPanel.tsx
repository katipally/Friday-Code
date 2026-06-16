import { Show } from "solid-js"
import { theme } from "@friday/shared"
import { useApp } from "../store.tsx"

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
          <box flexDirection="row" gap={1}>
            <text fg={theme.textFaint}>FRIDAY.md</text>
            <text fg={theme.textFaint}>—</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={theme.textFaint}>@ files</text>
            <text fg={theme.textFaint}>0</text>
          </box>
          <box flexDirection="column">
            <text fg={theme.textFaint}>context</text>
            <text fg={theme.textFaint}>▱▱▱▱▱▱ 0%</text>
          </box>
          <box height={1} />
          <text fg={theme.textFaint}>tools land in M1</text>
        </box>
      </box>
    </Show>
  )
}
