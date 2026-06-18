import { createMemo, For, Match, Show, Switch } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { theme, getMode, type ModeId } from "@friday/shared"
import { useApp, type ViewItem } from "../store.tsx"
import { ThinkingCard } from "./ThinkingCard.tsx"
import { ToolCard } from "./ToolCard.tsx"
import { Markdown } from "./Markdown.tsx"
import { EmptyHome } from "./EmptyHome.tsx"
import { Pressable } from "./Pressable.tsx"
import { FileChip } from "./FileChip.tsx"
import { G, modeGlyph } from "../util/term.ts"
import { copyText } from "../util/clipboard.ts"
import { parseMentions } from "../util/mentions.ts"
import { Appear, shimmerAccent } from "../motion/index.ts"

function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
function fmtElapsed(ms?: number): string {
  if (ms == null) return ""
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m${Math.round(s % 60).toString().padStart(2, "0")}s`
}

/** User prompt: a right-aligned rounded bubble whose border is colored by the mode it was sent in. */
function UserBubble(props: { item: Extract<ViewItem, { kind: "user" }> }) {
  const app = useApp()
  const renderer = useRenderer()
  const accent = () => shimmerAccent(getMode((props.item.mode as ModeId) ?? app.mode()).accent)
  // File references in the prompt show as click-to-open chips beneath the text.
  const chips = createMemo(() => parseMentions(props.item.text, app.roots()))
  const copy = () => {
    copyText(props.item.text, renderer)
    app.focusComposer()
  }
  // Undo rewinds files + conversation to the snapshot before this turn and drops the prompt back
  // into the composer (everything after is erased), so you can re-run from that exact point.
  const undo = () => app.rewindToPrompt(props.item.text)
  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row" justifyContent="flex-end">
        <box
          flexDirection="column"
          gap={1}
          maxWidth="85%"
          border
          borderStyle="rounded"
          borderColor={accent()}
          backgroundColor={theme.bgComposer}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.text} selectable>
            {props.item.text}
          </text>
          <Show when={chips().length > 0}>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <For each={chips()}>{(chip) => <FileChip chip={chip} accent={accent()} onOpen={() => app.openPath(chip.rel)} />}</For>
            </box>
          </Show>
        </box>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingRight={1}>
        <Pressable label="⧉ copy" onClick={copy} />
        <Pressable label="↶ undo" onClick={undo} />
      </box>
    </box>
  )
}

/** Assistant reply: rendered flush on the background with a ⏺ marker tinted by the mode the reply
 * ran in (so you can tell at a glance whether it was plan/default/accept/yolo); reasoning is a ╰ branch. */
function AssistantMessage(props: { item: Extract<ViewItem, { kind: "assistant" }> }) {
  const app = useApp()
  const renderer = useRenderer()
  const accent = () => shimmerAccent(getMode((props.item.mode as ModeId) ?? app.mode()).accent)
  const copy = () => {
    copyText(props.item.text, renderer)
    app.focusComposer()
  }
  // Fork branches a new session from this point — including this reply (and its tools) — so the
  // new chat starts right after the AI responded.
  const fork = () => {
    const items = app.items()
    const idx = items.findIndex((i) => i.id === props.item.id)
    for (let j = idx - 1; j >= 0; j--) {
      const it = items[j]
      if (it && it.kind === "user") return app.forkFromText(it.text)
    }
    app.forkFromText(props.item.text)
  }
  const meta = () => {
    const it = props.item
    const tok = it.inputTokens != null || it.outputTokens != null ? `↑${fmtTok(it.inputTokens ?? 0)} ↓${fmtTok(it.outputTokens ?? 0)}` : ""
    const t = fmtElapsed(it.durationMs)
    return [tok, t].filter(Boolean).join(" · ")
  }
  return (
    <box flexDirection="column" marginBottom={1}>
      <ThinkingCard item={props.item} />
      <Show when={props.item.text.length > 0}>
        <box flexDirection="row" gap={1}>
          <text fg={accent()}>{G.marker}</text>
          <box flexGrow={1} flexDirection="column">
            <Markdown content={props.item.text} streaming={!props.item.done} />
            <Show when={!props.item.done}>
              <text fg={theme.textFaint}>▋</text>
            </Show>
            <Show when={props.item.done && !props.item.intermediate}>
              <box flexDirection="row" alignItems="center" paddingTop={0}>
                <Pressable label="⧉ copy" onClick={copy} />
                <Pressable label="⑂ fork" onClick={fork} />
                <Show when={meta()}>
                  <box paddingLeft={1}>
                    <text fg={theme.textFaint}>◇ {meta()}</text>
                  </box>
                </Show>
              </box>
            </Show>
          </box>
        </box>
      </Show>
    </box>
  )
}

/** A dim, centered system notice (e.g. context compaction). When it carries a compaction `summary`
 * it becomes clickable, opening the read-only summary viewer. */
function NoticeBubble(props: { item: Extract<ViewItem, { kind: "notice" }> }) {
  const app = useApp()
  const clickable = () => !!props.item.summary
  return (
    <box flexDirection="row" justifyContent="center" marginBottom={1}>
      <box
        border
        borderStyle="rounded"
        borderColor={theme.border}
        paddingLeft={1}
        paddingRight={1}
        onMouseDown={() => props.item.summary && app.viewCompaction(props.item.summary)}
      >
        <text fg={clickable() ? theme.textMuted : theme.textFaint}>{props.item.text}</text>
      </box>
    </box>
  )
}

/**
 * Flow divider shown when a plan is accepted — a rule with "▸ running · <mode>" tinted by the chosen
 * mode's accent. It keeps plan execution reading as a continuation of the same response rather than a
 * fresh user prompt.
 */
function BreakerRow(props: { item: Extract<ViewItem, { kind: "breaker" }> }) {
  const tint = () => getMode(props.item.mode).accent
  return (
    <box flexDirection="row" justifyContent="center" alignItems="center" gap={1} marginTop={1} marginBottom={1}>
      <text fg={tint()}>{"─".repeat(8)}</text>
      <box border borderStyle="rounded" borderColor={tint()} paddingLeft={1} paddingRight={1}>
        <text fg={tint()}>
          {modeGlyph(props.item.mode)} {props.item.label}
        </text>
      </box>
      <text fg={tint()}>{"─".repeat(8)}</text>
    </box>
  )
}

function ErrorBubble(props: { item: Extract<ViewItem, { kind: "error" }> }) {
  return (
    <box flexDirection="row" gap={1} marginBottom={1}>
      <text fg={theme.error}>{G.marker}</text>
      <text fg={theme.error} selectable>
        {props.item.text}
      </text>
    </box>
  )
}

export function Chat() {
  const app = useApp()
  let sb: any
  // Freeze scroll-back keys whenever a modal owns the keyboard (single source of truth in store).
  const canScroll = () => app.view() === "shell" && !app.anyModalOpen()

  // Keyboard scroll-back through history (keys that don't collide with composer typing).
  useKeyboard((key) => {
    if (!canScroll() || !sb?.scrollBy) return
    if (key.name === "pageup") return sb.scrollBy(-10)
    if (key.name === "pagedown") return sb.scrollBy(10)
    if (key.shift && key.name === "up") return sb.scrollBy(-3)
    if (key.shift && key.name === "down") return sb.scrollBy(3)
    if (key.ctrl && key.name === "u") return sb.scrollBy(-10)
    if (key.ctrl && key.name === "d") return sb.scrollBy(10)
  })

  return (
    <Show
      when={app.items().length > 0}
      fallback={<EmptyHome />}
    >
      {/* paddingRight leaves a buffer so the scrollbar never overlaps the message text. */}
      <scrollbox ref={(r: any) => (sb = r)} flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom" paddingTop={1} paddingRight={1}>
        <For each={app.items()}>
          {(item) => (
            <Appear distance={1} duration={170}>
              <Switch>
                <Match when={item.kind === "user"}>
                  <UserBubble item={item as any} />
                </Match>
                <Match when={item.kind === "assistant"}>
                  <AssistantMessage item={item as any} />
                </Match>
                <Match when={item.kind === "tool"}>
                  <ToolCard item={item as any} />
                </Match>
                <Match when={item.kind === "error"}>
                  <ErrorBubble item={item as any} />
                </Match>
                <Match when={item.kind === "notice"}>
                  <NoticeBubble item={item as any} />
                </Match>
                <Match when={item.kind === "breaker"}>
                  <BreakerRow item={item as any} />
                </Match>
              </Switch>
            </Appear>
          )}
        </For>
      </scrollbox>
    </Show>
  )
}
