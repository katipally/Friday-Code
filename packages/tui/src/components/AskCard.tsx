import { createEffect, createSignal, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp, type PendingAsk } from "../store.tsx"
import { SelectList } from "./SelectList.tsx"

/**
 * Inline HITL card for the ask_user tool. Supports several questions at once: switch
 * between them (⭾ / click the tabs), pick options or type a custom answer per question,
 * then confirm all answers together. Single-question asks collapse to one screen.
 */
export function AskCard() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  let input: any

  const ask = () => app.askPending()
  const questions = () => ask()?.questions ?? []
  const [qIdx, setQIdx] = createSignal(0)
  const [selIdx, setSelIdx] = createSignal(0)
  const [typing, setTyping] = createSignal(false)
  // Per-question answers: a single value, or (multi) a list of chosen options.
  const [answers, setAnswers] = createSignal<Record<string, string>>({})
  const [multi, setMulti] = createSignal<Record<string, string[]>>({})

  const q = () => questions()[Math.min(qIdx(), Math.max(0, questions().length - 1))]
  const opts = () => q()?.options ?? []
  const isLast = () => qIdx() >= questions().length - 1

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

  function answerOf(id: string): string {
    const cur = q()
    if (cur?.multi) return (multi()[id] ?? []).join(", ")
    return answers()[id] ?? ""
  }
  const allAnswered = () => questions().every((qq) => (qq.multi ? (multi()[qq.id] ?? []).length > 0 : !!answers()[qq.id]))

  function confirm() {
    const out: Record<string, string> = {}
    for (const qq of questions()) {
      const v = qq.multi ? (multi()[qq.id] ?? []).join(", ") : answers()[qq.id]
      out[qq.id] = v && v.length ? v : "(no answer)"
    }
    app.replyAsk(out)
  }

  function chooseOption(i: number) {
    const cur = q()
    const opt = cur?.options?.[i]
    if (!cur || opt == null) return
    if (cur.multi) {
      setMulti((m) => {
        const set = new Set(m[cur.id] ?? [])
        set.has(opt) ? set.delete(opt) : set.add(opt)
        return { ...m, [cur.id]: [...set] }
      })
      return
    }
    setAnswers((a) => ({ ...a, [cur.id]: opt }))
    if (isLast()) confirm()
    else setQIdx((n) => n + 1)
  }

  function submitFree() {
    const cur = q()
    const text: string = (input?.plainText ?? "").trim()
    if (!cur) return
    if (text) setAnswers((a) => ({ ...a, [cur.id]: text }))
    setTyping(false)
    if (text && isLast() && allAnsweredAfter(cur.id, text)) confirm()
    else if (text && !isLast()) setQIdx((n) => n + 1)
  }
  // Whether everything is answered assuming `id` just got `val`.
  function allAnsweredAfter(id: string, val: string): boolean {
    return questions().every((qq) =>
      qq.id === id ? !!val : qq.multi ? (multi()[qq.id] ?? []).length > 0 : !!answers()[qq.id],
    )
  }

  useKeyboard((key) => {
    if (!ask()) return
    if (typing()) {
      if (key.name === "escape") setTyping(false)
      return // textarea owns the rest while typing
    }
    if (key.name === "escape") return confirm() // esc submits what we have (unanswered → "(no answer)")
    const n = Number(key.name)
    if (!Number.isNaN(n) && n >= 1 && n <= opts().length) return chooseOption(n - 1)
    if (key.name === "i") return setTyping(true)
    if (key.name === "c") return confirm()
    if (key.name === "tab" && !key.shift) return questions().length > 1 && setQIdx((x) => (x + 1) % questions().length)
    if ((key.name === "tab" && key.shift) || key.name === "left") return questions().length > 1 && setQIdx((x) => (x + questions().length - 1) % questions().length)
    if (key.name === "right") return questions().length > 1 && setQIdx((x) => (x + 1) % questions().length)
    if (key.name === "up" || key.name === "k") return opts().length && setSelIdx((s) => (s + opts().length - 1) % opts().length)
    if (key.name === "down" || key.name === "j") return opts().length && setSelIdx((s) => (s + 1) % opts().length)
    if (key.name === "return" || key.name === "enter" || key.name === "space") {
      if (opts().length) return chooseOption(selIdx())
      return setTyping(true)
    }
  })

  return (
    <Show when={ask()}>
      {(a: () => PendingAsk) => (
        <box
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={theme.info}
          backgroundColor={theme.bgElevated}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          marginBottom={1}
          gap={1}
        >
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.info}>? friday asks</text>
            <Show when={a().questions.length > 1}>
              <text fg={theme.textFaint}>
                · {qIdx() + 1} of {a().questions.length}
              </text>
            </Show>
          </box>

          {/* Question tabs (only when there's more than one). */}
          <Show when={a().questions.length > 1}>
            <box flexDirection="row" gap={1}>
              <For each={a().questions}>
                {(qq, i) => {
                  const done = () => (qq.multi ? (multi()[qq.id] ?? []).length > 0 : !!answers()[qq.id])
                  return (
                    <box paddingLeft={1} paddingRight={1} backgroundColor={qIdx() === i() ? theme.bgHover : "transparent"} onMouseDown={() => setQIdx(i())}>
                      <text fg={qIdx() === i() ? accent() : done() ? theme.success : theme.textFaint}>
                        {done() ? "✓" : "•"} {i() + 1}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          </Show>

          <text fg={theme.text}>{q()?.question}</text>

          <Show when={opts().length}>
            <SelectList
              items={opts().map((o, i) => ({ id: o, label: o, key: String(i + 1) }))}
              selected={selIdx()}
              accent={accent()}
              multi={q()?.multi}
              checked={new Set(multi()[q()!.id] ?? [])}
              onHover={(i) => setSelIdx(i)}
              onChoose={(i) => chooseOption(i)}
            />
          </Show>

          {/* Free-text answer — click or press i / enter (no options) to type. */}
          <box flexDirection="row" gap={1} alignItems="center" onMouseDown={() => setTyping(true)}>
            <text fg={typing() ? accent() : theme.textFaint}>✎</text>
            <box flexGrow={1} border borderStyle="rounded" borderColor={typing() ? accent() : theme.border} paddingLeft={1} paddingRight={1}>
              <textarea
                ref={(r: any) => (input = r)}
                onSubmit={submitFree}
                keyBindings={[{ name: "return", action: "submit" }]}
                focused={typing()}
                placeholder={opts().length ? "…or type your own answer" : "type an answer"}
                placeholderColor={theme.textFaint}
                minHeight={1}
                maxHeight={4}
              />
            </box>
          </box>

          <box flexDirection="row" gap={1} alignItems="center">
            <box paddingLeft={1} paddingRight={1} border borderStyle="rounded" borderColor={allAnswered() ? theme.success : theme.border} onMouseDown={confirm}>
              <text fg={allAnswered() ? theme.success : theme.textMuted}>✓ confirm all</text>
            </box>
            <box flexGrow={1} />
            <text fg={theme.textFaint}>
              {a().questions.length > 1 ? "↑↓ move · ⭾ switch · ⏎ pick · c confirm · esc skip" : "↑↓ move · ⏎ pick · i type · esc skip"}
            </text>
          </box>
        </box>
      )}
    </Show>
  )
}
