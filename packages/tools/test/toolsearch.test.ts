import { test, expect } from "bun:test"
import { searchTools } from "../src/builtin/toolsearch.ts"

const POOL = [
  { name: "task_create", description: "start a background task / subagent" },
  { name: "cron_create", description: "schedule a recurring job" },
  { name: "notebook_edit", description: "edit a jupyter notebook cell" },
  { name: "enter_worktree", description: "create or switch a git worktree" },
]

test("ranks exact/name matches above description-only matches", () => {
  const hits = searchTools("notebook", POOL)
  expect(hits[0]!.name).toBe("notebook_edit")
})

test("matches on description keywords", () => {
  const hits = searchTools("background", POOL)
  expect(hits.map((h) => h.name)).toContain("task_create")
})

test("no match returns empty", () => {
  expect(searchTools("nonexistent-capability-xyz", POOL)).toHaveLength(0)
})

test("empty query returns the pool (capped)", () => {
  expect(searchTools("", POOL).length).toBe(POOL.length)
})
