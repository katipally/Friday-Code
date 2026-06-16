import { Show } from "solid-js"
import { theme } from "@friday/shared"
import { useApp, type ViewItem } from "../store.tsx"

/** Collapsible reasoning on the timeline (⎿ branch). Auto-open while thinking. */
export function ThinkingCard(props: { item: Extract<ViewItem, { kind: "assistant" }> }) {
  const app = useApp()
  const secs = () => (props.item.durationMs ? Math.max(1, Math.round(props.item.durationMs / 1000)) : null)
  const label = () =>
    !props.item.done ? "thinking…" : secs() ? `thought for ${secs()}s` : "thought"

  return (
    <Show when={props.item.reasoning.length > 0}>
      <box flexDirection="column">
        <box flexDirection="row" gap={1} onMouseDown={() => app.toggleThinking(props.item.id)}>
          <text fg={theme.borderMuted}>⎿</text>
          <text fg={theme.textFaint}>◇ {label()}</text>
          <text fg={theme.textFaint}>{props.item.thinkingOpen ? "▾" : "▸"}</text>
        </box>
        <Show when={props.item.thinkingOpen}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.borderMuted}> </text>
            <text fg={theme.textFaint} selectable>
              {props.item.reasoning}
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}
