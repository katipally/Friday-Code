#!/usr/bin/env bun
import {
  compareSemver,
  detectInstallMethod,
  Engine,
  getLatestVersion,
  loadConfig,
  runUpdate,
  SessionStore,
} from "@friday/core"
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
  friday attach <id>          Watch a background/fleet session (read-only)

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
} else if (argv[0] === "attach") {
  await attachSession(argv[1])
} else {
  let resumeId: string | undefined
  let continueLast = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "-s" || a === "--session") resumeId = argv[++i]
    else if (a === "-c" || a === "--continue") continueLast = true
  }
  await maybeAutoUpdate()
  const engine = new Engine({ cwd: process.cwd(), resumeId, continueLast })
  await engine.init() // connect MCP servers (no-op if none configured)
  await start(engine, VERSION)
}

// Auto-update on reopen: before the TUI (alt-screen) exists, in the plain terminal. Acts instantly
// on a version a prior background check already flagged (config.latestKnown), with a bounded live
// npm check as fallback. On a newer version, upgrade and re-exec with FRIDAY_UPDATED set so the
// relaunched process skips this and boots straight into the TUI (no update loop). Doing this in the
// normal terminal — not inside the alt-screen — is what keeps the relaunch clean and interactive.
async function maybeAutoUpdate(): Promise<void> {
  if (VERSION === "dev" || process.env.FRIDAY_UPDATED) return
  if (loadConfig().autoupdate === "off") return
  let target = loadConfig().latestKnown // instant path — no network
  if (!target || compareSemver(target, VERSION) <= 0) target = (await getLatestVersion()) ?? undefined // live fallback (~6s cap, null offline)
  if (!target || compareSemver(target, VERSION) <= 0) return
  process.stdout.write(`↑ Updating Friday ${VERSION} → ${target}…\n`)
  const r = await runUpdate(detectInstallMethod())
  if (!r.ok) {
    process.stdout.write(`update failed — continuing on ${VERSION}\n`)
    return
  }
  process.stdout.write("✓ updated, relaunching\n")
  const c = Bun.spawnSync([process.execPath, ...process.argv.slice(1)], {
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, FRIDAY_UPDATED: "1" },
  })
  process.exit(c.exitCode ?? 0)
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

// `friday attach <id>` — a read-only viewer that tails one session's transcript from the shared
// store, so a spawned fleet window can watch an agent without any IPC. Polls for newly-appended
// messages (background runners persist each message as it completes).
// ponytail: poll-tail at 1s, turn-granular (not token-stream). Upgrade to a socket only if the
// lag is ever a problem in practice.
async function attachSession(id?: string): Promise<void> {
  if (!id) {
    process.stderr.write("Usage: friday attach <session-id>\n")
    process.exit(2)
  }
  const store = new SessionStore()
  const row = store.get(id)
  if (!row) {
    process.stderr.write(`No session ${id}.\n`)
    process.exit(1)
  }
  process.stdout.write(`\x1b[1m▸ ${row.title || id}\x1b[0m  (attached, read-only — Ctrl-C to detach)\n\n`)
  let seen = 0
  const render = () => {
    const msgs = store.loadMessages(id)
    for (const m of msgs.slice(seen)) {
      if (m.role === "user") process.stdout.write(`\x1b[36m❯ ${m.text}\x1b[0m\n\n`)
      else if (m.role === "assistant" && m.text) process.stdout.write(`${m.text}\n\n`)
      else if (m.role === "tool") process.stdout.write(`\x1b[90m· ${m.name}\x1b[0m\n`)
    }
    seen = msgs.length
  }
  render()
  // Re-open the DB each tick is unnecessary; the same connection sees committed writes from the
  // other process. Just re-query.
  setInterval(render, 1000)
  await new Promise(() => {}) // run until Ctrl-C
}
