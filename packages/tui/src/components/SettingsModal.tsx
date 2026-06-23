import { DEFAULT_KEYBINDINGS, type KeyAction } from "@friday/core"
import { theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { Overlay, Row, Tabs } from "./ui.tsx"

const TABS: { key: string; label: string }[] = [
  { key: "general", label: "General" },
  { key: "editor", label: "Editor" },
  { key: "keybindings", label: "Keybindings" },
]

const ACTION_LABELS: Record<KeyAction, string> = {
  "panel.toggle": "toggle side panel",
  "mic.toggle": "mic (speech-to-text)",
  "console.toggle": "agent-team console",
  "dashboard.toggle": "dashboard",
  "history.open": "session history",
  "mode.cycle": "cycle mode",
  "pause.open": "pause the agent (/pause)",
  "settings.open": "open settings",
  "help.open": "keymap guide",
}

const OUTPUT_STYLES = ["concise", "explanatory", "minimal"]
const AUTO_COMPACT_STEPS = [0.75, 0.8, 0.85, 0.9] as const
const NEWLINE_LABEL = { shift: "shift+enter", alt: "alt/option+enter", both: "shift+enter · alt+enter" } as const

/** A single settings row: a label, its current value, and what Enter/click does. */
type SRow = { label: string; value: string; hint?: string; onActivate: () => void }

/** Turn a live key event into a chord string ("ctrl+shift+b"); null for escape / lone modifiers. */
function keyToChord(key: {
  name?: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  option?: boolean
  super?: boolean
}): string | null {
  const name = (key.name ?? "").toLowerCase()
  if (!name || name === "escape") return null
  if (["control", "ctrl", "shift", "alt", "meta", "option", "super"].includes(name)) return null
  const parts: string[] = []
  if (key.ctrl) parts.push("ctrl")
  if (key.shift) parts.push("shift")
  if (key.option) parts.push("option")
  if (key.meta) parts.push("meta")
  if (key.super) parts.push("super")
  parts.push(name)
  return parts.join("+")
}

/** /settings — interactive, keyboard- + mouse-driven: tabs, selectable rows, and live key capture. */
export function SettingsModal() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const [tab, setTab] = createSignal("general")
  const [sel, setSel] = createSignal(0)
  // While non-null we're capturing the next keypress to rebind this action.
  const [capturing, setCapturing] = createSignal<KeyAction | null>(null)
  const [notice, setNotice] = createSignal("")
  const order = TABS.map((t) => t.key)
  const actions = Object.keys(DEFAULT_KEYBINDINGS) as KeyAction[]

  const cycle = <T,>(arr: readonly T[], cur: T): T => arr[(arr.indexOf(cur) + 1) % arr.length]!

  // Each tab is a flat list of rows so selection/keyboard/mouse behave identically everywhere.
  const rows = createMemo<SRow[]>(() => {
    if (tab() === "general")
      return [
        {
          label: "auto-update check",
          value: app.autoupdate() === "off" ? "off" : "notify on launch",
          onActivate: () => app.setAutoupdate(app.autoupdate() === "off" ? "notify" : "off"),
        },
        {
          label: "theme",
          value: app.engine.userConfig().theme ?? "dark",
          hint: "↵ pick",
          onActivate: () => app.setThemeModalOpen(true),
        },
        {
          label: "output style",
          value: app.outputStyle(),
          onActivate: () => {
            app.setOutputStyle(cycle(OUTPUT_STYLES, app.outputStyle()))
            setNotice("output style applies on the next turn")
          },
        },
        {
          label: "auto-format on edit",
          value: app.formatterOn() ? "on" : "off",
          onActivate: () => app.setFormatter(!app.formatterOn()),
        },
        {
          label: "auto-compact at",
          value: `${Math.round(app.autoCompactThreshold() * 100)}% of context`,
          hint: "compacts the chat",
          onActivate: () => app.setAutoCompactThreshold(cycle(AUTO_COMPACT_STEPS, app.autoCompactThreshold())),
        },
        {
          label: "check for updates…",
          value: `v${app.version}`,
          hint: "↵ open",
          onActivate: () => app.setUpdateModalOpen(true),
        },
      ]
    if (tab() === "editor")
      return [
        {
          label: "newline key",
          value: NEWLINE_LABEL[app.newlineMode()],
          hint: "enter always sends",
          onActivate: () => app.setNewlineMode(cycle(["shift", "alt", "both"] as const, app.newlineMode())),
        },
      ]
    // keybindings
    return actions.map<SRow>((a) => ({
      label: ACTION_LABELS[a],
      value: capturing() === a ? "press a key…  (esc cancels)" : app.keymap()[a],
      onActivate: () => setCapturing(a),
    }))
  })

  const clamped = () => Math.min(sel(), Math.max(0, rows().length - 1))
  const switchTab = (key: string) => {
    setTab(key)
    setSel(0)
    setNotice("")
    setCapturing(null)
  }

  useKeyboard((key) => {
    if (!app.settingsModalOpen()) return
    // Capture mode: the very next key becomes the binding (esc cancels).
    if (capturing()) {
      if (key.name === "escape") return setCapturing(null)
      const chord = keyToChord(key)
      if (!chord) return
      const ok = app.rebind(capturing()!, chord)
      setNotice(ok ? "" : "that chord is reserved — binding unchanged")
      return setCapturing(null)
    }
    if (key.name === "escape") return app.setSettingsModalOpen(false)
    if (key.name === "tab")
      return switchTab(order[(order.indexOf(tab()) + (key.shift ? order.length - 1 : 1)) % order.length]!)
    if (key.name === "left") return switchTab(order[(order.indexOf(tab()) - 1 + order.length) % order.length]!)
    if (key.name === "right") return switchTab(order[(order.indexOf(tab()) + 1) % order.length]!)
    const n = rows().length
    if (!n) return
    if (key.name === "up" || key.name === "k") return setSel((s) => (s - 1 + n) % n)
    if (key.name === "down" || key.name === "j") return setSel((s) => (s + 1) % n)
    if (key.name === "return") return rows()[clamped()]?.onActivate()
  })

  return (
    <Scrim onClose={() => app.setSettingsModalOpen(false)}>
      <Overlay
        title="settings"
        hint="↑↓ move · ⏎ change · ←→ section · esc close"
        width={Math.min(76, dims().width - 4)}
      >
        <box flexDirection="column" gap={1}>
          {/* Horizontal tab bar — same Tabs primitive the dashboard uses, for a consistent feel. */}
          <Tabs items={TABS} active={tab()} onSelect={switchTab} />
          {/* Active tab's rows, full width. */}
          <box flexDirection="column" flexGrow={1} gap={0}>
            <For each={rows()}>
              {(r, i) => (
                <Row
                  label={r.label}
                  hint={r.value + (r.hint ? `   ${r.hint}` : "")}
                  labelWidth={22}
                  selected={clamped() === i()}
                  onSelect={() => setSel(i())}
                  onActivate={r.onActivate}
                />
              )}
            </For>
            <Show when={tab() === "keybindings"}>
              <box flexDirection="row" gap={2} paddingTop={1}>
                <text fg={theme.textFaint}>⏎ rebind · ctrl+c can't be rebound</text>
                <text fg={theme.warning} onMouseDown={() => app.resetKeybindings()}>
                  reset all
                </text>
              </box>
            </Show>
            <Show when={notice()}>
              <text fg={theme.warning}>{notice()}</text>
            </Show>
          </box>
        </box>
      </Overlay>
    </Scrim>
  )
}
