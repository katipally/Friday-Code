import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { listProjectFiles } from "../util/files.ts"

type Suggestion = { label: string; hint: string; apply: () => void }

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
    !app.modelModalOpen() &&
    !app.pending() &&
    !app.askPending() &&
    !app.paletteOpen()
  const maxHeight = () => Math.max(4, Math.floor(dims().height / 3))

  let ta: any
  const [text, setText] = createSignal("")
  const [files, setFiles] = createSignal<string[]>([])
  const [sel, setSel] = createSignal(0)

  onMount(() => {
    listProjectFiles(app.engine.cwdPath()).then(setFiles)
  })

  function refresh() {
    queueMicrotask(() => setText(ta?.plainText ?? ""))
  }

  function setComposer(value: string) {
    ta?.setText?.(value)
    refresh()
  }

  const suggestions = createMemo<{ items: Suggestion[]; kind: "slash" | "file" | null }>(() => {
    const t = text()
    if (!focused() || !t) return { items: [], kind: null }

    // slash commands: "/" then command name, no space yet
    const slash = t.match(/^\/(\S*)$/)
    if (slash) {
      const token = slash[1]!.toLowerCase()
      const items = app
        .listCommands()
        .filter((c) => c.name.toLowerCase().includes(token))
        .slice(0, 8)
        .map<Suggestion>((c) => ({
          label: `/${c.name}`,
          hint: c.description,
          apply: () => setComposer(`/${c.name} `),
        }))
      return { items, kind: "slash" }
    }

    // file mentions: trailing "@token"
    const at = t.match(/(^|\s)@(\S*)$/)
    if (at) {
      const token = at[2]!.toLowerCase()
      const start = t.length - at[2]!.length
      const items = files()
        .filter((f) => f.toLowerCase().includes(token))
        .slice(0, 8)
        .map<Suggestion>((f) => ({
          label: f,
          hint: "file",
          apply: () => setComposer(t.slice(0, start) + f + " "),
        }))
      return { items, kind: "file" }
    }
    return { items: [], kind: null }
  })

  createEffect(() => {
    suggestions().items.length // track
    setSel(0)
  })

  function submit() {
    const value: string = ta?.plainText ?? ""
    if (value.trim()) app.submit(value)
    ta?.clear?.()
    refresh()
  }

  useKeyboard((key) => {
    if (!focused()) return
    const items = suggestions().items
    if (items.length) {
      if (key.name === "up") {
        setSel((s) => (s - 1 + items.length) % items.length)
        return
      }
      if (key.name === "down") {
        setSel((s) => (s + 1) % items.length)
        return
      }
      if (key.name === "tab" && !key.shift) {
        items[sel()]?.apply()
        return
      }
    }
    refresh()
  })

  return (
    <box flexDirection="column">
      <Show when={suggestions().items.length > 0}>
        <box
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={theme.border}
          backgroundColor={theme.bgElevated}
          paddingLeft={1}
          paddingRight={1}
          marginBottom={0}
        >
          <For each={suggestions().items}>
            {(s, i) => (
              <box
                flexDirection="row"
                gap={1}
                backgroundColor={sel() === i() ? theme.bgHover : "transparent"}
                onMouseDown={() => s.apply()}
              >
                <box width={28}>
                  <text fg={sel() === i() ? mode().accent : theme.text}>{s.label}</text>
                </box>
                <text fg={theme.textFaint}>{s.hint}</text>
              </box>
            )}
          </For>
          <text fg={theme.textFaint}>↑↓ move · ⭾ complete</text>
        </box>
      </Show>

      <box
        flexDirection="row"
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
        <box flexDirection="row" gap={1} marginLeft={1} alignItems="center">
          <text fg={mode().accent}>{mode().glyph}</text>
          <text fg={theme.textFaint}>{mode().label}</text>
        </box>
      </box>
    </box>
  )
}
