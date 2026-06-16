import type { ProviderEvent, ProviderInfo } from "@friday/shared"
import type { streamProvider } from "@friday/providers"

/** The provider streaming function (overridable in tests). */
export type StreamFn = (
  provider: ProviderInfo,
  apiKey: string | undefined,
  req: Parameters<typeof streamProvider>[2],
  signal: AbortSignal,
) => AsyncGenerator<ProviderEvent>
