/** Lightweight, local-only git helpers (status, diff, commit, worktrees). No network. */
import fs from "node:fs"
import path from "node:path"

/** Is `cwd` inside a git repo? An fs walk for `.git` — no subprocess, so it's safe to call on the hot
 * path and avoids spawning `git` (and holding a cwd lock) in dirs that aren't repos. */
export function isGitRepo(cwd: string): boolean {
  let dir = path.resolve(cwd)
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return true
    const parent = path.dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

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

/** The current commit (HEAD) sha, or null outside a repo / on an unborn branch. */
export async function gitRevParse(cwd: string, ref = "HEAD"): Promise<string | null> {
  const res = await run(cwd, ["rev-parse", "--verify", "--quiet", ref])
  const sha = res.out.trim()
  return res.ok && sha ? sha : null
}

/**
 * Everything changed since `base` (a commit captured at session start): committed AND uncommitted AND
 * deletions, in one list — `git diff <base>` compares that commit straight to the working tree, so
 * intermediate commits collapse into the net change. Untracked files are appended as adds. This is the
 * full "what happened this session" footprint, robust to commits the snapshot tracker would drop.
 */
export async function gitSessionChanges(cwd: string, base: string): Promise<GitFile[]> {
  const numstat = await run(cwd, ["diff", "--numstat", base])
  const counts = new Map<string, { added: number; removed: number }>()
  for (const line of numstat.out.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (!m) continue
    // Renames render as "old => new" or "{a => b}/c"; take the resulting path's last token.
    const p = m[3]!.includes(" => ")
      ? m[3]!
          .replace(/\{.*? => (.*?)\}/, "$1")
          .split(" => ")
          .pop()!
          .trim()
      : m[3]!
    counts.set(p, { added: m[1] === "-" ? 0 : Number(m[1]), removed: m[2] === "-" ? 0 : Number(m[2]) })
  }
  const nameStatus = await run(cwd, ["diff", "--name-status", base])
  const files: GitFile[] = []
  const seen = new Set<string>()
  for (const line of nameStatus.out.split("\n")) {
    if (!line.trim()) continue
    const parts = line.split("\t")
    const code = parts[0]!.trim()
    const status = code[0]! // M, A, D, R, C, T…
    const p = (status === "R" || status === "C" ? parts[2] : parts[1])?.trim()
    if (!p || seen.has(p)) continue
    seen.add(p)
    const c = counts.get(p) ?? { added: 0, removed: 0 }
    files.push({ path: p, status: status === "R" || status === "C" ? "A" : status, added: c.added, removed: c.removed })
  }
  // Untracked (new, never-added) files aren't in the diff — surface them as adds.
  const untracked = await run(cwd, ["ls-files", "--others", "--exclude-standard"])
  for (const line of untracked.out.split("\n")) {
    const p = line.trim()
    if (!p || seen.has(p)) continue
    seen.add(p)
    files.push({ path: p, status: "A", added: 0, removed: 0 })
  }
  return files
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
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
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
      cur.branch = line
        .slice(7)
        .trim()
        .replace(/^refs\/heads\//, "")
    }
  }
  if (cur) out.push(cur)
  return out
}
