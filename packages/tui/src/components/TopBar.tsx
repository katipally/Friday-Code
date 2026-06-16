import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"

/** Top row inside the frame: wordmark left, clickable mode badge + model right. */
export function TopBar() {
  const app = useApp()
  const mode = () => getMode(app.mode())

  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} alignItems="center">
      <text fg={theme.textFaint}>friday</text>
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
      <box onMouseDown={() => app.setModelModalOpen(true)}>
        <text fg={theme.textMuted}>{app.model()}</text>
      </box>
    </box>
  )
}
