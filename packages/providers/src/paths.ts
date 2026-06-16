import os from "node:os"
import path from "node:path"

/** Root config dir. Override with FRIDAY_HOME (used by tests + power users). Read lazily. */
export function fridayDir(): string {
  return process.env.FRIDAY_HOME || path.join(os.homedir(), ".friday")
}
export function authPath(): string {
  return path.join(fridayDir(), "auth.json")
}
export function configPath(): string {
  return path.join(fridayDir(), "config.json")
}
export function cacheDir(): string {
  return path.join(fridayDir(), "cache")
}
export function sessionsDb(): string {
  return path.join(fridayDir(), "sessions.db")
}
