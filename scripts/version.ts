#!/usr/bin/env bun

// Derive VERSION + TAG for a release.
//
// Called by .github/workflows/release.yml (the `version` job) on tag push
// and on workflow_dispatch. Reads:
//   GITHUB_REF_TYPE="tag"           for tag pushes
//   GITHUB_REF_NAME="v2.0.1"        for tag pushes
//   INPUT_TAG="v2.0.1"              for manual dispatch
// Writes to $GITHUB_OUTPUT so downstream jobs can use outputs.version / outputs.tag.

import { appendFile } from "node:fs/promises"

const tag = process.env.GITHUB_REF_TYPE === "tag" ? (process.env.GITHUB_REF_NAME ?? "") : (process.env.INPUT_TAG ?? "")

if (!/^v\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error(`version: invalid tag "${tag}" (expected vX.Y.Z[-suffix])`)
  process.exit(1)
}

const version = tag.replace(/^v/, "")
console.log(`version=${version}`)
console.log(`tag=${tag}`)

const out = process.env.GITHUB_OUTPUT
if (out) {
  await appendFile(out, `version=${version}\ntag=${tag}\n`)
}
