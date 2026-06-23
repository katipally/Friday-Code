import { theme } from "@friday/shared"
import { decodePasteBytes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { expandTokens, isBigPaste, makePasteToken } from "../util/attachments.ts"
import { listProjectFiles } from "../util/files.ts"
import { Scrim } from "./Scrim.tsx"
import { bandBg, Overlay } from "./ui.tsx"

const MAX_SUGGESTIONS = 50
const VISIBLE_SUGGESTIONS = 8

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/**
 * /pause composer: pause the running agent and add context it missed. Opening /pause (or Shift+Esc)
 * soft-interrupts the current generation immediately; on send the note is folded into the conversation
 * and the agent resumes. A full prompt composer — `@file` mentions autocomplete (resolved by the runner)
 * and big pastes collapse to placeholders, same as the main composer.
 */
export function PauseModal() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const maxHeight = () => Math.max(4, Math.floor(dims().height / 3))

  let ta: any
  const pastes = new Map<string, string>()
  let pasteN = 0
  const [text, setText] = createSignal("")
  const [files, setFiles] = createSignal<string[]>([])
  const [sel, setSel] = createSignal(0)
  let sgScroll: any

  // Load the project file list (across all roots) for @-mention completion.
  createEffect(() => {
    listProjectFiles(app.roots()).then(setFiles)
  })

  function refresh() {
    queueMicrotask(() => setText(ta?.plainText ?? ""))
  }
  function setComposer(value: string) {
    ta?.setText?.(value)
    if (ta) ta.cursorOffset = value.length
    setText(value)
  }

  // Trailing `@token` → file suggestions (only kind offered here; slash commands aren't meaningful).
  const suggestions = createMemo<{ label: string; apply: () => void }[]>(() => {
    const t = text()
    if (!t) return []
    const at = t.match(/(^|\s)@(\S*)$/)
    if (!at) return []
    const token = at[2]!.toLowerCase()
    const start = t.length - at[2]!.length
    return files()
      .filter((f) => f.toLowerCase().includes(token))
      .slice(0, MAX_SUGGESTIONS)
      .map((f) => ({ label: truncate(f, 48), apply: () => setComposer(`${t.slice(0, start) + f} `) }))
  })

  createEffect(() => {
    suggestions().length
    setSel(0)
  })
  createEffect(() => {
    const i = sel()
    suggestions().length
    queueMicrotask(() => sgScroll?.scrollChildIntoView?.(`pause-sg-${i}`))
  })

  function send() {
    const raw: string = ta?.plainText ?? ""
    app.pauseInject(expandTokens(raw, pastes), true) // paste tokens → full content; runner expands @mentions/images
  }

  // Enter applies a highlighted file suggestion (you then press Enter again to send); else submits.
  function submit() {
    const items = suggestions()
    if (items.length) return items[sel()]?.apply()
    send()
  }

  const onPaste = (event: any) => {
    try {
      const txt = (decodePasteBytes(event?.bytes) ?? "").replace(/\x1b\[[0-9;]*m/g, "")
      if (!isBigPaste(txt)) return
      event?.preventDefault?.()
      const token = makePasteToken(++pasteN, txt.length)
      pastes.set(token, txt)
      ta?.insertText?.(token)
      refresh()
    } catch {
      /* fall through to default paste */
    }
  }

  useKeyboard((key) => {
    if (!app.pauseModalOpen()) return
    const items = suggestions()
    if (items.length) {
      if (key.name === "up") return setSel((s) => (s - 1 + items.length) % items.length)
      if (key.name === "down") return setSel((s) => (s + 1) % items.length)
      if (key.name === "tab" && !key.shift) return items[sel()]?.apply()
      if (key.name === "escape") return setComposer(text().replace(/(^|\s)@\S*$/, "$1")) // dismiss the dropdown
    } else if (key.name === "escape") {
      return app.pauseCancel()
    }
    refresh()
  })

  return (
    <Scrim onClose={() => app.pauseCancel()}>
      <Overlay
        title="/pause"
        hint="paused — agent is waiting; send to add context"
        width={Math.min(76, dims().width - 4)}
      >
        <Show when={suggestions().length > 0}>
          <box flexDirection="column" backgroundColor={theme.bgElevated} paddingLeft={1} paddingRight={1}>
            <scrollbox ref={(r: any) => (sgScroll = r)} maxHeight={VISIBLE_SUGGESTIONS}>
              <For each={suggestions()}>
                {(s, i) => (
                  <box
                    id={`pause-sg-${i()}`}
                    flexDirection="row"
                    gap={1}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={bandBg(sel() === i())}
                    onMouseOver={() => setSel(i())}
                    onMouseDown={() => s.apply()}
                  >
                    <text fg={sel() === i() ? theme.textOnAccent : theme.text}>{s.label}</text>
                    <box flexGrow={1} />
                    <text fg={sel() === i() ? theme.textOnAccent : theme.textFaint}>file</text>
                  </box>
                )}
              </For>
            </scrollbox>
            <text fg={theme.textFaint}>↑↓ move · Enter insert · Tab complete · {suggestions().length}</text>
          </box>
        </Show>

        <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
          <textarea
            ref={(r: any) => {
              ta = r
              if (r) r.onPaste = onPaste
            }}
            onSubmit={submit}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "return", shift: true, action: "newline" },
              { name: "return", meta: true, action: "newline" },
            ]}
            focused
            placeholder="what should the agent also know?   @file · @image.png · Shift+Enter newline"
            placeholderColor={theme.textFaint}
            textColor={theme.text}
            backgroundColor={theme.bgComposer}
            minHeight={2}
            maxHeight={maxHeight()}
          />
        </box>

        <text fg={theme.textFaint}>Enter add context · @ mention a file · Esc resume the agent</text>
      </Overlay>
    </Scrim>
  )
}
