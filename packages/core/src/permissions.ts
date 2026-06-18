/**
 * Per-project "always allow" rules, persisted at ~/.friday/permissions.json keyed by project root.
 * When the user picks "allow always" on a permission prompt, we record a scoped rule here so the same
 * action auto-approves in future sessions for that project — bash commands by command prefix (matched
 * via safety.matchesList), other categories project-wide.
 */
import fs from "node:fs"
import path from "node:path"
import { fridayDir } from "@friday/providers"
import type { PermissionCategory } from "@friday/shared"

export type ProjectPerms = { bash?: string[]; categories?: PermissionCategory[] }
type Store = Record<string, ProjectPerms>

function storeFile(): string {
  return path.join(fridayDir(), "permissions.json")
}

function load(): Store {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), "utf8"))
  } catch {
    return {}
  }
}

function save(s: Store): void {
  try {
    fs.mkdirSync(fridayDir(), { recursive: true })
    fs.writeFileSync(storeFile(), JSON.stringify(s, null, 2))
  } catch {
    /* best-effort */
  }
}

/** Rules remembered for `root` (empty object when none). */
export function projectPermissions(root: string): ProjectPerms {
  return load()[root] ?? {}
}

/** Record an "allow always" decision for `root`. Bash → store the command's leading prefix. */
export function persistPermission(root: string, rule: { category: PermissionCategory; command?: string }): void {
  const s = load()
  const p: ProjectPerms = s[root] ?? {}
  if (rule.category === "bash" && rule.command) {
    // First two tokens: "npm test" allows "npm test …" but not all of "npm …".
    const prefix = rule.command.trim().split(/\s+/).slice(0, 2).join(" ")
    if (prefix) p.bash = Array.from(new Set([...(p.bash ?? []), prefix]))
  } else {
    p.categories = Array.from(new Set([...(p.categories ?? []), rule.category]))
  }
  s[root] = p
  save(s)
}

/** Forget all remembered rules for `root` (backs the `/permissions` reset). */
export function revokeProjectPermissions(root: string): void {
  const s = load()
  if (root in s) {
    delete s[root]
    save(s)
  }
}
