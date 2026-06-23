import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { TeamBoard } from "../src/board.ts"

function freshBoard(): TeamBoard {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-board-"))
  return new TeamBoard(path.join(dir, "teams.db"))
}

test("members, posts and read filtering", () => {
  const b = freshBoard()
  const team = b.createTeam("ship feature", "orchestrator-1")
  b.addMember(team, "s-back", "backend", "wt-back")
  b.addMember(team, "s-test", "tests", "wt-test")

  b.post(team, "s-back", "finding", "added /api route")
  const p2 = b.post(team, "s-test", "handoff", "need the route name", "backend")

  const all = b.readPosts(team)
  expect(all.length).toBe(2)
  expect(all[0]!.role).toBe("backend")

  // incremental read (since the first post) returns only newer ones
  expect(b.readPosts(team, all[0]!.id).map((p) => p.id)).toEqual([p2])

  // role filter matches author OR handoff target
  expect(b.readPosts(team, 0, "backend").length).toBe(2)
  expect(b.readPosts(team, 0, "tests").length).toBe(1)
})

test("file claims are advisory, owner-reentrant, and expire (no deadlock)", () => {
  const b = freshBoard()
  const team = b.createTeam("refactor", "orch")
  b.addMember(team, "a", "a")
  b.addMember(team, "b", "b")

  // first claim succeeds
  expect(b.claimFile(team, "src/x.ts", "a", 60_000).ok).toBe(true)
  // a different agent is refused and told who holds it — but is NOT blocked
  const denied = b.claimFile(team, "src/x.ts", "b", 60_000)
  expect(denied.ok).toBe(false)
  expect(denied.heldBy).toBe("a")
  // the owner can re-claim its own path
  expect(b.claimFile(team, "src/x.ts", "a", 60_000).ok).toBe(true)
  // an expired claim (ttl 0) is freely takeable by anyone
  b.claimFile(team, "src/y.ts", "a", 0)
  expect(b.claimFile(team, "src/y.ts", "b", 60_000).ok).toBe(true)
  // releasing frees it
  b.releaseFile(team, "src/x.ts", "a")
  expect(b.claimFile(team, "src/x.ts", "b", 60_000).ok).toBe(true)

  // liveClaims excludes expired ones
  const live = b
    .liveClaims(team)
    .map((c) => c.path)
    .sort()
  expect(live).toEqual(["src/x.ts", "src/y.ts"])
})

test("snapshot reflects status changes and latestTeamId tracks activity", () => {
  const b = freshBoard()
  const t1 = b.createTeam("one", "o")
  b.addMember(t1, "m1", "r1")
  b.setMemberStatus(t1, "m1", "done", "finished")
  const snap = b.snapshot(t1)!
  expect(snap.members[0]!.status).toBe("done")
  expect(snap.members[0]!.activity).toBe("finished")

  // newest-created team is the default (rowid tiebreak keeps it deterministic within a millisecond)
  const t2 = b.createTeam("two", "o")
  expect(b.latestTeamId()).toBe(t2)

  b.finishTeam(t1, "done")
  expect(b.team(t1)!.status).toBe("done")
  expect(b.team(t2)!.status).toBe("running")
})
