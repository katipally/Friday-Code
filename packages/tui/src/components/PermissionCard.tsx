import { Show } from "solid-js"
import { theme } from "@friday/shared"
import { useApp } from "../store.tsx"

function Btn(props: { label: string; color: string; onClick: () => void }) {
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.color}
      paddingLeft={1}
      paddingRight={1}
      onMouseDown={props.onClick}
    >
      <text fg={props.color}>{props.label}</text>
    </box>
  )
}

/** Inline HITL card shown above the composer when the engine asks for permission. */
export function PermissionCard() {
  const app = useApp()
  return (
    <Show when={app.pending()}>
      {(p) => (
        <box
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={theme.warning}
          backgroundColor={theme.bgElevated}
          paddingLeft={1}
          paddingRight={1}
          marginBottom={1}
          gap={1}
        >
          <box flexDirection="row" gap={1}>
            <text fg={theme.warning}>⚠ permission</text>
            <text fg={theme.text}>{p().summary}</text>
          </box>
          <Show when={p().detail}>
            <text fg={theme.textMuted} selectable>
              {p().detail}
            </text>
          </Show>
          <box flexDirection="row" gap={2}>
            <Btn label="allow once  a" color={theme.success} onClick={() => app.replyPermission("allow-once")} />
            <Btn label="always  s" color={theme.info} onClick={() => app.replyPermission("allow-always")} />
            <Btn label="deny  d / esc" color={theme.error} onClick={() => app.replyPermission("deny")} />
          </box>
        </box>
      )}
    </Show>
  )
}
