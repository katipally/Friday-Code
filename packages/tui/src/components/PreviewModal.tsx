import { theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import fs from "node:fs"
import { createMemo, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Pressable } from "./Pressable.tsx"
import { Scrim } from "./Scrim.tsx"
import { Overlay } from "./ui.tsx"

const MAX_CHARS = 40_000

function human(n: number): string {
  return n >= 1_000_000 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1000 ? `${(n / 1000).toFixed(1)} kB` : `${n} B`
}

/**
 * Click-to-open preview for an attachment chip (in the composer panel or a chat bubble): the pasted
 * text, a file's content (read on open, truncated), or an image's metadata. Terminals can't reliably
 * render an image inline, so images show path + size and an "open externally" action instead.
 */
export function PreviewModal() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const p = () => app.preview()!
  const width = () => Math.min(96, dims().width - 4)
  const maxH = () => Math.max(6, Math.floor(dims().height * 0.6))

  // Resolve the body lazily from the preview kind; file reads happen here (not at click time).
  const body = createMemo(() => {
    const pv = app.preview()
    if (!pv) return { text: "", note: "" }
    if (pv.kind === "text") return { text: pv.text.slice(0, MAX_CHARS), note: pv.text.length > MAX_CHARS ? "…truncated" : "" }
    if (pv.kind === "file") {
      try {
        const raw = fs.readFileSync(pv.path, "utf8")
        return { text: raw.slice(0, MAX_CHARS), note: raw.length > MAX_CHARS ? "…truncated" : "" }
      } catch (e: any) {
        return { text: "", note: `cannot read file: ${e?.message ?? e}` }
      }
    }
    // image
    let size = ""
    try {
      size = human(fs.statSync(pv.path).size)
    } catch {}
    return { text: "", note: `image — ${size || "?"} · terminals can't show it inline; open it externally to view` }
  })

  useKeyboard((key) => {
    if (!app.preview()) return
    if (key.name === "escape" || key.name === "return") return app.setPreview(null)
  })

  return (
    <Show when={app.preview()}>
      <Scrim onClose={() => app.setPreview(null)}>
        <Overlay title={p().title} hint={p().kind} width={width()}>
          <Show when={body().text}>
            <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
              <scrollbox maxHeight={maxH()} scrollX>
                <text fg={theme.text} selectable>
                  {body().text}
                </text>
              </scrollbox>
            </box>
          </Show>
          <Show when={body().note}>
            <text fg={theme.textFaint}>{body().note}</text>
          </Show>
          <box flexDirection="row" gap={2} alignItems="center">
            <Show when={p().kind !== "text"}>
              <Pressable label="⧉ open externally" onClick={() => (app.openPath((p() as any).path), app.setPreview(null))} />
            </Show>
            <box flexGrow={1} />
            <text fg={theme.textFaint}>Esc close</text>
          </box>
        </Overlay>
      </Scrim>
    </Show>
  )
}
