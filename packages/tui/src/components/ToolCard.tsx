import { GLYPH, getMode, theme } from "@friday/shared"
import { Show } from "solid-js"
import { useApp, type ViewItem } from "../store.tsx"
import { G } from "../util/term.ts"
import { useSpinner } from "../util/useSpinner.ts"
import { DiffCard } from "./DiffCard.tsx"

// First reveal shows a head+tail digest — never the whole dump. The full output sits behind a
// second "view full" gate so even an opened tool stays digestible. Head carries the command/start,
// tail carries the result (pass/fail line), which is what matters most in logs and test runs.
const HEAD_LINES = 8
const TAIL_LINES = 4
const DIGEST_MAX = HEAD_LINES + TAIL_LINES + 1 // below this, just show it all (digest would be pointless)

/** A tool step on the timeline: ⏺ marker + title; output / diff hangs off a ╰ branch. */
export function ToolCard(props: { item: Extract<ViewItem, { kind: "tool" }>; last?: boolean }) {
  const app = useApp()
  const spin = useSpinner()
  const accent = () => getMode(app.mode()).accent

  const marker = () => (props.item.status === "running" ? spin() : G.marker)
  const markerColor = () =>
    props.item.status === "running" ? accent() : props.item.status === "error" ? theme.error : theme.success

  const hasBody = () => !!props.item.diff || !!props.item.output
  // Stream-then-collapse, like the thinking block: the output (tools emit it only on completion) stays
  // visible while this is the running or last/active step, then collapses to just the title once the
  // turn moves on. Click the title to re-expand any finished tool.
  const expanded = () => props.item.status === "running" || props.item.open || !!props.last
  const outputLines = () => props.item.output.split("\n")
  // Two-gate disclosure: the first reveal is a head+tail digest; `full` (second gate) shows everything.
  // While a tool is still running we show the raw tail of what's streamed (no digest mid-stream).
  const digested = () => !props.item.full && props.item.status !== "running" && outputLines().length > DIGEST_MAX
  const hiddenCount = () => outputLines().length - HEAD_LINES - TAIL_LINES
  const shownOutput = () => {
    const lines = outputLines()
    if (!digested()) return props.item.output
    const head = lines.slice(0, HEAD_LINES).join("\n")
    const tail = lines.slice(-TAIL_LINES).join("\n")
    return `${head}\n  ⋯ +${hiddenCount()} lines\n${tail}`
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
          <box flexDirection="column">
            <box flexDirection="row" gap={1}>
              <text fg={theme.borderMuted}>{GLYPH.branch}</text>
              <text fg={props.item.status === "error" ? theme.error : theme.textMuted} selectable>
                {shownOutput()}
              </text>
            </box>
            {/* Second gate: reveal the complete output (or fold it back to the digest). */}
            <Show when={digested() || props.item.full}>
              <box flexDirection="row" gap={1} onMouseDown={() => app.toggleToolFull(props.item.id)}>
                <text fg={theme.borderMuted}> </text>
                <text fg={accent()}>
                  {props.item.full ? "▴ show less" : `▾ view full output (+${hiddenCount()} lines)`}
                </text>
              </box>
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}
