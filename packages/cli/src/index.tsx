#!/usr/bin/env bun
import { Engine } from "@friday/core"
import { start } from "@friday/tui"

// Stamped at compile time by scripts/build.ts via --define; "dev" when run from source.
// `typeof` guards the reference so an undefined global never throws at runtime.
declare const __FRIDAY_VERSION__: string
const STAMPED = typeof __FRIDAY_VERSION__ === "string" ? __FRIDAY_VERSION__ : "dev"
// Release builds carry the tag-stamped version. Running from source it's "dev" —
// fall back to `git describe` so the top bar reflects local development.
// ponytail: one git call, dev-only; "dev" if not a git checkout.
function devVersion(): string {
  try {
    const r = Bun.spawnSync(["git", "describe", "--tags", "--always", "--dirty"], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "ignore",
    })
    const out = r.stdout
      .toString()
      .trim()
      .replace(/^v(?=\d)/, "")
    return out || "dev"
  } catch {
    return "dev"
  }
}
const VERSION = STAMPED === "dev" ? devVersion() : STAMPED

const HELP = `friday — a terminal AI coding agent

Usage:
  friday                      Launch the interactive TUI
  friday -c, --continue       Resume the most recent session
  friday -s, --session <id>   Resume a specific session by id
  friday run "<prompt>"       Run one turn headless and print the result
  friday run "<prompt>" --json  Headless, emit JSON ({ "text": ... })

Options:
  -v, --version               Print the version and exit
  -h, --help                  Show this help and exit

On first launch, onboarding walks you through connecting a provider via /model.
Docs: https://github.com/katipally/friday-code`

// Tiny arg parser: `-s/--session <id>` resumes a session, `-c/--continue` resumes the latest.
// Headless: `friday run "<prompt>" [--json]` runs one turn to completion, prints the result, and exits
// (auto-approves tools, for CI/scripting) — no TUI.
const argv = process.argv.slice(2)

if (argv[0] === "-v" || argv[0] === "--version") {
  process.stdout.write(`${VERSION}\n`)
  process.exit(0)
} else if (argv[0] === "-h" || argv[0] === "--help") {
  process.stdout.write(`${HELP}\n`)
  process.exit(0)
} else if (argv[0] === "run") {
  await runHeadless(argv.slice(1))
} else {
  let resumeId: string | undefined
  let continueLast = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "-s" || a === "--session") resumeId = argv[++i]
    else if (a === "-c" || a === "--continue") continueLast = true
  }
  const engine = new Engine({ cwd: process.cwd(), resumeId, continueLast })
  await engine.init() // connect MCP servers (no-op if none configured)
  await start(engine, VERSION)
}

async function runHeadless(args: string[]): Promise<void> {
  const json = args.includes("--json")
  const prompt = args
    .filter((a) => !a.startsWith("-"))
    .join(" ")
    .trim()
  if (!prompt) {
    process.stderr.write('Usage: friday run "<prompt>" [--json]\n')
    process.exit(2)
  }
  const engine = new Engine({ cwd: process.cwd() })
  await engine.init()
  if (!engine.selection().model) {
    process.stderr.write("No model configured. Launch `friday` and pick one with /model first.\n")
    process.exit(1)
  }
  engine.setMode("yolo") // auto-approve tools in headless (not persisted to config)

  let text = ""
  let errored: string | undefined
  const done = new Promise<void>((resolve) => {
    engine.subscribe((e) => {
      if (e.type === "text") text += e.delta
      else if (e.type === "error") {
        errored = e.message
        resolve()
      } else if (e.type === "turn-done") resolve()
    })
  })
  engine.ready()
  engine.send({ type: "prompt", text: prompt })
  await done

  if (errored) {
    process.stderr.write(`${errored}\n`)
    process.exit(1)
  }
  process.stdout.write(json ? `${JSON.stringify({ text: text.trim() })}\n` : `${text.trim()}\n`)
  process.exit(0)
}
