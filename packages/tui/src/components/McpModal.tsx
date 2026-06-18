import { createSignal, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import type { McpServerConfig } from "@friday/core"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"
import { G } from "../util/term.ts"

type View = "list" | "add"

/** View / add / remove MCP servers. Add a stdio command or an http URL; connects live. */
export function McpModal() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
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
      <box
        flexDirection="column"
        width={68}
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
        <box flexDirection="row" gap={1}>
          <text fg={accent()}>/mcp</text>
          <text fg={theme.textFaint}>· model context protocol servers</text>
        </box>

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
                    <box onMouseDown={() => { app.removeMcpServer(name); refresh() }}>
                      <text fg={theme.error}>✗</text>
                    </box>
                  </box>
                )}
              </For>
            </Show>
            <box height={1} />
            <box onMouseDown={() => { setError(""); setView("add") }}>
              <text fg={accent()}>+ add a server</text>
            </box>
          </box>
          <text fg={theme.textFaint}>esc close</text>
        </Show>

        <Show when={view() === "add"}>
          <box flexDirection="column" gap={1}>
            <box flexDirection="row" gap={2}>
              <box onMouseDown={() => setKind("stdio")}>
                <text fg={kind() === "stdio" ? accent() : theme.textFaint}>{kind() === "stdio" ? "● " : "○ "}stdio</text>
              </box>
              <box onMouseDown={() => setKind("http")}>
                <text fg={kind() === "http" ? accent() : theme.textFaint}>{kind() === "http" ? "● " : "○ "}http</text>
              </box>
              <text fg={theme.textFaint}>(tab)</text>
            </box>
            <box flexDirection="column">
              <text fg={theme.textFaint}>name</text>
              <box border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1}>
                <input ref={(r: any) => (nameInput = r)} focused placeholder="my-server" placeholderColor={theme.textFaint} />
              </box>
            </box>
            <box flexDirection="column">
              <text fg={theme.textFaint}>{kind() === "stdio" ? "command (e.g. npx -y some-mcp)" : "url"}</text>
              <box border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1}>
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
                <text fg={theme.textFaint}>auth token (optional)</text>
                <box border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1}>
                  <input ref={(r: any) => (tokenInput = r)} onSubmit={add} placeholder="bearer token / api key" placeholderColor={theme.textFaint} />
                </box>
              </box>
            </Show>
            <Show when={error()}>
              <text fg={error() === "connecting…" ? theme.textMuted : theme.error}>{error()}</text>
            </Show>
            <box flexDirection="row" gap={2}>
              <box border borderStyle="rounded" borderColor={theme.success} paddingLeft={1} paddingRight={1} onMouseDown={add}>
                <text fg={theme.success}>connect</text>
              </box>
              <box border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1} onMouseDown={() => setView("list")}>
                <text fg={theme.textMuted}>back esc</text>
              </box>
            </box>
          </box>
        </Show>
      </box>
    </Scrim>
  )
}
