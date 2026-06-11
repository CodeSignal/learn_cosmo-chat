# AGENTS.md

## Cursor Cloud specific instructions

ChatCPT is a single Node.js service: an Express server (`server.js`) that serves a
vanilla-JS frontend (bundled from `public/app.js` into `public/app.bundle.js` via esbuild)
and proxies chat to the Octavus AI platform via `@octavus/server-sdk`.

Standard commands live in `package.json` (`build`, `dev`, `start`, `test`). Notes that are
not obvious from the README:

- **Octavus credentials are required for the server to even boot.** `server.js` constructs
  `new OctavusClient({ baseUrl: OCTAVUS_API_URL, ... })` at module load, and the SDK throws
  if `OCTAVUS_API_URL` is undefined. Put `OCTAVUS_API_URL`, `OCTAVUS_API_KEY`, and
  `OCTAVUS_AGENT_ID` in a gitignored `.env` (loaded via `dotenv`). Without real values the
  UI still renders but every chat/session API call returns HTTP 500 ("Failed to create
  session"), and the frontend keeps the chat shell hidden until a session is created.
- **`chat-config.json` must exist** (it is gitignored). Create it once with
  `cp chat-config.example.json chat-config.json`; otherwise config-dependent endpoints fall
  back to empty defaults.
- **The `design-system/` git submodule must be initialized** (`git submodule update --init
  --recursive`) — it is served at `/design-system` and the UI styling depends on it.
- **`public/hljs-github-dark.css` is gitignored and not produced by `npm run build`.** It is
  the highlight.js code-block theme referenced by `index.html`; copy it from the package
  (`cp node_modules/highlight.js/styles/github-dark.css public/hljs-github-dark.css`) or the
  link 404s. The startup update script already does this.
- There is **no lint script**; `npm test` runs vitest (`tests/*.test.js`) and does not need
  network access or Octavus credentials (`NODE_ENV=test` skips `app.listen`).
- `npm run dev` runs an esbuild `--watch` for the client plus `node --watch server.js`.
  Server-file changes hot-restart; client changes rebuild `app.bundle.js`. Reinstalling deps
  does not trigger a rebuild — re-run `npm run build` (or restart `dev`) after `npm install`.
- App serves at http://localhost:3000 (override with `PORT`).
