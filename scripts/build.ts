#!/usr/bin/env bun

// Build self-contained Friday binaries and assemble the npm publish tree.
//
// `bun build --compile` embeds the Bun runtime AND the OpenTUI native renderer
// (its bun entrypoint imports the lib with `{ type: "file" }`, which the bundler
// inlines). Each binary therefore needs the matching platform's native lib at
// build time, so cross-compiling is unreliable — build each target on a native
// runner (the release CI matrix does exactly this).
//
// Usage:
//   bun run scripts/build.ts                 # build the host target only
//   bun run scripts/build.ts --target=linux-x64
//   bun run scripts/build.ts --all           # attempt every target (needs all native libs)
//
// Output (dist/):
//   npm/friday-code/                 the launcher package (bin/friday.mjs + optionalDependencies)
//   npm/friday-code-<target>/        one package per platform, containing the binary
//   bin/friday-<target>[.exe]        raw binaries for GitHub Release attachments
//   bin/SHASUMS256.txt               checksums for the raw binaries

import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const ENTRY = path.join(ROOT, "packages/cli/src/index.tsx")
const DIST = path.join(ROOT, "dist")
const SHIM_SRC = path.join(ROOT, "packaging/friday-code")
const PLATFORM_README_SRC = path.join(ROOT, "packaging/platforms/README.md")

type Target = {
  name: string
  bun: string
  os: string
  cpu: string
  win: boolean
  npmPackageName: string
}
const TARGETS: Target[] = [
  {
    name: "darwin-arm64",
    bun: "bun-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
    win: false,
    npmPackageName: "friday-code-darwin-arm64",
  },
  {
    name: "darwin-x64",
    bun: "bun-darwin-x64",
    os: "darwin",
    cpu: "x64",
    win: false,
    npmPackageName: "friday-code-darwin-x64",
  },
  {
    name: "linux-x64",
    bun: "bun-linux-x64",
    os: "linux",
    cpu: "x64",
    win: false,
    npmPackageName: "friday-code-linux-x64",
  },
  {
    name: "linux-arm64",
    bun: "bun-linux-arm64",
    os: "linux",
    cpu: "arm64",
    win: false,
    npmPackageName: "friday-code-linux-arm64",
  },
  // Musl variants for Alpine Linux and minimal Docker images (statically linked).
  // Must be built inside a musl environment (see release.yml Alpine container jobs).
  {
    name: "linux-x64-musl",
    bun: "bun-linux-x64-musl",
    os: "linux",
    cpu: "x64",
    win: false,
    npmPackageName: "friday-code-linux-x64-musl",
  },
  {
    name: "linux-arm64-musl",
    bun: "bun-linux-arm64-musl",
    os: "linux",
    cpu: "arm64",
    win: false,
    npmPackageName: "friday-code-linux-arm64-musl",
  },
  {
    name: "win32-x64",
    bun: "bun-windows-x64",
    os: "win32",
    cpu: "x64",
    win: true,
    npmPackageName: "friday-code-windows-x64",
  },
  {
    name: "win32-arm64",
    bun: "bun-windows-arm64",
    os: "win32",
    cpu: "arm64",
    win: true,
    npmPackageName: "friday-code-windows-arm64",
  },
]

const args = process.argv.slice(2)
const wanted = args.filter((a) => a.startsWith("--target=")).map((a) => a.slice("--target=".length))
const hostName = `${process.platform}-${process.arch}`

let targets: Target[]
let launcherOnly = false
if (wanted[0] === "__launcher__") {
  // Special mode: build only the launcher npm package (no native binaries).
  // Used by the `npm-publish` job so the launcher is not tied to any specific
  // native runner. The launcher assembly below still runs; only the per-target
  // binary loop is skipped.
  launcherOnly = true
  targets = []
} else if (args.includes("--all")) {
  targets = TARGETS
} else if (wanted.length) {
  targets = TARGETS.filter((t) => wanted.includes(t.name))
} else {
  targets = TARGETS.filter((t) => t.name === hostName)
}

if (!launcherOnly && targets.length === 0) {
  console.error(`No build targets selected (host=${hostName}). Known: ${TARGETS.map((t) => t.name).join(", ")}.`)
  process.exit(1)
}

const shimPkg = JSON.parse(await readFile(path.join(SHIM_SRC, "package.json"), "utf8"))
// FRIDAY_VERSION is set by the release workflow from the git tag. Locally (no
// env), default to "dev" so `bun run scripts/build.ts` produces a binary that
// self-reports as "dev" — matching the source-mode fallback in cli/src/index.tsx.
const RAW_VERSION: string = process.env.FRIDAY_VERSION ?? "dev"
const VERSION = RAW_VERSION.replace(/^v(?=\d)/, "")
if (VERSION !== "dev" && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(VERSION)) {
  console.error(`Invalid release version "${RAW_VERSION}". Expected semver like 2.0.0 or v2.0.0.`)
  process.exit(1)
}
console.log(
  `Friday build · version ${VERSION} · targets: ${launcherOnly ? "(launcher only)" : targets.map((t) => t.name).join(", ")}\n`,
)

