import fs from "node:fs"
import path from "node:path"
import { getMode, theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"

function home(p: string): string {
  const h = process.env.HOME
  return h && p.startsWith(h) ? `~${p.slice(h.length)}` : p
}
function expand(v: string): string {
  return v.startsWith("~") ? (process.env.HOME ?? "") + v.slice(1) : v
}

/** Change the working directory (new session) or add a directory to the current session. */
export function DirectoryModal() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const [value, setValue] = createSignal("")
  const [error, setError] = createSignal("")
  const [sel, setSel] = createSignal(0)

  // Recently-used directories: distinct roots across all sessions, newest first.
  const recent = createMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const s of app.allSessions())
      for (const r of s.roots.length ? s.roots : [s.cwd])
        if (!seen.has(r)) {
          seen.add(r)
          out.push(r)
        }
    return out.filter((r) => !app.roots().includes(r)).slice(0, 6)
  })

  // Live filesystem autocomplete for the typed path.
  const suggestions = createMemo<string[]>(() => {
    const raw = value().trim()
    if (!raw) return []
    const abs = path.isAbsolute(expand(raw)) ? expand(raw) : path.resolve(app.engine.currentCwd(), expand(raw))
    const endsSlash = raw.endsWith("/")
    const baseDir = endsSlash ? abs : path.dirname(abs)
    const frag = endsSlash ? "" : path.basename(abs).toLowerCase()
    try {
      return fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name.toLowerCase().includes(frag))
        .slice(0, 8)
        .map((d) => path.join(baseDir, d.name))
    } catch {
      return []
    }
  })

  function resolve(): string | null {
    const v = expand((value() || "").trim())
    if (!v) return null
    const abs = path.isAbsolute(v) ? v : path.resolve(app.engine.currentCwd(), v)
    try {
      if (fs.statSync(abs).isDirectory()) return abs
    } catch {
      /* not a dir */
    }
    setError(`Not a directory: ${v}`)
    return null
  }
  function openDir(dir?: string) {
    const d = dir ?? resolve()
    if (d) {
      app.setDirModalOpen(false)
      app.setRoot(d)
    }
  }
  function add() {
    const dir = resolve()
    if (dir) {
      app.setDirModalOpen(false)
      app.addRoot(dir)
    }
  }
  function setComposer(v: string) {
    setValue(v)
    setSel(0)
    setError("")
  }

  useKeyboard((key) => {
    if (!app.dirModalOpen()) return
    const s = suggestions()
    if (key.name === "escape") return app.setDirModalOpen(false)
    if (s.length) {
      if (key.name === "up") return setSel((x) => (x - 1 + s.length) % s.length)
      if (key.name === "down") return setSel((x) => (x + 1) % s.length)
      if (key.name === "tab" && !key.shift) return setComposer(`${s[Math.min(sel(), s.length - 1)]!}/`)
    }
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

        <Show when={recent().length}>
          <box flexDirection="column">
            <text fg={theme.textMuted}>recent</text>
            <For each={recent()}>
              {(r) => (
                <box onMouseDown={() => openDir(r)}>
                  <text fg={theme.textFaint}>↩ {home(r)}</text>
                </box>
              )}
            </For>
          </box>
        </Show>

        <box flexDirection="column">
          <text fg={theme.textFaint}>path</text>
          <box border borderStyle="rounded" borderColor={accent()} paddingLeft={1} paddingRight={1}>
            <input
              value={value()}
              onInput={(v) => {
                setValue(v)
                setSel(0)
                setError("")
              }}
              onSubmit={() => openDir()}
              focused
              placeholder="~/path/to/project · ⭾ to complete"
              placeholderColor={theme.textFaint}
            />
          </box>
        </box>

        <Show when={suggestions().length}>
          <box flexDirection="column">
            <For each={suggestions()}>
              {(d, i) => (
                <box
                  paddingLeft={1}
                  backgroundColor={sel() === i() ? theme.bgHover : "transparent"}
                  onMouseOver={() => setSel(i())}
                  onMouseDown={() => setComposer(`${d}/`)}
                >
                  <text fg={sel() === i() ? accent() : theme.textMuted}> {home(d)}</text>
                </box>
              )}
            </For>
          </box>
        </Show>

        <Show when={error()}>
          <text fg={theme.error}>{error()}</text>
        </Show>

        <box flexDirection="row" gap={2}>
          <box
            border
            borderStyle="rounded"
            borderColor={theme.success}
            paddingLeft={1}
            paddingRight={1}
            onMouseDown={() => openDir()}
          >
            <text fg={theme.success}>open here ⏎</text>
            <text fg={theme.textFaint}> (new session)</text>
          </box>
          <box border borderStyle="rounded" borderColor={theme.info} paddingLeft={1} paddingRight={1} onMouseDown={add}>
            <text fg={theme.info}>+ add directory</text>
            <text fg={theme.textFaint}> (same session)</text>
          </box>
        </box>
        <text fg={theme.textFaint}>↑↓ pick · ⭾ complete · ⏎ open · esc close</text>
      </box>
    </Scrim>
  )
}
