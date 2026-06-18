import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { shimmerAccent } from "../motion/index.ts"
import { listProjectFiles } from "../util/files.ts"
import { modeGlyph } from "../util/term.ts"
import { FileChip } from "./FileChip.tsx"
import { parseMentions } from "../util/mentions.ts"

type Suggestion = { label: string; hint: string; apply: () => void; run?: () => void }

// Keep enough matches that every command is reachable; the dropdown scrolls to reveal them all
// instead of cycling within a handful.
const MAX_SUGGESTIONS = 50
const VISIBLE_SUGGESTIONS = 8

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
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
    // Assert synchronously first to close the race where the first keystroke after a modal closes
    // lands before focus is re-applied; the microtask remains as a fallback for OpenTUI's render
    // timing (focus() can be a no-op before the textarea has re-rendered).
    try {
      if (f) ta?.focus?.()
      else ta?.blur?.()
    } catch {}
    queueMicrotask(() => {
      try {
        if (f) ta?.focus?.()
        else ta?.blur?.()
      } catch {}
    })
  })

  // OpenTUI's autoFocus blurs the textarea when another focusable element (the chat scrollbox,
  // a list, …) is clicked. While we're still in the editable state, grab focus straight back so
  // the user can keep typing without having to click into the composer again.
  const onBlur = () => {
    if (focused()) queueMicrotask(() => { try { ta?.focus?.() } catch {} })
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
        .map((f) => ({ label: truncate(f, 40), hint: "file", apply: () => setComposer(t.slice(0, start) + f + " ") }))
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

  // File/folder/image references in the prompt, shown as compact chips above the input.
  // Images become vision input on submit; all chips are click-to-open.
  const chips = createMemo(() => parseMentions(text(), app.roots()))

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
    const value: string = ta?.plainText ?? ""
    if (value.trim()) app.submit(value)
    ta?.clear?.()
    setText("")
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
                <box id={`sg-${i()}`} flexDirection="row" gap={1} backgroundColor={sel() === i() ? theme.bgHover : "transparent"}>
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

      <Show when={chips().length > 0}>
        <box flexDirection="row" gap={1} marginBottom={1} flexShrink={0} flexWrap="wrap">
          <For each={chips()}>{(chip) => <FileChip chip={chip} accent={mode().accent} max={24} onOpen={() => app.openPath(chip.rel)} />}</For>
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
            }}
            onSubmit={submit}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "return", shift: true, action: "newline" },
            ]}
            focused={focused()}
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
