import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { useMascotFrame } from "../util/useMascot.ts"

/**
 * Strip directly above the composer: the animated mascot beside a live heuristic status.
 * No "friday" branding here — just the mascot + what the agent is doing.
 */
export function StatusStrip() {
  const app = useApp()
  const frame = useMascotFrame(app.mascot)
  const accent = () => getMode(app.mode()).accent

  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} gap={1} alignItems="center">
      <text fg={accent()}>{frame()}</text>
      <text fg={theme.textMuted}>{app.status()}</text>
    </box>
  )
}
