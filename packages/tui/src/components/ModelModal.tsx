import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { EFFORTS, theme, getMode, type ProviderInfo } from "@friday/shared"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"

type Step = "provider" | "key" | "model" | "effort"

function fmtCtx(n?: number): string {
  if (!n) return ""
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}
function fmtCost(c?: { input: number; output: number }): string {
  if (!c) return ""
  const r = (x: number) => (x >= 1 ? x.toFixed(0) : x.toFixed(2).replace(/\.?0+$/, ""))
  return `$${r(c.input)}/${r(c.output)}`
}

function Row(props: { active: boolean; accent: string; onClick: () => void; children: any; id?: string }) {
  return (
    <box
      id={props.id}
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.active ? theme.bgHover : "transparent"}
      onMouseDown={props.onClick}
    >
      <text fg={props.active ? props.accent : theme.textFaint}>{props.active ? "›" : " "}</text>
      {props.children}
    </box>
  )
}

export function ModelModal() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent

  const providers = app.engine.listProviders()
  const auth = app.engine.authState()

  const [step, setStep] = createSignal<Step>("provider")
  const [pIndex, setPIndex] = createSignal(0)
  const [provider, setProvider] = createSignal<ProviderInfo | null>(null)
  const [apiKey, setApiKey] = createSignal("")
  const [baseURL, setBaseURL] = createSignal("")
  const [mIndex, setMIndex] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [chosenModel, setChosenModel] = createSignal("")
  const [chosenReasoning, setChosenReasoning] = createSignal(false)
  const [eIndex, setEIndex] = createSignal(1)
  const [keyField, setKeyField] = createSignal<"key" | "url">("key")
  let scrollRef: any

  const [models] = createResource(
    () => (step() === "model" ? provider()?.id : undefined),
    (id) => app.engine.listModels(id),
  )

  const modelList = createMemo(() => models() ?? [])
  const filtered = createMemo(() => {
    const q = query().toLowerCase()
    return q ? modelList().filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : modelList()
  })

  // reset + scroll the highlighted model into view
  createEffect(() => {
    filtered().length
    setMIndex(0)
  })
  createEffect(() => {
    if (step() === "model") scrollRef?.scrollChildIntoView?.(`m-${mIndex()}`)
  })

  function chooseProvider(p: ProviderInfo) {
    setProvider(p)
    setQuery("")
    const a = auth[p.id]
    if (p.keyless || a?.hasKey) setStep("model")
    else {
      setApiKey("")
      setBaseURL(p.baseURL)
      setKeyField("key")
      setStep("key")
    }
  }

  function confirmKey() {
    setStep("model")
  }

  function chooseModel(modelId: string) {
    if (!modelId) return
    setChosenModel(modelId)
    const m = modelList().find((x) => x.id === modelId)
    const reasoning = !!m?.reasoning // custom / unknown models default to non-reasoning (safe)
    setChosenReasoning(reasoning)
    if (reasoning) setStep("effort")
    else finalize() // non-reasoning model — no effort step, and effort won't be sent
  }

  function finalize() {
    const p = provider()
    if (!p) return
    if (chosenReasoning()) app.setEffort(EFFORTS[eIndex()] ?? "medium")
    const picked = modelList().find((x) => x.id === chosenModel())
    app.connectAndSelect(
      p.id,
      chosenModel(),
      chosenReasoning(),
      apiKey() || undefined,
      baseURL() && baseURL() !== p.baseURL ? baseURL() : undefined,
      picked?.contextWindow,
      picked?.cost,
    )
  }

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (step() === "provider") return app.setModelModalOpen(false)
      if (step() === "key") return setStep("provider")
      if (step() === "model") return setStep(provider()?.keyless || auth[provider()!.id]?.hasKey ? "provider" : "key")
      if (step() === "effort") return setStep("model")
      return
    }
    if (step() === "key") {
      if (key.name === "tab") setKeyField((f) => (f === "key" ? "url" : "key"))
      return
    }
    if (step() === "provider") {
      if (key.name === "up") setPIndex((i) => Math.max(0, i - 1))
      else if (key.name === "down") setPIndex((i) => Math.min(providers.length - 1, i + 1))
      else if (key.name === "return" || key.name === "enter") chooseProvider(providers[pIndex()]!)
    } else if (step() === "model") {
      const items = filtered()
      if (key.name === "up") setMIndex((i) => Math.max(0, i - 1))
      else if (key.name === "down") setMIndex((i) => Math.min(items.length - 1, i + 1))
      else if (key.name === "return" || key.name === "enter") {
        const m = items[mIndex()]
        if (m) chooseModel(m.id)
        else if (query().trim()) chooseModel(query().trim()) // custom id when no match
      }
    } else if (step() === "effort") {
      if (key.name === "up") setEIndex((i) => Math.max(0, i - 1))
      else if (key.name === "down") setEIndex((i) => Math.min(EFFORTS.length - 1, i + 1))
      else if (key.name === "return" || key.name === "enter") finalize()
    }
  })

  return (
    <Scrim onClose={() => app.setModelModalOpen(false)}>
      <box
        flexDirection="column"
        width={64}
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
          <text fg={accent()}>/model</text>
          <text fg={theme.textFaint}>· connect a provider and pick a model</text>
        </box>

        <Switch>
          <Match when={step() === "provider"}>
            <box flexDirection="column">
              <For each={providers}>
                {(p, i) => (
                  <Row active={pIndex() === i()} accent={accent()} onClick={() => chooseProvider(p)}>
                    <box width={26}>
                      <text fg={pIndex() === i() ? theme.text : theme.textMuted}>{p.name}</text>
                    </box>
                    <text fg={auth[p.id]?.hasKey || p.keyless ? theme.success : theme.textFaint}>
                      {p.keyless ? "local" : auth[p.id]?.hasKey ? "● connected" : "○ needs key"}
                    </text>
                  </Row>
                )}
              </For>
            </box>
            <text fg={theme.textFaint}>↑↓ move · ⏎ select · esc close</text>
          </Match>

          <Match when={step() === "key"}>
            <box flexDirection="column" gap={1}>
              <text fg={theme.text}>Connect {provider()?.name}</text>
              <box flexDirection="column" onMouseDown={() => setKeyField("key")}>
                <text fg={theme.textFaint}>API key</text>
                <box border borderStyle="rounded" borderColor={keyField() === "key" ? accent() : theme.border} paddingLeft={1} paddingRight={1}>
                  <input
                    value={apiKey()}
                    onInput={setApiKey}
                    onSubmit={confirmKey}
                    focused={keyField() === "key"}
                    placeholder="paste your API key…"
                    placeholderColor={theme.textFaint}
                  />
                </box>
              </box>
              <box flexDirection="column" onMouseDown={() => setKeyField("url")}>
                <text fg={theme.textFaint}>base URL (optional override · tab)</text>
                <box border borderStyle="rounded" borderColor={keyField() === "url" ? accent() : theme.border} paddingLeft={1} paddingRight={1}>
                  <input
                    value={baseURL()}
                    onInput={setBaseURL}
                    onSubmit={confirmKey}
                    focused={keyField() === "url"}
                    placeholderColor={theme.textFaint}
                  />
                </box>
              </box>
              <box flexDirection="row" gap={2}>
                <box border borderStyle="rounded" borderColor={theme.success} paddingLeft={1} paddingRight={1} onMouseDown={confirmKey}>
                  <text fg={theme.success}>connect ⏎</text>
                </box>
                <box border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1} onMouseDown={() => setStep("provider")}>
                  <text fg={theme.textMuted}>back  esc</text>
                </box>
              </box>
            </box>
          </Match>

          <Match when={step() === "model"}>
            <box flexDirection="column" gap={1}>
              <box flexDirection="row" gap={1} alignItems="center">
                <text fg={theme.text}>{provider()?.name}</text>
                <box flexGrow={1} border borderStyle="rounded" borderColor={accent()} paddingLeft={1} paddingRight={1}>
                  <input
                    value={query()}
                    onInput={setQuery}
                    focused
                    placeholder="filter or type a model id…"
                    placeholderColor={theme.textFaint}
                  />
                </box>
              </box>
              <Show when={models.loading}>
                <text fg={theme.textFaint}>loading models…</text>
              </Show>
              <scrollbox ref={(r: any) => (scrollRef = r)} maxHeight={12}>
                <For each={filtered()}>
                  {(m, i) => (
                    <Row id={`m-${i()}`} active={mIndex() === i()} accent={accent()} onClick={() => chooseModel(m.id)}>
                      <text fg={mIndex() === i() ? theme.text : theme.textMuted}>{m.name}</text>
                      <box flexGrow={1} />
                      <Show when={m.reasoning}>
                        <text fg={accent()}>◇</text>
                      </Show>
                      <Show when={m.contextWindow}>
                        <text fg={theme.textFaint}>{fmtCtx(m.contextWindow)}</text>
                      </Show>
                      <Show when={m.cost}>
                        <text fg={theme.textFaint}>{fmtCost(m.cost)}</text>
                      </Show>
                    </Row>
                  )}
                </For>
              </scrollbox>
              <text fg={theme.textFaint}>↑↓ move · ⏎ select · esc back · {filtered().length} models</text>
            </box>
          </Match>

          <Match when={step() === "effort"}>
            <box flexDirection="column">
              <text fg={theme.text}>reasoning effort for {chosenModel()}</text>
              <For each={EFFORTS}>
                {(eff, i) => (
                  <Row active={eIndex() === i()} accent={accent()} onClick={() => { setEIndex(i()); finalize() }}>
                    <text fg={eIndex() === i() ? theme.text : theme.textMuted}>{eff}</text>
                  </Row>
                )}
              </For>
              <text fg={theme.textFaint}>↑↓ move · ⏎ confirm · esc back</text>
            </box>
          </Match>
        </Switch>
      </box>
    </Scrim>
  )
}
