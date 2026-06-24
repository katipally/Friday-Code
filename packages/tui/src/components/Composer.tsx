import { getMode, theme } from "@friday/shared"
import { decodePasteBytes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { shimmerAccent } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { createPasteStore, isPasteKey, pasteFromClipboard } from "../util/attachments.ts"
import { listProjectFiles } from "../util/files.ts"
import { modeGlyph } from "../util/term.ts"
import { bandBg } from "./ui.tsx"

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

  // Newline key(s) follow the user's setting (Enter always submits). The textarea binding model only
  // exposes meta (not option) as a modifier, so alt/option+Enter is expressed as meta+return.
  const newlineBindings = createMemo(() => {
    const m = app.newlineMode()
    const out: any[] = [{ name: "return", action: "submit" }]
    if (m === "shift" || m === "both") out.push({ name: "return", shift: true, action: "newline" })
    if (m === "alt" || m === "both") out.push({ name: "return", meta: true, action: "newline" })
    return out
  })

  // Prompt history: ↑/↓ walk this session's prior user prompts when the caret is on the first line
  // and no autocomplete is open. histIdx -1 = not browsing; `draft` preserves the in-progress text.
  const history = () =>
    app
      .items()
      .filter((i) => i.kind === "user")
      .map((i) => (i as any).display ?? (i as any).text)
      .filter((s: string) => s?.trim())
  let histIdx = -1
  let draft = ""
  function onFirstLine(): boolean {
    const t: string = ta?.plainText ?? ""
    const off: number = ta?.cursorOffset ?? 0
    const nl = t.indexOf("\n")
    return nl === -1 || off <= nl
  }

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

  // Paste handling: a big/multi-line paste collapses to a placeholder token at the cursor, and a
  // pasted image/file becomes a short inline `⟦▣ name⟧` token — both expand to full content / `@path`
  // on submit (the model gets the real path). Small text pastes flow in inline. The bracketed-paste
  // event and the Cmd/Ctrl+V fallback route through the same store.
  const store = createPasteStore()
  const onPaste = (event: any) => {
    try {
      // Text → token/inline; an empty bracketed paste means an image/file (Cmd+V of a picture) — read
      // the system clipboard for it. Only swallow the native paste when we actually inserted something.
      const txt = decodePasteBytes(event?.bytes) ?? ""
      if (txt.trim() ? store.insert(ta, txt) : pasteFromClipboard(ta, store)) {
        event?.preventDefault?.()
        refresh()
      }
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
    const value = store.expand(display) // paste tokens → full content for the model
    // Keep each live paste's content on the chat item so its chip can be previewed later.
    const pastes = Object.fromEntries(store.live(display).map((t) => [t, store.pastes.get(t)!]))
    if (value.trim())
      app.submit(value, display !== value ? display : undefined, Object.keys(pastes).length ? pastes : undefined)
    ta?.clear?.()
    setText("")
    store.clear()
  }

  useKeyboard((key) => {
    if (!focused()) return
    // Ctrl+V / Cmd+V: paste text, image, or file from the system clipboard (the reliable path where
    // the terminal doesn't bracket — and the only path for images/files).
    if (isPasteKey(key)) {
      pasteFromClipboard(ta, store)
      return refresh()
    }
    const items = suggestions()
    if (items.length) {
      if (key.name === "up") return setSel((s) => (s - 1 + items.length) % items.length)
      if (key.name === "down") return setSel((s) => (s + 1) % items.length)
      if (key.name === "tab" && !key.shift) return items[sel()]?.apply()
    } else {
      // Prompt history (only when no autocomplete dropdown is competing for ↑/↓).
      const h = history()
      if (key.name === "up" && onFirstLine() && h.length) {
        if (histIdx === -1) draft = ta?.plainText ?? ""
        histIdx = Math.min(histIdx + 1, h.length - 1)
        setComposer(h[h.length - 1 - histIdx]!)
        return
      }
      if (key.name === "down" && histIdx !== -1) {
        histIdx -= 1
        setComposer(histIdx < 0 ? draft : h[h.length - 1 - histIdx]!)
        if (histIdx < 0) histIdx = -1
        return
      }
    }
    // Any non-navigation key exits history-browsing so further edits are on the recalled text itself.
    if (key.name !== "up" && key.name !== "down") histIdx = -1
    refresh()
  })

  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={suggestions().length > 0}>
        <box
          flexDirection="column"
          flexShrink={0}
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
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={bandBg(sel() === i())}
                >
                  <box width={18} flexShrink={0}>
                    <text fg={sel() === i() ? theme.textOnAccent : theme.text}>{truncate(s.label, 18)}</text>
                  </box>
                  <text fg={sel() === i() ? theme.textOnAccent : theme.textFaint}>{truncate(s.hint, 36)}</text>
                </box>
              )}
            </For>
          </scrollbox>
          <text fg={theme.textFaint}>↑↓ move · Enter run · Tab complete · {suggestions().length}</text>
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
        borderStyle="single"
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
            keyBindings={newlineBindings()}
            placeholder="ask anything…   /command · @file · ↑ history · Shift+Enter newline"
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
