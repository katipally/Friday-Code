import { expect, test } from "bun:test"
import type { Tool } from "@friday/tools"
import { getAgent, loadAgents, resolveAgentTools } from "../src/agents.ts"

const ROOTS = ["/nonexistent-root-for-tests"] // no .friday/agents dir → just built-ins

test("loadAgents ships the built-ins", () => {
  const names = loadAgents(ROOTS).map((a) => a.name)
  for (const n of ["general", "explore", "plan", "review"]) expect(names).toContain(n)
})

test("getAgent defaults to general for unknown/blank types", () => {
  expect(getAgent(ROOTS, "nope").name).toBe("general")
  expect(getAgent(ROOTS).name).toBe("general")
  expect(getAgent(ROOTS, "explore").name).toBe("explore")
})

const tool = (name: string, permission: Tool["permission"]): Tool =>
  ({ name, permission, description: "", parameters: {}, execute: async () => ({ output: "" }) }) as Tool
const REGISTRY = [tool("read", "read"), tool("grep", "read"), tool("edit", "edit"), tool("bash", "bash")]

test("resolveAgentTools: general inherits all (undefined), explore is read-only + ask_user", () => {
  expect(resolveAgentTools(getAgent(ROOTS, "general"), REGISTRY)).toBeUndefined()
  const explore = resolveAgentTools(getAgent(ROOTS, "explore"), REGISTRY)!
  expect(explore.has("read")).toBe(true)
  expect(explore.has("grep")).toBe(true)
  expect(explore.has("ask_user")).toBe(true)
  expect(explore.has("edit")).toBe(false) // read-only never gets edit/bash
  expect(explore.has("bash")).toBe(false)
})

test("resolveAgentTools: review (readOnly + extraTools:bash) gets read tools + bash + ask_user, not edit", () => {
  const review = resolveAgentTools(getAgent(ROOTS, "review"), REGISTRY)!
  expect(review.has("read")).toBe(true)
  expect(review.has("bash")).toBe(true)
  expect(review.has("ask_user")).toBe(true)
  expect(review.has("edit")).toBe(false)
})
