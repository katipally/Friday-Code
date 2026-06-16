import { createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { EFFORTS, theme, getMode, type ProviderInfo } from "@friday/shared"
import { useApp } from "../store.tsx"
import { Scrim } from "./Scrim.tsx"

type Step = "provider" | "key" | "model" | "effort"

function Row(props: { active: boolean; accent: string; onClick: () => void; children: any }) {
  return (
    <box
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
  const [customModel, setCustomModel] = createSignal("")
  const [eIndex, setEIndex] = createSignal(1)
  const [field, setField] = createSignal<"list" | "input">("list")

  const [models] = createResource(
    () => (step() === "model" ? provider()?.id : undefined),
    (id) => app.engine.listModels(id),
  )

  const modelList = createMemo(() => models() ?? [])

  function chooseProvider(p: ProviderInfo) {
    setProvider(p)
    const a = auth[p.id]
    if (p.keyless || a?.hasKey) {
      setStep("model")
      setField("list")
    } else {
      setApiKey("")
      setBaseURL(p.baseURL)
      setStep("key")
    }
  }

  function confirmKey() {
    setStep("model")
    setField("list")
  }

  function chooseModel(modelId: string) {
    if (!modelId) return
    setCustomModel(modelId)
    setStep("effort")
  }

  function finalize() {
    const p = provider()
    if (!p) return
    const eff = EFFORTS[eIndex()] ?? "medium"
    app.setEffort(eff)
    app.connectAndSelect(p.id, customModel(), apiKey() || undefined, baseURL() && baseURL() !== p.baseURL ? baseURL() : undefined)
  }

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (step() === "provider") return app.setModelModalOpen(false)
      if (step() === "key") return setStep("provider")
      if (step() === "model") return setStep(provider()?.keyless || auth[provider()!.id]?.hasKey ? "provider" : "key")
      if (step() === "effort") return setStep("model")
      return
    }
    if (step() === "provider") {
      if (key.name === "up") setPIndex((i) => Math.max(0, i - 1))
      else if (key.name === "down") setPIndex((i) => Math.min(providers.length - 1, i + 1))
      else if (key.name === "return" || key.name === "enter") chooseProvider(providers[pIndex()]!)
    } else if (step() === "model" && field() === "list") {
      if (key.name === "up") setMIndex((i) => Math.max(0, i - 1))
      else if (key.name === "down") setMIndex((i) => Math.min(modelList().length - 1, i + 1))
      else if (key.name === "return" || key.name === "enter") {
        const m = modelList()[mIndex()]
        if (m) chooseModel(m.id)
      } else if (key.name === "tab") setField("input")
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
              <box flexDirection="column">
                <text fg={theme.textFaint}>API key</text>
                <box border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1}>
                  <input
                    value={apiKey()}
                    onInput={setApiKey}
                    onSubmit={confirmKey}
                    focused
                    placeholder="paste your API key…"
                    placeholderColor={theme.textFaint}
                  />
                </box>
              </box>
              <box flexDirection="column">
                <text fg={theme.textFaint}>base URL (optional override)</text>
                <box border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1}>
                  <input value={baseURL()} onInput={setBaseURL} onSubmit={confirmKey} placeholderColor={theme.textFaint} />
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
            <box flexDirection="column">
              <text fg={theme.text}>{provider()?.name} · pick a model</text>
              <Show when={models.loading}>
                <text fg={theme.textFaint}>loading models…</text>
              </Show>
              <box flexDirection="column" maxHeight={12}>
                <scrollbox maxHeight={10}>
                  <For each={modelList()}>
                    {(m, i) => (
                      <Row active={field() === "list" && mIndex() === i()} accent={accent()} onClick={() => chooseModel(m.id)}>
                        <text fg={field() === "list" && mIndex() === i() ? theme.text : theme.textMuted}>{m.name}</text>
                      </Row>
                    )}
                  </For>
                </scrollbox>
              </box>
              <box flexDirection="column">
                <text fg={theme.textFaint}>…or type a model id (tab)</text>
                <box border borderStyle="rounded" borderColor={field() === "input" ? accent() : theme.border} paddingLeft={1} paddingRight={1} onMouseDown={() => setField("input")}>
                  <input
                    value={customModel()}
                    onInput={setCustomModel}
                    onSubmit={() => chooseModel(customModel())}
                    focused={field() === "input"}
                    placeholder="e.g. gpt-5"
                    placeholderColor={theme.textFaint}
                  />
                </box>
              </box>
              <text fg={theme.textFaint}>↑↓ move · ⏎ select · tab custom · esc back</text>
            </box>
          </Match>

          <Match when={step() === "effort"}>
            <box flexDirection="column">
              <text fg={theme.text}>reasoning effort for {customModel()}</text>
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
