# ChatCPT – Cosmo's Prompt Tutor

A lightweight, hands-on chat interface for teaching effective AI prompting. Students practice writing prompts, iterate on responses, and submit their best attempt — all through a familiar ChatGPT-like interface.

## Features

- **Conversational UI** — clean, minimal interface similar to ChatGPT
- **Streaming responses** — real-time token streaming via Server-Sent Events
- **Markdown rendering** — responses are fully formatted with syntax-highlighted code blocks (20+ languages)
- **File attachments** — attach images and documents for the AI to reference
- **Session persistence** — conversations are saved to a local JSON file and restored on page reload
- **Multi-session sidebar** — create, switch between, and delete past conversations
- **Cosmo persona** — a friendly AI tutor who encourages good prompting habits

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, HTML, CSS — no framework |
| Design system | [CodeSignal Bespoke Design System](https://github.com/CodeSignal/learn_bespoke-design-system) (git submodule) |
| Backend | Node.js + Express |
| AI orchestration |  |
| Markdown | `marked` + `highlight.js` |
| Bundler | `esbuild` |

## Prerequisites

- Node.js 18+

## Setup

### 1. Clone with submodules

```bash
git clone --recurse-submodules https://github.com/your-org/chat-cpt.git
cd chat-cpt
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

```env
OCTAVUS_API_URL=https://octavus.ai
OCTAVUS_API_KEY=oct_sk_your_key_here
AGENT_TARGET=prod
OCTAVUS_AGENT_ID_DEV=your_dev_agent_id
OCTAVUS_AGENT_ID_PROD=your_prod_agent_id
```

> **Never commit `.env`** — it is listed in `.gitignore`. Use `.env.example` as the committed reference.

See [Agent deployment](#agent-deployment-dev-vs-prod) for how `AGENT_TARGET` and the two agent IDs work together.

## Running

### Development

Builds the JS bundle once, then starts the server with `--watch` for automatic restarts on server changes:

```bash
npm run dev
```

### Production

Builds and starts the server:

```bash
npm start
```

The app is available at **http://localhost:3000**.

## Configuration

Runtime behaviour can be tuned via `chat-config.json` in the project root. Copy the example file to get started:

```bash
cp chat-config.example.json chat-config.json
```

### Supported options

| Key | Type | Default | Description |
|---|---|---|---|
| `initialPrompt` | `string` | `""` | Text pre-populated in the composer on every page load and new chat. |
| `model` | `string` | first available | Default model ID used when creating new sessions. |
| `allowedModels` | `string[]` | `[]` (all) | Whitelist of exact model IDs for the picker. Empty means all models from `current-models.txt`. |
| `allowedModelFamilies` | `string[]` | `[]` (all) | Filter models by provider prefix (e.g. `["openai", "openrouter/deepseek"]`). Can be combined with `allowedModels`. |
| `modelDisplayNames` | `object` | `{}` | Map of model ID to display label shown in the dropdown (e.g. `{"openai/gpt-5": "GPT-5"}`). Models without an entry use the default `provider/model` label. |
| `temperature` | `number` | `0.7` | Controls randomness (0–2). Lower = more focused, higher = more creative. Ignored when thinking is enabled. |
| `systemPromptExtra` | `string` | `""` | Trusted, course-author instructions appended to Cosmo's system prompt at session creation. Always ranks below Cosmo's guardrails. |
| `allowCustomInstructions` | `boolean` | `false` | Opt-in. When `true`, shows a "Custom Instructions" field in the Settings modal that learners can edit. Their text is delivered in the user turn (never the system prompt) so it stays subordinate to Cosmo's guardrails. The value is persisted to `customInstructions` in `chat-config.json` and restored on reload. Hidden by default so it never appears in practices that don't need it. |
| `customInstructions` | `string` | `""` | The learner's saved custom instructions. Populated automatically when `allowCustomInstructions` is `true` and the user edits the field; sent with each message only while `allowCustomInstructions` is `true`. |
| `verbosity` | `string \| null` | _(none)_ | Controls how verbose responses are. One of `"concise"`, `"normal"`, `"detailed"`, or `"verbose"`. When omitted (or set to `null`), no `VERBOSITY_INSTRUCTIONS` value is sent, so the agent falls back to the protocol default directive defined in `agents/cosmo-tutor/protocol.yaml` (`"Be clear, concise, and conversational"`) rather than leaving the system prompt unchanged. |
| `language` | `string` | `"English"` | The language Cosmo speaks in when responding. Sent as `LANGUAGE` into the system prompt at session creation. Any language name works (e.g. `"Spanish"`, `"French"`, `"Japanese"`). When omitted, defaults to `"English"`. |
| `title` | `string` | `"ChatCPT"` | Override the app name shown in the sidebar header and browser tab. |
| `heading` | `string` | `"What's on your mind?"` | Override the empty-state heading shown before the first message. |
| `placeholder` | `string` | `"Ask me anything..."` | Override the placeholder text in the composer input. |
| `newChatLabel` | `string` | `"New chat"` | Override the label on the "New chat" button in the sidebar. |
| `strings` | `object` | `{}` | Per-key **overrides** for UI strings, layered on top of the i18n catalog selected by `language` (see [UI translations (i18n)](#ui-translations-i18n)). Each **key is the original English text** and the value is the replacement. Anything not overridden here falls back to the i18n catalog, then to the original English text. Reserve this for one-off tweaks; put full translations in `i18n/*.json`. |
| `footer` | `string` | `"Cosmo can make mistakes..."` | Override the disclaimer text below the composer. |
| `hideSettings` | `boolean` | `false` | Hide the settings button from the sidebar. |
| `hideModelSettings` | `boolean` | `false` | Hide the "Generation" section (Temperature and Thinking controls) in the Settings modal. The configured `temperature` still applies; only the UI controls are hidden. |
| `hideHistory` | `boolean` | `false` | Hide the conversation history sidebar. Only one chat exists at a time; "New chat" deletes the current conversation (with confirmation). |
| `hideFileUpload` | `boolean` | `false` | Hide the image and file attachment buttons from the composer. |
| `hidePromptControls` | `boolean` | `false` | Hide stop, regenerate, and edit controls for a classic chat experience. |
| `thinking` | `string` | `"off"` | Default extended-reasoning level: `"off"`, `"low"`, `"medium"`, `"high"`, or `"max"`. When not `"off"`, temperature is ignored. Forced to `"off"` in the UI for models that do not support Thinking. |
| `showReasoning` | `boolean` | `true` | When the model streams reasoning (Thinking is on), show a collapsible **Thoughts** block above the reply. Set to `false` to hide chain-of-thought even if the model emits it. |
| `thinkingModels` | `string[]` | `[]` | Force-enable Thinking for these model IDs. Use when OpenRouter under-reports a model that still produces chain-of-thought (e.g. Amazon Nova Premier via tagged `<thinking>`). Applied after the denylist; does not disable other models. |
| `noThinkingModels` | `string[]` | `[]` | Force-disable Thinking for these model IDs (wins over allowlist, capabilities map, and heuristics). |

### Thinking capability detection

The Settings **Thinking** control is enabled per model. Capability resolution order:

1. `noThinkingModels` denylist → off
2. `thinkingModels` allowlist → on
3. Snapshot in `model-capabilities.json` (served via `GET /api/models` as `capabilities`)
4. Provider heuristics aligned with Octavus docs (`anthropic/claude*`, `openai/(o1|o3|o4|gpt-5)*`, `google/gemini-(2.5|3)*`)

Refresh the snapshot from OpenRouter (plus those heuristics):

```bash
node scripts/refresh-model-capabilities.mjs
# or: npm run refresh:model-capabilities
```

OpenRouter's `GET /api/v1/models` exposes `supported_parameters` (`reasoning` / `include_reasoning`) and a `reasoning` object — that is the primary signal for OpenRouter-routed models. Some models still produce CoT without those flags (notably Amazon Nova when Octavus `THINKING` is on). Those stay `supportsThinking: false` in the generated file; add them to `thinkingModels` in `chat-config.json`. Octavus has no per-model Thinking capability API, so provider heuristics cover direct Anthropic / OpenAI / Google ids.

**Example `chat-config.json`:**

```json
{
  "initialPrompt": "Write a prompt that asks Cosmo to explain what a large language model is.",
  "model": "anthropic/claude-sonnet-4-6",
  "allowedModels": ["anthropic/claude-sonnet-4-6", "openrouter/deepseek/deepseek-r1"],
  "modelDisplayNames": {
    "anthropic/claude-sonnet-4-6": "Claude Sonnet 4.6",
    "openrouter/deepseek/deepseek-r1": "DeepSeek R1"
  },
  "temperature": 0.7,
  "systemPromptExtra": "Focus all examples on Python.",
  "verbosity": "detailed",
  "language": "Spanish",
  "strings": {
    "New chat": "Empezar de nuevo"
  },
  "title": "My AI Tutor",
  "heading": "How can I help you today?",
  "footer": "AI responses may be inaccurate. Always verify.",
  "hideSettings": true,
  "hideHistory": true,
  "hideFileUpload": false
}
```

> `chat-config.json` is committed to source control so you can version your configuration alongside the project. `chat-config.example.json` serves as a reference template.

## UI translations (i18n)

UI strings are translated ahead of time via locale catalogs in the `i18n/` folder, selected by the `language` config value. This keeps translations out of `chat-config.json` — the config `strings` map is reserved for per-key overrides.

### How it works

1. Each file in `i18n/` (e.g. `en.json`, `es.json`) is a locale catalog:

```json
{
  "languageNames": ["es", "spanish", "español", "españa"],
  "strings": {
    "New chat": "Nueva conversación",
    "Settings": "Configuración"
  }
}
```

2. On each request to `/api/config`, the server reads `language` from `chat-config.json` and finds the catalog whose `languageNames` contains it (case-insensitive, whitespace-trimmed). So `"language": "Spanish"` loads `i18n/es.json`.
3. The matched catalog's `strings` become the base, and `chat-config.json`'s `strings` map is merged on top (config wins per key).
4. In the client, every UI string is resolved through a `t()` helper keyed by the **original English text**. Resolution order for any string is: **config `strings` override → matched i18n catalog → original English text**. So a missing translation simply falls back to English; nothing breaks.

### Adding a language

1. Copy `i18n/en.json` to `i18n/<code>.json` (it's the canonical catalog of every translatable string).
2. Set `languageNames` to the names you want to match against `language` (include synonyms/spellings, e.g. `["fr", "french", "français"]`).
3. Translate the values (keep the keys and any `{token}` placeholders — e.g. `"{title} (responding)"` — unchanged).
4. Set `"language": "<one of the languageNames>"` in `chat-config.json`.

> Note: `language` also controls the language Cosmo *responds in* (via the system prompt), so setting it once drives both the UI and the assistant.

## Agent deployment (dev vs prod)

The Cosmo agent definition lives in `agents/cosmo-tutor/` and is the **single source of truth**. To avoid local experiments leaking into production, the same definition is deployed to two separate agents in Octavus, distinguished by slug:

| Target | Slug | Used by |
|---|---|---|
| dev | `cosmo-tutor-dev` | local development / testing (default) |
| prod | `cosmo-tutor` | real users |

There are **two independent switches**:

1. **Deploy** — which agent the CLI writes your edited files to. The Octavus CLI targets an agent by the `slug` in `settings.json`, so `scripts/deploy-agent.mjs` stages a copy of the definition and rewrites only the slug/name for the chosen target (the prompts and `protocol.yaml` are never duplicated, so dev and prod cannot drift):

   ```bash
   npm run deploy:agent:dev    # syncs to cosmo-tutor-dev
   npm run deploy:agent:prod   # syncs to cosmo-tutor (asks for confirmation)
   npm run validate:agent      # dry-run validation only
   ```

   `deploy:agent:prod` requires confirmation: answer the interactive prompt, or pass `--yes` for CI (`node scripts/deploy-agent.mjs prod --yes`).

2. **Runtime** — which deployed agent the running server talks to, selected by `AGENT_TARGET` (defaults to `prod`):

   ```bash
   npm run dev          # talks to the dev agent (the script sets AGENT_TARGET=dev)
   npm start            # talks to the prod agent (AGENT_TARGET defaults to prod)
   ```

   The server reads `OCTAVUS_AGENT_ID_DEV` or `OCTAVUS_AGENT_ID_PROD` based on `AGENT_TARGET`. Find the IDs with `npx octavus --env .env list`.

   **Backward compatibility:** the default is `prod`, and when the target-specific ID is missing the server falls back to the legacy `OCTAVUS_AGENT_ID`. So an existing `.env` that only defines `OCTAVUS_AGENT_ID` keeps working unchanged — it continues to talk to that (production) agent.

Typical workflow: edit `agents/cosmo-tutor/*`, run `npm run deploy:agent:dev`, test locally (dev is the default), and only run `npm run deploy:agent:prod` once you're happy.

## Project Structure

```
chat-cpt/
├── agents/
│   └── cosmo-tutor/          # Agent definition
│       ├── settings.json
│       ├── protocol.yaml
│       └── prompts/
│           ├── system.md     # Cosmo's persona + instructions
│           └── user-message.md
├── design-system/            # Git submodule (CodeSignal Bespoke DS)
├── public/
│   ├── index.html
│   ├── app.js                # Frontend source (bundled by esbuild)
│   ├── app.bundle.js         # Generated — do not edit directly
│   └── app.css
├── server.js                 # Express server + orchestration proxy
├── current-models.txt        # Model catalog for the picker
├── model-capabilities.json   # Generated Thinking capability snapshot (refresh via npm script)
├── chat-config.json          # Runtime configuration (see Configuration section)
├── chat-config.example.json  # Reference template for chat-config.json
├── chat-sessions.json        # Auto-generated session storage (gitignored)
├── .env                      # Secret credentials (gitignored)
└── package.json
```

## Session Persistence

Conversations are stored in `chat-sessions.json` at the project root. This file is gitignored and lives only on the local machine. Each entry contains:

```json
{
  "session_id": "...",
  "created_at": "...",
  "updated_at": "...",
  "messages": [
    { "role": "user", "content": "...", "files": [], "timestamp": "..." },
    { "role": "assistant", "content": "...", "files": [], "timestamp": "..." }
  ],
  "selected_submission": null
}
```

## License

[Elastic License 2.0](./LICENSE.md)
