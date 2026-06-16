import { render } from "@opentui/solid"
import { App } from "./App.tsx"

/** Boot the Friday Code TUI (full-screen, mouse on). */
export function start() {
  render(() => <App />, {
    targetFPS: 60,
    exitOnCtrlC: true,
    useMouse: true,
    autoFocus: true,
  })
}
