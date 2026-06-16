import { Show } from "solid-js"
import { theme } from "@friday/shared"
import { useApp, type PendingPermission } from "../store.tsx"

/** A keycap-style action button: [k] label, tinted by intent. */
function Action(props: { keycap: string; label: string; color: string; onClick: () => void }) {
  return (
    <box flexDirection="row" gap={1} onMouseDown={props.onClick}>
      <box border borderStyle="rounded" borderColor={props.color} paddingLeft={1} paddingRight={1}>
        <text fg={props.color}>{props.keycap}</text>
      </box>
      <text fg={theme.textMuted}>{props.label}</text>
    </box>
  )
}

/** Inline HITL card shown above the composer when the engine asks for permission. */
export function PermissionCard() {
  const app = useApp()
  return (
    <Show when={app.pending()}>
      {(p: () => PendingPermission) => (
        <box
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={theme.warning}
          backgroundColor={theme.bgElevated}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          marginBottom={1}
          gap={1}
        >
          <box flexDirection="row" gap={1}>
            <text fg={theme.warning}>⚠ permission required</text>
            <box flexGrow={1} />
            <text fg={theme.textFaint}>{p().tool}</text>
          </box>

          <text fg={theme.text}>{p().summary}</text>

          {/* The exact command / path, in a monospace block so long input wraps cleanly. */}
          <Show when={p().detail}>
            <box
              border
              borderStyle="rounded"
              borderColor={theme.border}
              backgroundColor={theme.bgComposer}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.textMuted} selectable>
                {p().detail}
              </text>
            </box>
          </Show>

          <box flexDirection="row" gap={3} marginTop={1}>
            <Action keycap="a" label="allow once" color={theme.success} onClick={() => app.replyPermission("allow-once")} />
            <Action keycap="s" label="allow always" color={theme.info} onClick={() => app.replyPermission("allow-always")} />
            <Action keycap="d" label="deny · esc" color={theme.error} onClick={() => app.replyPermission("deny")} />
          </box>
        </box>
      )}
    </Show>
  )
}
