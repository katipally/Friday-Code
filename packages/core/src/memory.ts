/**
 * Persistent cross-session memory at ~/.friday/memory/ — one fact per markdown file plus an index
 * digest that's injected into the system prompt each session, so Friday recalls durable facts
 * (preferences, project conventions) without the user repeating them.
 */
import fs from "node:fs"
import path from "node:path"
import { fridayDir } from "@friday/providers"

export type MemoryFact = { name: string; content: string }

function memDir(): string {
  return path.join(fridayDir(), "memory")
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "fact"
  )
}

export function saveMemory(name: string, content: string): string {
  const file = `${slug(name)}.md`
  try {
    fs.mkdirSync(memDir(), { recursive: true })
    fs.writeFileSync(path.join(memDir(), file), `# ${name}\n\n${content}\n`)
  } catch {
    /* best-effort */
  }
  return file
}

export function deleteMemory(name: string): boolean {
  try {
    fs.rmSync(path.join(memDir(), `${slug(name)}.md`))
    return true
  } catch {
    return false
  }
}

export function listMemory(): MemoryFact[] {
  try {
    return fs
      .readdirSync(memDir())
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ name: f.replace(/\.md$/, ""), content: fs.readFileSync(path.join(memDir(), f), "utf8") }))
  } catch {
    return []
  }
}

/** Compact index for the system prompt: "- <name>: <first non-heading line>". Empty when no memory. */
export function memoryDigest(): string {
  const facts = listMemory()
  if (!facts.length) return ""
  const lines = facts.map((f) => {
    const first = f.content
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"))
    return `- ${f.name}: ${first ?? ""}`.trim()
  })
  return lines.join("\n")
}
