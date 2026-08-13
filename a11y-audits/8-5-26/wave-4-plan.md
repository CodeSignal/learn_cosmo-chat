# Wave 4 — Moderate / Minor Remediation Plan

**Companion to:** [`audit.md`](./audit.md), [`resolution-plan.md`](./resolution-plan.md)  
**Scope:** remaining WCAG 2.2 AA moderate + minor findings (critical/serious complete)  
**Model:** one GitHub issue per finding, one PR per issue — except where a shared root cause clearly warrants bundling (same bar as A1/A2/A11)  
**Milestone:** `WCAG 2.2 AA — Moderate & Minor` (app + DS)

### Issue map (filed Wave 4a)

| ID | Issue | State |
|---|---|---|
| A19–A22 | [#61](https://github.com/CodeSignal/learn_cosmo-chat/issues/61)–[#64](https://github.com/CodeSignal/learn_cosmo-chat/issues/64) | Closed (verified / mitigated) |
| A10 | [#65](https://github.com/CodeSignal/learn_cosmo-chat/issues/65) | Closed (PR #78) |
| A12 | [#66](https://github.com/CodeSignal/learn_cosmo-chat/issues/66) | Closed (PR #75) |
| A13 | [#67](https://github.com/CodeSignal/learn_cosmo-chat/issues/67) | Closed (PR #74) |
| A14 | [#68](https://github.com/CodeSignal/learn_cosmo-chat/issues/68) | Closed (PR #80, with A15) |
| A15 | [#69](https://github.com/CodeSignal/learn_cosmo-chat/issues/69) | Closed (PR #80, with A14) |
| A16 | [#70](https://github.com/CodeSignal/learn_cosmo-chat/issues/70) | Open |
| A17 | [#71](https://github.com/CodeSignal/learn_cosmo-chat/issues/71) | Closed (PR #76) |
| A18 | [#72](https://github.com/CodeSignal/learn_cosmo-chat/issues/72) | Closed (PR #77) |
| A23 | [#73](https://github.com/CodeSignal/learn_cosmo-chat/issues/73) | Closed (PR #79) |
| D8 | [DS #19](https://github.com/CodeSignal/learn_bespoke-design-system/issues/19) | Closed (DS PR #24) |
| D9 | [DS #20](https://github.com/CodeSignal/learn_bespoke-design-system/issues/20) | Closed (DS PR #25) |
| D10 | [DS #21](https://github.com/CodeSignal/learn_bespoke-design-system/issues/21) | Closed (DS PR #24) |
| D11 | [DS #22](https://github.com/CodeSignal/learn_bespoke-design-system/issues/22) | Closed (DS PR #24) |
| D12 | [DS #23](https://github.com/CodeSignal/learn_bespoke-design-system/issues/23) | Open |

---

## Status after Waves 0–3 (verify before filing)

Code review of current `main` + bumped design-system submodule. Treat this as a pre-flight checklist; close with a short evidence note (test name, VoiceOver note, or screenshot) rather than opening work.

| ID | Audit claim | Current status | Evidence |
|---|---|---|---|
| **A11** | Live region rebuilt each render; no completion announcement | **Fixed** (Wave 1 foundation) | Persistent `#chatStatus` + `announceChatStatus()` for “Cosmo is responding” / “Response complete” / “Response stopped”; DOM tests `A11:*` in `tests/dom/render.test.js`. In-message `.message__ai-status` is visual only (no `aria-live`). |
| **A19** | Session items use UA default focus ring | **Fixed** (Wave 2 / A4) | `.session-item__select:focus-visible` and `.session-item__delete:focus-visible` use `outline: 2px solid var(--Colors-Primary-Default)`. |
| **A20** | Thoughts disclosure resets during streaming | **Fixed** (Wave 1 reconcile) | `patchAssistantRowContent` preserves `wasOpen` across token ticks (`public/app.js`, comment cites A20). |
| **A21** | User message text injected as unescaped HTML | **Fixed** (already landed) | User bubble created with `textContent` — comment cites A21 / XSS. |
| **A22** | No skip link past the sidebar | **Partially eased** | A5 restored `<main>`. No skip link in markup. AT users can landmark-jump; sighted keyboard users still tab through the sidebar. **Product decision:** keep as optional polish or close as “won’t fix / mitigated by landmarks.” |

**Also still open outside the numbered backlog:** axe baseline `region: 1` on empty-state (light + dark). **Diagnosed:** target is `#sidebarResizer` (`role="separator"`) — it sits between `<aside>` and `<main>` and is therefore outside any landmark. Track as **A23**. Fix by moving the resizer into the sidebar landmark (or otherwise containing it) without breaking drag/keyboard behavior. Clearing it lets the shrink-only baseline reach zero on empty-state.

---

## Remaining work (confirmed open)

### Application — `CodeSignal/learn_cosmo-chat`

| ID | Severity | Finding | Size | Primary files |
|---|---|---|---|---|
| A10 | Moderate | No `<h1>` once a conversation starts | S | `public/index.html`, `public/app.js` (`emptyState` / session title) |
| A12 | Moderate | Copy confirmation not announced | S | `public/app.js` (`copyWithFeedback` → reuse `announceChatStatus`) |
| A13 | Moderate | `role="toolbar"` without arrow-key nav | XS | `public/index.html` (prefer drop role; keep group `aria-label`) |
| A14 | Moderate | `lang="en"` hardcoded despite Spanish catalog | XS | `public/app.js` (`applyChatConfigUI`), locale from config |
| A15 | Moderate | Accessible names not translated | M | `public/index.html` static `aria-label`s, `applyChatConfigUI`, `i18n/*.json`, attachment remove label |
| A16 | Moderate | Images use filenames as alt text | M | markdown `renderer.image`, `renderFilePart`, composer thumbnails; prompt-as-alt for generated images |
| A17 | Moderate | Focus not restored when edit cancelled | S | `startEditingMessage` / `exitEditMode` |
| A18 | Moderate | Delete control only reachable on hover | S | `public/app.css` (`(hover: none)` or always-visible below breakpoint) |
| A22 | Minor | Skip link (if kept) | S | `public/index.html` + CSS |
| A23* | Moderate | Empty-state axe `region: 1` | XS–S | Landmark placement of `#chatStatus` / `.chat-main` |

\*Proposed ID for the residual baseline gap; not in the original audit table.

### Design system — `CodeSignal/learn_bespoke-design-system`

| ID | Severity | Finding | Size | Primary files |
|---|---|---|---|---|
| D8 | Moderate | Every modal reuses `id="modal-title"` | S | `components/modal/modal.js` |
| D9 | Moderate | Hardcoded English accessible names | M | `modal.js`, `numeric-slider.js`, `dropdown.js` (+ docs) |
| D10 | Moderate | Escape handler never removed on close | S | `modal.js` (`close` vs `destroy`) |
| D11 | Minor | Smooth scroll ignores reduced-motion | XS | `modal.js` |
| D12 | Minor | Stroke tokens not dark-adapted | M | `colors/colors.css` (+ confirm with DS owners; app local patches become removable) |

Every DS merge still needs an **app submodule bump PR** before users see it.

---

## Bundling decisions

Default remains **one issue → one PR**. Exceptions:

| Bundle | Why | Shape |
|---|---|---|
| **A14 + A15** | Same fix surface: `applyChatConfigUI` + catalogs; A14 alone is one line and would land in the same review as A15 anyway | One app PR, two issues closed |
| **D8 + D10** *(optional)* | Same file, same lifecycle theme (instance identity + listener hygiene). Independent review value is low | Prefer one DS PR if reviewer bandwidth is tight; otherwise sequential |
| **D11 with D8/D10** *(optional)* | Also `modal.js`; XS follow-on | Safe to include in the modal hygiene PR |
| **Do not bundle D9 with D8/D10** | D9 is an API/contract change (label overrides); different review and consumer impact | Separate DS issue/PR |
| **Do not bundle D12 with anything** | Visual token change across consumers — same process as A7/A8 | Own issue; early open, design sign-off |
| **A12 alone** | Reuses `announceChatStatus` but is unrelated to i18n or headings | Own PR |
| **A10 ± A23** | If diagnosing `region` shows `#chatStatus` should live inside `<main>` next to a persistent `<h1>`, one structural PR is cleaner | Bundle only after Wave 4a diagnosis |

---

## Execution waves

Sequenced by dependency and leverage. Parallelize across repos freely.

### Wave 4a — Verify gate (do first; no feature PRs yet)

1. Re-confirm A11 / A19 / A20 / A21 on current `main` (DOM tests + quick keyboard/VoiceOver spot-check for A11 completion).
2. Close those issues (or never file) with links to tests / commits.
3. Decide A22: **file + fix**, or **close mitigated** (landmarks sufficient for 2.4.1).
4. Diagnose empty-state `region: 1` → assign A23 or fold into A10.
5. Create milestone + issues for everything still open (app + DS).

**Exit:** backlog is only real open work; baseline residual has an owner.

---

### Wave 4b — Cheap, independent app wins (parallel)

No shared code; ship in any order.

| Order | ID | Suggested approach | Depends on |
|---|---|---|---|
| 1 | **A13** | Remove `role="toolbar"`; keep a grouping label if useful (`aria-label` on a plain `<div>` is fine, or drop it). Do **not** implement roving tabindex for three buttons. | — |
| 2 | **A12** | On successful copy, call `announceChatStatus(copiedLabel)` (or a dedicated short string). Keep visual checkmark + temporary `aria-label` if desired. | A11 infrastructure (already landed) |
| 3 | **A17** | Hold a reference to the Edit button in `startEditingMessage`; `exitEditMode` focuses it (mirror `copyText` focus restore). Escape key should take the same path if it cancels. | — |
| 4 | **A18** | `@media (hover: none) { .session-item__delete { opacity: 1; pointer-events: auto; } }` (and/or always show on coarse pointers). Keyboard path already works via `:focus-visible`. | — |
| 5 | **A10** (± **A23**) | Persistent conversation `<h1>` (visually hidden or in chrome) updated with session title; demote empty-state copy to `<p>` / `<h2>`. Fix landmark nesting if A23 shares the structure. Expect `page-has-heading-one` to appear once CI gains a populated scan — today CI only scans empty + settings. | 4a diagnosis |

**Exit:** copy announces; edit cancel restores focus; touch can delete sessions; heading hierarchy valid with messages present; toolbar role not lying.

---

### Wave 4c — i18n cluster (pull forward if Spanish deployments matter)

Resolution-plan guidance still holds: a Spanish UI with `lang="en"` and English control names is worse than “moderate” suggests.

| Order | ID | Repo | Suggested approach |
|---|---|---|---|
| 1 | **A14 + A15** | app | Set `document.documentElement.lang` from resolved locale in `applyChatConfigUI`. Route static `aria-label`s / landmark labels through `t()` the same way visible strings already are. Fix `` `Remove ${…}` `` to `t()`. Add keys to `i18n/en.json` and `i18n/es.json`. |
| 2 | **D9** | **DS** | Add optional accessible-name overrides (e.g. `closeButtonLabel`, handle `ariaLabel` / label maps, dropdown already has `placeholder`). **Do not** embed a full i18n runtime in the DS — consumers pass already-translated strings. Document defaults remain English. |
| 3 | — | app | Submodule bump; pass `t('Close modal')` (etc.) into Modal / Dropdown / Slider constructors where the app constructs them. |

**Dependency:** App can land A14+A15 without waiting on D9 (settings close button and slider defaults stay English until bump). For a Spanish-complete settings modal, D9 + bump is required.

**Exit:** `language: es` → `<html lang="es">`, translated control names in app chrome; DS widgets accept translated names from the app.

---

### Wave 4d — Content semantics (app)

| ID | Suggested approach | Notes |
|---|---|---|
| **A16** | Generated images: prefer generating prompt (or tool-call prompt) as `alt`. User uploads: `t('Attached image: {name}', …)` rather than bare filename. Empty markdown alt → same prompt fallback or a generic translated “Generated image”. Escape alt text. | Needs a clear rule for where the prompt is available in the message/parts model; spike if unclear. Add DOM fixtures with image parts. |

Independent of i18n for structure, but labels should go through `t()` — land after or with 4c if catalogs are open.

---

### Wave 4e — Design-system hygiene & tokens (parallel with 4b–4d)

| Order | ID | Suggested approach | Consumer impact |
|---|---|---|---|
| 1 | **D8** (+ optional **D10**, **D11**) | Unique `modal-title-${id}` per instance (same pattern as `PortalDropdown`). On `close()`, remove escape (and consider not leaving inert overlays forever if that is still true). Honor `prefers-reduced-motion` for `scrollIntoView`. | Low — attribute IDs change; app should not hardcode `modal-title`. |
| 2 | **D9** | See Wave 4c | API surface — coordinate with app bump |
| 3 | **D12** | Dark-adapt `--Colors-Stroke-*` in the dark block; propose values aligned with existing dark neutrals. Flag for DS owners (visual). After bump, remove app workarounds at `app.css` tertiary border / rest-pill comments if obsolete. | Medium — shared look; same process as A7/A8 |

Open D9 and D12 issues early (longest lead time). Modal hygiene can ship without waiting on tokens.

---

### Wave 4f — Optional polish

| ID | Action |
|---|---|
| **A22** | If kept: skip link as first focusable in `<body>`, target `#chatHistory` or `#promptInput`, visually hidden until focus. Update axe/manual checklist. |

---

## Suggested issue → PR count

| | Issues | PRs |
|---|---|---|
| Close / no-op after verify | A11, A19, A20, A21 (± A22) | 0 |
| App feature PRs | A10, A12, A13, A14+A15, A16, A17, A18, (± A22), (± A23) | **7–9** |
| DS PRs | D8(+D10+D11), D9, D12 | **3** (or 5 if fully split) |
| App submodule bumps | after D8-cluster, D9, D12 (can combine if timings align) | **1–3** |

---

## Recommended sequencing (calendar view)

```text
Week 0 (½ day)
  └─ Wave 4a verify + issue filing (both repos)

Parallel track A (app)          Parallel track B (DS)
─────────────────────           ─────────────────────
A13 → A12 → A17 → A18           D8 (+ D10, D11)
A10 (± A23)                     D9  ──needs design/API note
A14+A15                         D12 ──needs design sign-off
A16
(A22 if kept)

App bumps after each DS merge (or one bump when all three land)
```

**If Spanish rollout is imminent:** run Wave 4c immediately after 4a, ahead of A16/A18 polish.  
**If Spanish is not on the roadmap:** still land A14 (trivial correctness) with A15 whenever catalogs are touched; D9 can wait behind modal hygiene.

---

## Labels, branches, definition of done

Reuse the label set from `resolution-plan.md` (`a11y`, `severity:moderate|minor`, WCAG principle, `needs-manual-verify`, `theme:dark-only` for D12).

**Branches:** `fix/a11y-a12-copy-announce`, `fix/a11y-d8-modal-title-ids`, etc.

**Per-PR definition of done** (same as Waves 1–3):

- [ ] Issue acceptance criteria met  
- [ ] Light + dark checked where relevant  
- [ ] `npm test` green; new DOM coverage for render/focus/i18n behavior where practical  
- [ ] Axe baseline shrinks or stays equal — never grows  
- [ ] Keyboard walkthrough of the touched flow  
- [ ] Live-region / focus changes: VoiceOver note in the PR  
- [ ] No new hardcoded user-facing strings — route through `t()` (A15/D9 discipline)  
- [ ] PR links audit ID  

---

## Risks & notes

**CI does not scan populated conversations.** A10 (`page-has-heading-one` after the first message) will not fail PR CI until a populated state is added to the axe harness. Prefer a DOM unit assertion for the persistent `<h1>` in the A10 PR rather than waiting on CI expansion.

**D9 is a contract change.** Other DS consumers must keep working with English defaults when overrides are omitted.

**D12 is political the same way A7/A8 were.** Fix at source; no new long-lived app overrides. Confirm with DS owners before merge.

**A16 needs a product rule.** “Prompt as alt” is right for generated images but requires a reliable prompt string at render time; confirm against the parts/tool-call shape before estimating as S.

**A11 “fixed” ≠ “re-verify forever.”** Any future return to wipe-and-rebuild or nesting `aria-live` inside the message list reopens it; keep the DOM tests.

---

## Summary

| Wave | Work | Repo | Parallelizable |
|---|---|---|---|
| 4a — Verify | Close A11/A19/A20/A21; decide A22; diagnose `region` | app | — |
| 4b — Quick wins | A13, A12, A17, A18, A10 (±A23) | app | Fully |
| 4c — i18n | A14+A15; D9 + bump | app + DS | DS/app staggered |
| 4d — Media | A16 | app | Yes |
| 4e — DS hygiene/tokens | D8(+D10+D11), D12 + bumps | DS → app | Fully vs app 4b |
| 4f — Optional | A22 skip link | app | Yes |

**Net new delivery after verify:** ~10–12 findings → ~10–12 issues → ~10–12 PRs including bumps, with A14+A15 as the one deliberate app bundle and an optional modal hygiene bundle in the DS.
