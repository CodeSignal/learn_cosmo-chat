# Accessibility Remediation Plan

**Companion to:** [`audit.md`](./audit.md)
**Scope of this plan:** the 3 critical and 13 serious findings (16 of 34 total)
**Target:** WCAG 2.2 Level AA
**Model:** one GitHub issue per finding, one PR per issue

---

## Does the one-issue-one-PR model work here?

Yes, for 13 of the 16 findings. It gives each fix an independent review, an independent revert, and a clean audit trail back to a numbered finding. That is the right default.

There is **one exception worth deciding on deliberately**: findings A1, A2, and A11 are not three bugs. They are three symptoms of a single line of code — `messagesEl.innerHTML = ''` at `public/app.js:1020`. The fix for A1 (stop re-announcing the transcript) is to reconcile the message list instead of rebuilding it. That same change is the entire fix for A2 (focus destroyed on re-render) and removes the cause of A11 (live region rebuilt each render).

Splitting them into three PRs would mean one substantial PR followed by two that close an issue without changing meaningful code. The plan below therefore recommends **one foundation PR closing A1, A2, and A11 together**, with all three issues still filed separately for traceability. Everything else stays strictly one-to-one.

The other thing worth naming up front: **this work spans two repositories.**

| Repository | Findings | Notes |
|---|---|---|
| `CodeSignal/learn_cosmo-chat` | A1–A6, A9, D6, D7 | This repo |
| `CodeSignal/learn_bespoke-design-system` | A7, A8, D1, D2, D3, D4, D5 | Git submodule, separate repo and review cycle |

The split does not follow the audit's `A`/`D` prefixes, so check ownership per finding rather than assuming:

- **D6** (orphaned labels) and **D7** (portaled menu escaping the dialog) read as design-system findings but live in application code — `public/app.js:573,581` and `public/portal-dropdown.js`. Both may need a small cooperating change in the design system, noted per-issue below.
- **A7** (focus ring contrast) and **A8** (text contrast) surface in the application but trace entirely to design-system color tokens. Per the decision recorded in Wave 3, these are fixed at the source rather than overridden locally, so they belong to the design-system repo.

Every design-system merge also requires a **submodule pointer bump PR** in this repo before the fix reaches users. Budget for that round trip.

---

## Two things to build before fixing anything

Both of these exist because of gaps the audit surfaced, and both make every subsequent PR safer and faster to review.

### P0-1 — A DOM regression harness

`public/app.js` is 2094 lines and has **zero test coverage**. The `tests/` directory covers `lib/` only — `helpers`, `model-capabilities`, `server`, `stream-registry`, `thinking`. The foundation PR (A1/A2/A11) rewrites the rendering core of the application with no safety net underneath it. That is the single largest risk in this plan.

Add a `jsdom` environment to the existing vitest setup and cover the render path before touching it: messages render in order, streaming appends, restored history composes with live messages, stop folds a partial turn into history, and the hover-action buttons wire up to the right message index.

These are characterization tests. Their job is to prove the refactor changed nothing except what it intended to.

### P0-2 — Accessibility checks in CI

There is currently no CI on pull requests at all. `.github/workflows/release.yml` triggers only on `release: created`, so nothing runs `npm test` when a PR opens.

Add a `pr.yml` workflow that runs the unit tests and an axe scan against a locally started server, in both color schemes. The audit harness is already written and can be adapted directly — it boots the app, drives it into five states, and asserts on axe violations.

Gate on a **violation allowlist that only ever shrinks**: capture today's violations as the baseline, and fail the build if a new one appears or if a fix regresses. Without this, the 16 fixes below will erode.

---

## Labels and conventions

The repository currently has only GitHub's nine default labels. Create these first:

