import fs from "node:fs"
import path from "node:path"
import type { TodoItem } from "@friday/shared"
import type { PlanRow } from "./sessions.ts"

/**
 * A per-turn checkpoint: the conversation length + prior content of files the turn touched, PLUS the
 * pre-turn todo list and plans. Rewinding to a checkpoint restores everything Friday did since —
 * files, conversation, todos and plans — not just the chat.
 */
export interface Checkpoint {
  id: string
  label: string
  createdAt: number
  /** conversation length (seq) just before this turn — restore truncates back to here */
  messageSeq: number
  /** absolute path -> prior content (null = the file did not exist) */
  files: Map<string, string | null>
  /** todo list as it was BEFORE this turn — restore reverts to it */
  todos?: TodoItem[]
  /** plans as they were BEFORE this turn — restore reverts to them */
  plans?: PlanRow[]
}

/** JSON-friendly checkpoint (the `files` Map flattened to entries) for SQLite persistence. */
interface SerializedCheckpoint {
  id: string
  label: string
  createdAt: number
  messageSeq: number
  files: [string, string | null][]
  todos?: TodoItem[]
  plans?: PlanRow[]
}

export function serializeCheckpoints(cps: Checkpoint[]): string {
  const flat: SerializedCheckpoint[] = cps.map((c) => ({
    id: c.id,
    label: c.label,
    createdAt: c.createdAt,
    messageSeq: c.messageSeq,
    files: [...c.files.entries()],
    todos: c.todos,
    plans: c.plans,
  }))
  return JSON.stringify(flat)
}

export function deserializeCheckpoints(json: string): Checkpoint[] {
  try {
    const arr = JSON.parse(json) as SerializedCheckpoint[]
    if (!Array.isArray(arr)) return []
    return arr.map((c) => ({ ...c, files: new Map(c.files) }))
  } catch {
    return []
  }
}

/**
 * Line-level change counts (added/removed) between two file versions, via an LCS so inserts/deletes
 * are counted honestly (not just positional mismatches). Used to tell the user how much code a
 * rewind would revert.
 */
export function lineDelta(before: string | null, after: string | null): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 }
  const a = before === null ? [] : before.split("\n")
  const b = after === null ? [] : after.split("\n")
  // ponytail: LCS is O(n·m); cap large files with a coarse full-rewrite count rather than stalling.
  if (a.length > 5000 || b.length > 5000) return { added: b.length, removed: a.length }
  const m = a.length
  const n = b.length
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const lcs = dp[0]![0]!
  return { added: n - lcs, removed: m - lcs }
}

export function readOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return null
  }
}

/** Record a file's prior content the first time it is touched in this checkpoint. */
export function snapshotFile(cp: Checkpoint, absPath: string): void {
  if (!cp.files.has(absPath)) cp.files.set(absPath, readOrNull(absPath))
}

/** Restore files to the given contents (null = delete). */
export function applyFiles(map: Map<string, string | null>): void {
  for (const [p, content] of map) {
    if (content === null) {
      try {
        fs.rmSync(p, { force: true })
      } catch {
        /* ignore */
      }
    } else {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, content)
      } catch {
        /* ignore */
      }
    }
  }
}
