import { Show } from "solid-js"
import { theme, GLYPH } from "@friday/shared"
import { useApp, type ViewItem } from "../store.tsx"
import { syntaxStyle } from "../util/syntax.ts"

/** Collapsible reasoning on the timeline (╰ branch). Auto-open while thinking. */
export function ThinkingCard(props: { item: Extract<ViewItem, { kind: "assistant" }> }) {
  const app = useApp()
  const secs = () => (props.item.durationMs ? Math.max(1, Math.round(props.item.durationMs / 1000)) : null)
  const label = () =>
    !props.item.done ? "thinking…" : secs() ? `thought for ${secs()}s` : "thought"

  return (
    <Show when={props.item.reasoning.length > 0}>
      <box flexDirection="column">
        <box flexDirection="row" gap={1} onMouseDown={() => app.toggleThinking(props.item.id)}>
          <text fg={theme.borderMuted}>{GLYPH.branch}</text>
          <text fg={theme.textFaint}>◇ {label()}</text>
          <text fg={theme.textFaint}>{props.item.thinkingOpen ? "▾" : "▸"}</text>
        </box>
        <Show when={props.item.thinkingOpen}>
          {/* Reasoning rendered as muted markdown with a left rule (opencode pattern). */}
          <box flexDirection="row" border={["left"]} borderColor={theme.borderMuted} paddingLeft={1} marginTop={0}>
            <box flexGrow={1}>
              <markdown
                content={props.item.reasoning}
                syntaxStyle={syntaxStyle()}
                fg={theme.textFaint}
                streaming={!props.item.done}
              />
            </box>
          </box>
        </Show>
      </box>
    </Show>
  )
}
