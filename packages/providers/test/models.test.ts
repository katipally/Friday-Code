import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ProviderInfo } from "@friday/shared"
import { fetchModels } from "../src/models.ts"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function stub(handler: (url: string) => any) {
  globalThis.fetch = (async (url: string) => {
    if (url.includes("models.dev")) throw new Error("no catalog in test")
    return new Response(JSON.stringify(handler(url)), { status: 200 })
  }) as any
}

test("openai-compat live models: filtered to chat, reasoning inferred, live flag set", async () => {
  stub(() => ({
    data: [{ id: "gpt-test" }, { id: "text-embedding-3-large" }, { id: "o3-mini-test" }, { id: "whisper-1" }],
  }))
  const provider: ProviderInfo = { id: "openai", name: "OpenAI", protocol: "openai", baseURL: "https://api.test/v1" }
  const models = await fetchModels(provider, "sk-x")
  const ids = models.map((m) => m.id)
  expect(ids).toContain("gpt-test")
  expect(ids).toContain("o3-mini-test")
  expect(ids).not.toContain("text-embedding-3-large") // non-chat hidden
  expect(ids).not.toContain("whisper-1")
  expect(models.find((m) => m.id === "o3-mini-test")?.reasoning).toBe(true) // inferred
  expect(models.every((m) => m.live)).toBe(true)
})

test("anthropic live models map display_name", async () => {
  stub(() => ({ data: [{ id: "claude-test-1", display_name: "Claude Test One" }] }))
  const provider: ProviderInfo = {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
  }
  const models = await fetchModels(provider, "sk-ant")
  expect(models[0]?.id).toBe("claude-test-1")
  expect(models[0]?.name).toBe("Claude Test One")
})

test("falls back to the offline snapshot when the live endpoint fails", async () => {
  globalThis.fetch = (async () => {
    throw new Error("offline")
  }) as any
  const provider: ProviderInfo = {
    id: "ollama",
    name: "Ollama",
    protocol: "openai",
    baseURL: "http://localhost:11434/v1",
    keyless: true,
  }
  const models = await fetchModels(provider)
  expect(models.map((m) => m.id)).toContain("qwen2.5-coder:7b")
})
