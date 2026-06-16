const IGNORE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage)(\/|$)/

/** List project files (relative paths) for @-mention autocomplete. */
export async function listProjectFiles(cwd: string): Promise<string[]> {
  const out: string[] = []
  try {
    const glob = new Bun.Glob("**/*")
    for await (const f of glob.scan({ cwd, onlyFiles: true, dot: false })) {
      if (IGNORE.test(f)) continue
      out.push(f)
      if (out.length >= 3000) break
    }
  } catch {
    /* ignore */
  }
  out.sort()
  return out
}
