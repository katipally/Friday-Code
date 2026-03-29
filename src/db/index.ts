import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { sql } from 'drizzle-orm';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const DATA_DIR = join(homedir(), '.friday-code');
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, 'friday.db');

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// Initialize tables
export function initializeDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      working_directory TEXT NOT NULL,
      model_id TEXT,
      provider_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
      content TEXT NOT NULL,
      reasoning TEXT,
      tool_calls TEXT,
      tool_results TEXT,
      token_usage TEXT,
      finish_reason TEXT,
      model_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('openai', 'anthropic', 'ollama')),
      api_key TEXT,
      base_url TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      name TEXT NOT NULL,
      supports_streaming INTEGER DEFAULT 1,
      supports_tools INTEGER DEFAULT 1,
      supports_reasoning INTEGER DEFAULT 0,
      context_window INTEGER,
      last_fetched INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Seed default providers
  const existing = sqlite.prepare('SELECT COUNT(*) as count FROM providers').get() as { count: number };
  if (existing.count === 0) {
    sqlite.exec(`
      INSERT OR IGNORE INTO providers (id, name, type, base_url) VALUES
        ('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1'),
        ('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com'),
        ('ollama', 'Ollama (Local)', 'ollama', 'http://localhost:11434');

      INSERT OR IGNORE INTO settings (key, value) VALUES
        ('active_provider', 'openai'),
        ('active_model', 'gpt-4o'),
        ('theme', 'default'),
        ('stream_reasoning', 'true');
    `);
  }
}

export { schema };
export { DB_PATH, DATA_DIR };
