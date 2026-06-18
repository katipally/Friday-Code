import type { streamProvider } from "@friday/providers"
import type { ProviderEvent, ProviderInfo } from "@friday/shared"

/** The provider streaming function (overridable in tests). */
export type StreamFn = (
  provider: ProviderInfo,
  apiKey: string | undefined,
  req: Parameters<typeof streamProvider>[2],
  signal: AbortSignal,
) => AsyncGenerator<ProviderEvent>
