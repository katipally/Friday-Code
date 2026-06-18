import { BRAND, getMode, theme } from "@friday/shared"
import { Show } from "solid-js"
import { shimmerAccent } from "../motion/index.ts"
import { useApp } from "../store.tsx"

function home(p: string): string {
  const h = process.env.HOME
  const s = h && p.startsWith(h) ? `~${p.slice(h.length)}` : p
  return s.length > 40 ? `…${s.slice(-39)}` : s
}

/** Top rail: a single clean row — the `friday code` wordmark + version + working directory. */
export function TopBar() {
  const app = useApp()
  const accent = () => shimmerAccent(getMode(app.mode()).accent)
  const extra = () => app.roots().length - 1

  return (
    <box
      flexDirection="row"
      height={1}
      paddingLeft={1}
      paddingRight={1}
      alignItems="center"
      justifyContent="center"
      gap={1}
    >
      <text fg={accent()}>
        <strong>{BRAND.name}</strong>
      </text>
      <text fg={theme.textMuted}>{BRAND.suffix}</text>
      <text fg={theme.textFaint}>v{BRAND.version}</text>
      <text fg={theme.textFaint}>·</text>
      <box flexDirection="row" gap={1} onMouseDown={() => app.setDirModalOpen(true)}>
        <text fg={theme.textMuted}>{home(app.currentCwd())}</text>
        <Show when={extra() > 0}>
          <text fg={accent()}>+{extra()}</text>
        </Show>
      </box>
    </box>
  )
}
