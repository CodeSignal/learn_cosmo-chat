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

| Key | Type | Description |
|---|---|---|
| `initialPrompt` | `string` | Text pre-populated in the composer on every page load and when creating a new chat. Supports multiple lines (`\n`). Leave empty (`""`) to start with a blank input. |
| `allowedModels` | `string[]` | Whitelist of model IDs available in the picker. When set to a non-empty array, only those models are shown. When omitted or `[]`, all models from `current-models.txt` are available. |
| `systemPromptExtra` | `string` | Additional instructions appended to Cosmo's system prompt at session creation. Use this to tailor the persona or add domain-specific context without touching `agents/cosmo-tutor/prompts/system.md`. Supports multiple lines (`\n`). Leave empty (`""`) for no extra instructions. |

**Example `chat-config.json`:**

```json
{
  "initialPrompt": "Write a prompt that asks Cosmo to explain what a large language model is,\nusing simple analogies a 10-year-old could understand.",
  "systemPromptExtra": "You are assisting students in a Python programming course. Focus all examples and exercises on Python."
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
