import { theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { For, Show } from "solid-js"
import { shimmerAccent } from "../motion/index.ts"
import { type PendingPermission, useApp } from "../store.tsx"
import { G } from "../util/term.ts"
import { Scrim } from "./Scrim.tsx"

const DECISIONS = ["allow-once", "allow-always", "deny"] as const

type Action = { id: (typeof DECISIONS)[number]; label: string; key: string; color: string }
const ACTIONS: Action[] = [
  { id: "allow-once", label: "allow once", key: "a", color: theme.success },
  { id: "allow-always", label: "allow always", key: "s", color: theme.info },
  { id: "deny", label: "deny", key: "d", color: theme.error },
]

/**
 * Permission prompt — a centered overlay modal (opencode-style inline button row).
 *
 * This card OWNS its keyboard (via `useKeyboard`, gated on `app.pending()`); App.tsx early-returns
 * for permissions so there is exactly one key handler — no native `<select>` fighting for focus, no
 * double-handling. The backdrop is intentionally inert (onClose no-op) so an accidental click can't
 * silently deny.
 */
export function PermissionCard() {
  const app = useApp()

  function move(dir: 1 | -1) {
    app.setPermSel((s) => (s + dir + ACTIONS.length) % ACTIONS.length)
  }

  useKeyboard((key) => {
    if (!app.pending()) return
    if (key.name === "a") return app.replyPermission("allow-once")
    if (key.name === "s") return app.replyPermission("allow-always")
    if (key.name === "d" || key.name === "escape") return app.replyPermission("deny")
    if (key.name === "left" || key.name === "h" || key.name === "up" || key.name === "k") return move(-1)
    if (key.name === "right" || key.name === "l" || key.name === "down" || key.name === "j") return move(1)
    if (key.name === "tab") return move(key.shift ? -1 : 1)
    if (key.name === "return" || key.name === "enter" || key.name === "space")
      return app.replyPermission(ACTIONS[app.permSel()]!.id)
  })

  return (
    <Show when={app.pending()}>
      {(p: () => PendingPermission) => (
        <Scrim onClose={() => {}}>
          <box
            flexDirection="column"
            width={64}
            border
            borderStyle="single"
            borderColor={shimmerAccent(theme.warning)}
            backgroundColor={theme.bgElevated}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            gap={1}
          >
            <box flexDirection="row" gap={1}>
              <text fg={theme.warning}>{G.warn} permission</text>
              <box flexGrow={1} />
              <text fg={theme.textFaint}>{p().tool}</text>
            </box>

            <text fg={theme.text}>{p().summary}</text>

            {/* The exact command / path, in a bounded monospace block. */}
            <Show when={p().detail}>
              <box
                border
                borderStyle="single"
                borderColor={p().risk ? theme.error : theme.border}
                backgroundColor={theme.bgComposer}
                paddingLeft={1}
                paddingRight={1}
                maxHeight={8}
              >
                <text fg={theme.textMuted} selectable>
                  {p().detail}
                </text>
              </box>
            </Show>

            <Show when={p().risk}>
              <text fg={theme.error}>
                {G.warn} risky — {p().risk}
              </text>
            </Show>

            {/* Inline button row — selected pill is filled; the hotkey letter is shown on each. */}
            <box flexDirection="row" gap={1}>
              <For each={ACTIONS}>
                {(action, i) => {
                  const active = () => app.permSel() === i()
                  return (
                    <box
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={active() ? action.color : theme.bgComposer}
                      onMouseOver={() => app.setPermSel(i())}
                      onMouseDown={() => app.replyPermission(action.id)}
                    >
                      <text fg={active() ? theme.bg : action.color}>
                        <strong>{action.key}</strong>
                      </text>
                      <text fg={active() ? theme.bg : theme.textMuted}> {action.label}</text>
                    </box>
                  )
                }}
              </For>
            </box>

            <text fg={theme.textFaint}>←→ / a·s·d move · ⏎ choose · esc deny</text>
          </box>
        </Scrim>
      )}
    </Show>
  )
}
