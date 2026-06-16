import { For, Show } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { parseInline, parseMarkdown, type MdBlock } from "../util/markdown.ts"
import { highlightLine } from "../util/highlight.ts"

const CODE_INLINE = "#e0af68"

// `<span>`'s color prop isn't in the published types (but works at runtime); centralize the cast.
function CSpan(props: { color: string; children: any }) {
  return <span {...({ fg: props.color } as any)}>{props.children}</span>
}

function Inline(props: { text: string }) {
  return (
    <text fg={theme.text} selectable>
      <For each={parseInline(props.text)}>
        {(s) => {
          if (s.code) return <CSpan color={CODE_INLINE}>{s.text}</CSpan>
          if (s.bold) return <strong>{s.text}</strong>
          if (s.italic) return <em>{s.text}</em>
          if (s.strike)
            return (
              <CSpan color={theme.textFaint}>
                <span {...({ attributes: 8 } as any) /* strikethrough */}>{s.text}</span>
              </CSpan>
            )
          if (s.href)
            return (
              <CSpan color={theme.info}>
                <u>{s.text}</u>
              </CSpan>
            )
          return <span>{s.text}</span>
        }}
      </For>
    </text>
  )
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length)
}

/** A monospace-aligned table: header + rule + rows, columns sized to content. */
function Table(props: { headers: string[]; rows: string[][]; accent: string }) {
  const cols = props.headers.length
  const widths = props.headers.map((h, c) =>
    Math.min(40, Math.max(h.length, ...props.rows.map((r) => (r[c] ?? "").length))),
  )
  const rule = widths.map((w) => "─".repeat(w)).join("─┼─")
  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <text fg={props.accent}>
        <strong>{props.headers.map((h, c) => pad(h, widths[c]!)).join(" │ ")}</strong>
      </text>
      <text fg={theme.borderMuted}>{rule}</text>
      <For each={props.rows}>
        {(r) => <text fg={theme.textMuted}>{Array.from({ length: cols }, (_, c) => pad(r[c] ?? "", widths[c]!)).join(" │ ")}</text>}
      </For>
    </box>
  )
}

function Block(props: { b: MdBlock; accent: string }) {
  const b = props.b
  switch (b.type) {
    case "heading":
      return (
        <box marginTop={1} flexDirection="row" gap={1}>
          <text fg={theme.textFaint}>{"#".repeat(b.level)}</text>
          <text fg={props.accent}>
            <strong>{b.text}</strong>
          </text>
        </box>
      )
    case "hr":
      return <text fg={theme.borderMuted}>{"─".repeat(48)}</text>
    case "table":
      return <Table headers={b.headers} rows={b.rows} accent={props.accent} />
    case "code":
      return (
        <box
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={theme.borderMuted}
          backgroundColor={theme.bg}
          paddingLeft={1}
          paddingRight={1}
          marginTop={1}
          marginBottom={1}
        >
          <Show when={b.lang}>
            <text fg={theme.textFaint}>{b.lang}</text>
          </Show>
          <For each={b.lines}>
            {(line) => (
              <text selectable>
                <For each={highlightLine(line)}>{(seg) => <CSpan color={seg.color}>{seg.text}</CSpan>}</For>
              </text>
            )}
          </For>
        </box>
      )
    case "list":
      return (
        <box flexDirection="column">
          <For each={b.items}>
            {(item) => (
              <box flexDirection="row" gap={1} paddingLeft={item.depth * 2}>
                <Show
                  when={item.task}
                  fallback={<text fg={props.accent}>{item.ordered ? `${item.index}.` : "•"}</text>}
                >
                  <text fg={item.checked ? theme.success : theme.textFaint}>{item.checked ? "☑" : "☐"}</text>
                </Show>
                <Inline text={item.text} />
              </box>
            )}
          </For>
        </box>
      )
    case "quote":
      return (
        <box flexDirection="row" gap={1}>
          <text fg={theme.borderMuted}>│</text>
          <box flexDirection="column">
            <For each={b.lines}>{(l) => <text fg={theme.textMuted}>{l}</text>}</For>
          </box>
        </box>
      )
    default:
      return <Inline text={b.text} />
  }
}

/** Lightweight markdown renderer (headings, lists, quotes, fenced code with highlighting, inline). */
export function Markdown(props: { content: string }) {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  return (
    <box flexDirection="column">
      <For each={parseMarkdown(props.content)}>{(b) => <Block b={b} accent={accent()} />}</For>
    </box>
  )
}
