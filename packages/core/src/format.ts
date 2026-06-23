import fs from "node:fs"
import path from "node:path"

/**
 * Best-effort auto-format of a single file after an edit. Detects a formatter from the file
 * extension + what the project already uses, runs it, and stays silent on any failure —
 * formatting must never break the edit flow.
 *
 * ponytail: attempt-and-swallow instead of probing for installed binaries; if the tool isn't
 * there the spawn just fails and we move on. Upgrade to a cached capability check only if it
 * shows up in profiles.
 */

type Cmd = (file: string) => string[]

const BIOME: Cmd = (f) => ["biome", "format", "--write", f]
const PRETTIER: Cmd = (f) => ["prettier", "--write", f]

function pickCmd(cwd: string, ext: string): Cmd | undefined {
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
    case ".json":
    case ".jsonc":
    case ".css":
    case ".md":
      // Prefer whatever the repo is configured for.
      return hasFile(cwd, ["biome.json", "biome.jsonc"]) ? BIOME : PRETTIER
    case ".py":
      return (f) => ["ruff", "format", f]
    case ".go":
      return (f) => ["gofmt", "-w", f]
    case ".rs":
      return (f) => ["rustfmt", f]
    default:
      return undefined
  }
}

function hasFile(cwd: string, names: string[]): boolean {
  return names.some((n) => {
    try {
      return fs.existsSync(path.join(cwd, n))
    } catch {
      return false
    }
  })
}

/** Resolve a project-local node_modules/.bin/<tool> by walking up from cwd; else fall back to the bare name. */
function resolveBin(cwd: string, tool: string): string {
  let dir = cwd
  for (let i = 0; i < 12; i++) {
    const bin = path.join(dir, "node_modules", ".bin", tool)
    if (fs.existsSync(bin)) return bin
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return tool
}

/** Format `absPath` in place. `enabled` is config.formatter (undefined = on, false = off). */
export async function formatFile(cwd: string, absPath: string, enabled?: boolean): Promise<void> {
  if (enabled === false) return
  const cmd = pickCmd(cwd, path.extname(absPath).toLowerCase())
  if (!cmd) return
  const argv = cmd(absPath)
  argv[0] = resolveBin(cwd, argv[0]!)
  try {
    const proc = Bun.spawn(argv, { cwd, stdout: "ignore", stderr: "ignore" })
    // Don't let a hung formatter stall the turn.
    const timer = setTimeout(() => proc.kill(), 5000)
    await proc.exited
    clearTimeout(timer)
  } catch {
    /* formatter missing or failed — leave the file as the model wrote it */
  }
}
