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
