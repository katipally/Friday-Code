import type { McpServerConfig } from "@friday/core"
import { theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { G } from "../util/term.ts"
import { Scrim } from "./Scrim.tsx"
import { bandBg, Field, HintChip, Meta, Overlay, Pill, Tabs } from "./ui.tsx"

type View = "list" | "add"
// Add-form fields, in tab order. "token" only applies to http servers.
type AddField = "kind" | "name" | "value" | "token"

/** View / add / remove MCP servers. Add a stdio command or an http URL; connects live. */
export function McpModal() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const [view, setView] = createSignal<View>("list")
  const [kind, setKind] = createSignal<"stdio" | "http">("stdio")
  const [field, setField] = createSignal<AddField>("name")
  const [error, setError] = createSignal("")
  const [sel, setSel] = createSignal(0)
  let nameInput: any
  let valueInput: any
  let tokenInput: any

  const config = () => app.mcpConfig()
  const connected = () => new Set(app.mcpServers())
  const entries = createMemo(() => Object.entries(config()))
  const clamped = () => Math.min(sel(), Math.max(0, entries().length - 1))

  // The tab-cycle of fields for the current server kind.
  const fields = (): AddField[] => (kind() === "http" ? ["kind", "name", "value", "token"] : ["kind", "name", "value"])
  const moveField = (dir: 1 | -1) => {
    const f = fields()
    setField((cur) => f[(f.indexOf(cur) + dir + f.length) % f.length]!)
  }

  function refresh() {
    app.refreshMcp()
  }
  function openAdd() {
    setError("")
    setField("name")
    setView("add")
  }
  function removeAt(i: number) {
    const e = entries()[i]
    if (!e) return
    app.removeMcpServer(e[0])
    refresh()
    setSel((s) => Math.max(0, Math.min(s, entries().length - 2)))
  }

  async function add() {
    const name = (nameInput?.value ?? "").trim()
    const value = (valueInput?.value ?? "").trim()
    if (!name || !value) {
      setError("name and command/url are required")
      return
    }
    const token = (tokenInput?.value ?? "").trim()
    const server: McpServerConfig =
      kind() === "stdio"
        ? { type: "stdio", command: value.split(/\s+/) }
        : { type: "http", url: value, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }
    setError("connecting…")
    const ok = await app.addMcpServer(name, server)
    if (ok) {
      setView("list")
      setError("")
    } else {
      setError(`could not connect to "${name}"`)
    }
    refresh()
  }

  useKeyboard((key) => {
    if (!app.mcpModalOpen()) return
    if (view() === "list") {
      const n = entries().length
      if (key.name === "escape") return app.setMcpModalOpen(false)
      if (key.name === "a") return openAdd()
      if (!n) return
      if (key.name === "up" || key.name === "k") return setSel((s) => (s - 1 + n) % n)
      if (key.name === "down" || key.name === "j") return setSel((s) => (s + 1) % n)
      if (key.name === "x" || key.name === "delete" || key.name === "backspace") return removeAt(clamped())
      return
    }
    // add view — field navigation never collides with typing: Tab/↑/↓ move between fields, and only
    // when the (input-less) "kind" field is active do ←/→/space toggle the server type or ⏎ advance.
    if (key.name === "escape") return setView("list")
    if (key.name === "tab") return moveField(key.shift ? -1 : 1)
    if (key.name === "down") return moveField(1)
    if (key.name === "up") return moveField(-1)
    if (field() === "kind") {
      if (key.name === "left" || key.name === "right" || key.name === "space")
        return setKind((k) => (k === "stdio" ? "http" : "stdio"))
      if (key.name === "return") return setField("name")
    }
    // For input fields, ⏎ is handled by the input's onSubmit (→ add); we don't touch it here.
  })

  return (
    <Scrim onClose={() => app.setMcpModalOpen(false)}>
      <Overlay title="/mcp" hint="model context protocol servers" width={Math.min(68, dims().width - 4)}>
        <Show when={view() === "list"}>
          <box flexDirection="column">
            <Show when={entries().length} fallback={<text fg={theme.textFaint}>no servers configured</text>}>
              <For each={entries()}>
                {([name, cfg], i) => {
                  const on = () => clamped() === i()
                  return (
                    <box
                      flexDirection="row"
                      gap={1}
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={bandBg(on())}
                      onMouseOver={() => setSel(i())}
                    >
                      <text fg={connected().has(name) ? theme.success : on() ? theme.textOnAccent : theme.textFaint}>
                        {connected().has(name) ? G.bolt : G.dotOff}
                      </text>
                      <box width={16}>
                        <text fg={on() ? theme.textOnAccent : theme.text}>{name}</text>
                      </box>
                      <text fg={on() ? theme.textOnAccent : theme.textFaint}>
                        {(cfg as any).type === "stdio" ? (cfg as any).command?.join(" ") : (cfg as any).url}
                      </text>
                      <box flexGrow={1} />
                      <box onMouseDown={() => removeAt(i())}>
                        <text fg={on() ? theme.textOnAccent : theme.error}>✗</text>
                      </box>
                    </box>
                  )
                }}
              </For>
            </Show>
            <box height={1} />
            <Pill label="＋ add a server" hint="a" onClick={openAdd} />
          </box>
          <box flexDirection="row" gap={1}>
            <HintChip label="↑↓ select" />
            <HintChip label="x remove" accent={theme.error} />
            <HintChip label="a add" />
            <HintChip label="esc close" onClick={() => app.setMcpModalOpen(false)} />
          </box>
        </Show>

        <Show when={view() === "add"}>
          <box flexDirection="column" gap={1}>
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={field() === "kind" ? theme.brand : theme.textFaint}>type</text>
              <Tabs
                items={[
                  { label: "stdio", key: "stdio" },
                  { label: "http", key: "http" },
                ]}
                active={kind()}
                onSelect={(k) => {
                  setKind(k as "stdio" | "http")
                  setField("kind")
                }}
              />
              <text fg={theme.textFaint}>{field() === "kind" ? "←→ switch · ⏎ next" : "(tab here to switch)"}</text>
            </box>
            <Field label="name" focused={field() === "name"}>
              <input
                ref={(r: any) => (nameInput = r)}
                focused={field() === "name"}
                placeholder="my-server"
                placeholderColor={theme.textFaint}
              />
            </Field>
            <Field label={kind() === "stdio" ? "command" : "url"} focused={field() === "value"}>
              <input
                ref={(r: any) => (valueInput = r)}
                focused={field() === "value"}
                onSubmit={add}
                placeholder={kind() === "stdio" ? "npx -y @scope/mcp-server" : "https://example.com/mcp"}
                placeholderColor={theme.textFaint}
              />
            </Field>
            {/* Remote servers often need a bearer token / API key — sent as an Authorization header. */}
            <Show when={kind() === "http"}>
              <Field label="auth token (optional)" focused={field() === "token"}>
                <input
                  ref={(r: any) => (tokenInput = r)}
                  focused={field() === "token"}
                  onSubmit={add}
                  placeholder="bearer token / api key"
                  placeholderColor={theme.textFaint}
                />
              </Field>
            </Show>
            <Show when={error()}>
              <Meta text={error()} color={error() === "connecting…" ? theme.textMuted : theme.error} />
            </Show>
            <box flexDirection="row" gap={1}>
              <Pill label="connect" hint="⏎" accent={theme.success} onClick={add} />
              <Pill label="back" hint="esc" accent={theme.textMuted} onClick={() => setView("list")} />
            </box>
            <text fg={theme.textFaint}>tab / ↑↓ move between fields · ⏎ in a field connects</text>
          </box>
        </Show>
      </Overlay>
    </Scrim>
  )
}
