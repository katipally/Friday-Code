import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Conversations table
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('New Chat'),
  workingDirectory: text('working_directory').notNull(),
  modelId: text('model_id'),
  providerId: text('provider_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Messages table
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
  content: text('content').notNull(),
  reasoning: text('reasoning'),
  toolCalls: text('tool_calls'), // JSON
  toolResults: text('tool_results'), // JSON
  tokenUsage: text('token_usage'), // JSON {promptTokens, completionTokens}
  finishReason: text('finish_reason'),
  modelId: text('model_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Provider configurations
export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(), // 'openai', 'anthropic', 'ollama'
  name: text('name').notNull(),
  type: text('type', { enum: ['openai', 'anthropic', 'ollama'] }).notNull(),
  apiKey: text('api_key'),
  baseUrl: text('base_url'),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Cached models from providers
export const models = sqliteTable('models', {
  id: text('id').primaryKey(), // e.g. 'openai:gpt-4o'
  providerId: text('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull(), // e.g. 'gpt-4o'
  name: text('name').notNull(),
  supportsStreaming: integer('supports_streaming', { mode: 'boolean' }).default(true),
  supportsTools: integer('supports_tools', { mode: 'boolean' }).default(true),
  supportsReasoning: integer('supports_reasoning', { mode: 'boolean' }).default(false),
  contextWindow: integer('context_window'),
  lastFetched: integer('last_fetched', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// App settings (key-value)
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
