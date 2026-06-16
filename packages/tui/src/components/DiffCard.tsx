import { For, Show } from "solid-js"
import { theme } from "@friday/shared"

const MAX_LINES = 60

function lineColor(line: string): string {
  if (line.startsWith("+")) return theme.success
  if (line.startsWith("-")) return theme.error
  if (line.startsWith("@@") || line.trimStart().startsWith("⋮")) return theme.textFaint
  return theme.textMuted
}

/** Renders a unified-diff string (space/+/- prefixed lines) with colors. No tree-sitter. */
export function DiffCard(props: { diff: string }) {
  const all = () => props.diff.split("\n")
  const shown = () => all().slice(0, MAX_LINES)
  const extra = () => Math.max(0, all().length - MAX_LINES)

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.borderMuted}
      backgroundColor={theme.bg}
      paddingLeft={1}
      paddingRight={1}
    >
      <For each={shown()}>{(line) => <text fg={lineColor(line)} selectable>{line || " "}</text>}</For>
      <Show when={extra() > 0}>
        <text fg={theme.textFaint}>… {extra()} more lines</text>
      </Show>
    </box>
  )
}
