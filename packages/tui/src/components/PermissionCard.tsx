import { Show } from "solid-js"
import { theme } from "@friday/shared"
import { useApp, type PendingPermission } from "../store.tsx"
import { SelectList, type SelectItem } from "./SelectList.tsx"
import { Scrim } from "./Scrim.tsx"
import { shimmerAccent } from "../motion/index.ts"

const DECISIONS = ["allow-once", "allow-always", "deny"] as const

const ACTIONS: SelectItem[] = [
  { id: "allow-once", label: "allow once", key: "a", color: theme.success },
  { id: "allow-always", label: "allow always", key: "s", color: theme.info },
  { id: "deny", label: "deny · esc", key: "d", color: theme.error },
]

/**
 * Permission prompt — a centered overlay modal (same shape as the ⌘K command palette).
 * Keys are handled globally in App.tsx (a/s/d/arrows/enter/esc); the backdrop is intentionally
 * inert (onClose no-op) so an accidental click can't silently deny.
 */
export function PermissionCard() {
  const app = useApp()
  return (
    <Show when={app.pending()}>
      {(p: () => PendingPermission) => (
        <Scrim onClose={() => {}}>
          <box
            flexDirection="column"
            width={64}
            border
            borderStyle="rounded"
            borderColor={shimmerAccent(theme.warning)}
            backgroundColor={theme.bgElevated}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            gap={1}
          >
            <box flexDirection="row" gap={1}>
              <text fg={theme.warning}>⚠ permission</text>
              <box flexGrow={1} />
              <text fg={theme.textFaint}>{p().tool}</text>
            </box>

            <text fg={theme.text}>{p().summary}</text>

            {/* The exact command / path, in a bounded monospace block. */}
            <Show when={p().detail}>
              <box
                border
                borderStyle="rounded"
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
              <text fg={theme.error}>⚠ risky — {p().risk}</text>
            </Show>

            <SelectList
              items={ACTIONS}
              selected={app.permSel()}
              accent={theme.warning}
              onHover={(i) => app.setPermSel(i)}
              onChoose={(i) => app.replyPermission(DECISIONS[i]!)}
            />
            <text fg={theme.textFaint}>↑↓ move · ⏎ choose · a/s/d shortcuts · esc deny</text>
          </box>
        </Scrim>
      )}
    </Show>
  )
}
