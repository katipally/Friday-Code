import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Engine } from "@friday/core"
import { testRender } from "@opentui/solid"
import { App } from "../src/App.tsx"

process.env.FRIDAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "friday-home-"))

// Force the offline snapshot (don't depend on a live local Ollama in CI).
const realFetch = globalThis.fetch
globalThis.fetch = (async () => {
  throw new Error("offline (test)")
}) as any

test("model modal: pick keyless provider, filter models, select", async () => {
  const e = new Engine({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), "cwd-")) })
  const t = await testRender(() => <App engine={e} />, { width: 100, height: 30 })
  await t.renderOnce()
  t.mockInput.pressEnter() // splash -> shell; first-run shows onboarding
  await t.flush()
  t.mockInput.pressEnter() // onboarding -> open /model
  await t.flush()
  expect(t.captureCharFrame()).toContain("/model")

  // navigate to a keyless local provider (Ollama) and open its model step
  const providers = e.listProviders()
  const ollama = providers.findIndex((p) => p.id === "ollama")
  for (let i = 0; i < ollama; i++) {
    t.mockInput.pressArrow("down")
    await t.flush()
  }
  t.mockInput.pressEnter() // keyless -> straight to model step
  await t.flush()

  await t.mockInput.typeText("qwen")
  await t.flush()
  expect(t.captureCharFrame()).toContain("qwen2.5-coder")

  // snapshot model has no reasoning flag -> effort step is skipped, selection finalizes immediately
  t.mockInput.pressEnter()
  await t.flush()
  expect(e.selection().model).toBe("qwen2.5-coder:7b")
  expect(e.selection().providerId).toBe("ollama")

  t.renderer.destroy()
  globalThis.fetch = realFetch
})
