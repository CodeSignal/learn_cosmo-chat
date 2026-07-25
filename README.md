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
| AI orchestration | Octavus (default) or Amazon Bedrock when `useBedrock: true` |
| Markdown | `marked` + `highlight.js` |
| Bundler | `esbuild` |

## Prerequisites

- Node.js 18+
- For the default (Octavus) path: an Octavus API key and deployed agent
- For AWS courses (`useBedrock: true`): an AWS account with Amazon Bedrock access in your chosen region

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

Copy the example file and fill in the credentials for the backend this course uses:

```bash
cp .env.example .env
```

**Octavus (default — existing courses):**

```env
OCTAVUS_API_URL=https://octavus.ai
OCTAVUS_API_KEY=oct_sk_your_key_here
AGENT_TARGET=prod
OCTAVUS_AGENT_ID_DEV=your_dev_agent_id
OCTAVUS_AGENT_ID_PROD=your_prod_agent_id
```

**Amazon Bedrock (only when `chat-config.json` has `"useBedrock": true`):**

```env
BEDROCK_AWS_ACCESS_KEY_ID=AKIA...
BEDROCK_AWS_SECRET_ACCESS_KEY=your_secret_here
BEDROCK_AWS_REGION=us-east-1
```

The Bedrock variables are `BEDROCK_`-prefixed rather than the standard `AWS_` names so this app can use a dedicated Bedrock principal without interfering with other AWS tooling on the same machine.

> **Never commit `.env`** — it is listed in `.gitignore`. Use `.env.example` as the committed reference.

See [Agent deployment](#agent-deployment-dev-vs-prod) for Octavus agent targets, and [Amazon Bedrock setup](#amazon-bedrock-setup) for IAM / model access.

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
| `useBedrock` | `boolean` | `false` | When `true`, the course uses Amazon Bedrock instead of Octavus. **Omit this (or set `false`) on existing courses** so they keep working unchanged. Only AWS courses should turn it on. |
| `initialPrompt` | `string` | `""` | Text pre-populated in the composer on every page load and new chat. |
| `model` | `string` | first available | Default model ID used when creating new sessions. Use Octavus ids (`anthropic/...`) unless `useBedrock` is true, then use Bedrock inference-profile ids (`us.anthropic...`). |
| `allowedModels` | `string[]` | `[]` (all) | Whitelist of exact model IDs for the picker. Empty means all models from the active models file (`current-models.txt`, or `current-models.bedrock.txt` when `useBedrock` is true). |
| `allowedModelFamilies` | `string[]` | `[]` (all) | Filter models by provider (e.g. `["anthropic", "amazon"]`). Matches both `provider/model` and Bedrock's dotted `us.provider.model` ids. Can be combined with `allowedModels`. |
| `modelDisplayNames` | `object` | `{}` | Map of model ID to display label shown in the dropdown (e.g. `{"anthropic/claude-sonnet-4-6": "Claude Sonnet 4.6"}`). Models without an entry show the raw id. |
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

**Example `chat-config.json` (existing / Octavus courses — no new fields required):**

```json
{
  "initialPrompt": "Write a prompt that asks Cosmo to explain what a large language model is.",
  "model": "anthropic/claude-sonnet-4-6",
  "allowedModels": ["anthropic/claude-sonnet-4-6", "openai/gpt-5"],
  "temperature": 0.7,
  "systemPromptExtra": "Focus all examples on Python.",
  "verbosity": "detailed"
}
```

**AWS course example** — copy `chat-config.bedrock.example.json`, or start from:

```json
{
  "useBedrock": true,
  "model": "us.amazon.nova-2-lite-v1:0",
  "allowedModels": [
    "us.amazon.nova-2-lite-v1:0",
    "us.anthropic.claude-sonnet-4-6"
  ]
}
```

Then run `npm run sync:models` to refresh `current-models.bedrock.txt` from your AWS account.

> `chat-config.json` is committed to source control so you can version your configuration alongside the project. `chat-config.example.json` serves as a reference template.

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
├── agents/
│   └── cosmo-tutor/          # Octavus agent definition (default backend)
├── prompts/
│   └── system.md             # System prompt used when useBedrock is true
├── lib/
│   ├── provider.js           # useBedrock flag → backend selection
│   ├── bedrock-*.js          # Bedrock client / messages / stream
│   ├── attachments.js        # Local upload storage (Bedrock)
│   ├── helpers.js
│   └── stream-registry.js
├── design-system/            # Git submodule (CodeSignal Bespoke DS)
├── public/
│   ├── app.js                # Frontend (OctavusChat or ChatStore)
│   └── lib/chat-store.js     # Bedrock SSE consumer
├── scripts/
│   ├── deploy-agent.mjs      # Octavus agent deploy
│   └── sync-models.mjs       # Regenerates current-models.bedrock.txt
├── server.js                 # Shared Express routes; branches on useBedrock
├── current-models.txt        # Octavus model ids
├── current-models.bedrock.txt
├── chat-config.example.json          # Default / Octavus template
├── chat-config.bedrock.example.json  # AWS course template
└── package.json
```

## How a turn works

**Octavus (default):** the browser uses `OctavusChat`, uploads go through `/api/upload-urls`, and `/api/trigger` proxies the agent SSE stream from Octavus.

**Bedrock (`useBedrock: true`):** Bedrock is stateless — the full transcript is rebuilt and re-sent on every turn:

1. The browser store appends the user message, then `POST /api/trigger` with `{ sessionId, text, files, history }`.
2. The server renders `prompts/system.md`, maps the transcript to Converse content blocks (inlining attachment bytes from `uploads/`), and calls `ConverseStream`.
3. The first stream event is awaited **before** response headers are sent, so credential and model-access failures return a real status code.
4. Remaining events are forwarded as SSE frames and folded into the message list by `public/lib/chat-store.js`.
5. The client persists the transcript to `chat-sessions.json` through `POST /api/session/save`.

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

When `useBedrock` is true, sessions also store a `settings` object (model / temperature / thinking) so those values survive a reload and can be re-sent on every Converse turn. Bedrock attachments live under `uploads/<session-id>/`.

## License

[Elastic License 2.0](./LICENSE.md)
