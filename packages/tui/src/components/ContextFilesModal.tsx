import { theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { listProjectFiles } from "../util/files.ts"
import { Scrim } from "./Scrim.tsx"
import { bandBg, HintChip, Meta, Overlay } from "./ui.tsx"

/**
 * View and manage the files in this session's context. Two kinds:
 *   - AUTO: FRIDAY.md / AGENTS.md discovered up the tree (read-only — edit the files to change them).
 *   - PINNED: files you pin here; their contents are injected into context every turn and persist for
 *     the session. Type to filter the project, ⏎ to pin; on a pinned row ⏎ (or click ✕) unpins.
 */
export function ContextFilesModal() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const [query, setQuery] = createSignal("")
  const [files, setFiles] = createSignal<string[]>([])
  const [sel, setSel] = createSignal(0)

  createEffect(() => {
    if (app.contextModalOpen()) listProjectFiles(app.roots()).then(setFiles)
  })

  const pinned = () => app.pinnedFiles()
  // Filtered candidates to add: project files matching the query, not already pinned.
  const matches = () => {
    const q = query().toLowerCase().trim()
    const pset = new Set(pinned())
    return files()
      .filter((f) => !pset.has(f) && (!q || f.toLowerCase().includes(q)))
      .slice(0, 200)
  }
  const clamped = () => Math.min(sel(), Math.max(0, matches().length - 1))

  let sb: any
  createEffect(() => {
    const i = clamped()
    queueMicrotask(() => sb?.scrollChildIntoView?.(`ctxfile-${i}`))
  })

  useKeyboard((key) => {
    if (!app.contextModalOpen()) return
    if (key.name === "escape") {
      if (query()) return setQuery("")
      return app.setContextModalOpen(false)
    }
    const m = matches()
    if (key.name === "up") return setSel((s) => (m.length ? (s - 1 + m.length) % m.length : 0))
    if (key.name === "down") return setSel((s) => (m.length ? (s + 1) % m.length : 0))
    if (key.name === "return" || key.name === "enter") {
      const pick = m[clamped()]
      if (pick) {
        app.pinContextFile(pick)
        setQuery("")
        setSel(0)
      }
      return
    }
    if (key.name === "backspace") return setQuery((q) => q.slice(0, -1))
    // Printable char → extend the filter.
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta && key.sequence >= " ") {
      setSel(0)
      return setQuery((q) => q + key.sequence)
    }
  })

  return (
    <Scrim onClose={() => app.setContextModalOpen(false)}>
      <Overlay title="context files" hint="what Friday is reading this session" width={Math.min(72, dims().width - 4)}>
        {/* AUTO context (read-only) */}
        <Show when={app.contextFiles().length}>
          <box flexDirection="column">
            <Meta text="auto · FRIDAY.md / AGENTS.md (edit the files to change)" />
            <For each={app.contextFiles()}>
              {(f) => (
                <box flexDirection="row" gap={1} paddingLeft={1}>
                  <text fg={theme.textFaint}>📄</text>
                  <text fg={theme.textMuted}>{f}</text>
                </box>
              )}
            </For>
          </box>
        </Show>

        {/* PINNED files — each removable */}
        <box flexDirection="column">
          <Meta text={`pinned · ${pinned().length} (persist for this session)`} />
          <Show
            when={pinned().length}
            fallback={<text fg={theme.textFaint}> none yet — type below to pin a file</text>}
          >
            <For each={pinned()}>
              {(f) => (
                <box flexDirection="row" gap={1} paddingLeft={1} onMouseDown={() => app.unpinContextFile(f)}>
                  <text fg={theme.brand}>📎</text>
                  <text fg={theme.text}>{f}</text>
                  <box flexGrow={1} />
                  <text fg={theme.error}>✕</text>
                </box>
              )}
            </For>
          </Show>
        </box>

        {/* ADD: filter + results */}
        <box flexDirection="column">
          <box flexDirection="row" gap={1}>
            <text fg={theme.textFaint}>+ add file</text>
            <text fg={theme.text}>{query() || "…"}</text>
          </box>
          <Show when={query()}>
            <scrollbox ref={(r: any) => (sb = r)} maxHeight={10}>
              <For each={matches()}>
                {(f, i) => {
                  const on = () => clamped() === i()
                  return (
                    <box
                      id={`ctxfile-${i()}`}
                      flexDirection="row"
                      gap={1}
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={bandBg(on())}
                      onMouseOver={() => setSel(i())}
                      onMouseDown={() => {
                        app.pinContextFile(f)
                        setQuery("")
                        setSel(0)
                      }}
                    >
                      <text fg={on() ? theme.textOnAccent : theme.textFaint}>📎</text>
                      <text fg={on() ? theme.textOnAccent : theme.text}>{f}</text>
                    </box>
                  )
                }}
              </For>
            </scrollbox>
          </Show>
        </box>

        <box flexDirection="row" gap={1}>
          <HintChip label="type to filter" />
          <HintChip label="⏎ pin" accent={theme.success} />
          <HintChip label="✕ click to unpin" />
          <HintChip label="esc close" onClick={() => app.setContextModalOpen(false)} />
        </box>
      </Overlay>
    </Scrim>
  )
}
