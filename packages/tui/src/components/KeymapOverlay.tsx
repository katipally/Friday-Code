import { MODES, theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal, For, Match, Switch } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { Overlay, Row, SectionLabel, Tabs } from "./ui.tsx"

const KEYS: { keys: string; label: string }[] = [
  { keys: "Enter", label: "send message" },
  { keys: "Shift/Alt+Enter", label: "new line in composer (configurable in /settings)" },
  { keys: "↑ / ↓", label: "recall previous prompts (caret on first line)" },
  { keys: "Shift+Tab", label: "cycle mode (plan → default → yolo)" },
  { keys: "Shift+Esc", label: "pause the running agent & add context (/pause)" },
  { keys: "Ctrl+B", label: "toggle context panel" },
  { keys: "Ctrl+G", label: "settings — autoupdate · keybindings · editor · theme" },
  { keys: "Ctrl+R", label: "mic — press to record, press again to transcribe (on-device)" },
  { keys: "Ctrl+Y", label: "session history (all directories)" },
  { keys: "PgUp/PgDn", label: "scroll the conversation (Shift+↑/↓ · Ctrl+U/D)" },
  { keys: "/ · @", label: "slash command · file mention (@file#L1-20 for a range)" },
  { keys: "Esc Esc", label: "stop the agent (while busy) · checkpoint history (while idle)" },
  { keys: "? · F1", label: "this guide (or click ? keys)" },
  { keys: "Ctrl+C", label: "quit (press twice)" },
]

// Shortcuts shown in the guide are the defaults; the active bindings live in ~/.friday/keybindings.json
// (edit them in /settings → keybindings).

const TAB_ITEMS = [
  { label: "commands", key: "commands" },
  { label: "keyboard", key: "keyboard" },
  { label: "modes", key: "modes" },
]

/**
 * The `?` / F1 guide: every slash command, every keyboard shortcut, and every mode — one reference so
 * nothing is hidden. Tab / ←→ switch sections (also clickable); ↑↓ scroll the list; Esc or a backdrop
 * click closes (handled in App + the Scrim).
 */
export function KeymapOverlay() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const [tab, setTab] = createSignal("commands")
  const order = TAB_ITEMS.map((t) => t.key)
  let sb: { scrollBy?: (n: number) => void } | null = null

  useKeyboard((key) => {
    if (!app.overlayOpen()) return
    if (key.name === "tab")
      return setTab((t) => order[(order.indexOf(t) + (key.shift ? -1 + order.length : 1)) % order.length]!)
    if (key.name === "right") return setTab((t) => order[(order.indexOf(t) + 1) % order.length]!)
    if (key.name === "left") return setTab((t) => order[(order.indexOf(t) - 1 + order.length) % order.length]!)
    if (key.name === "up" || key.name === "k") return sb?.scrollBy?.(-3)
    if (key.name === "down" || key.name === "j") return sb?.scrollBy?.(3)
    if (key.name === "pageup") return sb?.scrollBy?.(-12)
    if (key.name === "pagedown") return sb?.scrollBy?.(12)
  })

  const maxH = () => Math.max(8, Math.round(dims().height * 0.6))

  return (
    <Scrim onClose={() => app.setOverlayOpen(false)}>
      <Overlay title="guide" hint="commands · keyboard · modes" width={Math.min(78, dims().width - 4)}>
        <Tabs items={TAB_ITEMS} active={tab()} onSelect={setTab} />
        <scrollbox ref={(r: any) => (sb = r)} maxHeight={maxH()}>
          <Switch>
            <Match when={tab() === "commands"}>
              <SectionLabel text="slash commands" />
              <box flexDirection="column">
                <For each={app.listCommands()}>
                  {(c) => <Row label={`/${c.name}`} hint={c.description} labelWidth={18} />}
                </For>
              </box>
            </Match>

            <Match when={tab() === "keyboard"}>
              <SectionLabel text="keyboard" />
              <box flexDirection="column">
                <For each={KEYS}>
                  {(k) => (
                    <box flexDirection="row" gap={2} paddingLeft={1}>
                      <box width={16}>
                        <text fg={theme.text}>{k.keys}</text>
                      </box>
                      <text fg={theme.textFaint}>{k.label}</text>
                    </box>
                  )}
                </For>
              </box>
            </Match>

            <Match when={tab() === "modes"}>
              <SectionLabel text="modes" />
              <box flexDirection="column">
                <For each={MODES}>
                  {(m) => (
                    <box flexDirection="row" gap={2} paddingLeft={1}>
                      <box width={16} flexDirection="row" gap={1}>
                        <text fg={m.accent}>{m.glyph}</text>
                        <text fg={m.accent}>{m.label}</text>
                      </box>
                      <text fg={theme.textFaint}>{m.hint}</text>
                    </box>
                  )}
                </For>
              </box>
            </Match>
          </Switch>
        </scrollbox>
        <text fg={theme.textFaint}>tab / ←→ switch · ↑↓ scroll · esc or click to close</text>
      </Overlay>
    </Scrim>
  )
}
