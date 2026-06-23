/**
 * Shared session-history ordering, so the /resume modal (SessionHistory) and the dashboard History
 * tab sort and group identically: grouped by directory (alphabetical), newest-first within each
 * directory. A session appears under each of its roots.
 */

// `updatedAt` is optional: persisted history rows have it (sorted newest-first within a dir); the live
// sessions list doesn't, so those keep their incoming order within each directory.
export type SessionMeta = { id: string; title: string; cwd: string; roots: string[]; updatedAt?: number }
export type HistoryRow<T extends SessionMeta = SessionMeta> = { dir: string } | { session: T; index: number }

/** Returns navigable `rows` (directory headers + sessions) plus the `flat` list those indices map to. */
export function groupSessionsByDir<T extends SessionMeta>(sessions: T[]): { rows: HistoryRow<T>[]; flat: T[] } {
  const byDir = new Map<string, T[]>()
  for (const s of sessions) {
    for (const root of s.roots.length ? s.roots : [s.cwd]) {
      if (!byDir.has(root)) byDir.set(root, [])
      byDir.get(root)!.push(s)
    }
  }
  const rows: HistoryRow<T>[] = []
  const flat: T[] = []
  for (const dir of [...byDir.keys()].sort()) {
    rows.push({ dir })
    for (const s of byDir.get(dir)!.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))) {
      rows.push({ session: s, index: flat.length })
      flat.push(s)
    }
  }
  return { rows, flat }
}

/** Abbreviate an absolute path with ~ for the home directory. */
export function homeDir(p: string): string {
  const h = process.env.HOME
  return h && p.startsWith(h) ? `~${p.slice(h.length)}` : p
}
