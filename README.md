# Friday Code

**Open-source terminal AI coding agent.**

Friday Code is a terminal-native AI assistant that reads, writes, and edits code using tool-calling agent loops. Built with React (Ink), Vercel AI SDK, and SQLite.

```
  ◈ friday code
  model → ollama/qwen3:Thinking
  scope → ~/projects/my-app

  · explain this project
  · find and fix bugs in @file
  · refactor this module for clarity
```

## Install

```bash
npm install -g friday-code
```

Or run from source:

```bash
git clone https://github.com/yashwanthreddy/friday-code.git
cd friday-code
npm install
npm run build
npm start
```

## Usage

```bash
friday                     # Start in current directory
friday --dir ~/projects    # Start with a specific scope
```

### Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands and shortcuts |
| `/model` | Select AI model and provider |
| `/provider` | Manage providers and API keys |
| `/scope <path>` | Change working directory |
| `/config` | View or set configuration |
| `/clear` | Clear conversation history |
| `/new` | Start a new conversation |
| `/history` | Show message count |
| `/exit` | Quit Friday Code |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Tab` | Autocomplete command or file |
| `↑` / `↓` | Navigate input history |
| `Ctrl+C` | Cancel generation |
| `Ctrl+D` | Exit |
| `Ctrl+U` | Clear input line |

### File Mentions

Reference files inline with `@filename`:

```
explain what @src/index.ts does and suggest improvements
```

The file contents are automatically included as context.

## Providers

Friday Code supports three AI providers out of the box:

| Provider | Setup | Notes |
|----------|-------|-------|
| **OpenAI** | Set `OPENAI_API_KEY` env var or use `/provider` | GPT-4o, o1, o3, o4 |
| **Anthropic** | Set `ANTHROPIC_API_KEY` env var or use `/provider` | Claude Sonnet 4, 3.5 Sonnet |
| **Ollama** | Install [Ollama](https://ollama.com) locally | Any local model — no API key needed |

Models are fetched live from each provider. Use `/model` to browse and select.

## Tools

The agent has access to these tools during conversations:

| Tool | Description | Approval |
|------|-------------|----------|
| `readFile` | Read file contents | Auto |
| `writeFile` | Create or overwrite a file | Required |
| `editFile` | Find-and-replace edit | Required |
| `listDirectory` | List files in a directory | Auto |
| `searchFiles` | Glob-pattern file search | Auto |
| `searchContent` | Grep-based content search | Auto |
| `executeCommand` | Run a shell command | Required |
| `gitStatus` | Show git status | Auto |
| `gitDiff` | Show git diff | Auto |
| `gitLog` | Show commit history | Auto |
| `gitCommit` | Stage and commit | Required |
| `webFetch` | Fetch a URL | Auto |
| `runTests` | Run the test suite | Required |

Destructive tools require approval by default. Press `Enter` to approve or `Esc` to deny. Disable with `/config approval off`.

## Configuration

Friday Code stores its database at `~/.friday-code/friday.db`.

API keys can be set via:
- Environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
- The `/provider` command inside the TUI
- A `.env` file in the working directory

Runtime settings via `/config`:

| Setting | Values | Default |
|---------|--------|---------|
| `maxSteps` | `1`–`100` | `25` |
| `approval` | `on` / `off` | `on` |

## Architecture

```
src/
├── index.tsx                    # CLI entry point
├── core/
│   ├── engine/agent.ts          # Agent loop (streamText, tool calling)
│   ├── providers/registry.ts    # Provider and model management
│   └── tools/tools.ts           # Tool definitions
├── db/
│   ├── index.ts                 # Database initialization
│   └── schema.ts                # Drizzle ORM schema
└── ui/
    ├── theme/theme.ts           # Color palette and icons
    ├── components/components.tsx # All UI components
    └── views/
        ├── App.tsx              # Main application orchestrator
        ├── InputBox.tsx         # Input with autocomplete
        └── ModelSelector.tsx    # Model/provider picker
```

**Stack:** TypeScript · React + Ink · Vercel AI SDK · SQLite + Drizzle ORM · Node.js 18+

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
