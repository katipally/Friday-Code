import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI as createOllamaProvider } from '@ai-sdk/openai';
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai';
import { db } from '../../db/index.js';
import { providers, models, settings } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { LanguageModelV1 } from 'ai';

export interface ProviderConfig {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'ollama';
  apiKey?: string | null;
  baseUrl?: string | null;
  isEnabled: boolean;
}

export interface ModelInfo {
  id: string;
  providerId: string;
  modelId: string;
  name: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsReasoning: boolean;
  contextWindow?: number;
}

// Detect if an Ollama model uses reasoning (via <think> tags through OpenAI-compat)
function isOllamaReasoningModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.includes('think') || lower.includes('reason') ||
    lower.includes('deepseek-r1') || lower.includes('qwq') ||
    lower.includes(':thinking');
}

// Create AI SDK model instance from provider + model config
export function createModel(provider: ProviderConfig, modelId: string): LanguageModelV1 {
  switch (provider.type) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: provider.apiKey || process.env.OPENAI_API_KEY || '',
        baseURL: provider.baseUrl || undefined,
      });
      return openai(modelId);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: provider.apiKey || process.env.ANTHROPIC_API_KEY || '',
        baseURL: provider.baseUrl || undefined,
      });
      return anthropic(modelId);
    }
    case 'ollama': {
      const ollama = createOllamaProvider({
        apiKey: 'ollama',
        baseURL: (provider.baseUrl || 'http://localhost:11434') + '/v1',
      });
      const baseModel = ollama(modelId);

      // All Ollama reasoning models use <think> tags through OpenAI-compat endpoint
      if (isOllamaReasoningModel(modelId)) {
        return wrapLanguageModel({
          model: baseModel,
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        });
      }
      return baseModel;
    }
    default:
      throw new Error(`Unknown provider type: ${provider.type}`);
  }
}

// Fetch models from provider API
export async function fetchModelsFromProvider(provider: ProviderConfig): Promise<ModelInfo[]> {
  const fetched: ModelInfo[] = [];

  try {
    switch (provider.type) {
      case 'openai': {
        const apiKey = provider.apiKey || process.env.OPENAI_API_KEY;
        if (!apiKey) return [];
        const res = await fetch(`${provider.baseUrl || 'https://api.openai.com/v1'}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return [];
        const data = await res.json() as { data: Array<{ id: string }> };
        for (const m of data.data) {
          if (m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('o4')) {
            fetched.push({
              id: `openai:${m.id}`,
              providerId: 'openai',
              modelId: m.id,
              name: m.id,
              supportsStreaming: true,
              supportsTools: !m.id.includes('instruct'),
              supportsReasoning: m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('o4'),
              contextWindow: m.id.includes('gpt-4') ? 128000 : 16384,
            });
          }
        }
        break;
      }
      case 'anthropic': {
        // Anthropic doesn't have a public list endpoint, so we use known models
        const claudeModels = [
          { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', reasoning: true, ctx: 200000 },
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', reasoning: false, ctx: 200000 },
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', reasoning: false, ctx: 200000 },
          { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', reasoning: false, ctx: 200000 },
        ];
        for (const m of claudeModels) {
          fetched.push({
            id: `anthropic:${m.id}`,
            providerId: 'anthropic',
            modelId: m.id,
            name: m.name,
            supportsStreaming: true,
            supportsTools: true,
            supportsReasoning: m.reasoning,
            contextWindow: m.ctx,
          });
        }
        break;
      }
      case 'ollama': {
        try {
          const baseUrl = provider.baseUrl || 'http://localhost:11434';
          const res = await fetch(`${baseUrl}/api/tags`);
          if (!res.ok) return [];
          const data = await res.json() as { models: Array<{ name: string; details?: { parameter_size?: string } }> };
          for (const m of data.models || []) {
            fetched.push({
              id: `ollama:${m.name}`,
              providerId: 'ollama',
              modelId: m.name,
              name: m.name,
              supportsStreaming: true,
              supportsTools: true,
              supportsReasoning: isOllamaReasoningModel(m.name),
            });
          }
        } catch {
          // Ollama might not be running
        }
        break;
      }
    }
  } catch {
    // Network error
  }

  return fetched;
}

// Get all configured providers from DB
export function getProviders(): ProviderConfig[] {
  return db.select().from(providers).all().map(p => ({
    id: p.id,
    name: p.name,
    type: p.type as 'openai' | 'anthropic' | 'ollama',
    apiKey: p.apiKey,
    baseUrl: p.baseUrl,
    isEnabled: p.isEnabled ?? true,
  }));
}

// Update provider API key
export function updateProviderKey(providerId: string, apiKey: string) {
  db.update(providers).set({ apiKey }).where(eq(providers.id, providerId)).run();
}

// Get or set a setting
export function getSetting(key: string): string | undefined {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value;
}

export function setSetting(key: string, value: string) {
  db.insert(settings).values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

// Save fetched models to DB
export function cacheModels(modelList: ModelInfo[]) {
  for (const m of modelList) {
    db.insert(models).values({
      id: m.id,
      providerId: m.providerId,
      modelId: m.modelId,
      name: m.name,
      supportsStreaming: m.supportsStreaming,
      supportsTools: m.supportsTools,
      supportsReasoning: m.supportsReasoning,
      contextWindow: m.contextWindow,
    }).onConflictDoUpdate({
      target: models.id,
      set: {
        name: m.name,
        supportsStreaming: m.supportsStreaming,
        supportsTools: m.supportsTools,
        supportsReasoning: m.supportsReasoning,
        contextWindow: m.contextWindow,
      },
    }).run();
  }
}

// Get cached models for a provider
export function getCachedModels(providerId?: string): ModelInfo[] {
  const query = providerId
    ? db.select().from(models).where(eq(models.providerId, providerId)).all()
    : db.select().from(models).all();

  return query.map(m => ({
    id: m.id,
    providerId: m.providerId,
    modelId: m.modelId,
    name: m.name,
    supportsStreaming: m.supportsStreaming ?? true,
    supportsTools: m.supportsTools ?? true,
    supportsReasoning: m.supportsReasoning ?? false,
    contextWindow: m.contextWindow ?? undefined,
  }));
}

// Get the currently active model configuration
export function getActiveModelConfig(): { provider: ProviderConfig; modelId: string } | null {
  const providerId = getSetting('active_provider');
  const modelId = getSetting('active_model');
  if (!providerId || !modelId) return null;

  const provider = db.select().from(providers).where(eq(providers.id, providerId)).get();
  if (!provider) return null;

  return {
    provider: {
      id: provider.id,
      name: provider.name,
      type: provider.type as 'openai' | 'anthropic' | 'ollama',
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      isEnabled: provider.isEnabled ?? true,
    },
    modelId,
  };
}
