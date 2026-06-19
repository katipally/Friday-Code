// Poll the rendered frame until every `needle` appears (or we time out). Fixed sleeps are flaky on
// slower CI runners — especially when waiting on multiple model turns or async tree-sitter
// highlighting — so we re-flush and re-check instead of guessing a single duration. Requiring ALL
// needles avoids capturing a half-rendered frame where one element has landed but another hasn't.
export async function waitForFrame(
  t: { flush: () => Promise<void>; captureCharFrame: () => string },
  needles: string | string[],
  timeoutMs = 5000,
): Promise<string> {
  const wanted = Array.isArray(needles) ? needles : [needles]
  const start = Bun.nanoseconds()
  let frame = t.captureCharFrame()
  while (!wanted.every((n) => frame.includes(n)) && (Bun.nanoseconds() - start) / 1e6 < timeoutMs) {
    await Bun.sleep(20)
    await t.flush()
    frame = t.captureCharFrame()
  }
  return frame
}

// Poll a generic predicate until it's truthy (or we time out). Use this instead
// of `await Bun.sleep(N)` whenever a test makes an async state change and then
// asserts on the resulting state. Fixed sleeps are flaky on slow CI runners;
// polling isO(K) faster in the happy path and self-failing in the sad path.
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const pollMs = opts.pollMs ?? 25
  const start = Bun.nanoseconds()
  while ((Bun.nanoseconds() - start) / 1e6 < timeoutMs) {
    if (await predicate()) return
    await Bun.sleep(pollMs)
  }
  throw new Error(`waitFor: predicate did not become true within ${timeoutMs}ms`)
}
