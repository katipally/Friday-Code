import { Database } from "bun:sqlite"
import fs from "node:fs"
import path from "node:path"
import { fridayDir } from "@friday/providers"

const now = () => Date.now()

export type TeamStatus = "running" | "gathering" | "done" | "failed"
export type MemberStatus = "running" | "done" | "dead" | "timed-out"
export type PostKind = "finding" | "message" | "handoff" | "status"

export interface MemberRow {
  sessionId: string
  role: string
  status: MemberStatus
  activity: string
  worktree?: string
  branch?: string
}
export interface PostRow {
  id: number
  sessionId: string
  role: string
  kind: PostKind
  toRole?: string
  text: string
  createdAt: number
}
export interface ClaimRow {
  path: string
  sessionId: string
}
export interface TeamSnapshot {
  teamId: string
  goal: string
  status: TeamStatus
  members: MemberRow[]
  posts: PostRow[]
  claims: ClaimRow[]
}

/**
 * The shared "blackboard" for an agent team: goal, member roster, posted findings/messages/handoffs,
 * and advisory file-claims. Backed by its own bun:sqlite file (zero deps) so `friday attach` viewers
 * and a restarted TUI can read the same state. All claims are advisory + time-boxed — nothing here
 * ever blocks, so the team can never deadlock.
 */
export class TeamBoard {
  private db: Database

