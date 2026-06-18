import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { getProviderKey, setProviderKey } from "../src/index.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
})

test("getProviderKey falls back to the provider's env var", () => {
  process.env.ANTHROPIC_API_KEY = "sk-from-env"
  expect(getProviderKey("anthropic")).toBe("sk-from-env")
})

test("a stored key takes priority over the env var", () => {
  process.env.ANTHROPIC_API_KEY = "sk-from-env"
  setProviderKey("anthropic", "sk-stored")
  expect(getProviderKey("anthropic")).toBe("sk-stored")
})
