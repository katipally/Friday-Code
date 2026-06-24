import { Database } from "bun:sqlite"
import fs from "node:fs"
import { fridayDir, sessionsDb } from "@friday/providers"
import type { Effort, Message, ModeId, TodoItem } from "@friday/shared"

/**
 * Per-session state that makes a resume feel identical to where you left off — beyond messages/todos/
 * plans/checkpoints. Stored as one JSON blob (merge-on-write) so adding a field needs no migration.
 */
export interface SessionMeta {
  providerId?: string
  model?: string
  reasoning?: boolean
  effort?: Effort
  mode?: ModeId
  contextWindow?: number
  cost?: { input: number; output: number }
  /** condensed-history summary so a long session doesn't lose/recompute its compacted context */
  compaction?: { summary: string; throughIndex: number }
  /** git commit captured at session start; the "changes" panel diffs the working tree against it */
  baseRef?: string
  /** active git worktree (restored on resume), with the dir/roots to return to on exit */
  worktree?: { path: string; pre: { cwd: string; roots: string[] } }
}

export interface SessionRow {
  id: string
  title: string
  cwd: string
  /** all directories this session spans (primary = roots[0], = cwd) */
  roots: string[]
  createdAt: number
  updatedAt: number
}

/** A persisted plan (mirrors the TUI PlanEntry). */
export interface PlanRow {
  id: string
  title: string
  text: string
}

/** Durable session + message storage backed by bun:sqlite (zero external deps). */
export class SessionStore {
  private db: Database

