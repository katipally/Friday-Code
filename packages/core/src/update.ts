import { spawn } from "node:child_process"

/**
 * Self-update support. Friday ships as the npm package `friday-code` (with brew/scoop taps). We check
 * the npm registry for the latest version and, on request, run the matching package-manager upgrade.
 * Detection of the install method is heuristic (same trade-off as Claude Code's updater) and can be
 * overridden by the caller if it guesses wrong.
 */

export type InstallMethod = "npm" | "bun" | "brew" | "scoop" | "unknown"

const PKG = "friday-code"

/** Compare two semver-ish strings. Returns -1 if a<b, 0 if equal, 1 if a>b (prerelease tags ignored). */
export function compareSemver(a: string, b: string): number {
  const core = (s: string) =>
    s
      .replace(/^v/, "")
      .split(/[-+]/)[0]!
      .split(".")
      .map((n) => Number(n) || 0)
  const pa = core(a)
  const pb = core(b)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Best-effort guess of how friday was installed, from the executable/script path. */
export function detectInstallMethod(): InstallMethod {
  const p = `${process.execPath ?? ""} ${process.argv[1] ?? ""}`.toLowerCase()
  if (p.includes("homebrew") || p.includes("/cellar/")) return "brew"
  if (p.includes("scoop")) return "scoop"
  if (p.includes("/.bun/") || p.includes("\\bun\\")) return "bun"
  if (p.includes("node_modules") || p.includes("/npm/") || p.includes("\\npm\\")) return "npm"
  // ponytail: default to npm — the primary distribution channel; user can override in the modal.
  return "npm"
}

/** The upgrade command for an install method (null when unknown). */
export function updateCommand(method: InstallMethod): string[] | null {
  switch (method) {
    case "npm":
      return ["npm", "install", "-g", `${PKG}@latest`]
    case "bun":
      return ["bun", "add", "-g", `${PKG}@latest`]
    case "brew":
      return ["brew", "upgrade", "friday"]
    case "scoop":
      return ["scoop", "update", "friday"]
    default:
      return null
  }
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ""
    try {
      const ch = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
      const t = setTimeout(() => {
        try {
          ch.kill()
        } catch {
          /* already gone */
        }
        resolve({ code: 1, out })
      }, timeoutMs)
      ch.stdout?.on("data", (d) => (out += d))
      ch.stderr?.on("data", (d) => (out += d))
      ch.on("error", () => {
        clearTimeout(t)
        resolve({ code: 1, out })
      })
      ch.on("close", (code) => {
        clearTimeout(t)
        resolve({ code: code ?? 1, out })
      })
    } catch {
      resolve({ code: 1, out })
    }
  })
}

/** Latest published version from the npm registry, or null on any failure (offline, no npm, …). */
export async function getLatestVersion(pkg = PKG): Promise<string | null> {
  const { code, out } = await run("npm", ["view", pkg, "version"], 6000)
  if (code !== 0) return null
  const m = out.trim().match(/\d+\.\d+\.\d+[^\s]*/)
  return m ? m[0] : null
}

/** Run the upgrade for the (detected or given) install method. */
export async function runUpdate(
  method: InstallMethod = detectInstallMethod(),
): Promise<{ ok: boolean; output: string }> {
  const cmd = updateCommand(method)
  if (!cmd) return { ok: false, output: `unknown install method — update ${PKG} manually` }
  const { code, out } = await run(cmd[0]!, cmd.slice(1), 120_000)
  return { ok: code === 0, output: out.trim() || (code === 0 ? "updated" : "update failed") }
}
