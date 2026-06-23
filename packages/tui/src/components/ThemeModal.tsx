import { theme, themeNames } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal, For } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { Overlay, Row } from "./ui.tsx"

/** /theme picker. Applies the chosen preset live + persists it (full repaint on next launch). */
export function ThemeModal() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const names = themeNames()
  const current = () => app.engine.userConfig().theme ?? "dark"
  const [sel, setSel] = createSignal(Math.max(0, names.indexOf(current())))

  useKeyboard((key) => {
    if (!app.themeModalOpen()) return
    if (key.name === "up" || key.name === "k") return setSel((s) => (s - 1 + names.length) % names.length)
    if (key.name === "down" || key.name === "j") return setSel((s) => (s + 1) % names.length)
    if (key.name === "return") return app.applyThemeNow(names[sel()]!)
    if (key.name === "escape") return app.setThemeModalOpen(false)
  })

  return (
    <Scrim onClose={() => app.setThemeModalOpen(false)}>
      <Overlay title="theme" hint="↑↓ move · ⏎ apply · esc close" width={Math.min(48, dims().width - 4)}>
        <box flexDirection="column">
          <For each={names}>
            {(name, i) => (
              <Row
                label={name === current() ? `${name}  ✓` : name}
                hint={name === "dark" ? "default" : ""}
                selected={sel() === i()}
                onSelect={() => setSel(i())}
                onActivate={() => app.applyThemeNow(name)}
              />
            )}
          </For>
        </box>
        <text fg={theme.textFaint}>applies now; restart to repaint everything</text>
      </Overlay>
    </Scrim>
  )
}