await rm(DIST, { recursive: true, force: true })
await mkdir(path.join(DIST, "bin"), { recursive: true })

// --- launcher package (friday-code) ---
const shimOut = path.join(DIST, "npm/friday-code")
await mkdir(path.join(shimOut, "bin"), { recursive: true })
await copyFile(path.join(SHIM_SRC, "bin/friday.mjs"), path.join(shimOut, "bin/friday.mjs"))
shimPkg.version = VERSION
for (const dep of Object.keys(shimPkg.optionalDependencies ?? {})) shimPkg.optionalDependencies[dep] = VERSION
await writeFile(path.join(shimOut, "package.json"), `${JSON.stringify(shimPkg, null, 2)}\n`)
for (const f of ["README.md", "LICENSE"]) {
  if (existsSync(path.join(ROOT, f))) await copyFile(path.join(ROOT, f), path.join(shimOut, f))
}

// --- per-target binaries + platform packages ---
// Each per-target npm package lives in its own target-named subdir
// (e.g. dist/npm/darwin-arm64/package.json) so that the upload step in the
// release workflow preserves the target name in the artifact, and the
// download step in npm-publish restores the same structure.
const checksums: string[] = []
for (const t of targets) {
  console.log(`▸ building ${t.name} …`)
  const pkgDir = path.join(DIST, `npm/${t.name}`)
  await mkdir(path.join(pkgDir, "bin"), { recursive: true })
  const outBase = path.join(pkgDir, "bin", "friday")

  const proc = Bun.spawnSync(
    [
      "bun",
      "build",
      ENTRY,
      "--compile",
      `--target=${t.bun}`,
      // Don't read the user's cwd bunfig.toml at runtime: it's only needed for the
      // dev-time Solid JSX transform, and honoring it would let a cwd config inject
      // preload scripts into Friday's process. Frozen, deterministic behavior.
      "--no-compile-autoload-bunfig",
      "--define",
      `__FRIDAY_VERSION__="${VERSION}"`,
      "--outfile",
      outBase,
    ],
    { stdout: "inherit", stderr: "inherit", cwd: ROOT },
  )
  if (proc.exitCode !== 0) {
    console.error(`\nbuild failed for ${t.name} (exit ${proc.exitCode}).`)
    if (t.name !== hostName)
      console.error("Cross-compiling needs that platform's native OpenTUI lib; build on a native runner.")
    process.exit(1)
  }

  const producedExe = `${outBase}${t.win ? ".exe" : ""}`
  await writeFile(
    path.join(pkgDir, "package.json"),
    `${JSON.stringify(
      {
        name: t.npmPackageName,
        version: VERSION,
        description: `Prebuilt friday binary for ${t.name}.`,
        license: "MIT",
        author: shimPkg.author,
        homepage: shimPkg.homepage,
        repository: shimPkg.repository,
        bugs: shimPkg.bugs,
        keywords: shimPkg.keywords,
        os: [t.os],
        cpu: [t.cpu],
        files: ["bin/", "README.md", "LICENSE"],
      },
      null,
      2,
    )}\n`,
  )

  // Per-platform README so the npm package page renders useful content
  // instead of falling back to the auto-generated package.json dump.
  const platformReadmeTpl = await readFile(PLATFORM_README_SRC, "utf8")
  await writeFile(
    path.join(pkgDir, "README.md"),
    platformReadmeTpl.replace(/\{\{TARGET\}\}/g, t.name),
  )
  await copyFile(path.join(ROOT, "LICENSE"), path.join(pkgDir, "LICENSE"))

  // Raw binary for GitHub Release + checksum.
  const releaseName = `friday-${t.name}${t.win ? ".exe" : ""}`
  const rawPath = path.join(DIST, "bin", releaseName)
  await copyFile(producedExe, rawPath)
  const hash = new Bun.CryptoHasher("sha256").update(await readFile(rawPath)).digest("hex")
  checksums.push(`${hash}  ${releaseName}`)
  console.log(`  ✓ ${releaseName}`)
}

if (!launcherOnly) {
  await writeFile(path.join(DIST, "bin/SHASUMS256.txt"), `${checksums.join("\n")}\n`)
}
console.log(`\nDone → ${path.relative(ROOT, DIST)}/  (npm packages in dist/npm, binaries in dist/bin)`)
