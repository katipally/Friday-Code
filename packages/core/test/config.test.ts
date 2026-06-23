import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Isolate the user config dir before importing the module under test.
process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cfg-home-"))
const { loadConfig } = await import("../src/config.ts")
const { configPath, projectConfigPath, projectLocalConfigPath } = await import("@friday/providers")

test("config layers user → project → local with deep merge", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cfg-proj-"))
  fs.mkdirSync(path.join(cwd, ".friday"), { recursive: true })

  // user: base model + one mcp server + a bash deny
  fs.writeFileSync(
    configPath(),
    JSON.stringify({ model: "user-model", theme: "dark", mcp: { a: { type: "stdio" } }, bash: { deny: ["rm"] } }),
  )
  // project: override model, add a second mcp server (deep-merge keeps `a`)
  fs.writeFileSync(projectConfigPath(cwd), JSON.stringify({ model: "project-model", mcp: { b: { type: "http" } } }))
  // local: override theme only
  fs.writeFileSync(projectLocalConfigPath(cwd), JSON.stringify({ theme: "light" }))

  const cfg = loadConfig(cwd)
  expect(cfg.model).toBe("project-model") // project beats user
  expect(cfg.theme).toBe("light") // local beats user
  expect(Object.keys(cfg.mcp ?? {}).sort()).toEqual(["a", "b"]) // nested objects merge, not replace
  expect(cfg.bash?.deny).toEqual(["rm"]) // untouched user key survives
})

test("missing project files are a no-op (user config returned)", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "friday-cfg-bare-"))
  fs.writeFileSync(configPath(), JSON.stringify({ model: "solo" }))
  expect(loadConfig(cwd).model).toBe("solo")
})
