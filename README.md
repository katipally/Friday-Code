# Friday Code ◆

**The open-source terminal AI coding agent.**

Built with React (Ink), Vercel AI SDK, SQLite + Drizzle ORM. Supports OpenAI, Anthropic, and Ollama.

```
  ╔══════════════════════════════════════════╗
  ║  ◆ F R I D A Y   C O D E              ║
  ║  AI-powered terminal coding agent      ║
  ╚══════════════════════════════════════════╝
```

## Features

- 🤖 **Multi-provider AI** — OpenAI, Anthropic, and Ollama (local models) with live model fetching
- 🎨 **Beautiful Terminal UI** — Custom React-based TUI built on Ink with rich components
- ⚡ **Streaming responses** — Real-time text streaming with reasoning/thinking display
- 🛠️ **Agent tools** — File read/write/edit, shell execution, file search, content search
- 💬 **Conversation history** — Persistent conversations stored in SQLite
- 🔍 **File mentions** — Reference files with `@filepath` to include as context
- ⌨️ **Slash commands** — `/model`, `/clear`, `/scope`, `/help`, `/provider`, and more
- 🧠 **Reasoning support** — Displays AI thinking/reasoning when model supports it
- 📂 **Scope management** — Set working directory scope for the AI agent
- 🗄️ **SQLite + Drizzle** — Type-safe database with conversations, settings, and model cache

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/friday-code.git
cd friday-code
npm install

# Set API key (choose one)
export OPENAI_API_KEY=sk-...
# or
export ANTHROPIC_API_KEY=sk-ant-...

# Run
npm run dev
```

## Usage

### Start Friday Code
```bash
npm run dev                    # Start in current directory
npm run dev -- --dir /path     # Start with specific scope
```

### Inside Friday Code

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model` | Select AI model and provider |
| `/provider` | Manage providers & API keys |
| `/scope <path>` | Change working directory |
| `/clear` | Clear conversation history |
| `/history` | Show message count |
| `/exit` | Exit Friday Code |
| `@file` | Mention a file for context |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Submit message |
| `Ctrl+C` | Cancel generation |
| `Ctrl+D` | Exit |
| `↑/↓` | Navigate input history |
| `←/→` | Move cursor |
| `Ctrl+U` | Clear input line |

## Architecture

```
friday-code/
├── src/
│   ├── index.tsx              # Entry point
│   ├── ui/
│   │   ├── theme/theme.ts     # Design system & colors
│   │   ├── components/        # Reusable UI components
│   │   │   └── components.tsx # Panel, StatusBar, Spinner, etc.
│   │   └── views/
│   │       ├── App.tsx        # Main application view
│   │       ├── InputBox.tsx   # Input component with history
│   │       └── ModelSelector.tsx  # Model/provider picker
│   ├── core/
│   │   ├── engine/agent.ts    # AI agent loop (streamText)
│   │   ├── providers/registry.ts  # Provider management
│   │   └── tools/tools.ts     # File, shell, search tools
│   └── db/
│       ├── schema.ts          # Drizzle ORM schema
│       └── index.ts           # Database initialization
├── package.json
├── tsconfig.json
└── drizzle.config.ts
```

### Tech Stack

- **UI**: React + Ink (terminal rendering) with custom component library
- **AI**: Vercel AI SDK (`streamText`, tool calling, multi-step agent loop)
- **Database**: SQLite via better-sqlite3 + Drizzle ORM
- **Providers**: `@ai-sdk/openai`, `@ai-sdk/anthropic`, Ollama (via OpenAI-compatible)
- **Language**: TypeScript with strict mode
- **Runtime**: Node.js 18+ with tsx for development

### Agent Loop

Friday Code uses a **React-pattern agent loop**:

1. **Observe** — Receive user input + file context
2. **Think** — Stream reasoning (when model supports it)
3. **Act** — Call tools (read files, edit code, run commands)
4. **Respond** — Stream final response text

The loop supports up to 10 steps per turn, allowing the AI to:
- Read a file → Edit it → Run tests → Fix issues → Respond

### AI Providers

| Provider | Setup | Models |
|----------|-------|--------|
| **OpenAI** | `OPENAI_API_KEY` or `/model` in TUI | GPT-4o, GPT-4, o1, o3, etc. |
| **Anthropic** | `ANTHROPIC_API_KEY` or `/model` in TUI | Claude Sonnet 4, 3.5 Sonnet, 3 Opus, etc. |
| **Ollama** | Install Ollama locally | Any local model (llama3, codellama, etc.) |

## Configuration

Friday Code stores data in `~/.friday-code/`:

- `friday.db` — SQLite database (conversations, settings, provider keys)

API keys can be set via:
1. Environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
2. The `/model` command in the TUI (stored in DB)
3. A `.env` file in the project directory

## Contributing

Contributions welcome! This is fully open-source.

```bash
# Development
npm run dev          # Run with tsx (hot-reload)
npm run build        # TypeScript compilation
```

## License

MIT
