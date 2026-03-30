import { streamText, type CoreMessage } from 'ai';
import { createModel, getActiveModelConfig } from '../providers/registry.js';
import { createTools, TOOL_SAFETY } from '../tools/tools.js';
import { db } from '../../db/index.js';
import { conversations, messages as messagesTable } from '../../db/schema.js';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

export type StreamEvent =
  | { type: 'step-start'; stepNumber: number; messageId: string }
  | {
      type: 'step-finish';
      stepNumber: number;
      finishReason: string;
      usage?: { promptTokens: number; completionTokens: number };
      isContinued: boolean;
    }
  | { type: 'text-delta'; text: string; stepNumber: number }
  | { type: 'reasoning'; text: string; stepNumber: number }
  | { type: 'tool-call-streaming-start'; stepNumber: number; toolCallId: string; toolName: string }
  | { type: 'tool-call-delta'; stepNumber: number; toolCallId: string; toolName: string; argsText: string }
  | { type: 'tool-call'; stepNumber: number; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool-result'; stepNumber: number; toolCallId: string; toolName: string; result: unknown }
  | {
      type: 'finish';
      text: string;
      reasoning?: string;
      usage?: { promptTokens: number; completionTokens: number };
      finishReason: string;
      totalSteps: number;
    }
  | { type: 'error'; error: string }
  | { type: 'status'; message: string }
  | { type: 'tool-approval-request'; stepNumber: number; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool-approval-response'; toolCallId: string; approved: boolean };

export interface EngineConfig {
  workingDirectory: string;
  conversationId?: string;
  systemPrompt?: string;
  maxSteps?: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are Friday Code, a proactive terminal coding agent.

Execution protocol:
- Keep a short internal plan and update it as the task evolves.
- Work in visible loops: inspect, act, verify, then continue until the task is actually done.
- Use tools when evidence is needed. Prefer reading before editing and verifying after changes.
- When a step is complete, move to the next best action instead of stopping early.
- Finish only after the work is complete or you genuinely need the user.

Working directory: {cwd}`;

export class AgentEngine {
  private config: EngineConfig;
  private conversationId: string;
  private messageHistory: CoreMessage[] = [];
  private abortController: AbortController | null = null;
  private pendingApproval: { resolve: (approved: boolean) => void } | null = null;
  private approvalMode: boolean = true;

  constructor(config: EngineConfig) {
    this.config = config;
    this.conversationId = config.conversationId || nanoid();
  }

  getConversationId(): string {
    return this.conversationId;
  }

  loadHistory() {
    const rows = db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, this.conversationId))
      .all();

    this.messageHistory = rows.map(row => {
      if (row.role === 'user') {
        return { role: 'user' as const, content: row.content };
      }

      if (row.role === 'assistant') {
        return { role: 'assistant' as const, content: row.content };
      }

      return { role: row.role as 'user', content: row.content };
    });
  }

  ensureConversation() {
    const existing = db
      .select()
      .from(conversations)
      .where(eq(conversations.id, this.conversationId))
      .get();

    if (!existing) {
      db.insert(conversations)
        .values({
          id: this.conversationId,
          workingDirectory: this.config.workingDirectory,
          title: 'New Chat',
        })
        .run();
    }
  }

  private saveMessage(
    role: 'user' | 'assistant' | 'tool',
    content: string,
    extra?: {
      reasoning?: string;
      toolCalls?: string;
      toolResults?: string;
      tokenUsage?: string;
      finishReason?: string;
      modelId?: string;
    },
  ) {
    db.insert(messagesTable)
      .values({
        id: nanoid(),
        conversationId: this.conversationId,
        role,
        content,
        ...extra,
      })
      .run();
  }

  abort() {
    this.abortController?.abort();
    this.abortController = null;
  }

  respondToApproval(approved: boolean) {
    if (this.pendingApproval) {
      this.pendingApproval.resolve(approved);
      this.pendingApproval = null;
    }
  }

  setApprovalMode(enabled: boolean) {
    this.approvalMode = enabled;
  }

  getApprovalMode(): boolean {
    return this.approvalMode;
  }

  async *run(userMessage: string): AsyncGenerator<StreamEvent> {
    const modelConfig = getActiveModelConfig();
    if (!modelConfig) {
      yield { type: 'error', error: 'No model configured. Use /model to select one.' };
      return;
    }

    this.ensureConversation();

    this.messageHistory.push({ role: 'user', content: userMessage });
    this.saveMessage('user', userMessage);

    const systemPrompt = (this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT)
      .replace('{cwd}', this.config.workingDirectory);

    const rawTools = createTools(this.config.workingDirectory);
    const engine = this;

    const tools: typeof rawTools = {} as any;
    for (const [name, rawTool] of Object.entries(rawTools) as [string, any][]) {
      if (engine.approvalMode && TOOL_SAFETY[name] === 'destructive') {
        tools[name as keyof typeof rawTools] = {
          ...rawTool,
          execute: async (args: any) => {
            const approved = await new Promise<boolean>((resolve) => {
              engine.pendingApproval = { resolve };
            });
            if (!approved) {
              return { error: 'Tool execution denied by user.' };
            }
            return rawTool.execute(args);
          },
        } as any;
      } else {
        tools[name as keyof typeof rawTools] = rawTool;
      }
    }

    this.abortController = new AbortController();

    const model = createModel(modelConfig.provider, modelConfig.modelId);

    let fullText = '';
    let fullReasoning = '';
    let currentStep = 0;
    let openStep = 0;
    const toolCallsLog: Array<{ stepNumber: number; toolCallId: string; toolName: string; args: unknown }> = [];
    const toolResultsLog: Array<{ stepNumber: number; toolCallId: string; toolName: string; result: unknown }> = [];

    try {
      yield { type: 'status', message: `Using ${modelConfig.provider.name} / ${modelConfig.modelId}` };

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
        maxSteps: this.config.maxSteps || 25,
        abortSignal: this.abortController.signal,
        maxRetries: 2,
        providerOptions,
        toolCallStreaming: true,
      });

      for await (const chunk of result.fullStream) {
        const stepNumber = openStep || currentStep || 1;

        switch (chunk.type) {
          case 'step-start': {
            currentStep += 1;
            openStep = currentStep;
            yield { type: 'step-start', stepNumber: currentStep, messageId: chunk.messageId };
            break;
          }

          case 'reasoning': {
            fullReasoning += chunk.textDelta;
            yield { type: 'reasoning', text: chunk.textDelta, stepNumber };
            break;
          }

          case 'tool-call-streaming-start': {
            yield {
              type: 'tool-call-streaming-start',
              stepNumber,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
            };
            break;
          }

          case 'tool-call-delta': {
            yield {
              type: 'tool-call-delta',
              stepNumber,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              argsText: chunk.argsTextDelta,
            };
            break;
          }

          case 'tool-call': {
            toolCallsLog.push({
              stepNumber,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              args: chunk.args,
            });
            yield {
              type: 'tool-call',
              stepNumber,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              args: chunk.args,
            };
            if (engine.approvalMode && TOOL_SAFETY[chunk.toolName] === 'destructive') {
              yield {
                type: 'tool-approval-request',
                stepNumber,
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                args: chunk.args,
              };
            }
            break;
          }

          case 'tool-result': {
            toolResultsLog.push({
              stepNumber,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              result: chunk.result,
            });
            yield {
              type: 'tool-result',
              stepNumber,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              result: chunk.result,
            };
            break;
          }

          case 'text-delta': {
            fullText += chunk.textDelta;
            yield { type: 'text-delta', text: chunk.textDelta, stepNumber };
            break;
          }

          case 'step-finish': {
            yield {
              type: 'step-finish',
              stepNumber,
              finishReason: chunk.finishReason,
              usage: normalizeUsage(chunk.usage),
              isContinued: chunk.isContinued,
            };
            openStep = 0;
            break;
          }

          case 'error':
            yield { type: 'error', error: String(chunk.error) };
            break;

          case 'finish':
            break;
        }
      }

      let usage: any;
      try {
        usage = await result.usage;
      } catch {
        usage = null;
      }

      const finishReason = await result.finishReason;

      this.messageHistory.push({ role: 'assistant', content: fullText });
      this.saveMessage('assistant', fullText, {
        reasoning: fullReasoning || undefined,
        toolCalls: toolCallsLog.length > 0 ? JSON.stringify(toolCallsLog) : undefined,
        toolResults: toolResultsLog.length > 0 ? JSON.stringify(toolResultsLog) : undefined,
        tokenUsage: usage ? JSON.stringify(usage) : undefined,
        finishReason,
        modelId: modelConfig.modelId,
      });

      if (this.messageHistory.length <= 2) {
        const title = userMessage.slice(0, 80) + (userMessage.length > 80 ? '...' : '');
        db.update(conversations)
          .set({ title })
          .where(eq(conversations.id, this.conversationId))
          .run();
      }

      yield {
        type: 'finish',
        text: fullText,
        reasoning: fullReasoning || undefined,
        usage: normalizeUsage(usage),
        finishReason: finishReason || 'stop',
        totalSteps: currentStep,
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        yield { type: 'status', message: 'Generation cancelled.' };
      } else {
        yield { type: 'error', error: error.message || String(error) };
      }
    } finally {
      this.abortController = null;
    }
  }

  clearHistory() {
    this.messageHistory = [];
    this.conversationId = nanoid();
  }

  setWorkingDirectory(directory: string) {
    this.config.workingDirectory = directory;
  }

  getWorkingDirectory(): string {
    return this.config.workingDirectory;
  }

  getMessageCount(): number {
    return this.messageHistory.length;
  }
}

function normalizeUsage(usage: any) {
  if (!usage) return undefined;
  const promptTokens = Number(usage?.promptTokens ?? usage?.prompt_tokens ?? 0) || 0;
  const completionTokens = Number(usage?.completionTokens ?? usage?.completion_tokens ?? 0) || 0;

  if (promptTokens === 0 && completionTokens === 0) {
    return undefined;
  }

  return { promptTokens, completionTokens };
}
