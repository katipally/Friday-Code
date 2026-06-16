import { Show } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"

function home(p: string): string {
  const h = process.env.HOME
  const s = h && p.startsWith(h) ? "~" + p.slice(h.length) : p
  return s.length > 28 ? "…" + s.slice(-27) : s
}

/** Top row inside the frame: wordmark + working directory left, mode badge + model right. */
export function TopBar() {
  const app = useApp()
  const mode = () => getMode(app.mode())
  const extra = () => app.roots().length - 1

  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} alignItems="center" gap={1}>
      <text fg={mode().accent}>⬡</text>
      <text fg={theme.text}>friday</text>
      <text fg={theme.textFaint}>code</text>
      <text fg={theme.textFaint}>·</text>
      <box flexDirection="row" gap={1} onMouseDown={() => app.setDirModalOpen(true)}>
        <text fg={theme.textMuted}>{home(app.currentCwd())}</text>
        <Show when={extra() > 0}>
          <text fg={mode().accent}>+{extra()}</text>
        </Show>
      </box>
      <box flexGrow={1} />
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={() => app.toggleMode(1)}
      >
        <text fg={mode().accent}>{mode().glyph}</text>
        <text fg={mode().accent}>{mode().label}</text>
      </box>
      <text fg={theme.textFaint}> · </text>
      <box flexDirection="row" gap={1} onMouseDown={() => app.setModelModalOpen(true)}>
        <text fg={theme.textMuted}>{app.model()}</text>
        <Show when={app.reasoningModel()}>
          <text fg={theme.textFaint}>◇ {app.effort()}</text>
        </Show>
      </box>
    </box>
  )
}
