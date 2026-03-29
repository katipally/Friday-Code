import { streamText, type CoreMessage, type ToolResultPart } from 'ai';
import { createModel, getActiveModelConfig, type ProviderConfig } from '../providers/registry.js';
import { createTools } from '../tools/tools.js';
import { db } from '../../db/index.js';
import { messages as messagesTable, conversations } from '../../db/schema.js';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call-start'; toolName: string; args: unknown }
  | { type: 'tool-result'; toolName: string; result: unknown }
  | { type: 'finish'; text: string; usage?: { promptTokens: number; completionTokens: number }; finishReason: string }
  | { type: 'error'; error: string }
  | { type: 'status'; message: string };

export interface EngineConfig {
  workingDirectory: string;
  conversationId?: string;
  systemPrompt?: string;
  maxSteps?: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are Friday Code, an expert AI coding assistant running in the terminal. You help users with software engineering tasks.

Key behaviors:
- You have access to file system tools (read, write, edit, search) and shell commands.
- Always read files before editing them to understand context.
- Make precise, surgical changes — don't rewrite entire files unnecessarily.
- Explain what you're doing concisely.
- When you make mistakes, acknowledge and fix them.
- Run tests/linters after changes when available.
- Be concise but thorough.

Working directory: {cwd}`;

export class AgentEngine {
  private config: EngineConfig;
  private conversationId: string;
  private messageHistory: CoreMessage[] = [];
  private abortController: AbortController | null = null;

  constructor(config: EngineConfig) {
    this.config = config;
    this.conversationId = config.conversationId || nanoid();
  }

  getConversationId(): string {
    return this.conversationId;
  }

  // Load conversation history from DB
  loadHistory() {
    const rows = db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, this.conversationId))
      .all();

    this.messageHistory = rows.map(r => {
      if (r.role === 'user') {
        return { role: 'user' as const, content: r.content };
      } else if (r.role === 'assistant') {
        return { role: 'assistant' as const, content: r.content };
      } else {
        return { role: r.role as 'user', content: r.content };
      }
    });
  }

  // Ensure conversation exists in DB
  ensureConversation() {
    const existing = db.select().from(conversations)
      .where(eq(conversations.id, this.conversationId)).get();

    if (!existing) {
      db.insert(conversations).values({
        id: this.conversationId,
        workingDirectory: this.config.workingDirectory,
        title: 'New Chat',
      }).run();
    }
  }

  // Save a message to DB
  private saveMessage(role: 'user' | 'assistant' | 'tool', content: string, extra?: {
    reasoning?: string;
    toolCalls?: string;
    toolResults?: string;
    tokenUsage?: string;
    finishReason?: string;
    modelId?: string;
  }) {
    db.insert(messagesTable).values({
      id: nanoid(),
      conversationId: this.conversationId,
      role,
      content,
      ...extra,
    }).run();
  }

  abort() {
    this.abortController?.abort();
    this.abortController = null;
  }

  // Main agent loop — yields streaming events
  async *run(userMessage: string): AsyncGenerator<StreamEvent> {
    const modelConfig = getActiveModelConfig();
    if (!modelConfig) {
      yield { type: 'error', error: 'No model configured. Use /model to select one.' };
      return;
    }

    this.ensureConversation();

    // Add user message
    this.messageHistory.push({ role: 'user', content: userMessage });
    this.saveMessage('user', userMessage);

    const systemPrompt = (this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT)
      .replace('{cwd}', this.config.workingDirectory);

    const tools = createTools(this.config.workingDirectory);
    const model = createModel(modelConfig.provider, modelConfig.modelId);

    this.abortController = new AbortController();

    let fullText = '';
    let fullReasoning = '';
    const toolCallsLog: any[] = [];

    try {
      yield { type: 'status', message: `Using ${modelConfig.provider.name} / ${modelConfig.modelId}` };

      // Build provider-specific options for reasoning
      const providerOptions: Record<string, any> = {};
      if (modelConfig.provider.type === 'anthropic') {
        providerOptions.anthropic = {
          thinking: { type: 'enabled', budgetTokens: 8000 },
        };
      }

      const result = streamText({
        model,
        system: systemPrompt,
        messages: this.messageHistory,
        tools,
        maxSteps: this.config.maxSteps || 10,
        abortSignal: this.abortController.signal,
        maxRetries: 2,
        providerOptions,
        onStepFinish: (event) => {
          if (event.toolCalls && event.toolCalls.length > 0) {
            toolCallsLog.push(...event.toolCalls);
          }
        },
      });

      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case 'text-delta':
            fullText += chunk.textDelta;
            yield { type: 'text-delta', text: chunk.textDelta };
            break;

          case 'reasoning':
            fullReasoning += chunk.textDelta;
            yield { type: 'reasoning', text: chunk.textDelta };
            break;

          case 'tool-call':
            yield {
              type: 'tool-call-start',
              toolName: chunk.toolName,
              args: chunk.args,
            };
            break;

          case 'tool-result':
            yield {
              type: 'tool-result',
              toolName: chunk.toolName,
              result: chunk.result,
            };
            break;

          case 'error':
            yield { type: 'error', error: String(chunk.error) };
            break;

          case 'finish':
            // Final event
            break;
        }
      }

      // Get final usage
      let usage: any;
      try { usage = await result.usage; } catch { usage = null; }
      const finishReason = await result.finishReason;

      // Save assistant response
      this.messageHistory.push({ role: 'assistant', content: fullText });
      this.saveMessage('assistant', fullText, {
        reasoning: fullReasoning || undefined,
        toolCalls: toolCallsLog.length > 0 ? JSON.stringify(toolCallsLog) : undefined,
        tokenUsage: usage ? JSON.stringify(usage) : undefined,
        finishReason: finishReason,
        modelId: modelConfig.modelId,
      });

      // Auto-title conversation if first exchange
      if (this.messageHistory.length <= 2) {
        const title = userMessage.slice(0, 80) + (userMessage.length > 80 ? '...' : '');
        db.update(conversations)
          .set({ title })
          .where(eq(conversations.id, this.conversationId))
          .run();
      }

      const pTokens = usage?.promptTokens ?? usage?.prompt_tokens ?? 0;
      const cTokens = usage?.completionTokens ?? usage?.completion_tokens ?? 0;

      yield {
        type: 'finish',
        text: fullText,
        usage: (pTokens || cTokens) ? { promptTokens: pTokens, completionTokens: cTokens } : undefined,
        finishReason: finishReason || 'stop',
      };

    } catch (e: any) {
      if (e.name === 'AbortError') {
        yield { type: 'status', message: 'Generation cancelled.' };
      } else {
        yield { type: 'error', error: e.message || String(e) };
      }
    } finally {
      this.abortController = null;
    }
  }

  // Clear conversation history
  clearHistory() {
    this.messageHistory = [];
    this.conversationId = nanoid();
  }

  setWorkingDirectory(dir: string) {
    this.config.workingDirectory = dir;
  }

  getWorkingDirectory(): string {
    return this.config.workingDirectory;
  }

  getMessageCount(): number {
    return this.messageHistory.length;
  }
}
