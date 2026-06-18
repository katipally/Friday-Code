import fs from "node:fs/promises"
import path from "node:path"
import { obj, type Tool, type ToolContext, type ToolResult } from "../tool.ts"
import { diffStats, unifiedDiff } from "../diff.ts"
import { replaceInContent, EditError } from "./editStrategies.ts"

type Hunk = { before: string; after: string }
type FilePatch = { oldPath: string; newPath: string; hunks: Hunk[] }

function stripPrefix(p: string): string {
  if (p === "/dev/null") return p
  return p.replace(/^[ab]\//, "")
}

/**
 * Parse a (possibly multi-file) unified diff into per-file hunks. Each hunk is reduced to a
 * before/after block (context + removed → before; context + added → after) so it can be applied with
 * the same whitespace-tolerant matcher the edit tools use.
 */
export function parseUnifiedDiff(patch: string): FilePatch[] {
  const lines = patch.split("\n")
  const files: FilePatch[] = []
  let cur: FilePatch | null = null
  let before: string[] = []
  let after: string[] = []
  let inHunk = false
  const flushHunk = () => {
    if (inHunk && cur) cur.hunks.push({ before: before.join("\n"), after: after.join("\n") })
    before = []
    after = []
    inHunk = false
  }
  for (const raw of lines) {
    if (raw.startsWith("--- ")) {
      flushHunk()
      if (cur) files.push(cur)
      cur = { oldPath: stripPrefix(raw.slice(4).trim().split("\t")[0]!), newPath: "", hunks: [] }
      continue
    }
    if (raw.startsWith("+++ ") && cur) {
      cur.newPath = stripPrefix(raw.slice(4).trim().split("\t")[0]!)
      continue
    }
    if (raw.startsWith("diff --git") || raw.startsWith("index ")) continue
    if (raw.startsWith("@@")) {
      flushHunk()
      inHunk = true
      continue
    }
    if (!inHunk) continue
    const tag = raw[0]
    const body = raw.slice(1)
    if (tag === " ") {
      before.push(body)
      after.push(body)
    } else if (tag === "-") {
      before.push(body)
    } else if (tag === "+") {
      after.push(body)
    } else if (tag === "\\") {
      /* "\ No newline at end of file" — ignore */
    } else if (raw === "") {
      // blank line inside a hunk is a context line with an empty body
      before.push("")
      after.push("")
    }
  }
  flushHunk()
  if (cur) files.push(cur)
  return files
}

async function readOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8")
  } catch {
    return null
  }
}

export const applyPatchTool: Tool = {
  name: "apply_patch",
  description:
    "Apply a unified diff (git-style, possibly spanning multiple files) to the workspace. Supports creating, modifying, and deleting files. Hunks are matched whitespace-tolerantly. Prefer this for multi-file or multi-hunk changes; use edit for a single targeted replacement.",
  permission: "edit",
  parameters: obj(
    {
      patch: { type: "string", description: "A unified diff (--- a/file / +++ b/file / @@ hunks). /dev/null marks create or delete." },
    },
    ["patch"],
  ),
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    let files: FilePatch[]
    try {
      files = parseUnifiedDiff(String(input.patch ?? ""))
    } catch (e: any) {
      return { output: `Error: could not parse patch: ${e.message}`, isError: true }
    }
    if (files.length === 0) return { output: "Error: no file sections found in patch", isError: true }

    const resolve = (p: string) => (path.isAbsolute(p) ? p : path.join(ctx.cwd, p))
    const rel = (p: string) => {
      const r = path.relative(ctx.cwd, p)
      return r.startsWith("..") ? p : r
    }
    const results: string[] = []
    let totalAdded = 0
    let totalRemoved = 0
    const diffs: string[] = []

    for (const f of files) {
      const isCreate = f.oldPath === "/dev/null"
      const isDelete = f.newPath === "/dev/null"
      const target = resolve(isCreate ? f.newPath : f.oldPath)
      const old = await readOrNull(target)

      try {
        if (isDelete) {
          if (old === null) {
            results.push(`skip (already gone): ${rel(target)}`)
            continue
          }
          await fs.rm(target)
          const diff = unifiedDiff(old, "")
          const s = diffStats(diff)
          totalRemoved += s.removed
          diffs.push(diff)
          results.push(`D ${rel(target)} (-${s.removed})`)
          continue
        }

        let next: string
        if (isCreate || old === null) {
          // New file: the sole hunk's "after" is the whole content.
          next = f.hunks.map((h) => h.after).join("\n")
        } else {
          next = old
          for (const h of f.hunks) next = replaceInContent(next, h.before, h.after, false)
        }
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, next, "utf8")
        const diff = unifiedDiff(old ?? "", next)
        const s = diffStats(diff)
        totalAdded += s.added
        totalRemoved += s.removed
        diffs.push(diff)
        results.push(`${old === null ? "A" : "M"} ${rel(target)} (+${s.added} -${s.removed})`)
      } catch (e: any) {
        const why = e instanceof EditError ? e.message : e.message
        return { output: `Error applying patch to ${rel(target)}: ${why}`, isError: true }
      }
    }

    return {
      output: `Applied patch to ${files.length} file(s):\n${results.join("\n")}`,
      title: `apply_patch ${files.length} file(s) (+${totalAdded} -${totalRemoved})`,
      diff: diffs.join("\n"),
    }
  },
}
