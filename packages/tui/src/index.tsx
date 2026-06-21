import type { Engine } from "@friday/core"
import { applyTerminalProfile, applyTheme } from "@friday/shared"
import { render } from "@opentui/solid"
import { App } from "./App.tsx"
import { hasTruecolor } from "./util/term.ts"
import { probeTerminal } from "./util/terminal.ts"

/** Boot the Friday Code TUI (full-screen, mouse on) against an engine. */
export async function start(engine: Engine, version = "dev"): Promise<void> {
  // Ask the terminal what it is BEFORE first render: a saved theme always wins, otherwise we follow
  // the detected background. Then layer a 256-safe palette when the terminal lacks truecolor so the
  // UI renders consistently in plain terminals (Terminal.app) and IDE terminals alike.
  const saved = engine.userConfig().theme
  const profile = await probeTerminal()
  const themeName = saved ?? (profile.background === "light" ? "light" : "dark")
  applyTheme(themeName)
  applyTerminalProfile({ truecolor: hasTruecolor, themeName })
  render(() => <App engine={engine} version={version} />, {
    targetFps: 60,
    exitOnCtrlC: false, // we handle Ctrl+C to show the clean-exit screen
    useMouse: true,
    autoFocus: true,
  })
}
