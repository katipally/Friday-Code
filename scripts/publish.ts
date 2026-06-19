#!/usr/bin/env bun

// Publish the release: platform packages + launcher to npm, then open
// PRs against the Homebrew tap and Scoop bucket with the new version + SHA256.
//
// Idempotent: every `npm publish` is skipped if the version is already on npm.
// Stable platforms (5) and the launcher get the full treatment; musl and
// win32-arm64 are best-effort if their artifact dir is present.
//
// Inputs (env):
//   VERSION            e.g. "2.0.1"  (REQUIRED)
//   NPM_DIR            e.g. "dist/npm"  (default)
//   NODE_AUTH_TOKEN    npm automation token  (REQUIRED for npm publish)
//   GITHUB_TOKEN       token for the GitHub API (tap/bucket PRs)
//   HOMEBREW_TAP_REPO  "owner/repo" of the tap  (optional — skips if unset)
//   SCOOP_BUCKET_REPO  "owner/repo" of the bucket  (optional — skips if unset)
//   FRIDAY_REPO        "katipally/friday-code"  (default)

import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const NPM_DIR = path.join(ROOT, process.env.NPM_DIR ?? "dist/npm")
const VERSION = process.env.VERSION ?? ""
const FRIDAY_REPO = process.env.FRIDAY_REPO ?? "katipally/friday-code"
const GH_TOKEN = process.env.GITHUB_TOKEN ?? ""

if (!VERSION) {
  console.error("publish: VERSION env required (e.g. 2.0.1)")
  process.exit(1)
}

const STABLE = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"] as const
const OPTIONAL = ["win32-arm64", "linux-x64-musl", "linux-arm64-musl"] as const

console.log(`=== publish v${VERSION} ===\n`)

const summary: Record<string, string> = {}

// 1. platform packages (best-effort)
for (const target of [...STABLE, ...OPTIONAL]) {
  const dir = path.join(NPM_DIR, `npm-${target}`)
  if (!existsSync(path.join(dir, "package.json"))) {
    if ((STABLE as readonly string[]).includes(target)) {
      console.error(`publish: missing required package dir ${dir}`)
      process.exit(1)
    }
    console.log(`  · ${target}: no artifact, skip (optional)`)
    continue
  }
  summary[target] = await publishOne(dir, (STABLE as readonly string[]).includes(target))
}

// 2. launcher (required)
const launcherDir = path.join(NPM_DIR, "npm-launcher")
if (!existsSync(path.join(launcherDir, "package.json"))) {
  console.error("publish: missing required launcher dir", launcherDir)
  process.exit(1)
}
summary.launcher = await publishOne(launcherDir, true)

// 3. external indexes (best-effort)
console.log("")
if (process.env.HOMEBREW_TAP_REPO) {
  console.log("=== homebrew tap update ===")
  await updateHomebrew()
} else {
  console.log("=== homebrew tap update: skipped (HOMEBREW_TAP_REPO not set) ===")
}
if (process.env.SCOOP_BUCKET_REPO) {
  console.log("=== scoop bucket update ===")
  await updateScoop()
} else {
  console.log("=== scoop bucket update: skipped (SCOOP_BUCKET_REPO not set) ===")
}

// 4. summary
console.log("\n=== summary ===")
for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(20)} ${v}`)

// ───────────────────────── helpers ─────────────────────────

async function publishOne(dir: string, required: boolean): Promise<string> {
  const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"))
  const { name, version: ver } = pkg

  if (await published(name, ver)) {
    console.log(`  ✓ ${name}@${ver}  already on npm — skip`)
    return "skipped (already published)"
  }
  // GitHub artifact downloads can drop the +x bit; restore it.
  if (process.platform !== "win32") await runOk(`chmod -R 755 .`, dir)
  console.log(`  → publishing ${name}@${ver} …`)
  const { code, output } = await run("npm publish --provenance --access public", dir)
  if (code === 0) {
    console.log(`  ✓ ${name}@${ver}  published`)
    return "published"
  }
  if (/previously published|spam detection|403/.test(output)) {
    console.log(`  ✓ ${name}@${ver}  blocked by registry — skip`)
    return "skipped (registry)"
  }
  if (required) {
    console.error(output)
    process.exit(code)
  }
  console.log(`  ! ${name}@${ver}  publish failed (non-blocking)`)
  return "failed (non-blocking)"
}

async function published(name: string, version: string): Promise<boolean> {
  const { code } = await run(`npm view ${name}@${version} version`)
  return code === 0
}

async function updateHomebrew(): Promise<void> {
  const tap = process.env.HOMEBREW_TAP_REPO
  if (!tap || !GH_TOKEN) {
    console.log("  skipped (HOMEBREW_TAP_REPO or GITHUB_TOKEN not set)")
    return
  }
  const assets: Record<string, string> = {
    "darwin-arm64": "friday-darwin-arm64",
    "darwin-x64": "friday-darwin-x64",
    "linux-arm64": "friday-linux-arm64",
    "linux-x64": "friday-linux-x64",
  }
  const shas: Record<string, string> = {}
  for (const [tgt, asset] of Object.entries(assets)) {
    const url = `https://github.com/${FRIDAY_REPO}/releases/download/v${VERSION}/${asset}`
    const { code, output } = await run(`curl -fsSL '${url}' | shasum -a 256`)
    if (code !== 0) {
      console.log(`  ! could not fetch ${asset} sha — skipping homebrew update`)
      return
    }
    shas[tgt] = output.trim().split(/\s+/)[0] ?? ""
  }
  const tpl = await readFile(path.join(ROOT, "packaging/homebrew/friday.rb"), "utf8")
  const rendered = tpl
    .replace(/version "[^"]+"/, `version "${VERSION}"`)
    .replace(/REPLACE_WITH_DARWIN_ARM64_SHA256/g, shas["darwin-arm64"] ?? "")
    .replace(/REPLACE_WITH_DARWIN_X64_SHA256/g, shas["darwin-x64"] ?? "")
    .replace(/REPLACE_WITH_LINUX_ARM64_SHA256/g, shas["linux-arm64"] ?? "")
    .replace(/REPLACE_WITH_LINUX_X64_SHA256/g, shas["linux-x64"] ?? "")
  await openOrUpdateFile(tap, "Formula/friday.rb", rendered, `friday ${VERSION}`, `chore: bump friday to ${VERSION}`)
  console.log(`  ✓ homebrew tap updated: ${tap}`)
}

