import { afterEach, expect, test } from "bun:test"
import { fetchWithRetry } from "../src/retry.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("retries transient 500s then succeeds", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    if (calls < 3) return new Response("server_error", { status: 500 })
    return new Response("ok", { status: 200 })
  }) as typeof fetch

  const ac = new AbortController()
  const res = await fetchWithRetry("https://x/y", {}, ac.signal, { baseMs: 1, maxMs: 5 })
  expect(res.status).toBe(200)
  expect(calls).toBe(3)
})

test("returns the final response on exhaustion so the caller throws the rich error", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response("still broken", { status: 503 })
  }) as typeof fetch

  const ac = new AbortController()
  const res = await fetchWithRetry("https://x/y", {}, ac.signal, { retries: 2, baseMs: 1, maxMs: 5 })
  expect(res.status).toBe(503)
  expect(calls).toBe(3) // 1 + 2 retries
})

test("does not retry a non-retryable status (400)", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response("bad request", { status: 400 })
  }) as typeof fetch

  const ac = new AbortController()
  const res = await fetchWithRetry("https://x/y", {}, ac.signal, { baseMs: 1 })
  expect(res.status).toBe(400)
  expect(calls).toBe(1)
})

test("aborting during backoff rejects and stops retrying", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response("overloaded", { status: 529 })
  }) as typeof fetch

  const ac = new AbortController()
  const p = fetchWithRetry("https://x/y", {}, ac.signal, { baseMs: 50, maxMs: 50 })
  queueMicrotask(() => ac.abort())
  await expect(p).rejects.toThrow()
  expect(calls).toBe(1) // aborted during the first backoff, never retried
})

test("retries network errors then succeeds", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    if (calls === 1) throw new TypeError("network down")
    return new Response("ok", { status: 200 })
  }) as typeof fetch

  const ac = new AbortController()
  const res = await fetchWithRetry("https://x/y", {}, ac.signal, { baseMs: 1, maxMs: 5 })
  expect(res.status).toBe(200)
  expect(calls).toBe(2)
})
