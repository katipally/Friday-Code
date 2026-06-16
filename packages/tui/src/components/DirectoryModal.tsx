import fs from "node:fs"
import path from "node:path"
import { createSignal, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"

function home(p: string): string {
  const h = process.env.HOME
  return h && p.startsWith(h) ? "~" + p.slice(h.length) : p
}

/** Change the working directory (new session) or add a directory to the current session. */
export function DirectoryModal() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const [value, setValue] = createSignal("")
  const [error, setError] = createSignal("")
  let input: any

  function resolve(): string | null {
    let v = (input?.value ?? value()).trim()
    if (!v) return null
    if (v.startsWith("~")) v = (process.env.HOME ?? "") + v.slice(1)
    const abs = path.isAbsolute(v) ? v : path.resolve(app.engine.currentCwd(), v)
    try {
      if (fs.statSync(abs).isDirectory()) return abs
    } catch {
      /* not a dir */
    }
    setError(`Not a directory: ${v}`)
    return null
  }

  function open() {
    const dir = resolve()
    if (dir) {
      app.setDirModalOpen(false)
      app.setRoot(dir)
    }
  }
  function add() {
    const dir = resolve()
    if (dir) {
      app.setDirModalOpen(false)
      app.addRoot(dir)
    }
  }

  useKeyboard((key) => {
    if (!app.dirModalOpen()) return
    if (key.name === "escape") app.setDirModalOpen(false)
  })

  return (
    <Scrim onClose={() => app.setDirModalOpen(false)}>
      <box
        flexDirection="column"
        width={68}
        border
        borderStyle="rounded"
        borderColor={accent()}
        backgroundColor={theme.bgElevated}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <box flexDirection="row" gap={1}>
          <text fg={accent()}>/dir</text>
          <text fg={theme.textFaint}>· workspace directories</text>
        </box>
        <box flexDirection="column">
          <text fg={theme.textMuted}>current roots</text>
          <For each={app.roots()}>
            {(r, i) => (
              <text fg={i() === 0 ? theme.text : theme.textMuted}>
                {i() === 0 ? "● " : "  "}
                {home(r)}
              </text>
            )}
          </For>
        </box>
        <box flexDirection="column">
          <text fg={theme.textFaint}>path</text>
          <box border borderStyle="rounded" borderColor={accent()} paddingLeft={1} paddingRight={1}>
            <input
              ref={(r: any) => (input = r)}
              value={value()}
              onInput={(v) => {
                setValue(v)
                setError("")
              }}
              onSubmit={open}
              focused
              placeholder="~/path/to/project or ../sibling"
              placeholderColor={theme.textFaint}
            />
          </box>
        </box>
        <Show when={error()}>
          <text fg={theme.error}>{error()}</text>
        </Show>
        <box flexDirection="row" gap={2}>
          <box border borderStyle="rounded" borderColor={theme.success} paddingLeft={1} paddingRight={1} onMouseDown={open}>
            <text fg={theme.success}>open here ⏎</text>
            <text fg={theme.textFaint}> (new session)</text>
          </box>
          <box border borderStyle="rounded" borderColor={theme.info} paddingLeft={1} paddingRight={1} onMouseDown={add}>
            <text fg={theme.info}>+ add directory</text>
            <text fg={theme.textFaint}> (same session)</text>
          </box>
        </box>
        <text fg={theme.textFaint}>esc to close</text>
      </box>
    </Scrim>
  )
}
