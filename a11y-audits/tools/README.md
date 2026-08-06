# Accessibility audit tools

The Playwright + axe-core scripts that produced the evidence in
[`../8-5-26/audit.md`](../8-5-26/audit.md). Kept in the repository so findings can be
re-measured after each fix, and because `audit.mjs` drives the
CI accessibility gate ([#36](https://github.com/CodeSignal/learn_cosmo-chat/issues/36)).

These have their own dependency tree. They are **not** part of the application build and are
not installed by the root `npm ci`.

## Setup

```bash
cd a11y-audits/tools
npm install
```

## Running

The scripts drive a real browser against a running instance, so start the app first. Port 3000
is often already occupied:

```bash
# from the repository root
PORT=3100 AGENT_TARGET=dev node server.js
```

Then:

```bash
cd a11y-audits/tools
npm run audit
```

| Variable | Default | Purpose |
|---|---|---|
| `A11Y_BASE_URL` | `http://localhost:3100` | Where the app is running |
| `A11Y_OUT` | `a11y-out` | Directory for screenshots and `report.json` |
| `A11Y_BROWSER_CHANNEL` | `chrome` | Set to `bundled` to use Playwright's own Chromium |
| `A11Y_CI` | unset | `1` stubs `/api/*`, skips the live-agent send flow, and enables the baseline gate |
| `A11Y_BASELINE` | `./baseline.json` when `A11Y_CI=1` | Path to the shrink-only axe baseline |
| `A11Y_UPDATE_BASELINE` | unset | `1` rewrites the baseline from the current run |

`A11Y_BROWSER_CHANNEL` defaults to system Chrome because Playwright's bundled Chromium was
missing on the audit machine. In CI, run `playwright install chromium` and set it to `bundled`.

### CI gate

`.github/workflows/pr.yml` runs:

```bash
npm run audit:ci
```

That compares the axe results for empty / settings / settings-with-dropdown in both color
schemes against [`baseline.json`](./baseline.json). The baseline is **shrink-only**: a new
rule or a higher node count fails the build; a fix that removes violations should update
`baseline.json` in the same PR so the floor ratchets down.

```bash
# after a fix that clears axe violations:
npm run audit:update-baseline
```

CI does not exercise streaming or populated-conversation states (no live agent). Those
axe results matched the empty-state shell in the original audit, and the settings /
dropdown states carry the distinctive rules (`aria-input-field-name`, the extra
`region` nodes, dark-mode contrast). Re-run the full `npm run audit` locally when a
fix needs the live-agent states.

## What each script does

**`audit.mjs`** — the main sweep. For each of light and dark mode it walks the app through five
states (empty, streaming, populated conversation, settings modal, settings modal with a dropdown
open), runs an axe scan tagged `wcag2a` through `wcag22aa` plus `best-practice` at each one, and
screenshots it. It also samples real foreground/background pairs from the live DOM and computes
WCAG contrast ratios from computed styles, which is how the token failures in A7 and A8 were
measured rather than estimated. Writes `report.json` and the screenshots to `$A11Y_OUT`.

It additionally scans the design system's own `components/dropdown/test.html`, because the app
only exposes one model and so never renders the model dropdown in-app.

Two details make the contrast numbers trustworthy, and both matter if you change this code.
Text is composited over its backdrop using the cumulative `opacity` of its ancestors before the
ratio is computed, because contrast applies to what is actually painted — `.composer__hint` sits
at `opacity: 0.8` and reads 3.05:1 raw but 2.45:1 as rendered. And text inside an inactive
component is skipped, since WCAG 1.4.3 exempts it; the disabled Temperature row is faded to
`opacity: 0.4` and would otherwise report a failure that is not real.

**`verify.mjs`** — targeted checks that axe cannot make: composer focus indicators, interactive
target sizes against the 24×24 threshold, live region behavior, and whether focus survives a
re-render.

**`verify2.mjs`** — session row keyboard behavior specifically, including the nested interactive
control in finding A4 where Enter fires two actions.

## Important limitation

**axe cannot detect A1**, the most severe finding in the audit. A live region that re-announces
its entire contents on every update is valid HTML; only a screen reader reveals the problem. A
clean run of these scripts is a floor, not a ceiling — the manual VoiceOver checks in the
remediation plan remain mandatory.

## Evidence from the 2026-08-05 run

Preserved in [`../8-5-26/evidence/`](../8-5-26/evidence/): `report.json` plus per-state
screenshots in both themes.
