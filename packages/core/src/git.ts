/** Lightweight, local-only git helpers (status, diff, commit). No network. */

export interface GitFile {
  path: string
  status: string // "M" | "A" | "D" | "?" | "R" ...
  added: number
  removed: number
}
export interface GitStatus {
  repo: boolean
  branch: string
  dirty: boolean
  files: GitFile[]
}

async function run(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" })
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    return { ok: code === 0, out }
  } catch {
    return { ok: false, out: "" }
  }
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const branchRes = await run(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (!branchRes.ok) return { repo: false, branch: "", dirty: false, files: [] }
  const branch = branchRes.out.trim() || "HEAD"

  const numstat = await run(cwd, ["diff", "--numstat", "HEAD"])
  const counts = new Map<string, { added: number; removed: number }>()
  for (const line of numstat.out.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (m) counts.set(m[3]!, { added: m[1] === "-" ? 0 : Number(m[1]), removed: m[2] === "-" ? 0 : Number(m[2]) })
  }

  const porcelain = await run(cwd, ["status", "--porcelain"])
  const files: GitFile[] = []
  for (const line of porcelain.out.split("\n")) {
    if (!line.trim()) continue
    const status = line.slice(0, 2).trim() || "?"
    const file = line.slice(3).trim()
    const c = counts.get(file) ?? { added: 0, removed: 0 }
    files.push({ path: file, status: status[0]!, added: c.added, removed: c.removed })
  }
  return { repo: true, branch, dirty: files.length > 0, files }
}

/** The committed (HEAD) contents of a tracked file, or null if it's not in HEAD. */
export async function gitShowHead(cwd: string, relPath: string): Promise<string | null> {
  const res = await run(cwd, ["show", `HEAD:${relPath}`])
  return res.ok ? res.out : null
}

/** Whether git tracks `relPath` (vs. an untracked/new file). */
export async function gitIsTracked(cwd: string, relPath: string): Promise<boolean> {
  const res = await run(cwd, ["ls-files", "--error-unmatch", "--", relPath])
  return res.ok
}

/** The working-tree diff (staged + unstaged), truncated for prompting. */
export async function gitDiff(cwd: string, maxChars = 12_000): Promise<string> {
  const res = await run(cwd, ["diff", "HEAD"])
  return res.out.slice(0, maxChars)
}

/** Stage everything and commit. Returns the short hash or an error string. */
export async function gitCommitAll(cwd: string, message: string): Promise<{ ok: boolean; info: string }> {
  const add = await run(cwd, ["add", "-A"])
  if (!add.ok) return { ok: false, info: "git add failed" }
  try {
    const proc = Bun.spawn(["git", "commit", "-m", message], { cwd, stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (code !== 0) return { ok: false, info: (err || out).trim() || "git commit failed" }
    const hash = await run(cwd, ["rev-parse", "--short", "HEAD"])
    return { ok: true, info: hash.out.trim() }
  } catch (e: any) {
    return { ok: false, info: e?.message ?? "git commit failed" }
  }
}