```bash
gh label create "a11y"               --color "1D76DB" --description "Accessibility"
gh label create "severity:critical"  --color "B60205" --description "Blocks assistive technology use"
gh label create "severity:serious"   --color "D93F0B" --description "Major barrier for some users"
gh label create "severity:moderate"  --color "FBCA04" --description "Meaningful barrier"
gh label create "severity:minor"     --color "FEF2C0" --description "Polish"
gh label create "wcag:perceivable"   --color "C5DEF5"
gh label create "wcag:operable"      --color "C5DEF5"
gh label create "wcag:understandable" --color "C5DEF5"
gh label create "wcag:robust"        --color "C5DEF5"
gh label create "theme:dark-only"    --color "0E1116" --description "Only reproduces in dark mode"
gh label create "needs-manual-verify" --color "5319E7" --description "Requires a screen reader pass"
```

Run the same set in `learn_bespoke-design-system` for D1–D5.

**Milestone:** `WCAG 2.2 AA — Critical & Serious`, one per repo.

**Branches** follow the existing convention (`fix/…`, `feature/…`): `fix/a11y-a4-session-item-buttons`.

**Commits** follow the existing Conventional Commits style: `fix(a11y): restructure session rows as native buttons`.

---

## Issue template

Every issue should carry enough context that whoever picks it up does not have to re-read the audit. Use this body shape:

```markdown
## Finding
[ID] — [one-line summary]        Severity: [critical|serious]
WCAG: [criterion number and name]        Theme: [both | dark only]

## Where
`path/to/file.js:LINE-LINE`

## Current behavior
[What happens today, with the audit's measured evidence.]

## Expected behavior
[What should happen.]

## How this was verified
[The exact measurement or reproduction from the audit, so it can be re-run.]

## Suggested approach
[The audit's recommended direction. Not binding — the implementer may find better.]

## Acceptance criteria
- [ ] [Specific, checkable outcome]
- [ ] Verified in both light and dark mode
- [ ] axe reports no new violations
- [ ] [Manual screen reader check, where relevant]

## Reference
a11y-audits/8-5-26/audit.md → finding [ID]
```

---

## Execution waves

Sequenced by dependency, not just severity. Each wave should land before the next begins, because later waves touch code the earlier ones rewrite.

### Wave 0 — Foundations

| ID | Work | Repo | Size |
|---|---|---|---|
| P0-1 | DOM regression harness for `renderMessages` | app | M |
| P0-2 | PR CI with unit tests + axe baseline | app | S |

**Exit criteria:** `npm test` covers the render path; a PR runs axe automatically in both themes.

---

### Wave 1 — Restore basic assistive-technology usability

This wave is the reason the app is currently unusable with a screen reader. Nothing in Waves 2–3 matters until it lands.

| ID | Finding | Repo | Size | Depends on |
|---|---|---|---|---|
| A5 | `role="log"` on `<main>` removes the main landmark | app | S | — |
| A1+A2+A11 | Render reconciliation (foundation PR) | app | L | P0-1, A5 |
| A3 | Composer disabled mid-stream drops focus | app | S | A1 |
| D1 | Modal has no focus trap | **DS** | M | — |
| — | Submodule bump for D1 | app | XS | D1 |

**Why A5 goes first:** it edits `public/index.html:83`, the same element the foundation PR rewires. Landing the one-line landmark fix first keeps the large PR's diff focused on logic rather than mixing in a semantics change.

**On the foundation PR (A1+A2+A11).** This is the highest-risk change in the plan. Guidance for whoever takes it:

- Key each message row by a stable identity and update in place. Do not rebuild rows that have not changed.
- Introduce one persistent, visually hidden `role="status"` element outside the message subtree, created at page load. Route *only* short deliberate messages through it: "Cosmo is responding", "Response complete", "Response stopped".
- Do not route streaming text through a live region. Full text stays available through normal document navigation.
- Land the characterization tests from P0-1 in a separate, earlier PR so the reviewer can see the refactor's diff against a green baseline.
- Expect the review to be slow. Consider a design sketch in the issue before opening the PR.

**D1 runs in parallel** — different repo, no shared code, and it unblocks a dependency-free submodule bump.

**Exit criteria:** streaming a full response announces status transitions only; focus survives a complete streaming turn; Tab cannot escape an open modal.

---

### Wave 2 — Keyboard and state correctness

Independent of one another. Parallelize freely.

