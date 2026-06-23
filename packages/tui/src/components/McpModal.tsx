import type { McpServerConfig } from "@friday/core"
import { theme } from "@friday/shared"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal, For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { G } from "../util/term.ts"
import { Scrim } from "./Scrim.tsx"
import { HintChip, Meta, Overlay, Pill, SectionLabel, Tabs } from "./ui.tsx"

type View = "list" | "add"

/** View / add / remove MCP servers. Add a stdio command or an http URL; connects live. */
export function McpModal() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const [view, setView] = createSignal<View>("list")
  const [kind, setKind] = createSignal<"stdio" | "http">("stdio")
  const [error, setError] = createSignal("")
  let nameInput: any
  let valueInput: any
  let tokenInput: any

  const config = () => app.mcpConfig()
  const connected = () => new Set(app.mcpServers())
  const entries = () => Object.entries(config())

  function refresh() {
    app.refreshMcp()
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
    if (key.name === "escape") {
      if (view() === "add") setView("list")
      else app.setMcpModalOpen(false)
    } else if (key.name === "tab" && view() === "add") {
      setKind((k) => (k === "stdio" ? "http" : "stdio"))
    }
  })

  return (
    <Scrim onClose={() => app.setMcpModalOpen(false)}>
      <Overlay title="/mcp" hint="model context protocol servers" width={Math.min(68, dims().width - 4)}>
        <Show when={view() === "list"}>
          <box flexDirection="column">
            <Show when={entries().length} fallback={<text fg={theme.textFaint}>no servers configured</text>}>
              <For each={entries()}>
                {([name, cfg]) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={connected().has(name) ? theme.success : theme.textFaint}>
                      {connected().has(name) ? G.bolt : G.dotOff}
                    </text>
                    <box width={16}>
                      <text fg={theme.text}>{name}</text>
                    </box>
                    <text fg={theme.textFaint}>
                      {(cfg as any).type === "stdio" ? (cfg as any).command?.join(" ") : (cfg as any).url}
                    </text>
                    <box flexGrow={1} />
                    <box
                      onMouseDown={() => {
                        app.removeMcpServer(name)
                        refresh()
                      }}
                    >
                      <text fg={theme.error}>✗</text>
                    </box>
                  </box>
                )}
              </For>
            </Show>
            <box height={1} />
            <Pill
              label="＋ add a server"
              onClick={() => {
                setError("")
                setView("add")
              }}
            />
          </box>
          <box flexDirection="row">
            <HintChip label="esc close" onClick={() => app.setMcpModalOpen(false)} />
          </box>
        </Show>

        <Show when={view() === "add"}>
          <box flexDirection="column" gap={1}>
            <box flexDirection="row" gap={1} alignItems="center">
              <Tabs
                items={[
                  { label: "stdio", key: "stdio" },
                  { label: "http", key: "http" },
                ]}
                active={kind()}
                onSelect={(k) => setKind(k as "stdio" | "http")}
              />
              <text fg={theme.textFaint}>(tab)</text>
            </box>
            <box flexDirection="column">
              <SectionLabel text="name" />
              <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                <input
                  ref={(r: any) => (nameInput = r)}
                  focused
                  placeholder="my-server"
                  placeholderColor={theme.textFaint}
                />
              </box>
            </box>
            <box flexDirection="column">
              <SectionLabel text={kind() === "stdio" ? "command (e.g. npx -y some-mcp)" : "url"} />
              <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                <input
                  ref={(r: any) => (valueInput = r)}
                  onSubmit={add}
                  placeholder={kind() === "stdio" ? "npx -y @scope/mcp-server" : "https://example.com/mcp"}
                  placeholderColor={theme.textFaint}
                />
              </box>
            </box>
            {/* Remote servers often need a bearer token / API key — sent as an Authorization header. */}
            <Show when={kind() === "http"}>
              <box flexDirection="column">
                <SectionLabel text="auth token (optional)" />
                <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                  <input
                    ref={(r: any) => (tokenInput = r)}
                    onSubmit={add}
                    placeholder="bearer token / api key"
                    placeholderColor={theme.textFaint}
                  />
                </box>
              </box>
            </Show>
            <Show when={error()}>
              <Meta text={error()} color={error() === "connecting…" ? theme.textMuted : theme.error} />
            </Show>
            <box flexDirection="row" gap={1}>
              <Pill label="connect" accent={theme.success} onClick={add} />
              <Pill label="back esc" accent={theme.textMuted} onClick={() => setView("list")} />
            </box>
          </box>
        </Show>
      </Overlay>
    </Scrim>
  )
}
