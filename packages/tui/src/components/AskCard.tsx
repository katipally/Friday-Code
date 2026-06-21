import { type AskOption, getMode, theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, For, Show } from "solid-js"
import { shimmerAccent, useHover } from "../motion/index.ts"
import { type PendingAsk, useApp } from "../store.tsx"
import { G } from "../util/term.ts"
import { Scrim } from "./Scrim.tsx"

/** A question-tab pill with a smooth hover fade. */
function Tab(props: { label: string; active: boolean; done: boolean; accent: string; onSelect: () => void }) {
  const h = useHover({ base: theme.bgElevated })
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.active ? theme.bgHover : h.bg()}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={props.onSelect}
    >
      <text fg={props.active ? props.accent : props.done ? theme.success : theme.textFaint}>
        {props.done ? G.todoDone : G.todoOpen} {props.label}
      </text>
    </box>
  )
}

/**
 * Inline HITL card for the ask_user tool. Renders the model's questions with concrete options
 * (label + description + optional ASCII preview) plus an always-available "type your own answer" row.
 *
 * Layout adapts to the content: the modal grows with the terminal, the option list scrolls when long,
 * and when any option carries a `preview` the card splits side-by-side — options on the left, the
 * focused option's ASCII diagram on the right (scrollable) — so the user can compare visually.
 *
 * It OWNS its keyboard (App.tsx early-returns for asks) and uses NO native `<select>` — the only
 * focusable element is the custom-answer textarea, focused solely while typing — so option keys and
 * typed input never fight over focus.
 */
