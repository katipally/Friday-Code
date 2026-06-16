#!/usr/bin/env bun
import { Engine } from "@friday/core"
import { start } from "@friday/tui"

// Tiny arg parser: `-s/--session <id>` resumes a session, `-c/--continue` resumes the latest.
const argv = process.argv.slice(2)
let resumeId: string | undefined
let continueLast = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "-s" || a === "--session") resumeId = argv[++i]
  else if (a === "-c" || a === "--continue") continueLast = true
}

const engine = new Engine({ cwd: process.cwd(), resumeId, continueLast })
await engine.init() // connect MCP servers (no-op if none configured)
start(engine)
