import type { Engine } from "@friday/core"
import { applyTheme } from "@friday/shared"
import { render } from "@opentui/solid"
import { App } from "./App.tsx"

/** Boot the Friday Code TUI (full-screen, mouse on) against an engine. */
export function start(engine: Engine): void {
  // Apply the saved theme before the first render (the UI reads `theme` directly).
  applyTheme(engine.userConfig().theme)
  render(() => <App engine={engine} />, {
    targetFps: 60,
    exitOnCtrlC: false, // we handle Ctrl+C to show the clean-exit screen
    useMouse: true,
    autoFocus: true,
  })
}
