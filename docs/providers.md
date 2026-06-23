# Providers

Friday talks to 19 providers. Anthropic and Google Gemini ship dedicated
adapters. The other 17 go through a single OpenAI-compatible adapter.

Pick a provider and model with `/model`. The picker validates the key against the
provider before saving, so a typo fails fast instead of breaking on the first
real request.

## The list

Dedicated adapters:

- Anthropic (Claude)
- Google Gemini

Through the OpenAI-compatible adapter:

- OpenAI
- OpenRouter
- OpenCode Zen
- Groq
- Moonshot / Kimi
- DeepSeek
- xAI
- Mistral
- Perplexity
- Together
- Cerebras
- DeepInfra
- Fireworks
- Azure OpenAI
- MiniMax
- Ollama
- llama.cpp / LM Studio

Ollama and llama.cpp are keyless and good for local models.

## Keys

Keys come from `auth.json` or from environment variables, with `auth.json`
winning on conflict. The `/model` picker writes `auth.json` for you.
See [configuration](configuration.md) for details.

## Models and reasoning

The model catalog comes from [models.dev](https://models.dev), with an offline
snapshot as a fallback so the picker still works without a network. For models
that expose a reasoning channel, set the effort with `/effort` (low through max).
Models without one ignore the setting.
