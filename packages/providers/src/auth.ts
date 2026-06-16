import fs from "node:fs"
import type { ProviderInfo } from "@friday/shared"
import { authPath, fridayDir } from "./paths.ts"

export interface AuthFile {
  providers: Record<string, { apiKey?: string; baseURL?: string }>
  custom: ProviderInfo[]
}

export function loadAuth(): AuthFile {
  try {
    const j = JSON.parse(fs.readFileSync(authPath(), "utf8"))
    return { providers: j.providers ?? {}, custom: j.custom ?? [] }
  } catch {
    return { providers: {}, custom: [] }
  }
}

export function saveAuth(a: AuthFile): void {
  fs.mkdirSync(fridayDir(), { recursive: true })
  fs.writeFileSync(authPath(), JSON.stringify(a, null, 2), { mode: 0o600 })
}

export function setProviderKey(id: string, apiKey: string, baseURL?: string): void {
  const a = loadAuth()
  a.providers[id] = { apiKey, ...(baseURL ? { baseURL } : {}) }
  saveAuth(a)
}

export function getProviderKey(id: string): string | undefined {
  return loadAuth().providers[id]?.apiKey
}
