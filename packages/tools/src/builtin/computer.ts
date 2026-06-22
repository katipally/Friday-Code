import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { obj, type Tool } from "../tool.ts"

/**
 * Desktop control (mouse / keyboard / screenshot). This is unavoidably a NATIVE capability, so it is
 * OPT-IN and never bundled: the backend (a nut.js fork) is installed on demand into
 * ~/.friday/computer-use and dynamically imported at runtime. If it isn't installed, the tools
 * politely tell the model to ask the user to install it (via the TUI). Uninstall removes the dir.
 *
 * ponytail: dynamic import of an out-of-tree package keeps the base binary light and dependency-free;
 * the user explicitly installs/uninstalls from the TUI. Screenshots are written to a file (tool
 * results can't carry images to the model yet) — full vision-driven control is a later enhancement.
 */

const COMPUTER = "computer" as const
const PKG = "@nut-tree-fork/nut-js"

function homeDir(): string {
  return path.join(os.homedir(), ".friday", "computer-use")
}
function modulePath(): string {
  return path.join(homeDir(), "node_modules", PKG)
}

export function computerInstalled(): boolean {
  return fs.existsSync(modulePath())
}

/** Install the native backend into ~/.friday/computer-use. Returns the install log. */
export async function installComputerUse(): Promise<{ ok: boolean; log: string }> {
  const dir = homeDir()
  fs.mkdirSync(dir, { recursive: true })
  const pkgJson = path.join(dir, "package.json")
  if (!fs.existsSync(pkgJson)) fs.writeFileSync(pkgJson, JSON.stringify({ name: "friday-computer-use", private: true }))
  const pm = Bun.which("bun") ? ["bun", "add", PKG] : ["npm", "install", PKG]
  const proc = Bun.spawn(pm, { cwd: dir, stdout: "pipe", stderr: "pipe" })
  await proc.exited
  const log = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`.slice(-2000)
  return { ok: computerInstalled(), log }
}

export function uninstallComputerUse(): boolean {
  try {
    fs.rmSync(homeDir(), { recursive: true, force: true })
    return !computerInstalled()
  } catch {
    return false
  }
}

// Cache the dynamically-imported module so we don't re-import per call.
let nut: any
async function loadNut(): Promise<any> {
  if (nut) return nut
  if (!computerInstalled())
    throw new Error("computer-use is not installed — ask the user to run /computer-use install in Friday")
  nut = await import(modulePath())
  return nut
}

async function withNut<T>(fn: (n: any) => Promise<T>): Promise<{ output: string }> {
  try {
    const n = await loadNut()
    const out = await fn(n)
    return { output: String(out ?? "ok") }
  } catch (e: any) {
    return { output: `Error: ${e?.message ?? e}` }
  }
}

// ---- tools ----------------------------------------------------------------

export const COMPUTER_SCREENSHOT = "computer_screenshot"
export const COMPUTER_CLICK = "computer_click"
export const COMPUTER_MOVE = "computer_move"
export const COMPUTER_TYPE = "computer_type"
export const COMPUTER_KEY = "computer_key"
export const COMPUTER_SCROLL = "computer_scroll"
export const COMPUTER_TOOLS = new Set([
  COMPUTER_SCREENSHOT,
  COMPUTER_CLICK,
  COMPUTER_MOVE,
  COMPUTER_TYPE,
  COMPUTER_KEY,
  COMPUTER_SCROLL,
])

const screenshotTool: Tool = {
  name: COMPUTER_SCREENSHOT,
  description:
    "Capture the whole screen to a PNG file and return its path + screen size. Requires the opt-in computer-use backend (the user installs it from the TUI).",
  permission: COMPUTER,
  deferred: true,
  parameters: obj({ path: { type: "string", description: "output file path (defaults to ./friday-screen.png)" } }),
  async execute(input: any, ctx) {
    const out = path.resolve(ctx.cwd, String(input.path || "friday-screen.png"))
    return withNut(async (n) => {
      const w = await n.screen.width()
      const h = await n.screen.height()
      // nut.js writes <name>.png into a dir; capture then move into place.
      const dir = path.dirname(out)
      const base = path.basename(out).replace(/\.png$/i, "")
      const written = await n.screen.capture(base, n.FileType.PNG, dir)
      return `saved ${written} (${w}×${h})`
    })
  },
}

const moveTool: Tool = {
  name: COMPUTER_MOVE,
  description: "Move the mouse cursor to absolute screen coordinates (x, y).",
  permission: COMPUTER,
  deferred: true,
  parameters: obj({ x: { type: "number" }, y: { type: "number" } }, ["x", "y"]),
  async execute(input: any) {
    return withNut(async (n) => {
      await n.mouse.setPosition(new n.Point(Number(input.x), Number(input.y)))
      return `moved to ${input.x},${input.y}`
    })
  },
}

const clickTool: Tool = {
  name: COMPUTER_CLICK,
  description: "Click the mouse. Optionally move to (x, y) first; button is 'left' (default) or 'right'.",
  permission: COMPUTER,
  deferred: true,
  parameters: obj({
    x: { type: "number", description: "optional x to move to before clicking" },
    y: { type: "number", description: "optional y to move to before clicking" },
    button: { type: "string", description: "'left' (default) or 'right'" },
  }),
  async execute(input: any) {
    return withNut(async (n) => {
      if (input.x != null && input.y != null) await n.mouse.setPosition(new n.Point(Number(input.x), Number(input.y)))
      const btn = input.button === "right" ? n.Button.RIGHT : n.Button.LEFT
      await n.mouse.click(btn)
      return "clicked"
    })
  },
}

const typeTool: Tool = {
  name: COMPUTER_TYPE,
  description: "Type a string at the current keyboard focus.",
  permission: COMPUTER,
  deferred: true,
  parameters: obj({ text: { type: "string" } }, ["text"]),
  async execute(input: any) {
    return withNut(async (n) => {
      await n.keyboard.type(String(input.text))
      return "typed"
    })
  },
}

const keyTool: Tool = {
  name: COMPUTER_KEY,
  description:
    "Press a key or chord by name (e.g. 'Enter', 'Escape', 'LeftControl+C'). Names match nut.js Key enum members.",
  permission: COMPUTER,
  deferred: true,
  parameters: obj({ keys: { type: "string", description: "key or '+'-joined chord" } }, ["keys"]),
  async execute(input: any) {
    return withNut(async (n) => {
      const names = String(input.keys)
        .split("+")
        .map((s) => s.trim())
      const keys = names.map((name) => n.Key[name])
      if (keys.some((k: unknown) => k === undefined)) return `unknown key in "${input.keys}"`
      await n.keyboard.pressKey(...keys)
      await n.keyboard.releaseKey(...keys)
      return `pressed ${input.keys}`
    })
  },
}

const scrollTool: Tool = {
  name: COMPUTER_SCROLL,
  description: "Scroll the mouse wheel. Positive `amount` scrolls down, negative scrolls up.",
  permission: COMPUTER,
  deferred: true,
  parameters: obj({ amount: { type: "number", description: "ticks; >0 down, <0 up" } }, ["amount"]),
  async execute(input: any) {
    return withNut(async (n) => {
      const amt = Number(input.amount)
      if (amt >= 0) await n.mouse.scrollDown(amt)
      else await n.mouse.scrollUp(-amt)
      return `scrolled ${amt}`
    })
  },
}

export const COMPUTER_TOOL_LIST: Tool[] = [screenshotTool, moveTool, clickTool, typeTool, keyTool, scrollTool]
