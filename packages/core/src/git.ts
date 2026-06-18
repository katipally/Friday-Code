/** Lightweight, local-only git helpers (status, diff, commit, worktrees). No network. */
import path from "node:path"

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

/** Where a named worktree lives: a sibling dir `<parent>/.<repo>-worktrees/<name>` (keeps the main repo clean). */
async function worktreePath(cwd: string, name: string): Promise<string | null> {
  const top = await run(cwd, ["rev-parse", "--show-toplevel"])
  if (!top.ok) return null
  const root = top.out.trim()
  return path.join(path.dirname(root), `.${path.basename(root)}-worktrees`, name)
}

/** Create (or reuse) a git worktree on branch `name`. Returns its absolute path. */
export async function gitWorktreeAdd(cwd: string, name: string): Promise<{ ok: boolean; path?: string; info: string }> {
  const wt = await worktreePath(cwd, name)
  if (!wt) return { ok: false, info: "not a git repository" }
  // Try a fresh branch first; fall back to checking out an existing branch into the new worktree.
  let res = await run(cwd, ["worktree", "add", wt, "-b", name])
  if (!res.ok) res = await run(cwd, ["worktree", "add", wt, name])
  if (!res.ok) return { ok: false, info: res.out.trim() || "git worktree add failed" }
  return { ok: true, path: wt, info: `worktree on branch ${name}` }
}

/** Remove the worktree for `name` (force, to drop uncommitted changes). */
export async function gitWorktreeRemove(cwd: string, name: string): Promise<{ ok: boolean; info: string }> {
  const wt = await worktreePath(cwd, name)
  if (!wt) return { ok: false, info: "not a git repository" }
  const res = await run(cwd, ["worktree", "remove", wt, "--force"])
  return { ok: res.ok, info: res.ok ? `removed worktree ${name}` : res.out.trim() || "git worktree remove failed" }
}

/** List worktrees as { path, branch }. */
export async function gitWorktreeList(cwd: string): Promise<{ path: string; branch: string }[]> {
  const res = await run(cwd, ["worktree", "list", "--porcelain"])
  if (!res.ok) return []
  const out: { path: string; branch: string }[] = []
  let cur: { path: string; branch: string } | null = null
  for (const line of res.out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) out.push(cur)
      cur = { path: line.slice(9).trim(), branch: "" }
    } else if (line.startsWith("branch ") && cur) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, "")
    }
  }
  if (cur) out.push(cur)
  return out
}
