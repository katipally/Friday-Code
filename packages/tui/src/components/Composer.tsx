import { getMode, theme } from "@friday/shared"
import { decodePasteBytes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { shimmerAccent } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { expandTokens, isBigPaste, makePasteToken } from "../util/attachments.ts"
import { listProjectFiles } from "../util/files.ts"
import { modeGlyph } from "../util/term.ts"

type Suggestion = { label: string; hint: string; apply: () => void; run?: () => void }

// Keep enough matches that every command is reachable; the dropdown scrolls to reveal them all
// instead of cycling within a handful.
const MAX_SUGGESTIONS = 50
const VISIBLE_SUGGESTIONS = 8

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/**
 * The prompt composer (uncontrolled textarea via `plainText`/`setText`). Enter submits,
 * Shift+Enter newlines, Tab applies the highlighted autocomplete suggestion.
 * Shows slash-command suggestions for `/…` and file suggestions for a trailing `@…`.
 */
export function Composer() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const mode = () => getMode(app.mode())
  const accentS = () => shimmerAccent(mode().accent)
  // Blur whenever ANY modal/overlay/HITL prompt owns the keyboard — single source of truth in
  // the store, so a new overlay can never leak keystrokes into the composer by being forgotten here.
  const focused = () => app.view() === "shell" && !app.anyModalOpen()
  const maxHeight = () => Math.max(4, Math.floor(dims().height / 3))

  let ta: any
  const [text, setText] = createSignal("")
  const [files, setFiles] = createSignal<string[]>([])
  const [sel, setSel] = createSignal(0)

  // Load (and reload when the workspace roots change) the file list across all roots.
  createEffect(() => {
    listProjectFiles(app.roots()).then(setFiles)
  })

  // Re-assert focus whenever the app returns to the editable shell state (e.g. a modal closes),
  // since OpenTUI only re-applies the `focused` prop when its *value* changes.
  createEffect(() => {
    const f = focused()
    // BLUR immediately when a modal opens — it must win the same tick so keys can't reach the composer.
    if (!f) {
      try {
        ta?.blur?.()
      } catch {}
      return
    }
    // FOCUS only on the next microtask, never synchronously. A modal is usually dismissed by a
    // keypress (e.g. `a` to allow, ⏎ to confirm); refocusing the composer synchronously inside that
    // same dispatch makes the dismiss key leak into the composer. Deferring lets the key finish first,
    // and the microtask still lands before the user's next keystroke.
    queueMicrotask(() => {
      try {
        if (focused()) ta?.focus?.()
      } catch {}
    })
  })

  // OpenTUI's autoFocus blurs the textarea when another focusable element (the chat scrollbox,
  // a list, …) is clicked. While we're still in the editable state, grab focus straight back so
  // the user can keep typing without having to click into the composer again.
  const onBlur = () => {
    if (focused())
      queueMicrotask(() => {
        try {
          ta?.focus?.()
        } catch {}
      })
  }

  function refresh() {
    queueMicrotask(() => setText(ta?.plainText ?? ""))
  }

  /** Replace the composer text and keep the cursor at the end (fixes cursor jumping to front). */
  function setComposer(value: string) {
    ta?.setText?.(value)
    if (ta) ta.cursorOffset = value.length
    setText(value)
  }

  const suggestions = createMemo<Suggestion[]>(() => {
    const t = text()
    if (!focused() || !t) return []

    const slash = t.match(/^\/(\S*)$/)
    if (slash) {
      const token = slash[1]!.toLowerCase()
      return app
        .listCommands()
        .filter((c) => c.name.toLowerCase().includes(token))
        .slice(0, MAX_SUGGESTIONS)
        .map((c) => ({
          label: `/${c.name}`,
          hint: c.description,
          // Tab completes to "/name " (so you can add args); Enter runs it straight away.
          apply: () => setComposer(`/${c.name} `),
          run: () => {
            ta?.clear?.()
            setText("")
            app.runCommand(c.name)
          },
        }))
    }

    const at = t.match(/(^|\s)@(\S*)$/)
    if (at) {
      const token = at[2]!.toLowerCase()
      const start = t.length - at[2]!.length
      return files()
        .filter((f) => f.toLowerCase().includes(token))
        .slice(0, MAX_SUGGESTIONS)
        .map((f) => ({ label: truncate(f, 40), hint: "file", apply: () => setComposer(`${t.slice(0, start) + f} `) }))
    }
    return []
  })

  createEffect(() => {
    suggestions().length
    setSel(0)
  })

  // Keep the highlighted suggestion in view as the user arrows through a scrolling list.
  let sgScroll: any
  createEffect(() => {
    const i = sel()
    suggestions().length
    queueMicrotask(() => sgScroll?.scrollChildIntoView?.(`sg-${i}`))
  })

  // Inline paste tokens: a big/multi-line paste collapses to a placeholder at the cursor (kept here,
  // not in a floating row) and is expanded back to full content on submit. File @mentions stay inline
  // as `@path` text — that's already where they're typed, so no separate chip row is needed.
  const pastes = new Map<string, string>()
  let pasteN = 0
  const onPaste = (event: any) => {
    try {
      const raw = decodePasteBytes(event?.bytes) ?? ""
      // Strip simple ANSI SGR sequences a terminal may include in the paste.
      const txt = raw.replace(/\x1b\[[0-9;]*m/g, "")
      if (!isBigPaste(txt)) return // let small/single-line pastes flow in as normal text
      event?.preventDefault?.()
      const token = makePasteToken(++pasteN, txt.length)
      pastes.set(token, txt)
      ta?.insertText?.(token)
      refresh()
    } catch {
      /* fall through to default paste */
    }
  }

  function submit() {
    // If an autocomplete suggestion is highlighted, Enter applies it (completes the /command or
    // @file) rather than submitting the whole composer — you then press Enter again to send.
    const items = suggestions()
    if (items.length) {
      const it = items[sel()]
      // Enter runs a highlighted slash command immediately; for @file it inserts the path.
      if (it?.run) return it.run()
      it?.apply()
      return
    }
    const display: string = ta?.plainText ?? ""
    const value = expandTokens(display, pastes) // paste tokens → full content for the model
    if (value.trim()) app.submit(value, display !== value ? display : undefined)
    ta?.clear?.()
    setText("")
    pastes.clear()
    pasteN = 0
  }

  useKeyboard((key) => {
    if (!focused()) return
    const items = suggestions()
    if (items.length) {
      if (key.name === "up") return setSel((s) => (s - 1 + items.length) % items.length)
      if (key.name === "down") return setSel((s) => (s + 1) % items.length)
      if (key.name === "tab" && !key.shift) return items[sel()]?.apply()
    }
    refresh()
  })

  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={suggestions().length > 0}>
        <box
          flexDirection="column"
          flexShrink={0}
          border
          borderStyle="rounded"
          borderColor={theme.border}
          backgroundColor={theme.bgElevated}
          paddingLeft={1}
          paddingRight={1}
          marginBottom={1}
        >
          <scrollbox ref={(r: any) => (sgScroll = r)} maxHeight={VISIBLE_SUGGESTIONS}>
            <For each={suggestions()}>
              {(s, i) => (
                <box
                  id={`sg-${i()}`}
                  flexDirection="row"
                  gap={1}
                  backgroundColor={sel() === i() ? theme.bgHover : "transparent"}
                >
                  <box width={18} flexShrink={0}>
                    <text fg={sel() === i() ? mode().accent : theme.text}>{truncate(s.label, 18)}</text>
                  </box>
                  <text fg={theme.textFaint}>{truncate(s.hint, 36)}</text>
                </box>
              )}
            </For>
          </scrollbox>
          <text fg={theme.textFaint}>↑↓ move · ⏎ run · ⭾ complete · {suggestions().length}</text>
        </box>
      </Show>

      {/* Prompts staged while the agent is busy — drained one at a time at each turn boundary.
          Click a row to drop it from the queue. */}
      <Show when={app.queued().length > 0}>
        <box flexDirection="column" marginBottom={1} flexShrink={0}>
          <For each={app.queued()}>
            {(q, i) => (
              <box flexDirection="row" gap={1} onMouseDown={() => app.unqueue(i())}>
                <text fg={theme.warning}>⏳ queued</text>
                <text fg={theme.textMuted}>{truncate(q, 52)}</text>
                <text fg={theme.textFaint}>✕</text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <box
        flexDirection="row"
        flexShrink={0}
        border
        borderStyle="rounded"
        borderColor={focused() ? accentS() : theme.border}
        backgroundColor={theme.bgComposer}
        paddingLeft={1}
        paddingRight={1}
        alignItems="flex-end"
      >
        <box flexGrow={1}>
          <textarea
            ref={(r: any) => {
              ta = r
              app.registerComposer(r)
              r?.on?.("blurred", onBlur)
              if (r) r.onPaste = onPaste
            }}
            onSubmit={submit}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "return", shift: true, action: "newline" },
            ]}
            placeholder="ask anything…   /command · @file · ⇧⏎ newline"
            placeholderColor={theme.textFaint}
            textColor={theme.text}
            backgroundColor={theme.bgComposer}
            minHeight={1}
            maxHeight={maxHeight()}
          />
        </box>
        <box flexDirection="row" gap={1} marginLeft={1} alignItems="center" flexShrink={0}>
          <text fg={accentS()}>{modeGlyph(app.mode())}</text>
          <text fg={theme.textFaint}>{mode().label}</text>
        </box>
      </box>
    </box>
  )
}
