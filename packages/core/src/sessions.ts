import fs from "node:fs"
import { Database } from "bun:sqlite"
import { fridayDir, sessionsDb } from "@friday/providers"
import type { Message } from "@friday/shared"

export interface SessionRow {
  id: string
  title: string
  cwd: string
  createdAt: number
  updatedAt: number
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
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS messages (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
        seq INTEGER NOT NULL, json TEXT NOT NULL
      );`,
    )
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_msg_session ON messages (session_id, seq);")
  }

  create(cwd: string, id: string, now: number, title = "new session"): SessionRow {
    this.db.query("INSERT INTO sessions (id, title, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      title,
      cwd,
      now,
      now,
    )
    return { id, title, cwd, createdAt: now, updatedAt: now }
  }

  get(id: string): SessionRow | undefined {
    const r = this.db.query("SELECT * FROM sessions WHERE id = ?").get(id) as any
    return r ? rowToSession(r) : undefined
  }

  list(cwd?: string): SessionRow[] {
    const rows = cwd
      ? (this.db.query("SELECT * FROM sessions WHERE cwd = ? ORDER BY updated_at DESC").all(cwd) as any[])
      : (this.db.query("SELECT * FROM sessions ORDER BY updated_at DESC").all() as any[])
    return rows.map(rowToSession)
  }

  latest(cwd?: string): SessionRow | undefined {
    return this.list(cwd)[0]
  }

  rename(id: string, title: string, now: number): void {
    this.db.query("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?").run(title, now, id)
  }

  touch(id: string, now: number): void {
    this.db.query("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, id)
  }

  appendMessage(sessionId: string, seq: number, msg: Message): void {
    this.db.query("INSERT INTO messages (session_id, seq, json) VALUES (?, ?, ?)").run(sessionId, seq, JSON.stringify(msg))
  }

  loadMessages(sessionId: string): Message[] {
    const rows = this.db.query("SELECT json FROM messages WHERE session_id = ? ORDER BY seq").all(sessionId) as {
      json: string
    }[]
    return rows.map((r) => JSON.parse(r.json) as Message)
  }
}

function rowToSession(r: any): SessionRow {
  return { id: r.id, title: r.title, cwd: r.cwd, createdAt: r.created_at, updatedAt: r.updated_at }
}
