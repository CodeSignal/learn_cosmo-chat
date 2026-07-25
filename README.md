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
| Model inference | Amazon Bedrock (`ConverseStream`) via `@aws-sdk/client-bedrock-runtime` |
| Markdown | `marked` + `highlight.js` |
| Bundler | `esbuild` |

## Prerequisites

- Node.js 18+
- An AWS account with Amazon Bedrock access in your chosen region

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
BEDROCK_AWS_ACCESS_KEY_ID=AKIA...
BEDROCK_AWS_SECRET_ACCESS_KEY=your_secret_here
BEDROCK_AWS_REGION=us-east-1
```

The variables are `BEDROCK_`-prefixed rather than the standard `AWS_` names so this app can use a dedicated Bedrock principal without interfering with other AWS tooling on the same machine. They are passed to the SDK explicitly, which also prevents an unrelated `~/.aws` profile from being picked up silently.

> **Never commit `.env`** — it is listed in `.gitignore`. Use `.env.example` as the committed reference.

See [Amazon Bedrock setup](#amazon-bedrock-setup) for IAM permissions and model access.

### 4. Choose your models

`current-models.txt` ships with a small starter list. Replace it with the models your own account can actually invoke:

```bash
npm run sync:models
```

Then set `model` and `allowedModels` in `chat-config.json` to ids from that list.

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
| `allowedModelFamilies` | `string[]` | `[]` (all) | Filter models by provider (e.g. `["anthropic", "amazon"]`). Matches both `provider/model` and Bedrock's dotted `us.provider.model` ids. Can be combined with `allowedModels`. |
| `modelDisplayNames` | `object` | `{}` | Map of model ID to display label shown in the dropdown (e.g. `{"us.anthropic.claude-sonnet-4-6": "Claude Sonnet 4.6"}`). Models without an entry show the raw id. |
| `temperature` | `number` | `0.7` | Controls randomness (0–2). Lower = more focused, higher = more creative. Ignored when thinking is enabled. |
| `systemPromptExtra` | `string` | `""` | Additional instructions appended to Cosmo's system prompt at session creation. |
| `verbosity` | `string \| null` | _(none)_ | Controls how verbose responses are. One of `"concise"`, `"normal"`, `"detailed"`, or `"verbose"`. When omitted (or set to `null`), the `{{VERBOSITY_INSTRUCTIONS}}` placeholder in `prompts/system.md` falls back to its built-in default (`"Be clear, concise, and conversational"`) rather than being left in the prompt verbatim. |
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
  "model": "us.anthropic.claude-sonnet-4-6",
  "allowedModels": ["us.anthropic.claude-sonnet-4-6", "us.amazon.nova-2-lite-v1:0"],
  "modelDisplayNames": {
    "us.anthropic.claude-sonnet-4-6": "Claude Sonnet 4.6",
    "us.amazon.nova-2-lite-v1:0": "Nova 2 Lite"
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

## Amazon Bedrock setup

### IAM permissions

Chat streaming needs `bedrock:InvokeModelWithResponseStream`. `npm run sync:models` additionally needs `bedrock:ListFoundationModels` and `bedrock:ListInferenceProfiles`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["bedrock:ListFoundationModels", "bedrock:ListInferenceProfiles"],
      "Resource": "*"
    }
  ]
}
```

Two things about that policy are easy to get wrong:

- When you scope to a **cross-region inference profile** (the `us.`-prefixed ids), you must grant **both** the inference-profile ARN and the foundation-model ARN with a wildcard region. The profile can route your request to any region in its geography, and without the wildcard entry those routed calls fail with `AccessDeniedException`.
- Inference-profile ARNs are account-scoped (`:111122223333:inference-profile/...`) while foundation-model ARNs are not (`::foundation-model/...`). The two formats are not interchangeable.

AWS recommends IAM **roles** over long-lived access keys. For deployments, omit the key variables and set `BEDROCK_AWS_USE_DEFAULT_CREDENTIALS=true` so the SDK's default provider chain picks up the instance or task role.

### Model access

Most serverless models are available without manual enablement, but Anthropic models require a one-time use-case form submission (via the Bedrock console playground) before first use. Some third-party models also require a Marketplace subscription or EULA acceptance.

Cross-region inference profiles need model access enabled in **every** region the profile routes to — `us.` profiles cover `us-east-1`, `us-east-2`, and `us-west-2`.

### Region

`BEDROCK_AWS_REGION` (default `us-east-1`) selects the runtime endpoint. Model availability varies by region, so re-run `npm run sync:models` after changing it.

### Troubleshooting

