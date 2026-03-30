# Contributing to Friday Code

Thanks for your interest in contributing! Friday Code is open-source and welcomes contributions of all kinds.

## Development Setup

```bash
git clone https://github.com/yashwanthreddy/friday-code.git
cd friday-code
npm install
```

### Run in Development

```bash
npm run dev
```

This uses `tsx` for on-the-fly TypeScript execution with hot reload.

### Build

```bash
npm run build
```

Compiles TypeScript to `dist/`. The CLI entry point is `bin/friday.js`.

### Test Locally

```bash
node dist/index.js
# or
npm start
```

## Project Structure

- **`src/core/engine/`** — Agent loop, streaming, tool orchestration
- **`src/core/tools/`** — Tool definitions (file ops, git, shell, web)
- **`src/core/providers/`** — AI provider registry (OpenAI, Anthropic, Ollama)
- **`src/ui/components/`** — React (Ink) UI components
- **`src/ui/views/`** — Application views (App, InputBox, ModelSelector)
- **`src/ui/theme/`** — Color palette, icons, slash commands
- **`src/db/`** — SQLite schema and database initialization

## How to Contribute

### Bug Reports

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Your OS, Node.js version, and terminal emulator

### Feature Requests

Open an issue describing the feature, why it's useful, and how it might work.

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `npm run build` to verify compilation
5. Commit with a clear message
6. Open a pull request against `main`

### Code Style

- TypeScript with strict mode
- Functional React components
- No unnecessary comments — code should be self-documenting
- Keep UI components in `src/ui/components/components.tsx`
- Keep tools in `src/core/tools/tools.ts`

## Adding a New Tool

1. Add the tool definition in `src/core/tools/tools.ts` inside `createTools()`
2. Add a safety classification in the `TOOL_SAFETY` object (`'safe'` or `'destructive'`)
3. Rebuild and test

## Adding a New Provider

1. Install the AI SDK provider package (e.g., `@ai-sdk/google`)
2. Add a case in `createModel()` in `src/core/providers/registry.ts`
3. Add a case in `fetchModelsFromProvider()` for model listing
4. Add the provider type to the schema enum in `src/db/schema.ts`
5. Seed the provider in `src/db/index.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
