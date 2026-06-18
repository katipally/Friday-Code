import { GLYPH, getMode, theme } from "@friday/shared"
import { Show } from "solid-js"
import { useApp, type ViewItem } from "../store.tsx"
import { G } from "../util/term.ts"
import { useSpinner } from "../util/useSpinner.ts"
import { DiffCard } from "./DiffCard.tsx"

const MAX_OUTPUT_LINES = 12

/** A tool step on the timeline: ⏺ marker + title; output / diff hangs off a ╰ branch. */
export function ToolCard(props: { item: Extract<ViewItem, { kind: "tool" }> }) {
  const app = useApp()
  const spin = useSpinner()
  const accent = () => getMode(app.mode()).accent

  const marker = () => (props.item.status === "running" ? spin() : G.marker)
  const markerColor = () =>
    props.item.status === "running" ? accent() : props.item.status === "error" ? theme.error : theme.success

  const hasBody = () => !!props.item.diff || !!props.item.output
  // Auto-collapse once the tool finishes (like the thinking block): show the body live while running,
  // then collapse to just the title on done. Click the title to expand/re-collapse.
  const expanded = () => props.item.status === "running" || props.item.open
  const outputLines = () => props.item.output.split("\n")
  const clippedOutput = () => {
    const lines = outputLines()
    if (!props.item.open && lines.length > MAX_OUTPUT_LINES) {
      return `${lines.slice(0, MAX_OUTPUT_LINES).join("\n")}\n… ${lines.length - MAX_OUTPUT_LINES} more lines`
    }
    return props.item.output
  }

  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row" gap={1} onMouseDown={() => app.toggleToolOpen(props.item.id)}>
        <text fg={markerColor()}>{marker()}</text>
        <text fg={theme.text}>{props.item.title ?? props.item.name}</text>
        {/* expand/collapse affordance, shown once there's a body and the tool has finished */}
        <Show when={hasBody() && props.item.status !== "running"}>
          <text fg={theme.textFaint}>{props.item.open ? "▾" : "▸"}</text>
        </Show>
      </box>

      <Show when={expanded()}>
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
      </Show>
    </box>
  )
}
