import type { ProviderInfo } from "@friday/shared"

/**
 * Built-in providers. Everything except Anthropic speaks the OpenAI-compatible protocol, so one
 * adapter covers the long tail. `catalogId` maps to the models.dev provider key for the catalog.
 */
export interface BuiltinProvider extends ProviderInfo {
  catalogId?: string
}

export const BUILTIN_PROVIDERS: BuiltinProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
    envKeys: ["ANTHROPIC_API_KEY"],
    catalogId: "anthropic",
  },
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    baseURL: "https://api.openai.com/v1",
    envKeys: ["OPENAI_API_KEY"],
    catalogId: "openai",
  },
  {
    id: "google",
    name: "Google Gemini",
    protocol: "google",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    catalogId: "google",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai",
    baseURL: "https://openrouter.ai/api/v1",
    envKeys: ["OPENROUTER_API_KEY"],
    catalogId: "openrouter",
  },
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    protocol: "openai",
    baseURL: "https://opencode.ai/zen/v1",
    envKeys: ["OPENCODE_API_KEY"],
    catalogId: "opencode",
  },
  {
    id: "groq",
    name: "Groq",
    protocol: "openai",
    baseURL: "https://api.groq.com/openai/v1",
    envKeys: ["GROQ_API_KEY"],
    catalogId: "groq",
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    protocol: "openai",
    baseURL: "https://api.moonshot.ai/v1",
    envKeys: ["MOONSHOT_API_KEY"],
    catalogId: "moonshotai",
  },
  {
    id: "minimax",
    name: "MiniMax",
    protocol: "openai",
    baseURL: "https://api.minimax.io/v1",
    envKeys: ["MINIMAX_API_KEY"],
    catalogId: "minimax",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    baseURL: "https://api.deepseek.com/v1",
    envKeys: ["DEEPSEEK_API_KEY"],
    catalogId: "deepseek",
  },
  {
    id: "together",
    name: "Together",
    protocol: "openai",
    baseURL: "https://api.together.xyz/v1",
    envKeys: ["TOGETHER_API_KEY"],
    catalogId: "togetherai",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    protocol: "openai",
    baseURL: "https://api.x.ai/v1",
    envKeys: ["XAI_API_KEY"],
    catalogId: "xai",
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    protocol: "openai",
    baseURL: "http://localhost:11434/v1",
    keyless: true,
  },
  {
    id: "llamacpp",
    name: "llama.cpp / LM Studio (local)",
    protocol: "openai",
    baseURL: "http://localhost:8080/v1",
    keyless: true,
  },
]

/** Small offline snapshot so the /model picker always has options (overridden by models.dev). */
export const MODEL_SNAPSHOT: Record<string, string[]> = {
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-5", "gpt-5-mini", "o3"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
  openrouter: ["anthropic/claude-opus-4-8", "openai/gpt-5", "moonshotai/kimi-k2"],
  "opencode-zen": ["claude-sonnet-4-6", "kimi-k2", "gpt-5", "minimax-m2.5"],
  groq: ["moonshotai/kimi-k2-instruct", "llama-3.3-70b-versatile"],
  moonshot: ["kimi-k2-0711-preview", "kimi-k2-turbo-preview", "moonshot-v1-128k"],
  minimax: ["MiniMax-M2.5", "abab7-chat-preview"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  together: ["moonshotai/Kimi-K2-Instruct", "meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  xai: ["grok-4", "grok-3"],
  ollama: ["llama3.3", "qwen2.5-coder:7b"],
  llamacpp: [],
}