async function updateScoop(): Promise<void> {
  const bucket = process.env.SCOOP_BUCKET_REPO
  if (!bucket || !GH_TOKEN) {
    console.log("  skipped (SCOOP_BUCKET_REPO or GITHUB_TOKEN not set)")
    return
  }
  const url = `https://github.com/${FRIDAY_REPO}/releases/download/v${VERSION}/friday-win32-x64.exe`
  const { code, output } = await run(`curl -fsSL '${url}' | shasum -a 256`)
  if (code !== 0) {
    console.log("  ! could not fetch friday-win32-x64.exe — skipping scoop update")
    return
  }
  const sha = output.trim().split(/\s+/)[0]
  const tpl = JSON.parse(await readFile(path.join(ROOT, "packaging/scoop/friday.json"), "utf8"))
  tpl.version = VERSION
  tpl.architecture["64bit"].url = `${url}#/friday.exe`
  tpl.architecture["64bit"].hash = sha
  await openOrUpdateFile(
    bucket,
    "friday.json",
    `${JSON.stringify(tpl, null, 2)}\n`,
    `friday ${VERSION}`,
    `chore: bump friday to ${VERSION}`,
  )
  console.log(`  ✓ scoop bucket updated: ${bucket}`)
}

async function openOrUpdateFile(
  repo: string,
  filePath: string,
  content: string,
  title: string,
  commitMessage: string,
): Promise<void> {
  const [owner, name] = repo.split("/")
  const apiBase = `https://api.github.com/repos/${owner}/${name}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${GH_TOKEN}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const j = async (res: Response) => (res.status >= 400 ? null : res.json())

  const repoInfo: any = await j(await fetch(apiBase, { headers }))
  if (!repoInfo) {
    console.log(`  ! could not read ${repo} (check GITHUB_TOKEN scopes)`)
    return
  }
  const branch = repoInfo.default_branch
  const branchRef: any = await j(await fetch(`${apiBase}/git/ref/heads/${branch}`, { headers }))
  if (!branchRef) {
    console.log(`  ! could not read default branch on ${repo}`)
    return
  }
  const headSha: string = branchRef.object.sha

  // Create branch (idempotent: 422 = already exists, fine)
  const branchName = `friday-${VERSION}-${Date.now()}`
  const refRes = await fetch(`${apiBase}/git/refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: headSha }),
  })
  if (refRes.status >= 400 && refRes.status !== 422) {
    console.log(`  ! could not create branch ${branchName} on ${repo} (${refRes.status})`)
    return
  }

  // Look up existing file sha (if any) so the update is a real update
  const existing: any = await j(
    await fetch(`${apiBase}/contents/${encodeURIComponent(filePath)}?ref=${branch}`, { headers }),
  )
  const putRes = await fetch(`${apiBase}/contents/${encodeURIComponent(filePath)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: branchName,
      sha: existing?.sha,
    }),
  })
  if (putRes.status >= 400) {
    console.log(`  ! could not commit ${filePath} on ${repo} (${putRes.status})`)
    return
  }

  // Open a PR (422 = a PR already exists for this head/base, fine)
  const prRes = await fetch(`${apiBase}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title,
      head: branchName,
      base: branch,
      body: `Automated bump for friday v${VERSION}.`,
      maintainer_can_modify: true,
    }),
  })
  if (prRes.status === 422) console.log(`  · PR already exists for this version — no-op`)
  else if (prRes.status >= 400) console.log(`  ! could not open PR on ${repo} (${prRes.status})`)
}

// ───────────────────────── shell helper ─────────────────────────

async function run(cmd: string, cwd = ROOT): Promise<{ code: number; output: string }> {
  const proc = Bun.spawnSync(["bash", "-c", cmd], { cwd, env: process.env })
  return { code: proc.exitCode, output: proc.stdout.toString() + proc.stderr.toString() }
}

async function runOk(cmd: string, cwd = ROOT): Promise<void> {
  const { code, output } = await run(cmd, cwd)
  if (code !== 0) throw new Error(`${cmd} failed in ${cwd}: ${output}`)
}
