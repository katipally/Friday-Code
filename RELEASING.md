# Releasing Friday Code

This is the maintainer runbook for cutting a release and publishing to every channel.
Friday ships as a **self-contained binary** (Bun runtime + OpenTUI native renderer embedded),
distributed via npm, Homebrew, Scoop, a curl script, and GitHub Releases.

## One-time setup

1. **npm**: you must own `friday-code` (you do). Create an automation token and add it as the
   repo secret **`NPM_TOKEN`** (Settings → Secrets and variables → Actions).
2. **Release approval gate**: create a GitHub Environment named **`release`** (Settings →
   Environments) and add yourself as a required reviewer. The `npm-publish` job waits on it, so
   nothing reaches npm without your click.
3. **Homebrew tap** (optional but recommended): create repo `katipally/homebrew-tap`, copy
   `packaging/homebrew/friday.rb` to `Formula/friday.rb`.
4. **Scoop bucket** (optional, Windows): create repo `katipally/scoop-bucket`, copy
   `packaging/scoop/friday.json` into it.
5. Make `main` the default branch (Settings → General) and add branch protection requiring CI.

## Versioning

- This release line is **2.x** (the npm name `friday-code` already had an unrelated `1.x`).
- Bump the version in: root `package.json`, every `packages/*/package.json`, and
  `packaging/friday-code/package.json`. The build stamps the binary and all generated platform
  packages from `FRIDAY_VERSION` (the git tag in CI).
- Update `CHANGELOG.md`.

## Cut a release (automated path — recommended)

```bash
# from a clean main with everything committed
git tag v2.0.0
git push origin main
git push origin v2.0.0          # triggers .github/workflows/release.yml
```

The release workflow then:

1. Builds each target on a native runner (`darwin-arm64`, `darwin-x64`, `linux-x64`,
   `linux-arm64`, `win32-x64`) and smoke-tests `--version`.
2. Creates a **GitHub Release** with all binaries + `SHASUMS256.txt`.
3. Waits for you to **approve the `release` environment**, then publishes the platform packages
   and the `friday-code` launcher to npm with provenance.

After it finishes, update the Homebrew formula and Scoop manifest hashes (from `SHASUMS256.txt`)
in their repos — or automate that as a follow-up step.

## Manual / local build (for testing or fallback)

```bash
bun install --frozen-lockfile
FRIDAY_VERSION=2.0.0 bun run scripts/build.ts --target=darwin-arm64   # host target
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

## Future channels (as demand appears)

AUR (Arch), Chocolatey (Windows), Nixpkgs.