export function AskCard() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const accent = () => getMode(app.mode()).accent
  let input: any
  let optsBox: { scrollBy?: (n: number) => void } | null = null
  let previewBox: { scrollBy?: (n: number) => void } | null = null

  const ask = () => app.askPending()
  const questions = () => ask()?.questions ?? []
  const [qIdx, setQIdx] = createSignal(0)
  const [selIdx, setSelIdx] = createSignal(0)
  const [typing, setTyping] = createSignal(false)
  // Per-question answers: a single value, or (multi) a list of chosen option labels.
  const [answers, setAnswers] = createSignal<Record<string, string>>({})
  const [multi, setMulti] = createSignal<Record<string, string[]>>({})

  const q = () => questions()[Math.min(qIdx(), Math.max(0, questions().length - 1))]
  const opts = (): AskOption[] => q()?.options ?? []
  const isLast = () => qIdx() >= questions().length - 1
  const rowCount = () => opts().length + 1 // options + the "type your own answer" row
  const isCustomRow = () => selIdx() === opts().length

  // Side-by-side preview when any option in this question carries an ASCII preview.
  const anyPreview = () => opts().some((o) => !!o.preview)
  const focusedPreview = () => (isCustomRow() ? undefined : opts()[selIdx()]?.preview)

  // Adaptive sizing — fill up to ~70% of the terminal, then the option list scrolls.
  const previewW = () => (anyPreview() ? Math.min(58, Math.max(28, Math.floor((dims().width - 12) * 0.45))) : 0)
  const totalW = () => {
    const base = Math.max(60, Math.round(dims().width * 0.7))
    return Math.min(dims().width - 4, anyPreview() ? base + previewW() : base)
  }
  // Inner content width (minus border + horizontal padding) — drives the full-width dividers.
  const innerW = () => Math.max(8, totalW() - 4)
  const optsMaxH = () => Math.max(3, Math.min(rowCount() * 3, Math.round(dims().height * 0.7) - 12))
  const sideMaxH = () => Math.max(6, Math.round(dims().height * 0.7) - 8)
  // Extra breathing room between options when the list is short enough to afford it.
  const optGap = () => (opts().length <= 5 ? 1 : 0)

  // Reset transient state whenever a fresh ask arrives or the question changes.
  createEffect(() => {
    ask()?.requestId
    setQIdx(0)
    setSelIdx(0)
    setTyping(false)
    setAnswers({})
    setMulti({})
  })
  createEffect(() => {
    qIdx()
    setSelIdx(0)
    setTyping(false)
  })

  const isChecked = (id: string, label: string) => (multi()[id] ?? []).includes(label)
  const allAnswered = () =>
    questions().every((qq) => (qq.multi ? (multi()[qq.id] ?? []).length > 0 : !!answers()[qq.id]))

  function tabLabel(qq: { header?: string }, i: number): string {
    return qq.header?.trim() || `Q${i + 1}`
  }

  function confirm() {
    const out: Record<string, string> = {}
    for (const qq of questions()) {
      const v = qq.multi ? (multi()[qq.id] ?? []).join(", ") : answers()[qq.id]
      out[qq.id] = v?.length ? v : "(no answer)"
    }
    app.replyAsk(out)
  }

  function nextQ(dir: 1 | -1) {
    if (questions().length <= 1) return
    setQIdx((x) => (x + dir + questions().length) % questions().length)
  }

  function chooseOption(i: number) {
    const cur = q()
    const opt = cur?.options?.[i]
    if (!cur || opt == null) return
    if (cur.multi) {
      setMulti((m) => {
        const set = new Set(m[cur.id] ?? [])
        set.has(opt.label) ? set.delete(opt.label) : set.add(opt.label)
        return { ...m, [cur.id]: [...set] }
      })
      return
    }
    setAnswers((a) => ({ ...a, [cur.id]: opt.label }))
    if (isLast()) confirm()
    else nextQ(1)
  }

  // Defer revealing the editor to the next tick so the key that opened it (Enter/Space/i) finishes
  // dispatching first — otherwise that key reaches the freshly-focused textarea and is typed in.
  function startTyping() {
    queueMicrotask(() => setTyping(true))
  }

  function chooseRow(i: number) {
    if (i < opts().length) return chooseOption(i)
    startTyping() // the custom-answer row
  }

  function submitFree() {
    const cur = q()
    const text: string = (input?.plainText ?? "").trim()
    if (!cur) return
    if (text) {
      if (cur.multi) {
        setMulti((m) => {
          const set = new Set(m[cur.id] ?? [])
          set.add(text)
          return { ...m, [cur.id]: [...set] }
        })
      } else {
        setAnswers((a) => ({ ...a, [cur.id]: text }))
      }
    }
    input?.clear?.()
    setTyping(false)
    if (text && !cur.multi && isLast() && allAnsweredAfter(cur.id, text)) confirm()
    else if (text && !cur.multi && !isLast()) nextQ(1)
  }
  // Whether everything is answered assuming `id` just got `val` (single-select only).
  function allAnsweredAfter(id: string, val: string): boolean {
    return questions().every((qq) =>
      qq.id === id ? !!val : qq.multi ? (multi()[qq.id] ?? []).length > 0 : !!answers()[qq.id],
    )
  }

  function moveSel(dir: 1 | -1) {
    setSelIdx((s) => (s + dir + rowCount()) % rowCount())
    optsBox?.scrollBy?.(dir * 2) // keep the moving selection roughly in view
  }

  useKeyboard((key) => {
    if (!ask()) return
    if (typing()) {
      if (key.name === "escape") return setTyping(false)
      return // textarea owns the rest while typing
    }
    if (key.name === "escape") return confirm() // esc submits what we have (unanswered → "(no answer)")
    const n = Number(key.name)
    if (!Number.isNaN(n) && n >= 1 && n <= opts().length) return chooseOption(n - 1)
    if (key.name === "i") return startTyping()
    if (key.name === "c") return confirm()
    if (key.name === "tab") return nextQ(key.shift ? -1 : 1)
    if (key.name === "left" || key.name === "h") return nextQ(-1)
    if (key.name === "right" || key.name === "l") return nextQ(1)
    if (key.name === "up" || key.name === "k") return moveSel(-1)
    if (key.name === "down" || key.name === "j") return moveSel(1)
    if (key.name === "pageup") return previewBox?.scrollBy?.(-8)
    if (key.name === "pagedown") return previewBox?.scrollBy?.(8)
    if (key.name === "return" || key.name === "enter" || key.name === "space") return chooseRow(selIdx())
  })

  const confirmHover = useHover({ base: theme.bgElevated })

  return (
    <Show when={ask()}>
      {(a: () => PendingAsk) => (
        <Scrim onClose={() => {}}>
          <box
            flexDirection="column"
            width={totalW()}
            border
            borderStyle="single"
            borderColor={shimmerAccent(theme.info)}
            backgroundColor={theme.bgElevated}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            gap={1}
          >
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.info}>
                <strong>? question</strong>
              </text>
              <Show when={a().questions.length > 1}>
                <text fg={theme.textFaint}>
                  · {qIdx() + 1} of {a().questions.length}
                </text>
              </Show>
              <Show when={q()?.header && a().questions.length <= 1}>
                <text fg={theme.textFaint}>· {q()!.header}</text>
              </Show>
            </box>

            <Show when={a().questions.length > 1}>
              <box flexDirection="row" gap={1} flexWrap="wrap">
                <For each={a().questions}>
                  {(qq, i) => (
                    <Tab
                      label={tabLabel(qq, i())}
                      active={qIdx() === i()}
                      done={qq.multi ? (multi()[qq.id] ?? []).length > 0 : !!answers()[qq.id]}
                      accent={accent()}
                      onSelect={() => setQIdx(i())}
                    />
                  )}
                </For>
              </box>
            </Show>

            {/* Optional ASCII banner the agent supplied for this question. */}
            <Show when={q()?.art}>
              <box border borderStyle="single" borderColor={theme.borderMuted} paddingLeft={1} paddingRight={1}>
                <text fg={theme.textMuted}>{q()!.art}</text>
              </box>
            </Show>

            <text fg={theme.text}>{q()?.question}</text>

            {/* divider — separates the question/banner zone from the choices */}
            <text fg={theme.borderMuted}>{"─".repeat(innerW())}</text>

            {/* Body: option list on the left, the focused option's ASCII preview on the right. */}
            <box flexDirection="row" gap={2}>
              <box flexDirection="column" flexGrow={1}>
                {/* Options as rows (scrolls when long): number · checkbox (multi) · label, description below. */}
                <scrollbox ref={(r: any) => (optsBox = r)} maxHeight={optsMaxH()} paddingRight={1}>
                  <For each={opts()}>
                    {(opt, i) => {
                      const active = () => selIdx() === i()
                      const checked = () => !!q()?.multi && isChecked(q()!.id, opt.label)
                      const picked = () => !q()?.multi && answers()[q()!.id] === opt.label
                      return (
                        <box
                          flexDirection="column"
                          paddingLeft={1}
                          paddingRight={1}
                          marginBottom={optGap()}
                          backgroundColor={active() ? theme.bgHover : "transparent"}
                          onMouseOver={() => setSelIdx(i())}
                          onMouseDown={() => chooseOption(i())}
                        >
                          <box flexDirection="row" gap={1}>
                            <text fg={active() ? accent() : theme.textFaint}>{active() ? G.caret : " "}</text>
                            <Show when={q()?.multi}>
                              <text fg={checked() ? theme.success : theme.textFaint}>
                                {checked() ? G.todoDone : G.todoOpen}
                              </text>
                            </Show>
                            <text fg={theme.textFaint}>{i() + 1}</text>
                            <text fg={active() || picked() || checked() ? theme.text : theme.textMuted}>
                              {opt.label}
                            </text>
                            <Show when={opt.preview}>
                              <text fg={theme.textFaint}>{G.caret}▦</text>
                            </Show>
                          </box>
                          <Show when={opt.description}>
                            <box paddingLeft={q()?.multi ? 5 : 3}>
                              <text fg={theme.textFaint}>{opt.description}</text>
                            </box>
                          </Show>
                        </box>
                      )
                    }}
                  </For>

                  {/* divider — fences the free-text row off from the concrete choices */}
                  <text fg={theme.borderMuted}>{"╌".repeat(Math.max(8, innerW() - previewW() - 4))}</text>

                  {/* Always-present "type your own answer" row — selecting it opens the textarea. */}
                  <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={1}
                    paddingRight={1}
                    marginTop={optGap()}
                    backgroundColor={isCustomRow() ? theme.bgHover : "transparent"}
                    onMouseOver={() => setSelIdx(opts().length)}
                    onMouseDown={() => setTyping(true)}
                  >
                    <text fg={isCustomRow() ? accent() : theme.textFaint}>{isCustomRow() ? G.caret : " "}</text>
                    <text fg={typing() ? accent() : theme.textFaint}>{G.pencil}</text>
                    <text fg={isCustomRow() || typing() ? theme.text : theme.textMuted}>type your own answer</text>
                  </box>
                </scrollbox>

                {/* The custom-answer editor — only focused while typing so it never steals option keys. */}
                <Show when={typing()}>
                  <box
                    border
                    borderStyle="single"
                    borderColor={theme.border}
                    paddingLeft={1}
                    paddingRight={1}
                    marginTop={1}
                  >
                    <textarea
                      ref={(r: any) => (input = r)}
                      onSubmit={submitFree}
                      keyBindings={[{ name: "return", action: "submit" }]}
                      focused={typing()}
                      placeholder="type an answer, ⏎ to submit"
                      placeholderColor={theme.textFaint}
                      minHeight={1}
                      maxHeight={4}
                    />
                  </box>
                </Show>
              </box>

              {/* Preview panel — the focused option's ASCII diagram, scrollable for tall mockups. */}
              <Show when={anyPreview()}>
                <box
                  flexDirection="column"
                  width={previewW()}
                  border
                  borderStyle="single"
                  borderColor={theme.border}
                  backgroundColor={theme.bgComposer}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <Show
                    when={focusedPreview()}
                    fallback={<text fg={theme.textFaint}>(no preview for this option)</text>}
                  >
                    <scrollbox ref={(r: any) => (previewBox = r)} maxHeight={sideMaxH()}>
                      <text fg={theme.textMuted}>{focusedPreview()}</text>
                    </scrollbox>
                  </Show>
                </box>
              </Show>
            </box>

            {/* divider — fences the confirm/footer zone from the choices */}
            <text fg={theme.borderMuted}>{"─".repeat(innerW())}</text>

            <box flexDirection="row" gap={1} alignItems="center">
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={confirmHover.bg()}
                onMouseOver={confirmHover.onMouseOver}
                onMouseOut={confirmHover.onMouseOut}
                onMouseDown={confirm}
              >
                <text fg={allAnswered() ? theme.success : theme.textMuted}>
                  {G.todoDone} confirm{allAnswered() ? " all" : ""}
                </text>
              </box>
              <box flexGrow={1} />
              <text fg={theme.textFaint}>
                {(a().questions.length > 1 ? "↑↓ pick · 1-9 · tab switch · c confirm" : "↑↓ pick · 1-9 · i type") +
                  (anyPreview() ? " · pgup/pgdn scroll · esc skip" : " · esc skip")}
              </text>
            </box>
          </box>
        </Scrim>
      )}
    </Show>
  )
}
