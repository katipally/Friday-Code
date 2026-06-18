# Releasing Friday Code

This is the maintainer runbook for cutting a release and publishing to every channel.
Friday ships as a **self-contained binary** (Bun runtime + OpenTUI native renderer embedded),
distributed via npm, Homebrew, Scoop, a curl script, and GitHub Releases.

## One-time setup

1. **npm**: you must own `friday-code` (you do). Create an automation token and add it as the
   repo secret **`NPM_TOKEN`** (Settings → Secrets and variables → Actions).
2. **Release approval gate** (optional): create a GitHub Environment named **`release`**
   (Settings → Environments) and add yourself as a required reviewer. The `npm-publish` job waits
   on it, so you can add a manual approval step before packages hit npm.
3. **Homebrew tap** (optional but recommended): create repo `katipally/homebrew-tap`, copy
   `packaging/homebrew/friday.rb` to `Formula/friday.rb`.
4. **Scoop bucket** (optional, Windows): create repo `katipally/scoop-bucket`, copy
   `packaging/scoop/friday.json` into it.
5. Make `main` the default branch (Settings → General) and add branch protection requiring CI.

## Versioning

- This release line is **2.x** (the npm name `friday-code` already had an unrelated `1.x`).
- Bump the version in: root `package.json`, every `packages/*/package.json`, and
  `packaging/friday-code/package.json`. The build stamps the binary and all generated platform
  packages from `FRIDAY_VERSION`; CI accepts a tag like `v2.0.0` and writes npm-safe version
  `2.0.0`.
- Update `CHANGELOG.md`.

## Cut a release

Publishing is **fully automatic** when you push a version tag:

```bash
# from a clean main with everything committed and version bumped
git tag v2.0.1
git push origin v2.0.1          # triggers build → GitHub Release → npm publish
```

The release workflow automatically:

1. Builds each target on a native runner (see platform table below) and smoke-tests `--version`.
2. Creates a **GitHub Release** with all binaries + `SHASUMS256.txt`.
3. Publishes all platform packages and the `friday-code` launcher to npm with provenance.

The publish step is **idempotent** — if a platform package version is already on npm (e.g. from
a previous partial run), it is skipped rather than failing. This means reruns and retries always
complete successfully.

To rerun or manually trigger for a specific tag (e.g. after a flaky runner):

```
GitHub Actions → Release workflow → Run workflow → tag: v2.0.1
```

## Platform targets

| npm package | Platform | Runner |
|---|---|---|
| `friday-code-darwin-arm64` | macOS Apple Silicon | `macos-14` |
| `friday-code-darwin-x64` | macOS Intel | `macos-15-intel` |
| `friday-code-linux-x64` | Linux glibc x64 | `ubuntu-latest` |
| `friday-code-linux-arm64` | Linux glibc ARM64 | `ubuntu-24.04-arm` |
| `friday-code-linux-x64-musl` | Linux musl x64 (Alpine/Docker) | `ubuntu-latest` + Alpine container |
| `friday-code-linux-arm64-musl` | Linux musl ARM64 (Alpine/Docker) | `ubuntu-24.04-arm` + Alpine container |
| `friday-code-windows-x64` | Windows x64 | `windows-latest` |
| `friday-code-windows-arm64` | Windows ARM64 | `windows-11-arm` |

The launcher (`friday-code`) detects the current platform (including musl vs glibc on Linux) at
install time and loads the correct optional dependency.

## Manual / local build (for testing or fallback)

```bash
bun install --frozen-lockfile
FRIDAY_VERSION=2.0.1 bun run scripts/build.ts --target=darwin-arm64   # host target
# or --all on a machine that has every platform's native OpenTUI lib (rare)

dist/bin/friday-<target>           # raw binaries + dist/bin/SHASUMS256.txt
dist/npm/friday-code               # launcher package
dist/npm/friday-code-<target>      # platform packages
```

Publish manually (platform packages first, then the launcher):

```bash
npm login
for d in dist/npm/friday-code-*; do npm publish "$d" --access public; done
npm publish dist/npm/friday-code --access public
```

## Where it lands

| Channel        | Install command                                            |
|----------------|-----------------------------------------------------------|
| npm            | `npm install -g friday-code`                               |
| curl           | `curl -fsSL .../main/install.sh \| sh`                     |
| Homebrew       | `brew install katipally/tap/friday`                        |
| Scoop (Win)    | `scoop bucket add katipally …; scoop install friday`       |
| GitHub Release | direct binary download + checksums                        |

## Post-release smoke test

On a clean machine (or VM) per OS:

```bash
npm install -g friday-code && friday --version && friday   # connects via /model, run a prompt
```

Docker/Alpine (musl) smoke test:

```bash
docker run --rm node:22-alpine sh -c "npm install -g friday-code && friday --version"
```

## Future channels (as demand appears)

AUR (Arch), Chocolatey (Windows), Nixpkgs.
