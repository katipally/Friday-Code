import path from "node:path"

const IGNORE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage)(\/|$)/

/** List files across all workspace roots (paths relative to the primary root) for @-mentions. */
export async function listProjectFiles(roots: string[]): Promise<string[]> {
  const primary = roots[0]
  if (!primary) return []
  const out = new Set<string>()
  try {
    const glob = new Bun.Glob("**/*")
    for (const root of roots) {
      for await (const f of glob.scan({ cwd: root, onlyFiles: true, dot: false })) {
        if (IGNORE.test(f)) continue
        const rel = path.relative(primary, path.join(root, f))
        out.add(rel || f)
        if (out.size >= 4000) break
      }
      if (out.size >= 4000) break
    }
  } catch {
    /* ignore */
  }
  return [...out].sort()
}
