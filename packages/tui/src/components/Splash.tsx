import { getMode, MASCOT, theme } from "@friday/shared"
import { useApp } from "../store.tsx"
import { Logo } from "./Logo.tsx"

/** Full-screen splash shown on launch. Dismissed via Enter/Space/click (handled in App). */
export function Splash() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.bg}
      justifyContent="center"
      alignItems="center"
      gap={1}
      onMouseDown={() => app.setView("shell")}
    >
      <Logo />
      <text fg={theme.textMuted}>a new kind of terminal coding agent</text>
      <box height={1} />
      <box flexDirection="row" gap={1}>
        <text fg={accent()}>{MASCOT.idle.frames[1]}</text>
        <text fg={theme.textFaint}>press</text>
        <text fg={theme.text}>enter</text>
        <text fg={theme.textFaint}>to begin</text>
      </box>
    </box>
  )
}