  constructor(dbPath: string = sessionsDb()) {
    fs.mkdirSync(fridayDir(), { recursive: true })
    this.db = new Database(dbPath)
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, cwd TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );`,
    )
    // roots column added later — migrate existing dbs.
    try {
      this.db.exec("ALTER TABLE sessions ADD COLUMN roots TEXT NOT NULL DEFAULT '[]';")
    } catch {
      /* already exists */
    }
    this.db.exec("UPDATE sessions SET roots = json_array(cwd) WHERE roots = '[]' OR roots IS NULL;")
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS messages (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
        seq INTEGER NOT NULL, json TEXT NOT NULL
      );`,
    )
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_msg_session ON messages (session_id, seq);")
    // Per-session UI state that isn't part of the message log: todos, plans, and rewind checkpoints.
    // Stored as JSON blobs (replace-on-write) keyed by session so a resumed session restores them.
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS session_state (
        session_id TEXT PRIMARY KEY, todos TEXT NOT NULL DEFAULT '[]',
        plans TEXT NOT NULL DEFAULT '[]', checkpoints TEXT NOT NULL DEFAULT '[]',
        pinned_files TEXT NOT NULL DEFAULT '[]', meta TEXT NOT NULL DEFAULT '{}'
      );`,
    )
    // Migrate older DBs that predate these columns. Duplicate-column errors are expected & ignored.
    for (const col of ["pinned_files TEXT NOT NULL DEFAULT '[]'", "meta TEXT NOT NULL DEFAULT '{}'"]) {
      try {
        this.db.exec(`ALTER TABLE session_state ADD COLUMN ${col}`)
      } catch {
        /* column already exists */
      }
    }
    // Cross-process presence registry: every friday process heartbeats the runners it owns here, so any
    // OTHER terminal's dashboard can show live sessions / background tasks / team members it doesn't own.
    // Rows are pruned when their heartbeat goes stale or the owning pid dies (see prunePresence).
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS presence (
        session_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, root TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'session', busy INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '', team_id TEXT, cost REAL NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );`,
    )
    // Cross-process control: a terminal can request the OWNING process stop a runner it doesn't hold.
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS control (
        session_id TEXT PRIMARY KEY, action TEXT NOT NULL, created_at INTEGER NOT NULL
      );`,
    )
  }

  // ---- cross-process presence registry ----
  /** Upsert heartbeat rows for the runners this process owns (called on a timer + on every dispatch). */
  heartbeat(rows: PresenceUpsert[]): void {
    const t = Date.now()
    const q = this.db.query(
      `INSERT INTO presence (session_id, pid, root, title, kind, busy, status, description, team_id, cost, updated_at)
       VALUES ($id,$pid,$root,$title,$kind,$busy,$status,$desc,$team,$cost,$t)
       ON CONFLICT(session_id) DO UPDATE SET pid=$pid, root=$root, title=$title, kind=$kind, busy=$busy,
         status=$status, description=$desc, team_id=$team, cost=$cost, updated_at=$t`,
    )
    for (const r of rows) {
      q.run({
        $id: r.sessionId,
        $pid: r.pid,
        $root: r.root,
        $title: r.title ?? "",
        $kind: r.kind,
        $busy: r.busy ? 1 : 0,
        $status: r.status ?? "",
        $desc: r.description ?? "",
        $team: r.teamId ?? null,
        $cost: r.cost ?? 0,
        $t: t,
      })
    }
  }
  dropPresence(sessionId: string): void {
    this.db.query("DELETE FROM presence WHERE session_id = ?").run(sessionId)
  }
  dropPresenceForPid(pid: number): void {
    this.db.query("DELETE FROM presence WHERE pid = ?").run(pid)
  }
  /** All fresh presence rows (heartbeat newer than `freshMs`), optionally scoped to a project root. */
  livePresence(freshMs: number, root?: string): PresenceRow[] {
    const cutoff = Date.now() - freshMs
    const rows = (
      root
        ? this.db.query("SELECT * FROM presence WHERE updated_at > ? AND root = ? ORDER BY updated_at DESC").all(cutoff, root)
        : this.db.query("SELECT * FROM presence WHERE updated_at > ? ORDER BY updated_at DESC").all(cutoff)
    ) as any[]
    return rows.map(rowToPresence)
  }
  /** Drop presence rows whose owning pid is no longer alive (best-effort, same-machine). */
  prunePresence(freshMs: number): void {
    const stale = Date.now() - freshMs
    // Stale heartbeat → gone. Also prune fresh-looking rows whose pid is dead (hard crash, no cleanup).
    const rows = this.db.query("SELECT DISTINCT pid FROM presence").all() as { pid: number }[]
    for (const { pid } of rows) {
      if (pid === process.pid) continue
      try {
        process.kill(pid, 0) // alive → keep
      } catch {
        this.db.query("DELETE FROM presence WHERE pid = ?").run(pid)
      }
    }
    this.db.query("DELETE FROM presence WHERE updated_at < ?").run(stale)
  }

  // ---- cross-process control ----
  requestControl(sessionId: string, action: "stop"): void {
    this.db
      .query("INSERT OR REPLACE INTO control (session_id, action, created_at) VALUES (?,?,?)")
      .run(sessionId, action, Date.now())
  }
  /** Pop control requests for the given session ids (the caller owns them); returns the actions to apply. */
  takeControl(sessionIds: string[]): { sessionId: string; action: string }[] {
    if (!sessionIds.length) return []
    const marks = sessionIds.map(() => "?").join(",")
    const rows = this.db
      .query(`SELECT session_id, action FROM control WHERE session_id IN (${marks})`)
      .all(...sessionIds) as any[]
    if (rows.length) this.db.query(`DELETE FROM control WHERE session_id IN (${marks})`).run(...sessionIds)
    return rows.map((r) => ({ sessionId: r.session_id, action: r.action }))
  }

  private upsertState(
    sessionId: string,
    column: "todos" | "plans" | "checkpoints" | "pinned_files" | "meta",
    json: string,
  ): void {
    this.db
      .query(
        `INSERT INTO session_state (session_id, ${column}) VALUES (?, ?)
         ON CONFLICT(session_id) DO UPDATE SET ${column} = excluded.${column}`,
      )
      .run(sessionId, json)
  }
  private readState(sessionId: string, column: "todos" | "plans" | "checkpoints" | "pinned_files"): string {
    const r = this.db.query(`SELECT ${column} AS v FROM session_state WHERE session_id = ?`).get(sessionId) as
      | { v: string }
      | undefined
    return r?.v ?? "[]"
  }

  /** Merge a partial SessionMeta into the stored blob (read-modify-write) so independent writers —
   * the runner (compaction/baseRef/worktree) and the engine (model/mode/effort) — never clobber. */
  setMeta(sessionId: string, patch: Partial<SessionMeta>): void {
    const next = { ...this.loadMeta(sessionId), ...patch }
    this.upsertState(sessionId, "meta", JSON.stringify(next))
  }
  loadMeta(sessionId: string): SessionMeta {
    const r = this.db.query("SELECT meta AS v FROM session_state WHERE session_id = ?").get(sessionId) as
      | { v: string }
      | undefined
    try {
      return r?.v ? (JSON.parse(r.v) as SessionMeta) : {}
    } catch {
      return {}
    }
  }

  setTodos(sessionId: string, todos: TodoItem[]): void {
    this.upsertState(sessionId, "todos", JSON.stringify(todos))
  }
  loadTodos(sessionId: string): TodoItem[] {
    try {
      return JSON.parse(this.readState(sessionId, "todos")) as TodoItem[]
    } catch {
      return []
    }
  }
  setPlans(sessionId: string, plans: PlanRow[]): void {
    this.upsertState(sessionId, "plans", JSON.stringify(plans))
  }
  loadPlans(sessionId: string): PlanRow[] {
    try {
      return JSON.parse(this.readState(sessionId, "plans")) as PlanRow[]
    } catch {
      return []
    }
  }
  /** Files the user pinned into context for this session (relative paths); restored on resume. */
  setPinned(sessionId: string, files: string[]): void {
    this.upsertState(sessionId, "pinned_files", JSON.stringify(files))
  }
  loadPinned(sessionId: string): string[] {
    try {
      return JSON.parse(this.readState(sessionId, "pinned_files")) as string[]
    } catch {
      return []
    }
  }
  /** Checkpoints serialize their file-snapshot Map to entry arrays; callers (re)hydrate the Map. */
  setCheckpointsJson(sessionId: string, json: string): void {
    this.upsertState(sessionId, "checkpoints", json)
  }
  loadCheckpointsJson(sessionId: string): string {
    return this.readState(sessionId, "checkpoints")
  }

  create(roots: string[], id: string, now: number, title = "new session"): SessionRow {
    const row = this.buildRow(roots, id, now, title)
    this.persist(row)
    return row
  }

  /** A session row in memory WITHOUT touching the DB. Pair with ensure() to persist it lazily — new,
   * empty sessions stay out of history until their first message, so opening chats never duplicates rows. */
  buildRow(roots: string[], id: string, now: number, title = "new session"): SessionRow {
    return { id, title, cwd: roots[0]!, roots, createdAt: now, updatedAt: now }
  }

  /** Insert a session row if it isn't already stored (idempotent). Called on the first message. */
  ensure(row: SessionRow): void {
    this.db
      .query("INSERT OR IGNORE INTO sessions (id, title, cwd, roots, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, row.title, row.cwd, JSON.stringify(row.roots), row.createdAt, row.updatedAt)
  }

  private persist(row: SessionRow): void {
    this.db
      .query("INSERT INTO sessions (id, title, cwd, roots, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, row.title, row.cwd, JSON.stringify(row.roots), row.createdAt, row.updatedAt)
  }

  get(id: string): SessionRow | undefined {
    const r = this.db.query("SELECT * FROM sessions WHERE id = ?").get(id) as any
    return r ? rowToSession(r) : undefined
  }

  /** Sessions whose roots include `dir` (or all sessions if dir omitted), newest first. */
  list(dir?: string): SessionRow[] {
    const rows = dir
      ? (this.db
          .query(
            "SELECT * FROM sessions WHERE EXISTS (SELECT 1 FROM json_each(sessions.roots) WHERE value = ?) ORDER BY updated_at DESC",
          )
          .all(dir) as any[])
      : (this.db.query("SELECT * FROM sessions ORDER BY updated_at DESC").all() as any[])
    return rows.map(rowToSession)
  }

  latest(dir?: string): SessionRow | undefined {
    return this.list(dir)[0]
  }

  rename(id: string, title: string, now: number): void {
    this.db.query("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?").run(title, now, id)
  }

  touch(id: string, now: number): void {
    this.db.query("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, id)
  }

  addRoot(id: string, dir: string, now: number): string[] {
    const row = this.get(id)
    if (!row) return []
    if (row.roots.includes(dir)) return row.roots
    const roots = [...row.roots, dir]
    this.db.query("UPDATE sessions SET roots = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(roots), now, id)
    return roots
  }

  delete(id: string): void {
    this.db.query("DELETE FROM messages WHERE session_id = ?").run(id)
    this.db.query("DELETE FROM session_state WHERE session_id = ?").run(id)
    this.db.query("DELETE FROM sessions WHERE id = ?").run(id)
  }

  appendMessage(sessionId: string, seq: number, msg: Message): void {
    this.db
      .query("INSERT INTO messages (session_id, seq, json) VALUES (?, ?, ?)")
      .run(sessionId, seq, JSON.stringify(msg))
  }

  /** Drop messages at or after `seq` (used by undo/rewind). */
  truncateMessages(sessionId: string, seq: number): void {
    this.db.query("DELETE FROM messages WHERE session_id = ? AND seq >= ?").run(sessionId, seq)
  }

  loadMessages(sessionId: string): Message[] {
    const rows = this.db.query("SELECT json FROM messages WHERE session_id = ? ORDER BY seq").all(sessionId) as {
      json: string
    }[]
    return rows.map((r) => JSON.parse(r.json) as Message)
  }
}

/** A live runner advertised by some friday process (this one or another terminal). */
export interface PresenceRow {
  sessionId: string
  pid: number
  root: string
  title: string
  kind: "session" | "task" | "team"
  busy: boolean
  status: string
  description: string
  teamId?: string
  cost: number
  updatedAt: number
}
export type PresenceUpsert = Omit<PresenceRow, "busy" | "updatedAt" | "cost"> & { busy: boolean; cost?: number }

function rowToPresence(r: any): PresenceRow {
  return {
    sessionId: r.session_id,
    pid: r.pid,
    root: r.root,
    title: r.title,
    kind: r.kind,
    busy: !!r.busy,
    status: r.status,
    description: r.description,
    teamId: r.team_id ?? undefined,
    cost: r.cost ?? 0,
    updatedAt: r.updated_at,
  }
}

function rowToSession(r: any): SessionRow {
  let roots: string[]
  try {
    roots = JSON.parse(r.roots)
    if (!Array.isArray(roots) || !roots.length) roots = [r.cwd]
  } catch {
    roots = [r.cwd]
  }
  return { id: r.id, title: r.title, cwd: r.cwd, roots, createdAt: r.created_at, updatedAt: r.updated_at }
}
