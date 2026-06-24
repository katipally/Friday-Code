import { type AskOption, theme } from "@friday/shared"
import { decodePasteBytes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, For, Show } from "solid-js"
import { shimmerAccent, useHover } from "../motion/index.ts"
import { type PendingAsk, useApp } from "../store.tsx"
import { createPasteStore, isPasteKey, pasteFromClipboard } from "../util/attachments.ts"
import { G } from "../util/term.ts"
import { Scrim } from "./Scrim.tsx"
import { bandBg, Overlay, SectionLabel } from "./ui.tsx"

/**
 * A question-tab pill with a smooth hover fade; active tab bands with the neutral selection grey.
 * `glyph` overrides the leading status mark (the synthetic Submit tab uses ⊕ instead of a checkbox).
 */
function Tab(props: {
  id: string
  label: string
  active: boolean
  done: boolean
  glyph?: string
  onSelect: () => void
}) {
  const h = useHover({ base: theme.bgElevated })
  const fg = () => (props.active ? theme.textOnAccent : props.done ? theme.success : theme.textFaint)
  return (
    <box
      id={props.id}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.active ? bandBg(true) : h.bg()}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={props.onSelect}
    >
      <text fg={fg()}>
        {props.glyph ?? (props.done ? G.todoDone : G.todoOpen)} {props.label}
      </text>
    </box>
  )
}

/**
 * Inline HITL card for the ask_user tool. Each question is a clean label-only option list; the focused
 * option's description + ASCII preview live in a content-sized info panel to the RIGHT (so the option
 * rows stay scannable and the diagram never floats in a big empty box). "Type your own" is the last
 * option in the list, the note is its own area below, and a synthetic "⊕ Submit" tab at the end of the
 * (horizontally scrollable) tab bar opens the review/confirm screen.
 *
 * It OWNS its keyboard (App.tsx early-returns for asks) and uses NO native `<select>` — the only
 * focusable elements are the custom-answer / note textareas, focused solely while typing.
 */