  constructor(dbPath: string = path.join(fridayDir(), "teams.db")) {
    fs.mkdirSync(fridayDir(), { recursive: true })
    this.db = new Database(dbPath)
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY, goal TEXT NOT NULL, status TEXT NOT NULL,
        orchestrator_session TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );`,
    )
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS members (
        team_id TEXT NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL,
        status TEXT NOT NULL, activity TEXT NOT NULL DEFAULT '', worktree TEXT, branch TEXT,
        updated_at INTEGER NOT NULL, PRIMARY KEY (team_id, session_id)
      );`,
    )
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, team_id TEXT NOT NULL, session_id TEXT NOT NULL,
        kind TEXT NOT NULL, to_role TEXT, text TEXT NOT NULL, created_at INTEGER NOT NULL
      );`,
    )
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_posts_team ON posts (team_id, id);")
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS claims (
        team_id TEXT NOT NULL, path TEXT NOT NULL, session_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (team_id, path)
      );`,
    )
  }

  createTeam(goal: string, orchestratorSession: string): string {
    const id = crypto.randomUUID().slice(0, 8)
    const t = now()
    this.db
      .query("INSERT INTO teams (id, goal, status, orchestrator_session, created_at, updated_at) VALUES (?,?,?,?,?,?)")
      .run(id, goal, "running", orchestratorSession, t, t)
    return id
  }

  addMember(teamId: string, sessionId: string, role: string, worktree?: string, branch?: string): void {
    this.db
      .query(
        "INSERT OR REPLACE INTO members (team_id, session_id, role, status, activity, worktree, branch, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(teamId, sessionId, role, "running", "", worktree ?? null, branch ?? null, now())
  }

  setMemberStatus(teamId: string, sessionId: string, status: MemberStatus, activity?: string): void {
    if (activity != null)
      this.db
        .query("UPDATE members SET status=?, activity=?, updated_at=? WHERE team_id=? AND session_id=?")
        .run(status, activity, now(), teamId, sessionId)
    else
      this.db
        .query("UPDATE members SET status=?, updated_at=? WHERE team_id=? AND session_id=?")
        .run(status, now(), teamId, sessionId)
  }

  setActivity(teamId: string, sessionId: string, activity: string): void {
    this.db
      .query("UPDATE members SET activity=?, updated_at=? WHERE team_id=? AND session_id=?")
      .run(activity, now(), teamId, sessionId)
  }

  post(teamId: string, sessionId: string, kind: PostKind, text: string, toRole?: string): number {
    const r = this.db
      .query(
        "INSERT INTO posts (team_id, session_id, kind, to_role, text, created_at) VALUES (?,?,?,?,?,?) RETURNING id",
      )
      .get(teamId, sessionId, kind, toRole ?? null, text, now()) as { id: number }
    this.db.query("UPDATE teams SET updated_at=? WHERE id=?").run(now(), teamId)
    return r.id
  }

  /** Read posts for a team, newest-relevant first filtered by optional `sinceId` and target `role`. */
  readPosts(teamId: string, sinceId = 0, role?: string): PostRow[] {
    const rows = this.db
      .query(
        `SELECT p.id, p.session_id, p.kind, p.to_role, p.text, p.created_at, COALESCE(m.role,'?') AS role
         FROM posts p LEFT JOIN members m ON m.team_id=p.team_id AND m.session_id=p.session_id
         WHERE p.team_id=? AND p.id>? ORDER BY p.id ASC`,
      )
      .all(teamId, sinceId) as any[]
    return rows
      .filter((r) => !role || r.role === role || r.to_role === role)
      .map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        role: r.role,
        kind: r.kind,
        toRole: r.to_role ?? undefined,
        text: r.text,
        createdAt: r.created_at,
      }))
  }

  /** Advisory, time-boxed soft lock. Succeeds if the path is free or the existing claim is expired or
   * owned by the caller; otherwise reports who holds it. NEVER blocks → no deadlock. */
  claimFile(teamId: string, claimPath: string, sessionId: string, ttlMs: number): { ok: boolean; heldBy?: string } {
    const t = now()
    const cur = this.db
      .query("SELECT session_id, expires_at FROM claims WHERE team_id=? AND path=?")
      .get(teamId, claimPath) as { session_id: string; expires_at: number } | undefined
    if (cur && cur.expires_at > t && cur.session_id !== sessionId) return { ok: false, heldBy: cur.session_id }
    this.db
      .query("INSERT OR REPLACE INTO claims (team_id, path, session_id, expires_at, created_at) VALUES (?,?,?,?,?)")
      .run(teamId, claimPath, sessionId, t + ttlMs, t)
    return { ok: true }
  }

  releaseFile(teamId: string, claimPath: string, sessionId: string): void {
    this.db.query("DELETE FROM claims WHERE team_id=? AND path=? AND session_id=?").run(teamId, claimPath, sessionId)
  }

  liveClaims(teamId: string): ClaimRow[] {
    const rows = this.db
      .query("SELECT path, session_id FROM claims WHERE team_id=? AND expires_at>?")
      .all(teamId, now()) as any[]
    return rows.map((r) => ({ path: r.path, sessionId: r.session_id }))
  }

  members(teamId: string): MemberRow[] {
    const rows = this.db
      .query("SELECT session_id, role, status, activity, worktree, branch FROM members WHERE team_id=? ORDER BY rowid")
      .all(teamId) as any[]
    return rows.map((r) => ({
      sessionId: r.session_id,
      role: r.role,
      status: r.status,
      activity: r.activity,
      worktree: r.worktree ?? undefined,
      branch: r.branch ?? undefined,
    }))
  }

  team(teamId: string): { id: string; goal: string; status: TeamStatus; orchestratorSession: string } | undefined {
    const r = this.db.query("SELECT id, goal, status, orchestrator_session FROM teams WHERE id=?").get(teamId) as any
    return r ? { id: r.id, goal: r.goal, status: r.status, orchestratorSession: r.orchestrator_session } : undefined
  }

  finishTeam(teamId: string, status: TeamStatus): void {
    this.db.query("UPDATE teams SET status=?, updated_at=? WHERE id=?").run(status, now(), teamId)
  }

  /** The most recently active team (for the console's default view). */
  latestTeamId(): string | undefined {
    const r = this.db.query("SELECT id FROM teams ORDER BY updated_at DESC, rowid DESC LIMIT 1").get() as
      | { id: string }
      | undefined
    return r?.id
  }

  snapshot(teamId: string): TeamSnapshot | undefined {
    const t = this.team(teamId)
    if (!t) return undefined
    // Cap posts to the most recent 100 so the event stays small.
    const all = this.readPosts(teamId)
    return {
      teamId,
      goal: t.goal,
      status: t.status,
      members: this.members(teamId),
      posts: all.slice(-100),
      claims: this.liveClaims(teamId),
    }
  }
}