| ID | Finding | Repo | Size | Notes |
|---|---|---|---|---|
| A4 | Session rows are nested interactive; Enter fires two actions | app | M | Also adds `aria-current`; fixes Space scrolling |
| D2 | Dropdown loses focus on open and on select | **DS** | M | |
| D3 | Dropdown listbox/option structure malformed | **DS** | M | Land with or after D2 — same files |
| D4 | Dropdown selection state is visual only | **DS** | S | Follows D3 |
| D5 | Slider role contains focusable buttons | **DS** | M | |
| D6 | Settings labels orphaned from widgets | app | S | May need a DS option to accept an external label id |
| D7 | Portaled menu escapes the `aria-modal` dialog | app | M | See note below |
| — | Submodule bump for D2–D5 | app | XS | |

**On D2/D3/D4.** These are three issues in one file (`dropdown.js`) and one component contract. They can be three PRs, but they must be reviewed in order and the later ones rebased — otherwise they will conflict continuously. If the DS repo tolerates it, a single PR closing all three is defensible; the one-to-one rule is less valuable when the reviews cannot be independent anyway.

**On D7.** Two viable approaches, and the choice affects effort materially:
- *Tactical:* add `aria-owns` on the toggle pointing at the portaled menu, preserving the ownership relationship across the DOM move. Small, low risk, keeps the existing portal machinery.
- *Structural:* replace the portal with the native `popover` attribute and the top layer, which solves the original clipping problem without moving the element out of the dialog's subtree. This would let `public/portal-dropdown.js` be deleted entirely. Larger, but removes 178 lines of workaround.

Worth a short spike before committing.

**Exit criteria:** every custom widget is fully operable by keyboard with focus returning where the user expects, and exposes its state programmatically.

---

### Wave 3 — Perceptual and visual

| ID | Finding | Repo | Size | Notes |
|---|---|---|---|---|
| A6 | Composer has no focus indicator in dark mode | app | S | Dark only; app CSS, not a token |
| A7 | Focus ring contrast 2.94:1 in dark mode | **DS** | S | Token fix — see below |
| A8 | Four text contrast failures | **DS** | M | Token fix — see below |
| A9 | Targets below 24×24 | app | S | Mostly padding |
| — | Submodule bump for A7, A8 | app | XS | Required before users see either fix |

**The token fixes (A7 and A8).** Both trace to design-system color tokens rather than application CSS:

- A7: `--Colors-Primary-Default` resolves to `Primary-700` (`#1062FB`) in *both* themes — it was never lightened for dark. The `Primary-400`/`Primary-450` steps already exist in the scale and are used for other dark-mode semantics.
- A8: the failing text uses `--Colors-Text-Body-Lighter`, which maps to `Neutral-800` in light and `Neutral-900` in dark. Neither is sufficient against its own theme's background at body size.

**Decision: fix these at the source in the design system, with no interim application-level override.** Correcting the tokens benefits every consumer and avoids leaving a temporary patch in `app.css` that someone has to remember to remove. The trade-off is accepted deliberately: these two findings stay live for users until the design-system PRs merge and the submodule pointer is bumped.

Two consequences to plan around:

1. **Start A7 and A8 early.** They have no dependency on Waves 1 or 2, and they carry the longest lead time of anything in this plan — separate repo, separate review, then a bump. Opening them alongside Wave 1 rather than waiting for Wave 3 costs nothing and removes them from the critical path.
2. **Expect cross-consumer discussion.** Changing shared text and primary tokens alters the look of every project using the design system. Flag the intent in the DS issues and confirm with the design-system owners before merging, since this is a visual change and not purely a bug fix.

Note that the existing local patches at `app.css:38-40` and `app.css:259` are precedent for the *opposite* approach. They are worth revisiting as follow-up DS issues so the workaround pattern does not keep accumulating.

**Exit criteria:** all text meets 4.5:1, all focus indicators meet 3:1, all targets are at least 24×24 — verified in both themes, against the bumped submodule.

---

## Ready-to-run issue creation

With `gh` authenticated as you already are, the critical and serious issues can be filed in one pass. Illustrative for the first two; the same shape applies to the rest.

