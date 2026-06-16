import type { ChatRequest, ProviderEvent, ProviderInfo } from "@friday/shared"
import { streamAnthropic } from "./anthropic.ts"
import { streamOpenAI } from "./openai.ts"
import { streamOpenAIResponses } from "./openai-responses.ts"
import { streamGoogle } from "./google.ts"

export * from "./registry.ts"
export * from "./auth.ts"
export * from "./catalog.ts"
export * from "./models.ts"
export * from "./paths.ts"

/** Dispatch a streaming chat request to the right wire adapter. */
export function streamProvider(
  provider: ProviderInfo,
  apiKey: string | undefined,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ProviderEvent> {
  const headers = provider.id === "openrouter" ? { "HTTP-Referer": "https://friday.code", "X-Title": "Friday Code" } : undefined
  if (provider.protocol === "anthropic") return streamAnthropic({ baseURL: provider.baseURL, apiKey, req, signal, headers })
  if (provider.protocol === "google") return streamGoogle({ baseURL: provider.baseURL, apiKey, req, signal })
  // OpenAI (and any provider that advertises it) uses the newer Responses API.
  if (provider.supportsResponses) return streamOpenAIResponses({ baseURL: provider.baseURL, apiKey, req, signal, headers })
  return streamOpenAI({ baseURL: provider.baseURL, apiKey, req, signal, headers })
}
