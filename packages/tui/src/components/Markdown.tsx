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

function Block(props: { b: MdBlock; accent: string }) {
  const b = props.b
  switch (b.type) {
    case "heading":
      return (
        <box marginTop={1}>
          <text fg={props.accent}>
            <strong>{b.text}</strong>
          </text>
        </box>
      )
    case "hr":
      return <text fg={theme.borderMuted}>{"─".repeat(40)}</text>
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
            {(item, i) => (
              <box flexDirection="row" gap={1}>
                <text fg={props.accent}>{b.ordered ? `${i() + 1}.` : "•"}</text>
                <Inline text={item} />
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
