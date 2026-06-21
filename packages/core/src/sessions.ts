import { Database } from "bun:sqlite"
import fs from "node:fs"
import { fridayDir, sessionsDb } from "@friday/providers"
import type { Message, TodoItem } from "@friday/shared"

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
        plans TEXT NOT NULL DEFAULT '[]', checkpoints TEXT NOT NULL DEFAULT '[]'
      );`,
    )
  }

  private upsertState(sessionId: string, column: "todos" | "plans" | "checkpoints", json: string): void {
    this.db
      .query(
        `INSERT INTO session_state (session_id, ${column}) VALUES (?, ?)
         ON CONFLICT(session_id) DO UPDATE SET ${column} = excluded.${column}`,
      )
      .run(sessionId, json)
  }
  private readState(sessionId: string, column: "todos" | "plans" | "checkpoints"): string {
    const r = this.db.query(`SELECT ${column} AS v FROM session_state WHERE session_id = ?`).get(sessionId) as
      | { v: string }
      | undefined
    return r?.v ?? "[]"
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
  /** Checkpoints serialize their file-snapshot Map to entry arrays; callers (re)hydrate the Map. */
  setCheckpointsJson(sessionId: string, json: string): void {
    this.upsertState(sessionId, "checkpoints", json)
  }
  loadCheckpointsJson(sessionId: string): string {
    return this.readState(sessionId, "checkpoints")
  }

  create(roots: string[], id: string, now: number, title = "new session"): SessionRow {
    const cwd = roots[0]!
    this.db
      .query("INSERT INTO sessions (id, title, cwd, roots, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, title, cwd, JSON.stringify(roots), now, now)
    return { id, title, cwd, roots, createdAt: now, updatedAt: now }
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
