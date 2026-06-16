import { Show } from "solid-js"
import { theme, getMode, GLYPH } from "@friday/shared"
import { useApp, type ViewItem } from "../store.tsx"
import { useSpinner } from "../util/useSpinner.ts"
import { DiffCard } from "./DiffCard.tsx"

const MAX_OUTPUT_LINES = 12

/** A tool step on the timeline: ⏺ marker + title; output / diff hangs off a ╰ branch. */
export function ToolCard(props: { item: Extract<ViewItem, { kind: "tool" }> }) {
  const app = useApp()
  const spin = useSpinner()
  const accent = () => getMode(app.mode()).accent

  const marker = () => (props.item.status === "running" ? spin() : "⏺")
  const markerColor = () =>
    props.item.status === "running" ? accent() : props.item.status === "error" ? theme.error : theme.success

  const outputLines = () => props.item.output.split("\n")
  const clippedOutput = () => {
    const lines = outputLines()
    if (!props.item.open && lines.length > MAX_OUTPUT_LINES) {
      return lines.slice(0, MAX_OUTPUT_LINES).join("\n") + `\n… ${lines.length - MAX_OUTPUT_LINES} more lines`
    }
    return props.item.output
  }

  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row" gap={1} onMouseDown={() => app.toggleToolOpen(props.item.id)}>
        <text fg={markerColor()}>{marker()}</text>
        <text fg={theme.text}>{props.item.title ?? props.item.name}</text>
      </box>

      <Show when={props.item.diff}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.borderMuted}>{GLYPH.branch}</text>
          <box flexGrow={1}>
            <DiffCard diff={props.item.diff!} />
          </box>
        </box>
      </Show>

      <Show when={!props.item.diff && props.item.output}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.borderMuted}>{GLYPH.branch}</text>
          <text fg={props.item.status === "error" ? theme.error : theme.textMuted} selectable>
            {clippedOutput()}
          </text>
        </box>
      </Show>
    </box>
  )
}
