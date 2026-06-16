import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { listProjectFiles } from "../util/files.ts"
import { parseMentions, chipIcon } from "../util/mentions.ts"

type Suggestion = { label: string; hint: string; apply: () => void }

const MAX_SUGGESTIONS = 6

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
  const focused = () =>
    app.view() === "shell" &&
    !app.overlayOpen() &&
    !app.onboardingOpen() &&
    !app.modelModalOpen() &&
    !app.paletteOpen() &&
    !app.historyOpen() &&
    !app.dirModalOpen() &&
    !app.mcpModalOpen() &&
    !app.checkpointsOpen() &&
    !app.pending() &&
    !app.askPending()
  const maxHeight = () => Math.max(4, Math.floor(dims().height / 3))

  let ta: any
  const [text, setText] = createSignal("")
  const [files, setFiles] = createSignal<string[]>([])
  const [sel, setSel] = createSignal(0)

  // Load (and reload when the workspace roots change) the file list across all roots.
  createEffect(() => {
    listProjectFiles(app.roots()).then(setFiles)
  })

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
        .map((c) => ({ label: `/${c.name}`, hint: c.description, apply: () => setComposer(`/${c.name} `) }))
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

  // File/folder/image references in the prompt, shown as compact chips above the input.
  // Images become vision input on submit; all chips are click-to-open.
  const chips = createMemo(() => parseMentions(text(), app.roots()))

  function submit() {
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
          <For each={suggestions()}>
            {(s, i) => (
              <box flexDirection="row" gap={2} backgroundColor={sel() === i() ? theme.bgHover : "transparent"}>
                <text fg={sel() === i() ? mode().accent : theme.text}>{s.label}</text>
                <box flexGrow={1} />
                <text fg={theme.textFaint}>{truncate(s.hint, 28)}</text>
              </box>
            )}
          </For>
          <text fg={theme.textFaint}>↑↓ move · ⭾ complete</text>
        </box>
      </Show>

      <Show when={chips().length > 0}>
        <box flexDirection="row" gap={1} marginBottom={1} flexShrink={0} flexWrap="wrap">
          <For each={chips()}>
            {(chip) => (
              <box
                border
                borderStyle="rounded"
                borderColor={chip.abs ? mode().accent : theme.border}
                paddingLeft={1}
                paddingRight={1}
                onMouseDown={() => app.openPath(chip.rel)}
              >
                <text fg={chip.abs ? theme.text : theme.textFaint}>
                  {chipIcon(chip.kind)} {truncate(chip.rel.split("/").pop() || chip.rel, 24)}
                </text>
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
        borderColor={focused() ? mode().accent : theme.border}
        backgroundColor={theme.bgComposer}
        paddingLeft={1}
        paddingRight={1}
        alignItems="flex-end"
      >
        <box flexGrow={1}>
          <textarea
            ref={(r: any) => (ta = r)}
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
          <text fg={mode().accent}>{mode().glyph}</text>
          <text fg={theme.textFaint}>{mode().label}</text>
        </box>
      </box>
    </box>
  )
}
