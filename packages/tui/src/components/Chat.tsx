import { getMode, type ModeId, theme } from "@friday/shared"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Appear, shimmerAccent } from "../motion/index.ts"
import { useApp, type ViewItem } from "../store.tsx"
import { tokenPreview } from "../util/attachments.ts"
import { copyText } from "../util/clipboard.ts"
import { parseMentions } from "../util/mentions.ts"
import { G, modeGlyph } from "../util/term.ts"
import { EmptyHome } from "./EmptyHome.tsx"
import { FileChip } from "./FileChip.tsx"
import { Markdown } from "./Markdown.tsx"
import { Pressable } from "./Pressable.tsx"
import { ThinkingCard } from "./ThinkingCard.tsx"
import { ToolCard } from "./ToolCard.tsx"

function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
function fmtElapsed(ms?: number): string {
  if (ms == null) return ""
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m${Math.round(s % 60)
    .toString()
    .padStart(2, "0")}s`
}

/** User prompt: a right-aligned elevated panel whose single-line border is tinted by the mode the
 * message was SENT in (locked at send time, gently shimmering) — the one intentional border in the
 * app, so you can always tell which mode each turn ran in. */
function UserBubble(props: { item: Extract<ViewItem, { kind: "user" }> }) {
  const app = useApp()
  const renderer = useRenderer()
  // The mode this turn ACTUALLY ran in — locked at send time, never re-tinted by later mode switches.
  const ranMode = (): ModeId => (props.item.mode as ModeId) ?? app.mode()
  const accent = () => shimmerAccent(getMode(ranMode()).accent)
  // What the user saw (compact, with inline paste tokens) — falls back to the sent text.
  const shown = () => props.item.display ?? props.item.text
  // Manually-typed `@path` mentions show as click-to-preview chips beneath the text.
  const chips = createMemo(() => parseMentions(shown(), app.roots()))
  // Attachment tokens (pasted text, files, images) → click-to-preview chips; content/path kept on item.
  const attachChips = createMemo(() => {
    const m = props.item.pastes
    if (!m) return []
    return Object.entries(m)
      .filter(([tok]) => shown().includes(tok))
      .map(([tok, val]) => tokenPreview(tok, val))
  })
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
          borderStyle="single"
          borderColor={accent()}
          backgroundColor={theme.bgElevated}
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg={theme.text} selectable>
            {shown()}
          </text>
          <Show when={chips().length > 0 || attachChips().length > 0}>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <For each={chips()}>
                {(chip) => (
                  <FileChip
                    chip={chip}
                    accent={accent()}
                    onOpen={() =>
                      app.setPreview(
                        chip.kind === "image"
                          ? { kind: "image", title: chip.rel, path: chip.abs ?? chip.rel }
                          : { kind: "file", title: chip.rel, path: chip.abs ?? chip.rel },
                      )
                    }
                  />
                )}
              </For>
              <For each={attachChips()}>
                {(c) => (
                  <Pressable
                    label={`${c.kind === "image" ? "▣" : c.kind === "file" ? "▤" : "▥"} ${c.title}`}
                    onClick={() =>
                      app.setPreview(
                        c.kind === "text"
                          ? { kind: "text", title: c.title, text: c.text }
                          : { kind: c.kind, title: c.title, path: c.path },
                      )
                    }
                  />
                )}
              </For>
            </box>
          </Show>
        </box>
      </box>
      <box flexDirection="row" justifyContent="flex-end" alignItems="center" gap={1} paddingRight={1}>
        <Pressable label="⧉ copy" onClick={copy} />
        <Pressable label="↶ undo" onClick={undo} />
      </box>
    </box>
  )
}

/** Assistant reply: rendered flush on the background with a ⏺ marker tinted by the mode the reply
 * ran in (so you can tell at a glance whether it was plan/default/yolo); reasoning is a ╰ branch. */
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
    const tok =
      it.inputTokens != null || it.outputTokens != null
        ? `↑${fmtTok(it.inputTokens ?? 0)} ↓${fmtTok(it.outputTokens ?? 0)}`
        : ""
    const t = fmtElapsed(it.durationMs)
    return [tok, t].filter(Boolean).join(" · ")
  }
  const hasText = () => props.item.text.trim().length > 0
  const hasReasoning = () => props.item.reasoning.length > 0
  return (
    // Render nothing for a finished, fully-empty step (reasoning-only and no-op steps would otherwise
    // leave a bare ⏺ / blank line after the thinking block).
    <Show when={hasText() || hasReasoning() || !props.item.done}>
      <box flexDirection="column" marginBottom={hasText() || hasReasoning() ? 1 : 0}>
        <ThinkingCard item={props.item} />
        <Show when={hasText()}>
          <box flexDirection="row" gap={1}>
            <text fg={accent()}>{G.marker}</text>
            <box flexGrow={1} flexDirection="column">
              <Markdown content={props.item.text} streaming={!props.item.done} />
              <Show when={!props.item.done}>
                <text fg={theme.textFaint}>▋</text>
              </Show>
              <Show when={props.item.interrupted}>
                <text fg={theme.warning}>⏸ paused — adding context…</text>
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
    </Show>
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
        backgroundColor={theme.bgElevated}
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
 * Flow divider shown when a plan is accepted ("running · <mode>") or refined ("refining plan") —
 * a centered mode-tinted pill flanked by rules that flex to fill the column on BOTH sides, so the
 * pill stays truly centered at any width (the rules grow/shrink, the pill doesn't). An optional
 * `note` renders as a quoted subtitle below. Keeps plan flow reading as a continuation rather than
 * a fresh user prompt.
 */
function BreakerRow(props: { item: Extract<ViewItem, { kind: "breaker" }> }) {
  const tint = () => getMode(props.item.mode).accent
  // Over-long so the rule always reaches the edge; the side boxes clip the overflow (height 1).
  const rule = "─".repeat(240)
  return (
    <box flexDirection="column" alignItems="center" marginTop={1} marginBottom={1}>
      <box flexDirection="row" alignItems="center" gap={1} width="100%">
        {/* flexBasis 0 + minWidth 0 makes both rules share the leftover width equally → centered pill. */}
        <box flexGrow={1} flexBasis={0} minWidth={0} height={1} overflow="hidden">
          <text fg={tint()}>{rule}</text>
        </box>
        <box backgroundColor={theme.bgElevated} paddingLeft={1} paddingRight={1} flexShrink={0}>
          <text fg={tint()}>
            {modeGlyph(props.item.mode)} {props.item.label}
          </text>
        </box>
        <box flexGrow={1} flexBasis={0} minWidth={0} height={1} overflow="hidden">
          <text fg={tint()}>{rule}</text>
        </box>
      </box>
      <Show when={props.item.note}>
        <box maxWidth="80%">
          <text fg={theme.textMuted}>“{props.item.note}”</text>
        </box>
      </Show>
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

/** HH:MM clock for an injected note's timestamp. */
function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/**
 * A /pause note injected mid-task. Two states, rendered as a centered pill flanked by rules (like the
 * plan breaker) so it reads as an interleaved insertion into the flow:
 *   • pending  — sent, about to be folded in at the next step. Warm, *pulsing* so the user sees it's
 *                in flight ("⏳ adding to context…").
 *   • attached — now part of the agent's context, stamped with the time it landed ("✓ added · HH:MM").
 * The note text is shown as a quoted subtitle so the user sees exactly what was added.
 */
function InjectRow(props: { item: Extract<ViewItem, { kind: "inject" }> }) {
  const pending = () => props.item.state === "pending"
  // Pulse while pending (shimmerAccent reads the shared phase → re-renders each tick); solid once attached.
  const tint = () => (pending() ? shimmerAccent(theme.warning) : theme.success)
  const label = () =>
    pending() ? "⏳ adding to context…" : `✓ added to context · ${clock(props.item.attachedAt ?? props.item.at)}`
  const rule = "─".repeat(240)
  return (
    <box flexDirection="column" alignItems="center" marginTop={1} marginBottom={1}>
      <box flexDirection="row" alignItems="center" gap={1} width="100%">
        <box flexGrow={1} flexBasis={0} minWidth={0} height={1} overflow="hidden">
          <text fg={tint()}>{rule}</text>
        </box>
        <box backgroundColor={theme.bgElevated} paddingLeft={1} paddingRight={1} flexShrink={0}>
          <text fg={tint()}>{label()}</text>
        </box>
        <box flexGrow={1} flexBasis={0} minWidth={0} height={1} overflow="hidden">
          <text fg={tint()}>{rule}</text>
        </box>
      </box>
      <box maxWidth="80%">
        <text fg={theme.textMuted}>“{props.item.text}”</text>
      </box>
    </box>
  )
}

export function Chat(props: { pad?: number }) {
  const app = useApp()
  const pad = () => props.pad ?? 1
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
    <Show when={app.items().length > 0} fallback={<EmptyHome />}>
      {/* The scrollbar sits on the far-right edge with a 1-col gap (paddingLeft) so it never touches
          the message text; track/thumb are subtle so it reads as a quiet edge affordance. */}
      <scrollbox
        ref={(r: any) => (sb = r)}
        flexGrow={1}
        minHeight={0}
        stickyScroll
        stickyStart="bottom"
        paddingTop={1}
        verticalScrollbarOptions={{
          showArrows: false,
          paddingLeft: 1,
          trackOptions: { backgroundColor: theme.borderMuted, foregroundColor: theme.borderActive },
        }}
      >
        {/* Content inset keeps the conversation centered/aligned with the composer while the
            scrollbox (and its scrollbar) spans to the terminal edge. */}
        <box flexDirection="column" paddingLeft={pad()} paddingRight={pad()}>
          <For each={app.items()}>
            {(item, i) => {
              // The last item is the "active" one: a just-finished tool stays expanded while it's last,
              // then collapses to its title once the turn appends something new (stream-then-collapse).
              const last = () => i() === app.items().length - 1
              const body = (
                <Switch>
                  <Match when={item.kind === "user"}>
                    <UserBubble item={item as any} />
                  </Match>
                  <Match when={item.kind === "assistant"}>
                    <AssistantMessage item={item as any} />
                  </Match>
                  <Match when={item.kind === "tool"}>
                    <ToolCard item={item as any} last={last()} />
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
                  <Match when={item.kind === "inject"}>
                    <InjectRow item={item as any} />
                  </Match>
                </Switch>
              )
              // A streaming assistant reply re-renders every flush as tokens arrive; wrapping it in the
              // enter-animation makes that growth look glitchy. Animate only settled items.
              const streaming = item.kind === "assistant" && !(item as any).done
              return streaming ? (
                body
              ) : (
                <Appear distance={1} duration={170}>
                  {body}
                </Appear>
              )
            }}
          </For>
        </box>
      </scrollbox>
    </Show>
  )
}
