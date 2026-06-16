import { createMemo, createSignal, For, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"

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
    if (key.name === "return" || key.name === "enter") return run(sel())
    queueMicrotask(() => {
      setQuery(input?.plainText ?? "")
      setSel(0)
    })
  })

  onMount(() => setQuery(""))

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      backgroundColor={theme.bg}
      justifyContent="center"
      alignItems="center"
      onMouseDown={() => app.setPaletteOpen(false)}
    >
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
        onMouseDown={(e: any) => e?.stopPropagation?.()}
      >
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={accent()}>⌘</text>
          <box flexGrow={1} border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1}>
            <textarea ref={(r: any) => (input = r)} focused minHeight={1} maxHeight={1} placeholder="run a command…" placeholderColor={theme.textFaint} />
          </box>
        </box>
        <box flexDirection="column" maxHeight={12}>
          <For each={filtered()}>
            {(c, i) => (
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={sel() === i() ? theme.bgHover : "transparent"}
                onMouseDown={() => run(i())}
              >
                <box width={20}>
                  <text fg={sel() === i() ? accent() : theme.text}>/{c.name}</text>
                </box>
                <text fg={theme.textFaint}>{c.description}</text>
              </box>
            )}
          </For>
        </box>
        <text fg={theme.textFaint}>↑↓ move · ⏎ run · esc close</text>
      </box>
    </box>
  )
}
