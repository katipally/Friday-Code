import { getMode, theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, onMount } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { SelectList } from "./SelectList.tsx"

/** Ctrl/Cmd+K fuzzy command palette over built-in + custom commands. */
export function CommandPalette() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const all = app.listCommands()
  const [query, setQuery] = createSignal("")
  const [sel, setSel] = createSignal(0)
  let input: any

  const filtered = createMemo(() => {
    const q = query().toLowerCase()
    return all.filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
  })

  function run(i: number) {
    const c = filtered()[i]
    if (!c) return
    app.setPaletteOpen(false)
    app.runCommand(c.name)
  }

  useKeyboard((key) => {
    if (!app.paletteOpen()) return
    const items = filtered()
    if (key.name === "escape") return app.setPaletteOpen(false)
    if (key.name === "up") return setSel((s) => (s - 1 + items.length) % Math.max(1, items.length))
    if (key.name === "down") return setSel((s) => (s + 1) % Math.max(1, items.length))
    if (key.name === "return" || key.name === "enter" || (key.name === "tab" && !key.shift)) return run(sel())
    queueMicrotask(() => {
      setQuery(input?.plainText ?? "")
      setSel(0)
    })
  })

  onMount(() => setQuery(""))

  return (
    <Scrim onClose={() => app.setPaletteOpen(false)}>
      <box
        flexDirection="column"
        width={64}
        border
        borderStyle="rounded"
        borderColor={accent()}
        backgroundColor={theme.bgElevated}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={accent()}>⌘</text>
          <box flexGrow={1} border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1}>
            <textarea
              ref={(r: any) => (input = r)}
              focused
              minHeight={1}
              maxHeight={1}
              placeholder="run a command…"
              placeholderColor={theme.textFaint}
            />
          </box>
        </box>
        <box flexDirection="column" maxHeight={12}>
          <SelectList
            items={filtered().map((c) => ({ id: c.name, label: `/${c.name}`, hint: c.description }))}
            selected={sel()}
            accent={accent()}
            onHover={(i) => setSel(i)}
            onChoose={(i) => run(i)}
          />
        </box>
        <text fg={theme.textFaint}>↑↓ move · ⏎/⭾ run · esc close</text>
      </box>
    </Scrim>
  )
}