export function AskCard() {
  const app = useApp()
  const dims = useTerminalDimensions()
  let input: any
  let optsBox: { scrollBy?: (n: number) => void } | null = null
  let previewBox: { scrollBy?: (n: number) => void } | null = null
  let tabBox: { scrollChildIntoView?: (id: string) => void } | null = null

  const ask = () => app.askPending()
  const questions = () => ask()?.questions ?? []
  const [qIdx, setQIdx] = createSignal(0)
  const [selIdx, setSelIdx] = createSignal(0)
  const [typing, setTyping] = createSignal(false)
  // Per-question answers: a single value, or (multi) a list of chosen option labels.
  const [answers, setAnswers] = createSignal<Record<string, string>>({})
  const [multi, setMulti] = createSignal<Record<string, string[]>>({})
  // Per-question NOTE — extra info attached ALONGSIDE the chosen option (distinct from the custom
  // "type your own answer"). Folded into the reply as "<answer> — note: <note>" so the model sees it.
  const [notes, setNotes] = createSignal<Record<string, string>>({})
  const [noting, setNoting] = createSignal(false)
  let noteInput: any
  // Paste stores: big/multi-line pastes collapse to a token (expanded on submit), small pastes inline —
  // same behaviour as the composer, so clipboard works in the answer and note fields too.
  const answerPaste = createPasteStore()
  const notePaste = createPasteStore()
  // The synthetic "Submit" tab is active while this is true — it shows the review-of-every-answer screen.
  const [review, setReview] = createSignal(false)

  const q = () => questions()[Math.min(qIdx(), Math.max(0, questions().length - 1))]
  const opts = (): AskOption[] => q()?.options ?? []
  const isLast = () => qIdx() >= questions().length - 1
  const rowCount = () => opts().length + 1 // options + the "type your own answer" row
  const isCustomRow = () => selIdx() === opts().length

  // Tab-bar positions: 0..Q-1 are questions, Q is the synthetic Submit tab.
  const submitPos = () => questions().length
  const curPos = () => (review() ? submitPos() : qIdx())

  // Focused option's info (description + ASCII) — surfaced in the right panel instead of under the row.
  const anyInfo = () => opts().some((o) => !!o.description || !!o.preview)
  const info = (): { desc: string; art: string } => {
    if (isCustomRow()) return { desc: "Write a free-form answer of your own.", art: "" }
    const o = opts()[selIdx()]
    return { desc: o?.description ?? "", art: o?.preview ?? "" }
  }

  // The modal never exceeds 80% of the terminal in either axis.
  const W_CAP = () => Math.floor(dims().width * 0.8)
  const H_CAP = () => Math.floor(dims().height * 0.8)
  // The info panel is shown for EVERY question that has options (so the explanation/ASCII area is always
  // present). Everything below is sized to the LARGEST option in THIS question (not the focused one), so
  // the modal picks one stable size per question and never reflows as the selection moves.
  const showInfo = () => opts().length > 0
  const artW = (s: string) => (s ? s.split("\n").reduce((m, l) => Math.max(m, l.length), 0) : 0)
  const artH = (s: string) => (s ? s.split("\n").length : 0)
  const maxArtW = () => opts().reduce((m, o) => Math.max(m, artW(o.preview ?? "")), 0)
  const maxArtH = () => opts().reduce((m, o) => Math.max(m, artH(o.preview ?? "")), 0)
  const infoW = () => {
    if (!showInfo()) return 0
    const base = Math.max(maxArtW(), 30) // always a comfortable reading column
    return Math.min(46, Math.max(26, base + 2))
  }
  const totalW = () => {
    const base = Math.max(48, Math.round(dims().width * 0.46))
    return Math.min(W_CAP(), showInfo() ? base + infoW() + 2 : base)
  }
  // Inner content width (minus border + horizontal padding) — drives the full-width dividers.
  const innerW = () => Math.max(8, totalW() - 4)
  // Body height budget so the whole modal (chrome + body) stays within the 80% height cap.
  const bodyMaxH = () => Math.max(4, H_CAP() - 11)
  // Longest wrapped description across the options (desc isn't scrolled, so it adds real height).
  const maxDescH = () =>
    opts().reduce(
      (m, o) => Math.max(m, o.description ? Math.ceil(o.description.length / Math.max(8, infoW() - 2)) : 0),
      0,
    )
  // One tight, stable body height: the taller of the option list and the biggest option's info,
  // clamped to the cap. Applied as a fixed height so short content leaves no empty box and changing
  // the selection never resizes the modal.
  const bodyH = () => Math.max(3, Math.min(Math.max(rowCount(), maxDescH() + maxArtH()) + 1, bodyMaxH()))
  const optsMaxH = () => Math.max(3, bodyH() - 1)
  const infoMaxH = () => Math.max(3, bodyH() - 1 - maxDescH())

  // Reset transient state whenever a fresh ask arrives or the question changes.
  createEffect(() => {
    ask()?.requestId
    setQIdx(0)
    setSelIdx(0)
    setTyping(false)
    setAnswers({})
    setMulti({})
    setNotes({})
    setNoting(false)
    setReview(false)
  })
  createEffect(() => {
    qIdx()
    setSelIdx(0)
    setTyping(false)
    setNoting(false)
  })
  // Keep the active tab in view as the user moves across a long (scrolling) tab bar.
  createEffect(() => {
    const p = curPos()
    questions().length
    queueMicrotask(() => tabBox?.scrollChildIntoView?.(p >= submitPos() ? "tab-submit" : `tab-${p}`))
  })

  const isChecked = (id: string, label: string) => (multi()[id] ?? []).includes(label)
  // A free-text answer the user typed (one that isn't one of the offered option labels) — shown back in
  // the "type your own" row so a revisited question still displays what was entered.
  const customVal = () => {
    const cur = q()
    if (!cur) return ""
    const labels = (cur.options ?? []).map((o) => o.label)
    if (cur.multi) return (multi()[cur.id] ?? []).find((v) => !labels.includes(v)) ?? ""
    const a = answers()[cur.id]
    return a && !labels.includes(a) ? a : ""
  }
  const allAnswered = () =>
    questions().every((qq) => (qq.multi ? (multi()[qq.id] ?? []).length > 0 : !!answers()[qq.id]))

  function tabLabel(qq: { header?: string }, i: number): string {
    return qq.header?.trim() || `Q${i + 1}`
  }

  // The value we'll report for a question (answer + any attached note), for both review + submit.
  function answerOf(qq: { id: string; multi?: boolean }): string {
    const base = qq.multi ? (multi()[qq.id] ?? []).join(", ") : answers()[qq.id]
    const note = notes()[qq.id]?.trim()
    const v = base?.length ? base : "(no answer)"
    return note ? `${v} — note: ${note}` : v
  }
  // Open the FINAL CONFIRM GATE (the Submit tab) rather than submitting straight away.
  function confirm() {
    setTyping(false)
    setNoting(false)
    setReview(true)
  }
  // Actually send the reply (called from the review screen).
  function submit() {
    const out: Record<string, string> = {}
    for (const qq of questions()) out[qq.id] = answerOf(qq)
    app.replyAsk(out)
  }

  // Jump to a tab position (a question, or the Submit tab past the last question).
  function goTo(pos: number) {
    if (pos >= submitPos()) return confirm()
    setReview(false)
    setQIdx(pos)
  }
  function nextTab(dir: 1 | -1) {
    const total = submitPos() + 1 // questions + the Submit tab
    goTo((curPos() + dir + total) % total)
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

  // Note editor (deferred reveal, same reason as startTyping) and save-on-submit.
  function startNoting() {
    queueMicrotask(() => setNoting(true))
  }
  function saveNote() {
    const cur = q()
    const text: string = notePaste.expand(noteInput?.plainText ?? "").trim()
    if (cur) setNotes((m) => ({ ...m, [cur.id]: text }))
    notePaste.clear()
    setNoting(false)
  }

  function submitFree() {
    const cur = q()
    const text: string = answerPaste.expand(input?.plainText ?? "").trim()
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
    answerPaste.clear()
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
      if (isPasteKey(key)) return void pasteFromClipboard(input, answerPaste)
      return // textarea owns the rest while typing
    }
    if (noting()) {
      if (key.name === "escape") return setNoting(false)
      if (isPasteKey(key)) return void pasteFromClipboard(noteInput, notePaste)
      return // note textarea owns the rest while noting
    }
    // Final confirm gate (Submit tab): review owns its keys.
    if (review()) {
      // Esc reaches the Submit tab, then a second Esc cancels the whole question (no more ping-pong loop).
      if (key.name === "escape") return app.replyAsk({})
      if (key.name === "e") return setReview(false) // back to editing
      if (key.name === "return" || key.name === "enter" || key.name === "c" || key.name === "y") return submit()
      if (key.name === "tab" || key.name === "left" || key.name === "h") return nextTab(key.shift ? 1 : -1)
      if (key.name === "right" || key.name === "l") return nextTab(1)
      if (key.name === "up" || key.name === "k") return setQIdx((x) => Math.max(0, x - 1))
      if (key.name === "down" || key.name === "j") return setQIdx((x) => Math.min(questions().length - 1, x + 1))
      return
    }
    if (key.name === "escape") return confirm() // esc jumps to the Submit tab
    const n = Number(key.name)
    if (!Number.isNaN(n) && n >= 1 && n <= opts().length) return chooseOption(n - 1)
    if (key.name === "i") return startTyping()
    if (key.name === "n") return startNoting()
    if (key.name === "c") return confirm()
    if (key.name === "tab") return nextTab(key.shift ? -1 : 1)
    if (key.name === "left" || key.name === "h") return nextTab(-1)
    if (key.name === "right" || key.name === "l") return nextTab(1)
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
          <Overlay width={totalW()}>
            {/* Question header is brand amber; not the Overlay title (extra hints follow inline). */}
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={shimmerAccent(theme.brand)}>
                <strong>? QUESTION</strong>
              </text>
              <Show when={app.askFrom()}>
                <text fg={theme.textMuted}>· {app.askFrom()}</text>
              </Show>
              <Show when={a().questions.length > 1 && !review()}>
                <text fg={theme.textFaint}>
                  · {qIdx() + 1} of {a().questions.length}
                </text>
              </Show>
              <Show when={review()}>
                <text fg={theme.textFaint}>· review &amp; submit</text>
              </Show>
            </box>

            {/* Tab bar — questions + the synthetic Submit tab; scrolls horizontally when there are many. */}
            <scrollbox
              ref={(r: any) => (tabBox = r)}
              scrollX
              scrollY={false}
              height={1}
              flexShrink={0}
              horizontalScrollbarOptions={{ visible: false }}
              contentOptions={{ flexDirection: "row", gap: 1 }}
            >
              <For each={a().questions}>
                {(qq, i) => (
                  <Tab
                    id={`tab-${i()}`}
                    label={tabLabel(qq, i())}
                    active={!review() && qIdx() === i()}
                    done={qq.multi ? (multi()[qq.id] ?? []).length > 0 : !!answers()[qq.id]}
                    onSelect={() => goTo(i())}
                  />
                )}
              </For>
              <Tab id="tab-submit" label="Submit" glyph="⊕" active={review()} done={allAnswered()} onSelect={confirm} />
            </scrollbox>

            <Show when={!review()}>
              <box flexDirection="column" gap={1}>
                {/* Optional ASCII banner the agent supplied for this question. */}
                <Show when={q()?.art}>
                  <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                    <text fg={theme.textMuted}>{q()!.art}</text>
                  </box>
                </Show>

                <text fg={theme.text}>{q()?.question}</text>

                {/* Body: clean option list (left) + the focused option's info panel (right). Fixed height
                    (sized to the biggest option) so the modal stays put as you move the selection. */}
                <box flexDirection="row" gap={2} height={bodyH()}>
                  <box
                    flexDirection="column"
                    flexGrow={1}
                    backgroundColor={theme.bgElevated}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <SectionLabel text={q()?.multi ? "select any" : "select one"} />
                    {/* Options as label-only rows (scrolls when long); description lives in the info panel. */}
                    <scrollbox ref={(r: any) => (optsBox = r)} maxHeight={optsMaxH()} paddingRight={1}>
                      <For each={opts()}>
                        {(opt, i) => {
                          const active = () => selIdx() === i()
                          const checked = () => !!q()?.multi && isChecked(q()!.id, opt.label)
                          const picked = () => !q()?.multi && answers()[q()!.id] === opt.label
                          return (
                            <box
                              flexDirection="row"
                              gap={1}
                              paddingLeft={1}
                              paddingRight={1}
                              backgroundColor={bandBg(active())}
                              onMouseOver={() => setSelIdx(i())}
                              onMouseDown={() => chooseOption(i())}
                            >
                              <text fg={active() ? theme.textOnAccent : theme.textFaint}>
                                {active() ? G.caret : " "}
                              </text>
                              {/* Status mark: a green ✓ on the option you've chosen (multi = checkbox), so a
                                  previously-answered question still shows its pick when you revisit it. */}
                              <Show
                                when={q()?.multi}
                                fallback={
                                  <text fg={active() ? theme.textOnAccent : picked() ? theme.success : theme.textFaint}>
                                    {picked() ? G.todoDone : " "}
                                  </text>
                                }
                              >
                                <text fg={active() ? theme.textOnAccent : checked() ? theme.success : theme.textFaint}>
                                  {checked() ? G.todoDone : G.todoOpen}
                                </text>
                              </Show>
                              <text fg={active() ? theme.textOnAccent : theme.textFaint}>{i() + 1}</text>
                              <text
                                fg={
                                  active()
                                    ? theme.textOnAccent
                                    : picked() || checked()
                                      ? theme.success
                                      : theme.textMuted
                                }
                              >
                                {opt.label}
                              </text>
                              <Show when={opt.preview}>
                                <text fg={active() ? theme.textOnAccent : theme.textFaint}>▦</text>
                              </Show>
                            </box>
                          )
                        }}
                      </For>

                      {/* "Type your own" — the last option in the list; its INPUT is inline in the row, so
                          typing happens right where the option lives (not in a separate editor below). */}
                      <box
                        flexDirection="row"
                        gap={1}
                        alignItems="center"
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={bandBg(isCustomRow() && !typing())}
                        onMouseOver={() => setSelIdx(opts().length)}
                        onMouseDown={() => setTyping(true)}
                      >
                        <text fg={isCustomRow() ? theme.textOnAccent : customVal() ? theme.success : theme.textFaint}>
                          {customVal() && !isCustomRow() ? G.todoDone : isCustomRow() ? G.caret : " "}
                        </text>
                        <text
                          fg={
                            typing() || customVal()
                              ? theme.success
                              : isCustomRow()
                                ? theme.textOnAccent
                                : theme.textFaint
                          }
                        >
                          ⊕
                        </text>
                        <Show
                          when={typing()}
                          fallback={
                            <text
                              fg={customVal() ? theme.success : isCustomRow() ? theme.textOnAccent : theme.textMuted}
                            >
                              {customVal() || "type your own answer"}
                            </text>
                          }
                        >
                          <box flexGrow={1} backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                            <textarea
                              ref={(r: any) => {
                                input = r
                                if (r)
                                  r.onPaste = (e: any) => {
                                    const txt = decodePasteBytes(e?.bytes) ?? ""
                                    if (txt.trim() ? answerPaste.insert(r, txt) : pasteFromClipboard(r, answerPaste))
                                      e?.preventDefault?.()
                                  }
                              }}
                              onSubmit={submitFree}
                              keyBindings={[{ name: "return", action: "submit" }]}
                              focused={typing()}
                              placeholder="type an answer · @file · ⌘/Ctrl+V paste · Enter submit · Esc cancels"
                              placeholderColor={theme.textFaint}
                              minHeight={1}
                              maxHeight={4}
                            />
                          </box>
                        </Show>
                      </box>
                    </scrollbox>
                  </box>

                  {/* Info panel — the focused option's description + ASCII, shown for EVERY question with
                      options and sized to its content. */}
                  <Show when={showInfo()}>
                    <box
                      flexDirection="column"
                      width={infoW()}
                      backgroundColor={theme.bgComposer}
                      paddingLeft={1}
                      paddingRight={1}
                    >
                      <SectionLabel text="info" />
                      <Show when={info().desc}>
                        <text fg={theme.textMuted}>{info().desc}</text>
                      </Show>
                      <Show when={info().art}>
                        <scrollbox ref={(r: any) => (previewBox = r)} maxHeight={infoMaxH()} scrollX>
                          <text fg={theme.textFaint}>{info().art}</text>
                        </scrollbox>
                      </Show>
                      <Show when={!info().desc && !info().art}>
                        <text fg={theme.textFaint}>(no details for this option)</text>
                      </Show>
                    </box>
                  </Show>
                </box>

                {/* NOTE — its own area below the choices: one optional note attached to this answer (press n). */}
                <box flexDirection="column">
                  <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} onMouseDown={() => setNoting(true)}>
                    <text fg={notes()[q()?.id ?? ""] ? theme.warning : theme.textFaint}>✎</text>
                    <text fg={notes()[q()?.id ?? ""] ? theme.textMuted : theme.textFaint}>
                      {notes()[q()?.id ?? ""] ? `note: ${notes()[q()!.id]}` : "add a note (optional) · n"}
                    </text>
                  </box>
                  <Show when={noting()}>
                    <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                      <textarea
                        ref={(r: any) => {
                          noteInput = r
                          if (r)
                            r.onPaste = (e: any) => {
                              const txt = decodePasteBytes(e?.bytes) ?? ""
                              if (txt.trim() ? notePaste.insert(r, txt) : pasteFromClipboard(r, notePaste))
                                e?.preventDefault?.()
                            }
                        }}
                        onSubmit={saveNote}
                        keyBindings={[{ name: "return", action: "submit" }]}
                        focused={noting()}
                        placeholder="note to attach · ⌘/Ctrl+V paste · Enter to save"
                        placeholderColor={theme.textFaint}
                        minHeight={1}
                        maxHeight={4}
                      />
                    </box>
                  </Show>
                </box>
              </box>
            </Show>

            {/* SUBMIT TAB — a review of every answer (and note) before we send. */}
            <Show when={review()}>
              <box flexDirection="column" gap={0} backgroundColor={theme.bgElevated} paddingLeft={1} paddingRight={1}>
                <text fg={theme.textMuted}>Review your answers — confirm to send, or pick a tab to edit.</text>
                <text fg={theme.borderMuted}>{"─".repeat(innerW() - 2)}</text>
                <For each={questions()}>
                  {(qq, i) => {
                    const answered = () => (qq.multi ? (multi()[qq.id] ?? []).length > 0 : !!answers()[qq.id])
                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={bandBg(qIdx() === i())}
                        onMouseDown={() => goTo(i())}
                      >
                        <text fg={answered() ? theme.success : theme.warning}>
                          {answered() ? G.todoDone : G.todoOpen}
                        </text>
                        <text fg={qIdx() === i() ? theme.textOnAccent : theme.textMuted}>{tabLabel(qq, i())}</text>
                        <text fg={qIdx() === i() ? theme.textOnAccent : theme.text}>{answerOf(qq)}</text>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>

            {/* divider — fences the footer zone from the body */}
            <text fg={theme.borderMuted}>{"─".repeat(innerW())}</text>

            <box flexDirection="row" gap={1} alignItems="center">
              <Show when={review()}>
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={confirmHover.bg()}
                  onMouseOver={confirmHover.onMouseOver}
                  onMouseOut={confirmHover.onMouseOut}
                  onMouseDown={submit}
                >
                  <text fg={theme.success}>{G.todoDone} submit answers</text>
                </box>
                <box paddingLeft={1} paddingRight={1} onMouseDown={() => setReview(false)}>
                  <text fg={theme.textFaint}>‹ edit</text>
                </box>
              </Show>
              <box flexGrow={1} />
              <text fg={theme.textFaint}>
                {review()
                  ? "Enter submit · e edit · ↑↓ jump · Esc cancel"
                  : `↑↓ pick · 1-9 select · Tab next · n note · Esc submit · Esc Esc cancel${anyInfo() ? " · PgUp/PgDn scroll" : ""}`}
              </text>
            </box>
          </Overlay>
        </Scrim>
      )}
    </Show>
  )
}
