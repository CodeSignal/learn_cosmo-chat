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

Create a `.env` file in the project root:

```env
```

> **Never commit `.env`** — it is listed in `.gitignore`.

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
| `systemPromptExtra` | `string` | `""` | Additional instructions appended to Cosmo's system prompt at session creation. |
| `verbosity` | `string \| null` | `"detailed"` | Controls how verbose responses are. One of `"concise"`, `"normal"`, `"detailed"`, or `"verbose"`. Set to `null` to inject no verbosity instruction and leave the system prompt unchanged. |
| `title` | `string` | `"ChatCPT"` | Override the app name shown in the sidebar header and browser tab. |
| `heading` | `string` | `"What's on your mind?"` | Override the empty-state heading shown before the first message. |
| `placeholder` | `string` | `"Ask me anything..."` | Override the placeholder text in the composer input. |
| `footer` | `string` | `"Cosmo can make mistakes..."` | Override the disclaimer text below the composer. |
| `hideSettings` | `boolean` | `false` | Hide the settings button from the sidebar. |
| `hideHistory` | `boolean` | `false` | Hide the conversation history sidebar. Only one chat exists at a time; "New chat" deletes the current conversation (with confirmation). |
| `hideFileUpload` | `boolean` | `false` | Hide the image and file attachment buttons from the composer. |
| `hidePromptControls` | `boolean` | `false` | Hide stop, regenerate, and edit controls for a classic chat experience. |

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
  "title": "My AI Tutor",
  "heading": "How can I help you today?",
  "footer": "AI responses may be inaccurate. Always verify.",
  "hideSettings": true,
  "hideHistory": true,
  "hideFileUpload": false
}
```

> `chat-config.json` is committed to source control so you can version your configuration alongside the project. `chat-config.example.json` serves as a reference template.

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
