import { beforeEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Isolate ~/.friday for this test before importing the module that reads it.
process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-perm-"))
const { projectPermissions, persistPermission, revokeProjectPermissions } = await import("../src/permissions.ts")

const ROOT = "/tmp/proj-A"

beforeEach(() => revokeProjectPermissions(ROOT))

test("bash allow-always persists a command prefix scoped to the project", () => {
  persistPermission(ROOT, { category: "bash", command: "npm test --watch" })
  expect(projectPermissions(ROOT).bash).toContain("npm test")
  // a different project is unaffected
  expect(projectPermissions("/tmp/other").bash ?? []).not.toContain("npm test")
})

test("non-bash allow-always persists the category", () => {
  persistPermission(ROOT, { category: "edit" })
  expect(projectPermissions(ROOT).categories).toContain("edit")
})

test("revoke clears a project's rules", () => {
  persistPermission(ROOT, { category: "network" })
  revokeProjectPermissions(ROOT)
  expect(projectPermissions(ROOT).categories ?? []).toHaveLength(0)
})
