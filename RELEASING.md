# Releasing Friday Code

Friday ships as a **self-contained binary** (Bun runtime + OpenTUI native renderer
embedded), distributed via npm, Homebrew, Scoop, a curl script, and GitHub Releases.

> **The whole release is one command:** `git tag v2.0.2 && git push origin v2.0.2`
>
> Versions are **derived from the git tag**, never hardcoded. There is no
> `bump` step, no manifest editing, nothing to forget.

## One-time setup

1. **npm**: create an automation token on npmjs.com with publish scope on
   `friday-code` and all 8 `friday-code-<target>` packages. Add it as the repo
   secret **`NPM_TOKEN`** (Settings → Secrets and variables → Actions).
2. **Release approval gate**: Settings → Environments → create environment named
   **`release`** → add yourself as a required reviewer. The `npm-publish` job
   waits on it before going live.
3. **Homebrew tap** (optional): create repo `katipally/homebrew-tap` with an
   empty `Formula/` directory. The release workflow opens a PR that updates
   `Formula/friday.rb`.
4. **Scoop bucket** (optional, Windows): create repo `katipally/scoop-bucket`
   with an empty root. The release workflow opens a PR that updates `friday.json`.
5. **Cross-repo PR token**: create a PAT with `repo` scope and add it as
   **`RELEASE_TOKEN`**. The default `GITHUB_TOKEN` can't open PRs on other repos.
6. Make `main` the default branch and turn on branch protection requiring CI.

## Cut a release

```bash
# 1. (optional) move entries from [Unreleased] in CHANGELOG.md to a new section
#    Each GitHub Release also gets auto-generated notes from merged PRs.

# 2. commit any pending changes
git add -A
git commit -m "release prep"  # or skip if nothing to commit

# 3. tag + push, that's the whole release
git tag v2.0.2
git push origin v2.0.2
```

The release workflow automatically:

1. **builds** every target on a native runner (one matrix of 8)
2. creates a **GitHub Release** with all binaries + `SHASUMS256.txt`
3. waits for your **manual approval** in the `release` environment
4. publishes every `friday-code-<target>` package + the `friday-code` launcher
   to npm with provenance
5. opens a **PR on `katipally/homebrew-tap`** with the new formula + SHA256s
6. opens a **PR on `katipally/scoop-bucket`** with the new manifest + hash

The `VERSION` everywhere (binary `--version`, npm `package.json` files, Homebrew
formula, Scoop manifest) is stamped from the tag, so you cannot accidentally have
mismatched versions.

### Failure handling

- **Stable 5** (darwin × 2, linux × 2, win-x64) must all pass; if any fail,
  the GitHub Release and npm publish are blocked.
- **Musl (linux x64/arm64)** and **Windows ARM64** are best-effort. If they
  fail, the release still proceeds; they're simply omitted from the published
  artifacts.
- npm publish is **idempotent**: if a `package@version` is already on npm
  (e.g. from a partial retry), it's skipped rather than failing.

### Why artifacts are tarballs, not directories

Each `build` job tars `dist/npm/<target>/` into `dist/npm-<target>.tar.gz`
and uploads that single file as the `npm-<target>` artifact. The `npm-publish`
job downloads each tarball with `gh run download` and untars it into
`dist/npm/`.

This avoids `actions/upload-artifact`'s well-known flattening behaviour:
when you upload a directory, the artifact's zip contains the directory's
contents at the root (the directory name is stripped). All 8 `npm-<target>`
zips then have **identical** top-level paths (`package.json`, `bin/`), and
`download-artifact`'s `merge-multiple: true` happily overwrites them with
"last writer wins", silently producing an empty `dist/npm/<target>/` for 7
of the 8 platforms. This bug broke every v2.0.x release between 2026-06-18
and 2026-06-19.

A tarball is one file with the structure preserved on extract; the loop
in `npm-publish` downloads each one to its own subdir. Don't "simplify"
this back to `actions/download-artifact@v4` + `merge-multiple: true` unless
you also add per-artifact renaming to the upload step.