| Symptom | Cause |
|---|---|
| `AccessDeniedException` | Missing IAM permission, model access not enabled in the region, or a wildcard-region foundation-model ARN missing from the policy. |
| `ResourceNotFoundException` | Model id doesn't exist in this region. Run `npm run sync:models`. |
| `on-demand throughput isn't supported` | That model must be invoked through an inference profile — use the `us.`-prefixed id. |
| `ThrottlingException` | Quota exceeded. Bedrock reserves quota against `maxTokens`, not request count. |

## What this app does not do

Model inference is all Bedrock provides, so these capabilities are not available:

- **Web search and URL fetching** — the system prompt tells Cosmo to say so plainly rather than hallucinate browsing. Adding it would mean an [AgentCore Gateway web-search connector](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-target-connector-web-search-tool.html) or a third-party search API wired in as a tool.
- **Image generation** — would need a separate `InvokeModel` call against an image model such as Amazon Nova Canvas.
- **Tool / function calling** — the Converse API supports it (`toolConfig` plus a `stopReason: "tool_use"` loop), but no tools are wired up.

## Project Structure

```
chat-cpt/
├── prompts/
│   └── system.md             # Cosmo's persona + instructions (Converse system prompt)
├── lib/
│   ├── bedrock-client.js     # Credential resolution + client construction
│   ├── bedrock-messages.js   # Stored transcript ⇄ Converse request mapping
│   ├── bedrock-stream.js     # ConverseStream events → flat SSE events
│   ├── system-prompt.js      # Prompt template rendering
│   ├── attachments.js        # Local upload storage
│   ├── helpers.js            # Session records, model filtering, verbosity
│   └── stream-registry.js    # Concurrent-stream gating (shared with frontend)
├── design-system/            # Git submodule (CodeSignal Bespoke DS)
├── public/
│   ├── index.html
│   ├── app.js                # Frontend source (bundled by esbuild)
│   ├── app.bundle.js         # Generated — do not edit directly
│   ├── app.css
│   └── lib/
│       └── chat-store.js     # Observable message list + SSE consumer
├── scripts/
│   └── sync-models.mjs       # Regenerates current-models.txt from your account
├── server.js                 # Express server + Bedrock streaming endpoint
├── current-models.txt        # Model ids offered in the picker
├── chat-config.json          # Runtime configuration (see Configuration section)
├── chat-config.example.json  # Reference template for chat-config.json
├── chat-sessions.json        # Auto-generated session storage (gitignored)
├── uploads/                  # Attachment storage (gitignored)
├── .env                      # Secret credentials (gitignored)
└── package.json
```

## How a turn works

Bedrock is stateless — it has no concept of a conversation — so the full transcript is rebuilt and re-sent on every turn:

1. The browser store appends the user message, then `POST /api/trigger` with `{ sessionId, text, files, history }`.
2. The server renders `prompts/system.md`, maps the transcript to Converse content blocks (inlining attachment bytes from `uploads/`), and calls `ConverseStream`.
3. The first stream event is awaited **before** response headers are sent, so credential and model-access failures return a real HTTP status instead of an error buried in the stream.
4. Remaining events are forwarded as SSE frames (`text-delta`, `reasoning-delta`, `done`) and folded into the message list by `public/lib/chat-store.js`.
5. The client persists the transcript to `chat-sessions.json` through `POST /api/session/save`, throttled during streaming and flushed at the end.

The client sends the history rather than the server reading it from disk because transcript writes are throttled — the on-disk copy can lag the newest turn — and because regenerate/edit deliberately replay a truncated history.

## Session Persistence

Conversations are stored in `chat-sessions.json` at the project root. This file is gitignored and lives only on the local machine. Each entry contains:

```json
{
  "session_id": "...",
  "created_at": "...",
  "updated_at": "...",
  "settings": {
    "MODEL": "us.anthropic.claude-sonnet-4-6",
    "THINKING": "off",
    "TEMPERATURE": 0.7
  },
  "messages": [
    { "role": "user", "content": "...", "files": [], "timestamp": "..." },
    { "role": "assistant", "content": "...", "files": [], "timestamp": "..." }
  ],
  "selected_submission": null
}
```

`settings` records the model, temperature, and reasoning level chosen when the session was created. Because Bedrock is stateless, these are re-sent on every turn and so must survive a page reload.

Attachments are stored as files under `uploads/<session-id>/` and referenced from `messages[].files` by URL. Their bytes are re-read and inlined into each Converse request; deleting a conversation removes its upload directory too.

## License

[Elastic License 2.0](./LICENSE.md)