```bash
gh issue create \
  --title "[a11y][A1] Whole conversation re-announced continuously while streaming" \
  --label "a11y,severity:critical,wcag:robust,needs-manual-verify" \
  --milestone "WCAG 2.2 AA — Critical & Serious" \
  --body-file .github/a11y/A1.md

gh issue create \
  --title "[a11y][A4] Session rows are nested interactive controls; Enter fires two actions" \
  --label "a11y,severity:serious,wcag:operable" \
  --milestone "WCAG 2.2 AA — Critical & Serious" \
  --body-file .github/a11y/A4.md
```

Consider an **epic issue** that links all 16 with checkboxes, so progress is visible in one place and the waves stay legible.

---

## Definition of done, per PR

A PR closing an accessibility issue should satisfy all of these before merge:

- [ ] The specific acceptance criteria in its issue are met
- [ ] Verified in **both** light and dark mode — several findings reproduce in only one
- [ ] `npm test` passes, including any new regression coverage
- [ ] The axe baseline shrinks, and no new violation appears
- [ ] Keyboard-only walkthrough of the affected flow, with focus visible at every stop
- [ ] For anything touching live regions or focus: a VoiceOver pass, with the observed behavior described in the PR
- [ ] PR body links the audit finding ID and states how it was verified
- [ ] No new hardcoded user-facing strings — route through `t()` (see A15)

---

## Risks

**The foundation PR is large and untested.** It rewrites the render core of a 2094-line file with no existing coverage. Mitigated by P0-1 landing first. If the characterization tests prove hard to write, that is a signal the refactor needs a design discussion before code, not a reason to skip them.

**Cross-repo latency is now the critical path.** Seven of the sixteen findings — A7, A8, and D1–D5 — need a design-system merge plus a submodule bump before they reach users. With the no-override decision on A7 and A8, nothing shortcuts that wait. Open all seven design-system issues at the start of Wave 1, not when their wave comes up.

**Design-system changes affect other consumers.** `learn_bespoke-design-system` is shared. The dropdown and slider fixes change DOM structure and ARIA, which could affect other projects' selectors or snapshots; the A7/A8 token fixes change colors everywhere. Flag both in those PRs and check with the design-system owners before merging.

**Fixes can regress each other.** A2 (focus survival) and A3 (composer focus) both depend on the render refactor holding. The CI axe gate plus focus-specific regression tests are what keep Wave 1 from quietly unravelling during Waves 2–3.

**Automated checks miss the most important finding.** axe cannot detect A1 — a live region that re-announces too much is valid HTML. Only a screen reader reveals it. Do not let a green CI badge stand in for the manual pass.

---

## After critical and serious

The 12 moderate and 6 minor findings are deliberately out of scope here. Several become nearly free once this work lands: A22 (skip link) is largely resolved by A5, A19 (default focus ring) disappears with A4's restructuring, and A20 (Thoughts disclosure resetting) is fixed by the render reconciliation.

The remaining cluster worth planning as a unit is internationalization — A14 (`lang` never updates), A15 (accessible names not translated), and D9 (hardcoded English in the design system). These share one root cause and one fix strategy, and they matter more than "moderate" suggests for any Spanish deployment: a screen reader reading Spanish content with an English synthesizer is close to unusable. Consider pulling that group forward if a Spanish rollout is on the roadmap.

---

## Summary

| Wave | Findings | Repo split | Parallelizable |
|---|---|---|---|
| 0 — Foundations | P0-1, P0-2 | app | Yes |
| 1 — AT usability | A5, A1+A2+A11, A3, D1 | 3 app + 1 DS | Partly — A1 gates A3 |
| 2 — Keyboard & state | A4, D2, D3, D4, D5, D6, D7 | 3 app + 4 DS | Mostly |
| 3 — Perceptual | A6, A9 (app) · A7, A8 (DS) | 2 app + 2 DS | Fully |

**16 findings → 16 issues → 14 PRs** (A1, A2, and A11 share the foundation PR), plus 2 foundation PRs and 3 submodule bumps (D1; D2–D5; A7–A8).

Because A7 and A8 are fixed in the design system with no interim override, open their issues during Wave 1 even though they land in Wave 3 — they have the longest lead time of anything here.
