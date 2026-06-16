import fs from "node:fs"
import path from "node:path"

/** A per-turn checkpoint: the conversation length + prior content of files the turn touched. */
export interface Checkpoint {
  id: string
  label: string
  createdAt: number
  /** conversation length (seq) just before this turn — restore truncates back to here */
  messageSeq: number
  /** absolute path -> prior content (null = the file did not exist) */
  files: Map<string, string | null>
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
