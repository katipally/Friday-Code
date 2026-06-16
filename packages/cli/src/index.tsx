#!/usr/bin/env bun
import { Engine } from "@friday/core"
import { start } from "@friday/tui"

// M0/M1: launch the shell against a fresh engine in the current directory.
// Arg parsing (-s/-c/--continue) lands in M3.
const engine = new Engine({ cwd: process.cwd() })
start(engine)