To retry a tag manually:

```
GitHub Actions → Release → Run workflow → tag: v2.0.2
```

## Pipeline

```
  git tag v2.0.2
       │
       ▼
  ┌──────────────┐
  │  version     │  scripts/version.ts → VERSION=2.0.2, TAG=v2.0.2
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │  build (×8)  │  darwin-arm64 darwin-x64 linux-x64 linux-arm64 win32-x64
  │              │  linux-x64-musl  linux-arm64-musl  win32-arm64
  │              │  (musl + win-arm are best-effort)
  │              │  Each stamps FRIDAY_VERSION=2.0.2 into its binary.
  └──────┬───────┘
         │  5 stable must succeed
         ▼
  ┌──────────────┐
  │  release     │  GitHub Release + SHASUMS256.txt
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │  npm-publish │  ⏸  manual approve (release env)
  │              │  → rebuilds launcher package (stamped 2.0.2)
  │              │  → npm × 9 packages (8 platform + 1 launcher)
  │              │  → PR on homebrew-tap (formula with sha256s from the release)
  │              │  → PR on scoop-bucket  (manifest with hash from the release)
  └──────────────┘
```

## Platform targets

| npm package | Platform | Runner |
|---|---|---|
| `friday-code-darwin-arm64` | macOS Apple Silicon | `macos-15` |
| `friday-code-darwin-x64`   | macOS Intel         | `macos-15-intel` |
| `friday-code-linux-x64`    | Linux glibc x64     | `ubuntu-latest` |
| `friday-code-linux-arm64`  | Linux glibc ARM64   | `ubuntu-24.04-arm` |
| `friday-code-linux-x64-musl`  | Linux musl x64   | `ubuntu-latest` (Alpine) |
| `friday-code-linux-arm64-musl`| Linux musl ARM64 | `ubuntu-24.04-arm` (Alpine) |
| `friday-code-windows-x64`  | Windows x64         | `windows-latest` |
| `friday-code-windows-arm64`| Windows ARM64       | `windows-11-arm` |

The launcher (`friday-code`) detects the current platform (including musl vs
glibc on Linux) at install time and loads the correct optional dependency.

## Manual / local build (for testing or fallback)

```bash
bun install --frozen-lockfile

# Host target, no FRIDAY_VERSION, binary reports "dev"
bun run scripts/build.ts --target=darwin-arm64

# Explicit version (what the release workflow does)
FRIDAY_VERSION=v2.0.2 bun run scripts/build.ts --target=darwin-arm64

# Just the launcher npm package (no native binaries)
FRIDAY_VERSION=v2.0.2 bun run scripts/build.ts --target=__launcher__
```

Publish manually:

```bash
npm login
VERSION=2.0.2 NODE_AUTH_TOKEN=… GITHUB_TOKEN=… \
  HOMEBREW_TAP_REPO=katipally/homebrew-tap \
  SCOOP_BUCKET_REPO=katipally/scoop-bucket \
  bun run scripts/publish.ts
```

## Where it lands

| Channel        | Install command                                            |
|----------------|-----------------------------------------------------------|
| npm            | `npm install -g friday-code`                              |
| curl           | `curl -fsSL .../main/install.sh \| sh`                    |
| Homebrew       | `brew install katipally/tap/friday`                       |
| Scoop (Win)    | `scoop bucket add katipally …; scoop install friday`      |
| GitHub Release | direct binary download + checksums                        |

## Post-release smoke test

On a clean machine (or VM) per OS:

```bash
npm install -g friday-code && friday --version && friday
```

Docker/Alpine (musl) smoke test:

```bash
docker run --rm node:22-alpine sh -c "npm install -g friday-code && friday --version"
```

## Future channels (as demand appears)

AUR (Arch), Chocolatey (Windows), Nixpkgs.
