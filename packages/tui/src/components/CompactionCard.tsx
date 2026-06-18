import { getMode, theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { Show } from "solid-js"
import { shimmerAccent, useBreathe } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { Markdown } from "./Markdown.tsx"
import { Pressable } from "./Pressable.tsx"
import { Scrim } from "./Scrim.tsx"

/** A 12-cell block bar for a 0–100 percentage. */
function bar(pct: number, width = 12): string {
  const f = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return "█".repeat(f) + "░".repeat(width - f)
}

/**
 * Live compaction modal — a sonar pulse plus the REAL context-usage % being freed. We only know the
 * "before" number while summarizing (it's a single model call), so the modal shows that with a
 * breathing bar; the "after" lands in the chat notice and animates the sidebar bar once it completes.
 * Esc / the Stop button cancel the in-flight compaction (history is left untouched).
 */
export function CompactionCard() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const glow = useBreathe(accent, () => app.compacting())
  const before = () => app.compactPct().before

  useKeyboard((key) => {
    if (!app.compacting()) return
    if (key.name === "escape") return app.stopCompact()
  })

  return (
    <Show when={app.compacting()}>
      <Scrim onClose={() => {}}>
        <box
          flexDirection="column"
          width={46}
          border
          borderStyle="rounded"
          borderColor={shimmerAccent(accent())}
          backgroundColor={theme.bgElevated}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          gap={1}
        >
          <text fg={accent()}>↻ compacting context</text>
          <box flexDirection="row" justifyContent="center">
            <text fg={glow()}>(( ◍ ))</text>
          </box>
          <text fg={theme.textFaint}>summarizing older turns — freeing space…</text>
          <text fg={before() > 80 ? theme.warning : accent()}>
            ctx {before()}% {bar(before())}
          </text>
          <box flexDirection="row" justifyContent="center">
            <Pressable label="■ stop · esc" fg={theme.error} onClick={() => app.stopCompact()} />
          </box>
        </box>
      </Scrim>
    </Show>
  )
}

/**
 * Read-only viewer for a completed compaction's summary — the same shape as the plan viewer, opened
 * by clicking the "view summary" chat notice (or the sidebar). Scrollable; Esc closes.
 */
export function CompactionSummary() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const accent = () => getMode(app.mode()).accent
  let sb: { scrollBy?: (n: number) => void } | null = null
  const W = () => Math.min(dims().width - 4, Math.max(64, Math.round(dims().width * 0.7)))
  const H = () => Math.max(6, Math.round(dims().height * 0.7) - 4)

  useKeyboard((key) => {
    if (!app.compactionView()) return
    if (key.name === "escape") return app.setCompactionView(null)
    if (key.name === "up" || key.name === "k") return sb?.scrollBy?.(-3)
    if (key.name === "down" || key.name === "j") return sb?.scrollBy?.(3)
    if (key.name === "pageup") return sb?.scrollBy?.(-12)
    if (key.name === "pagedown") return sb?.scrollBy?.(12)
  })

  return (
    <Show when={app.compactionView()}>
      <Scrim onClose={() => app.setCompactionView(null)}>
        <box
          flexDirection="column"
          width={W()}
          border
          borderStyle="rounded"
          borderColor={accent()}
          backgroundColor={theme.bgElevated}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          gap={1}
        >
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={accent()}>↻ compaction summary</text>
            <text fg={theme.textFaint}>· what was kept in context</text>
          </box>
          <scrollbox ref={(r: any) => (sb = r)} maxHeight={H()} paddingLeft={1} paddingRight={1}>
            <Markdown content={app.compactionView() ?? ""} />
          </scrollbox>
          <text fg={theme.textFaint}>↑↓ scroll · esc close</text>
        </box>
      </Scrim>
    </Show>
  )
}
