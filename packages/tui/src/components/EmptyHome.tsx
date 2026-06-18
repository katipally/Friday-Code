import { theme } from "@friday/shared"
import { createMemo, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Logo } from "./Logo.tsx"
import { Pressable } from "./Pressable.tsx"

function home(p: string): string {
  const h = process.env.HOME
  return h && p.startsWith(h) ? `~${p.slice(h.length)}` : p
}

function ago(ms?: number): string {
  if (!ms) return ""
  const s = (Date.now() - ms) / 1000
  if (s < 60) return "just now"
  const m = s / 60
  if (m < 60) return `${Math.floor(m)}m ago`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/**
 * Empty-session home: the logo, the current directory, the 3 most-recent sessions in this
 * directory (click to resume), and shortcuts to the full history / a directory change.
 */
export function EmptyHome() {
  const app = useApp()

  // 3 most recent sessions rooted in the current directory, excluding the (empty) active one.
  const recents = createMemo(() => {
    const cwd = app.currentCwd()
    const here = (app.allSessions() as any[]).filter(
      (s) => s.id !== app.activeSession() && (s.cwd === cwd || (s.roots ?? []).includes(cwd)),
    )
    here.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    return here.slice(0, 3)
  })

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" justifyContent="center" alignItems="center" gap={1}>
      <Logo />
      <text fg={theme.textFaint}>{truncate(home(app.currentCwd()), 56)}</text>

      <Show when={recents().length > 0}>
        <box flexDirection="column" width={52} gap={0} marginTop={1}>
          <box paddingLeft={1}>
            <text fg={theme.textMuted}>recent here</text>
          </box>
          <For each={recents()}>
            {(s: any) => (
              <box flexDirection="row" alignItems="center">
                <Pressable
                  label={`↻ ${truncate(s.title, 34)}`}
                  fg={theme.text}
                  grow
                  onClick={() => app.switchSession(s.id)}
                />
                <text fg={theme.textFaint}>{ago(s.updatedAt)} </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <box flexDirection="row" gap={1} marginTop={1}>
        <Pressable label="⏲ view more history" onClick={() => app.setHistoryOpen(true)} />
        <Pressable label="▸ change directory" onClick={() => app.setDirModalOpen(true)} />
      </box>
    </box>
  )
}
