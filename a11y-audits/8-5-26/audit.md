# Accessibility Audit — ChatCPT

**Date:** August 5, 2026
**Standard:** WCAG 2.2 Level AA
**Auditor:** Automated + manual code review with live browser verification
**Status:** Findings only. No code was changed as part of this audit.

---

## Executive summary

ChatCPT is a hand-rolled vanilla-JS chat interface. There is no framework supplying accessibility defaults, so every landmark, live region, focus transition, and custom widget is bespoke — and that is where the problems concentrate.

The single most consequential issue is architectural rather than cosmetic: **the entire conversation is destroyed and rebuilt on every render pass, inside an `aria-live` region.** During a streaming response this happens on every token and at least once per second. For a screen reader user this re-announces the whole conversation continuously; for a keyboard user it silently throws focus to `<body>` several times per second. Together these make the core task of the app — reading a reply and acting on it — effectively unusable with assistive technology, even though almost every individual control has a correct `aria-label`.

The good news is that the groundwork is better than average. `prefers-reduced-motion` is honored in six places, the auto-scroll logic correctly respects a user who has scrolled up, most icon buttons carry real accessible names, the sidebar resizer implements a genuine `role="separator"` with live `aria-valuenow`, and the reduced-motion and focus-visible styling in `app.css` show deliberate care. The failures are concentrated in a handful of systemic patterns, not scattered everywhere.

### Findings by severity

| Severity | Application | Design system | Total |
|---|---|---|---|
| Critical | 2 | 1 | 3 |
| Serious | 7 | 6 | 13 |
| Moderate | 9 | 3 | 12 |
| Minor | 4 | 2 | 6 |
| **Total** | **22** | **12** | **34** |

Dark mode carries three failures that light mode does not: the composer loses its focus indicator entirely, the standard focus ring drops below the required contrast threshold, and a secondary button's label falls below 4.5:1.

---

## Scope and method

### What was audited

| Area | Files |
|---|---|
| Application shell | `public/index.html` |
| Application logic and rendering | `public/app.js` (2094 lines), `public/portal-dropdown.js` |
| Application styling and theming | `public/app.css` (1752 lines) |
| Localization | `i18n/en.json`, `i18n/es.json`, locale resolution in `server.js` |
| Design system (reported separately) | `design-system/components/{modal,dropdown,numeric-slider}`, `design-system/colors/colors.css` |

`design-system/` is a git submodule shared with other projects. Its findings are in a separate section because they cannot be fixed from this repository, but they are included because they affect this application's real-world accessibility.

### How it was tested

Three complementary passes:

1. **Static code review** of every file above against a WCAG 2.2 AA checklist covering semantics, ARIA, keyboard operability, focus management, contrast, live regions, forms, images, motion, reflow, target size, and internationalization.

2. **Automated scanning** with axe-core 4.x driven through Playwright against a running instance, in five application states (empty, streaming, populated conversation, settings modal, settings modal with dropdown open) and in the isolated design-system dropdown page. Every scan was run twice, once with `prefers-color-scheme: light` and once with `dark`.

3. **Scripted behavioral verification** for the things static analysis and axe both miss: programmatic tab-order walks recording each stop's computed focus indicator, focus-survival tests across re-renders, focus-trap testing inside the modal, computed-style contrast sampling of real rendered elements, target-size measurement, and reproduction of specific keyboard interactions.

Contrast ratios in this report are measured from **computed styles on live rendered elements** in each theme, not from raw design tokens, so they account for opacity and inherited backgrounds.

### Theming note

There is no in-app theme toggle. Dark mode is driven entirely by `@media (prefers-color-scheme: dark)` in `design-system/colors/colors.css:276` and three override blocks in `public/app.css` (lines 25, 260, 1708). Both themes were exercised by emulating the media query at the browser level.

### Not covered

- Manual screen reader passes with VoiceOver, JAWS, or NVDA. Automated tooling predicts announcement behavior; it does not replace hearing it. The live-region findings in particular deserve a confirmation pass with VoiceOver.
- Windows High Contrast Mode / forced-colors.
- The `split-panel`, `table`, `tags`, `horizontal-cards`, and `boxes` design-system components, which this application does not use.
- The Spanish locale rendered end-to-end. The `es.json` catalog was reviewed and the `lang` defect confirmed by code, but the UI was not driven in Spanish.
- Authenticated or error states beyond the boot-error path.

---

## Findings index

### Application

| ID | Severity | Finding | WCAG | Theme |
|---|---|---|---|---|
| A1 | Critical | Whole conversation re-announced continuously during streaming | 4.1.3 | Both |
| A2 | Critical | Keyboard focus destroyed on every re-render | 2.4.3, 3.2.2 | Both |
| A3 | Serious | Composer disabled mid-stream, dropping focus to `<body>` | 2.4.3, 3.2.2 | Both |
| A4 | Serious | Session items are nested interactive controls; Enter triggers two actions | 1.3.1, 4.1.2, 2.1.1 | Both |
| A5 | Serious | `role="log"` on `<main>` removes the main landmark | 1.3.1, 2.4.1 | Both |
| A6 | Serious | Composer has no focus indicator in dark mode | 2.4.7, 2.4.11 | Dark |
| A7 | Serious | Focus ring contrast 2.94:1 in dark mode | 1.4.11, 2.4.11 | Dark |
| A8 | Serious | Four text contrast failures across both themes | 1.4.3 | Both |
| A9 | Serious | Interactive targets below 24×24 CSS pixels | 2.5.8 | Both |
| A10 | Moderate | No `<h1>` once a conversation starts | 1.3.1, 2.4.6 | Both |
| A11 | Moderate | Streaming status live region rebuilt each render; no completion announcement | 4.1.3 | Both |
| A12 | Moderate | Copy confirmation not announced | 4.1.3 | Both |
| A13 | Moderate | `role="toolbar"` without arrow-key navigation | 4.1.2 | Both |
| A14 | Moderate | `lang="en"` hardcoded despite a Spanish catalog | 3.1.1 | Both |
| A15 | Moderate | Accessible names not translated | 3.1.1, 1.3.1 | Both |
| A16 | Moderate | Images use filenames as alternative text | 1.1.1 | Both |
| A17 | Moderate | Focus not restored when message editing is cancelled | 2.4.3 | Both |
| A18 | Moderate | Delete control only reachable on hover | 2.1.1 | Both |
| A19 | Minor | Session items rely on the browser default focus ring | 2.4.7 | Both |
| A20 | Minor | Thoughts disclosure state resets during streaming | 3.2.2 | Both |
| A21 | Minor | User message text injected as unescaped HTML | 1.3.1 | Both |
| A22 | Minor | No skip link past the sidebar | 2.4.1 | Both |

### Design system (submodule)

| ID | Severity | Finding | WCAG | Theme |
|---|---|---|---|---|
| D1 | Critical | Modal has no focus trap | 2.4.3 | Both |
| D2 | Serious | Dropdown loses focus on open and on select | 2.4.3, 2.1.1 | Both |
| D3 | Serious | Dropdown listbox/option structure is malformed | 1.3.1, 4.1.2 | Both |
| D4 | Serious | Dropdown selection state is visual only | 1.4.1, 4.1.2 | Both |
| D5 | Serious | Slider role contains focusable buttons; invalid `aria-valuenow` | 1.3.1, 4.1.2 | Both |
| D6 | Serious | Settings labels are orphaned from their custom widgets | 1.3.1, 3.3.2, 4.1.2 | Both |
| D7 | Serious | Portaled menu escapes the `aria-modal` dialog | 1.3.1, 4.1.2 | Both |
| D8 | Moderate | Every modal reuses `id="modal-title"` | 1.3.1, 4.1.2 | Both |
| D9 | Moderate | Hardcoded English accessible names | 3.1.1 | Both |
| D10 | Moderate | Escape handler never removed on close | — | Both |
| D11 | Minor | Smooth scroll ignores reduced-motion preference | 2.3.3 | Both |
| D12 | Minor | Stroke tokens are not dark-adapted | — | Dark |

---

## Application findings

### A1 — Critical: the whole conversation is re-announced continuously while streaming

**Where:** `public/app.js:1009-1219` (`renderMessages`), specifically the wipe at line 1020; render loop at `public/app.js:367-378`; live region declared at `public/index.html:83`

**What happens:** `#chatHistory` is marked `role="log" aria-live="polite"`. On every render, `renderMessages()` executes `messagesEl.innerHTML = ''` and then rebuilds every message in the conversation from scratch. This runs on each subscription tick (i.e. each streaming token) and additionally once per second via the `syncStreamingLoop` interval.

To a screen reader, replacing the contents of a polite live region is a change to be announced. Because the whole log is replaced rather than appended to, the announcement is not "the newest few words" — it is potentially the entire conversation, over and over. Measured during a live streaming response, the text content of the live region was 2,229 characters in light mode and 2,454 in dark. That volume of text is queued for re-announcement many times per second.

**Impact:** Screen reader users cannot follow a response as it arrives, and cannot interact with the page while a response streams because the speech queue never drains. This is the difference between the app being slow to use and being unusable.

**Why the current design invites it:** the rebuild-everything approach is simple and correct for rendering, but `aria-live` semantics assume incremental DOM changes. The two are fundamentally at odds.

**Recommended direction:** decouple the announcement surface from the render surface. Keep `#chatHistory` as a plain container (see A5 about restoring `<main>`), and introduce a separate, visually hidden `role="status"` element that receives only short, deliberate messages — "Cosmo is responding", "Response complete", "Response stopped". Reserve full-text access for the user's own navigation of the static DOM rather than pushing it through a live region. If in-progress text truly must be announced, diff and append rather than replace, and consider `aria-atomic="false"` with `aria-relevant="additions"`.

---

### A2 — Critical: keyboard focus is destroyed on every re-render

**Where:** `public/app.js:1020` and the action buttons created at lines 1131-1195

**What happens:** every re-render discards the DOM nodes for all message action buttons (Regenerate, Copy as Markdown, Edit, code-block Copy) and creates new ones. If one of those buttons had focus, the element holding focus no longer exists, and the browser resets focus to `<body>`.

**Verified:** a copy/regenerate button was focused, a render pass was triggered, and focus was confirmed to land on `<body>` in both light and dark mode.

**Impact:** a keyboard user tabbing toward the Copy button on a reply can have focus yanked to the top of the document mid-action — during streaming, repeatedly. Combined with A1, keyboard and screen reader users cannot reliably reach the per-message controls at all.

**Recommended direction:** reconcile the message list instead of rebuilding it — key each message row by index or ID, update only changed nodes, and leave untouched rows in place. Failing that, capture the active element's identity before the wipe and restore focus to its replacement afterwards. The former is the real fix; the latter is a stopgap.

---

### A3 — Serious: the composer is disabled mid-stream, dropping focus

**Where:** `public/app.js:1217` — `promptInput.disabled = streaming;`

**What happens:** when a response begins streaming, the prompt textarea is disabled. Disabling the element that currently holds focus removes it from the focus order, and focus falls to `<body>`.

**Verified:** mid-stream, `promptInput.disabled` was `true` and `document.activeElement` was `<body>`.

**Impact:** every single turn of the conversation costs the keyboard user their place in the document. There is no announcement explaining why, and after the response completes focus is not returned.

**Recommended direction:** prefer `readOnly` over `disabled` for a transiently unavailable text field — it keeps the element focusable and in the accessibility tree. Pair it with `aria-describedby` pointing at a short explanation, and return focus to the composer when the response completes.

---

### A4 — Serious: session list items are nested interactive controls, and Enter fires two actions

**Where:** `public/app.js:1528-1570`

Three distinct defects share one root cause — a `<div role="button" tabindex="0">` that contains a real `<button>`:

**Nested interactive controls.** axe flags this as serious on every scan (2 nodes in the sidebar). A control with `role="button"` may not contain focusable descendants; assistive technology cannot reliably present a button inside a button.

**Enter on Delete performs two actions.** The delete button's click handler calls `e.stopPropagation()` (line 1557), but the parent's `keydown` handler at line 1564 does not check `e.target`. Pressing Enter while the Delete button has focus therefore runs the parent's `switchSession()` on keydown *and* the delete on the subsequent click.

Verified by network capture — a single Enter keypress on a focused Delete button produced both:

```
GET /api/session?id=cmsdhe21o003e04jl0g1dg1w5
DELETE /api/sessions/cmsdhe21o003e04jl0g1dg1w5
```

A mouse user gets one action; a keyboard user gets two. That is a keyboard-only destructive behavior divergence.

**Space scrolls the page.** The same handler treats `' '` as an activation key but never calls `preventDefault()`, so the browser also performs its default page scroll. Verified: `defaultPrevented` was `false`.

Separately, the active conversation is conveyed only by background color (`.session-item--active`, `public/app.css:435`) with no `aria-current`. Verified: `aria-current` is `null` on the active item. That is a color-only distinction (1.4.1) and an unexposed state (4.1.2).

**Recommended direction:** restructure each row as a real `<button>` for selection with the Delete button as a *sibling* rather than a descendant, wrapped in a list item. Add `aria-current="page"` to the active conversation. The native `<button>` then handles Enter and Space correctly with no custom key handling at all.

---

### A5 — Serious: `role="log"` on `<main>` removes the main landmark

**Where:** `public/index.html:83`

`<main class="chat-history" id="chatHistory" role="log" aria-live="polite">` overrides the implicit `main` role. The page ends up with no main landmark, and the chat content is no longer inside one.

axe reports three related violations on every scan: `aria-allowed-role` ("ARIA role log is not allowed for given element"), `landmark-one-main`, and `region` ("All page content should be contained by landmarks").

**Impact:** screen reader users lose the standard "jump to main content" shortcut, which is the primary way of bypassing the sidebar (see also A22).

**Recommended direction:** keep `<main>` as a landmark and move the live-region semantics to a dedicated child element — which is also what A1 recommends.

---

### A6 — Serious: the composer has no focus indicator in dark mode

**Where:** `public/app.css:25-42` (dark overrides), `1218-1231`, `1233-1312`

In light mode, focusing the composer produces a visible animated conic ring around the chatbox, and the design-system focus ring on the textarea is deliberately suppressed to avoid clashing with it (`public/app.css:1226-1231`).

In dark mode, three things combine to leave nothing at all:

| Variable | Light | Dark |
|---|---|---|
| `--chatbox-ring-display` | `block` | `none` |
| `--chatbox-bg` | `Neutral-20` | `Neutral-1250` |
| `--chatbox-focus-bg` | `Backgrounds-Main-Top` (differs) | `Neutral-1250` (identical to resting) |

The conic ring is not rendered, the focus background equals the resting background, and the textarea's own outline and box-shadow are forced off with `!important`.

**Verified** by computed style, dark mode, before and after focus:

```
unfocused: boxBg rgb(38,49,76)  ringDisplay none  outline none  boxShadow none
focused:   boxBg rgb(38,49,76)  ringDisplay none  outline none  boxShadow none
```

Nothing changes. There is no visible indication of keyboard focus on the primary input of the application.

**Impact:** a sighted keyboard user in dark mode cannot tell when the composer is focused. This is a clear 2.4.7 failure and, because no indicator exists at all, also 2.4.11.

**Recommended direction:** restore a dark-mode focus treatment for the composer — either give `--chatbox-focus-bg` a genuinely distinct value, or keep the ring rendered in dark mode (it can be non-animated), or drop the `!important` suppression of the textarea's own focus ring when the conic ring is unavailable.

---

### A7 — Serious: focus ring contrast is below threshold in dark mode

**Where:** `public/app.css:328-330, 508-513, 1045-1047` and every other rule using `outline: 2px solid var(--Colors-Primary-Default)`

`--Colors-Primary-Default` resolves to `--Colors-Base-Primary-700` (`#1062FB`) in **both** themes (`design-system/colors/colors.css:193` and `:279`). It was not lightened for dark mode.

Measured against the actual adjacent background:

| Theme | Ring | Background | Ratio | Required |
|---|---|---|---|---|
| Light | `#1062FB` | `#FFFFFF` | **5.05:1** | 3:1 — passes |
| Dark | `#1062FB` | `#1D2740` | **2.94:1** | 3:1 — **fails** |

It misses narrowly, but it misses, and it applies to every focusable control in the application in dark mode.

**Recommended direction:** give `--Colors-Primary-Default` a lighter dark-mode value (the `Primary-400`/`Primary-450` steps already exist in the scale and are used for other dark-mode semantics), or define a dedicated focus-ring token per theme.

---

### A8 — Serious: text contrast failures in both themes

Measured on live rendered elements, with opacity applied:

| Element | Light | Dark | Required | Source |
|---|---|---|---|---|
| `.sidebar__nav-label` ("New chat", "Settings") | **3.44:1** `#808AA5` on `#FFFFFF` | **3.05:1** `#66718F` on `#1D2740` | 4.5:1 | `public/app.css` sidebar nav |
| `.composer__hint` ("Cosmo can make mistakes…") | **2.58:1** `#99A1B7` on `#FFFFFF` | **2.44:1** `#57627F` on `#1D2740` | 4.5:1 | `public/index.html:131` |
| `.composer__textarea::placeholder` | **4.46:1** | **4.26:1** | 4.5:1 | placeholder opacity |
| `.button-secondary` (settings modal) | passes | **3.91:1** `#377DFF` on `#1D2740` | 4.5:1 | design system |

The composer hint is the worst offender in both themes at roughly half the required ratio, and it is the text that tells users the model can be wrong — content with real consequence.

The two sidebar nav labels are confirmed independently by axe (`color-contrast`, serious, 3 nodes per scan) and by direct computed-style sampling.

**Note on root cause:** the underlying tokens are the "lighter" text steps — `--Colors-Text-Body-Lighter` maps to `Neutral-800` in light and `Neutral-900` in dark. Neither is dark enough (or light enough) against its own theme's background for body-size text. This is a token-level problem, so fixing it centrally will fix all four sites.

---

### A9 — Serious: interactive targets below the 24×24 minimum

WCAG 2.2 adds success criterion 2.5.8 (Target Size, Minimum), requiring a 24×24 CSS pixel target unless a spacing exception applies. Measured in the running application:

| Control | Size | Location |
|---|---|---|
| Attach an image | **18×18** | `public/index.html:109` |
| Attach a file | **18×18** | `public/index.html:114` |
| Send / Stop | **18×18** | `public/index.html:120` |
| Delete conversation | **22×22** | `public/app.css:486-492` |
| Sidebar resizer | **8** px wide | `public/app.css:220-234` |

The three composer buttons sit adjacent to one another, so the spacing exception is unlikely to rescue them. The Send button in particular is the most important control in the application.

The resizer is arguably exempt — it has a keyboard alternative and dragging is not the only way to accomplish the goal — but widening its hit area would still be an improvement for motor-impaired users.

**Recommended direction:** grow the composer icon buttons' hit areas to at least 24×24 (padding is sufficient; the icon glyph can stay 18×18), and the delete control to 24×24.

---

### A10 — Moderate: no `<h1>` once a conversation starts

**Where:** `public/index.html:86`, hidden at `public/app.js:1206`

The only `<h1>` is "What's on your mind?" inside the empty state, and `emptyState.hidden` is set as soon as any message exists. From then on the document's highest-ranked heading is the sidebar's `<h2>History`, so the heading hierarchy starts at level 2 and the page has no top-level heading. axe flags `page-has-heading-one` on every scan.

**Recommended direction:** give the chat region a persistent `<h1>` (visually hidden if the design requires it) naming the conversation, and let the empty-state text be a lower-level heading or plain text.

---

### A11 — Moderate: streaming status live region is rebuilt each render

**Where:** `public/app.js:1086-1088`

The status line ("Thinking…", "Working on it…", "Creating image…") is emitted as `<div class="message__ai-status" aria-live="polite">` inside the HTML string that gets rebuilt on every render. A live region that is created fresh rather than updated in place has unreliable announcement behavior — assistive technology needs the region to exist before its contents change in order to observe the change.

It also nests a `polite` region inside the already-`polite` `role="log"` container, compounding A1.

Related gaps in the same area: the log never gets `aria-busy="true"` while a response is generating, and completion is never announced at all.

**Recommended direction:** create one persistent status region at page load, outside the rebuilt subtree, and write text into it. This is the same element proposed in A1.

---

### A12 — Moderate: copy confirmation is not announced

**Where:** `public/app.js:1834-1856` (`copyWithFeedback`)

On a successful copy, the button's icon swaps to a checkmark and its `aria-label` changes from "Copy code" to "Copied", reverting after 1500 ms. Changing the accessible name of an already-focused element does not reliably trigger an announcement in any major screen reader — the user gets no confirmation that the copy succeeded.

**Recommended direction:** announce the result through a shared `role="status"` region rather than by mutating the button's name. Keep the visual checkmark as-is.

---

### A13 — Moderate: `role="toolbar"` without arrow-key navigation

**Where:** `public/index.html:107`

`<div class="composer__toolbar" role="toolbar" aria-label="Composer actions">` declares the toolbar pattern, which carries an expectation: a toolbar is a single tab stop whose contents are navigated with arrow keys (roving `tabindex`). No such behavior is implemented — all three buttons are independent tab stops.

**Recommended direction:** either implement roving `tabindex` with arrow-key handling, or simply drop `role="toolbar"`. The latter is likely the better trade here; the three buttons work fine as ordinary tab stops, and the group already reads sensibly.

---

### A14 — Moderate: `lang="en"` is hardcoded despite a Spanish catalog

**Where:** `public/index.html:2`; locale resolution at `server.js:61-96`

The application ships `i18n/es.json` and `server.js` resolves UI strings against `config.language`, merging a locale catalog into the config response. The entire interface can therefore render in Spanish — but `<html lang="en">` is static and nothing ever updates it.

**Impact:** a screen reader reads Spanish content with an English speech synthesizer, producing largely unintelligible output. This is a direct failure of 3.1.1 (Language of Page) and the most severe consequence of any i18n gap.

**Recommended direction:** have `applyChatConfigUI()` set `document.documentElement.lang` from the resolved locale, alongside where it already sets `document.title` (`public/app.js:497`).

---

### A15 — Moderate: accessible names are not translated

Two separate gaps:

**Bypassed helper.** `public/app.js:1393` builds the attachment remove button's label with a raw template literal — `` `Remove ${item.file.name || 'attachment'}` `` — while every neighboring string goes through `t()`.

**Static markup never translated.** The `aria-label` attributes written directly into `public/index.html` are never touched by `applyChatConfigUI()`: "Open settings" (line 55), "Resize sidebar" (77), "Prompt input" (103), "Attach an image" (109), "Attach a file" (114), "Send prompt" (120), plus the landmark labels "Workspace" (48), "Conversations" (65), and "Composer actions" (107).

**Impact:** a Spanish-configured deployment presents visible text in Spanish but announces every control name in English. Sighted users never notice; screen reader users get a mixed-language interface.

**Recommended direction:** route the dynamic label through `t()`, and extend `applyChatConfigUI()` to translate the static `aria-label` attributes the same way it already translates visible labels. Add the corresponding keys to both catalogs.

---

### A16 — Moderate: images use filenames as alternative text

**Where:** `public/app.js:115` (markdown images), `public/app.js:1223` (file parts), `public/app.js:1352` (composer thumbnails)

Assistant-generated images take `alt` from the markdown alt text, which models frequently leave empty. Attachment images fall back to `part.filename || 'image'`, and composer thumbnails to `item.file.name || ''`. A filename like `IMG_4032.png` is not an alternative for the image's content.

Given that the app can generate images via `octavus_generate_image`, this matters: a generated image is often the entire substance of a reply, and a screen reader user currently receives nothing meaningful.

**Recommended direction:** when the model generates an image, use the generating prompt as the alt text — it is the best available description. For user uploads, the filename is a reasonable fallback but should be labelled as such ("Attached file: IMG_4032.png") so it is not mistaken for a description.

---

### A17 — Moderate: focus is not restored when message editing is cancelled

**Where:** `public/app.js:1978-1985` (`exitEditMode`)

Entering edit mode correctly moves focus into the textarea and positions the caret (lines 1975-1976) — good practice. But `exitEditMode()` removes the edit box without sending focus anywhere, so cancelling drops the user at `<body>`.

**Recommended direction:** restore focus to the Edit button that opened the editor, mirroring the pattern already used correctly in `copyText()` at lines 1796-1823.

---

### A18 — Moderate: the delete control is only reachable on hover

**Where:** `public/app.css:486-513`

`.session-item__delete` is `opacity: 0; pointer-events: none` and only becomes usable on `:hover` or `:focus-visible`. Keyboard access works. Touch devices, which have no hover state, do not — the control is permanently invisible and non-interactive.

**Recommended direction:** expose the control persistently below a touch breakpoint, or via a `(hover: none)` media query.

---

### A19 — Minor: session items rely on the browser's default focus ring

Every other control in the application uses a deliberate `outline: 2px solid var(--Colors-Primary-Default)`. The session items, being `<div role="button">`, fall back to the user-agent default (`outline: auto 1px`), measured during the tab-order walk. Chrome's default is reasonably visible, so this is not a hard failure — but it is visually inconsistent and not under the design system's control. Restructuring per A4 resolves it.

### A20 — Minor: the Thoughts disclosure resets during streaming

**Where:** `public/app.js:956-975`

`renderThoughtsBlock()` sets `open` based purely on whether the response is still streaming. Because the block is rebuilt on every render, a user who collapses the reasoning mid-stream sees it spring open again on the next token. The user's explicit choice is overridden several times per second.

### A21 — Minor: user message text is injected as unescaped HTML

**Where:** `public/app.js:1171`

`<div class="message__bubble body-medium">${text}</div>` interpolates the user's own message without escaping, while the assistant's reasoning text is correctly escaped via `escapeHtml()` at line 963. Accessibility-wise, markup typed into a prompt alters the document structure of the transcript. It is also a self-XSS vector — outside the scope of this audit, but worth noting while the line is being changed.

### A22 — Minor: no skip link

There is no mechanism to bypass the sidebar's navigation and conversation list to reach the chat content. Landmarks would normally satisfy 2.4.1, but the main landmark is absent per A5. Once A5 is fixed, this is largely resolved; a skip link would still help sighted keyboard users, who cannot use landmark navigation.

---

## Design system findings (submodule)

These originate in `design-system/`, a shared git submodule. They cannot be fixed from this repository, but they degrade this application's accessibility today.

### D1 — Critical: the modal has no focus trap

**Where:** `design-system/components/modal/modal.js:221-268`

`open()` sets `aria-modal="true"`, stores the previously focused element, and focuses the close button — all correct. But nothing constrains Tab. There is no keydown handler cycling focus within the dialog, and the background is neither `inert` nor `aria-hidden`.

**Verified** by walking Tab through the open settings modal:

| Stop | Inside dialog | Element |
|---|---|---|
| 1-6 | yes | slider, slider handle, thinking dropdown, custom instructions, Close, Apply & New Chat |
| 7 | **no** | `#newChatBtn` |
| 8 | **no** | `#settingsBtn` |
| 9-14 | **no** | session items, delete buttons, resizer, message actions |

After six stops, focus leaves the dialog and walks the entire page behind it while the modal is still open and the overlay still blocks pointer interaction.

**Impact:** keyboard users are silently dumped into content they cannot see or click. `aria-modal="true"` tells screen readers the background is hidden while the keyboard says otherwise — the two disagree, which is worse than either alone.

**Recommended direction:** add a Tab/Shift+Tab handler that cycles within the dialog, and apply `inert` to the rest of the document while open.

### D2 — Serious: the dropdown loses focus on open and on select

**Where:** `design-system/components/dropdown/dropdown.js:148-210, 247-273, 398-433`

Verified against the isolated dropdown test page in both themes:

- **Focus after opening the menu:** `BODY`. `updateToggleState()` only toggles CSS classes; nothing moves focus into the list. The menu's own keydown handler at line 173 computes `currentIndex` from `document.activeElement`, which is never a menu item unless the user manually tabs to one.
- **ArrowDown while the toggle is focused:** focus stays on `.dropdown-toggle`. The toggle's handler (line 163) recognizes only Enter, Space, and Escape — the standard listbox opening keys do nothing.
- **Focus after activating an option with Enter:** `BODY`, confirmed `isBody=true`. `selectItem()` calls `close()`, the menu becomes `display: none` (`dropdown.css:176`), and the focused option ceases to be focusable.

**Impact:** selecting a model or a thinking level by keyboard ejects the user to the top of the document every time.

**Recommended direction:** move focus to the selected (or first) option on open, support ArrowUp/ArrowDown/Home/End from the toggle, and return focus to the toggle after selection or dismissal.

### D3 — Serious: the listbox/option structure is malformed

**Where:** `design-system/components/dropdown/dropdown.js:64-66, 108-114`

Verified in the live DOM:

```json
{ "toggleRole": null, "ariaHaspopup": "true", "ariaControls": null,
  "menuRole": "listbox", "optionParentRole": null, "optionTag": "BUTTON",
  "ariaSelectedCount": 0, "optionCount": 6 }
```

Four problems: `role="option"` is applied to `<button>` elements; those options are wrapped in a role-less `.dropdown-menu-list` div, breaking the required listbox→option ownership; `aria-haspopup="true"` means *menu*, not *listbox*; and the base component sets no `aria-controls` (only the app's `PortalDropdown` subclass adds one, at `public/portal-dropdown.js:36`).

**Recommended direction:** follow the APG combobox-with-listbox pattern — `role="combobox"` on the toggle with `aria-haspopup="listbox"` and `aria-controls`, and plain elements with `role="option"` owned directly by the listbox (or `aria-owns` if the DOM nesting must stay).

### D4 — Serious: selection state is visual only

**Where:** `design-system/components/dropdown/dropdown.js:116-129, 398-424`

The selected option is marked with a CSS class and a checkmark SVG that carries no accessible text. No `aria-selected` is set on any option — verified as `0` of `6`. A screen reader user cannot determine which model or thinking level is currently active.

This is both a state-exposure failure (4.1.2) and a use-of-color failure (1.4.1), since the checkmark and a color change are the only indicators.

### D5 — Serious: the slider role contains focusable buttons

**Where:** `design-system/components/numeric-slider/numeric-slider.js:144-207, 519-541`

axe flags `nested-interactive` on `.numeric-slider-wrapper` whenever the settings modal is open. The wrapper carries `role="slider"` with `aria-valuemin`/`max`/`now` and `tabindex="0"`, and *also* contains `<button>` handles with their own `tabindex="0"`.

Consequences: two tab stops for one control; `role="slider"` has invalid children; the value lives on the wrapper while the handle is a button whose accessible name ("Value: 0.7") merely changes as it moves; range mode writes `aria-valuenow="0.5,1.5"`, which is not a valid number; there is no `aria-valuetext`; and the disabled state uses `tabindex="-1"` without `aria-disabled`.

Keyboard interaction itself is good — Arrow keys, Shift for coarse steps, Home and End are all handled (lines 432-490). The problem is purely how the control is exposed.

**Recommended direction:** put `role="slider"` and all value attributes on the focusable handle itself, and leave the wrapper as a plain presentational container.

### D6 — Serious: settings labels are orphaned from their widgets

**Where:** `public/app.js:573` and `public/app.js:581`

```html
<label class="body-small settings-row__label">Temperature</label>
<label class="body-small settings-row__label">Thinking</label>
```

Neither has a `for` attribute, and neither wraps its control — because the controls are custom `<div>`-based widgets rendered afterwards into separate containers. The labels are decorative text as far as assistive technology is concerned.

axe confirms the consequence: `aria-input-field-name` (serious) on `#portal-dropdown-menu-1` — the thinking listbox has no accessible name at all.

By contrast, the System Prompt field at line 558 does this correctly with `for="customInstructionsEl"`.

**Recommended direction:** give each label an `id` and point the widget at it with `aria-labelledby`, and connect the description paragraphs via `aria-describedby`.

### D7 — Serious: the portaled menu escapes the `aria-modal` dialog

**Where:** `public/portal-dropdown.js:61-89`

`PortalDropdown` solves a real clipping problem by relocating the open menu to `document.body`. The accessibility side effect is that the menu is no longer a descendant of the dialog.

**Verified:** `thinking menu portaled: true; menu inside dialog: false`.

Because the modal overlay sets `aria-modal="true"`, conforming screen readers hide everything outside the dialog subtree. The Thinking menu is outside it — so the menu a sighted user sees floating over the modal is, for a screen reader user, not there at all.

**Recommended direction:** either keep the menu inside the dialog and solve clipping with CSS anchor positioning or `popover`, or add `aria-owns` on the toggle pointing at the portaled menu so the ownership relationship survives the DOM move. The native `popover` attribute with the top layer would sidestep both problems.

### D8 — Moderate: every modal reuses `id="modal-title"`

**Where:** `design-system/components/modal/modal.js:37, 50, 300`

Both `aria-labelledby` and the title element's `id` are the hardcoded string `"modal-title"`. Each modal instance appends its overlay to `<body>` in the constructor and `close()` never removes it, so instances accumulate.

If two modals ever exist simultaneously, the document has duplicate IDs and every `aria-labelledby="modal-title"` resolves to the *first* match — so the second modal is announced with the first modal's title.

**Status: latent, not currently reproduced.** With the shipped config (`hideHistory: false`), only the settings modal is ever constructed, and a duplicate-ID scan of the running page returned none. The confirm modal at `public/app.js:1622` is only created when `hideHistory: true`, which would trigger it.

**Recommended direction:** generate a unique ID per instance, as `PortalDropdown` already does for its menu (`public/portal-dropdown.js:34-35`).

### D9 — Moderate: hardcoded English accessible names

The design system embeds English directly into accessible names, with no hook for translation: `'Close modal'` (`modal.js:59`), `` `Slider value ${...}` ``, `` `Minimum value: ${...}` ``, `` `Value: ${...}` `` (`numeric-slider.js:150-207`), and `'Select option'` (`dropdown.js:18`). In a Spanish deployment these remain English. Compounds A14 and A15.

### D10 — Moderate: the Escape handler is never removed on close

**Where:** `design-system/components/modal/modal.js:193-200, 314-318`

The document-level `keydown` listener is registered in the constructor and removed only in `destroy()`, which this application never calls. Each modal ever created keeps a live global handler. Currently benign because the guard checks `this.isOpen`, but it accumulates and creates a real risk of stacked modals closing together.

### D11 — Minor: smooth scroll ignores the reduced-motion preference

**Where:** `design-system/components/modal/modal.js:215`

`scrollIntoView({ behavior: 'smooth' })` is unconditional. The application itself is conscientious about `prefers-reduced-motion` — six separate blocks in `app.css` — so this is the odd one out.

### D12 — Minor: stroke tokens are not dark-adapted

**Where:** `design-system/colors/colors.css:314-325`

In the dark-mode block, every `--Colors-Stroke-*` token is redefined to the *same light-mode value* — `Stroke-Light` stays `Neutral-150` (`#E7EAF2`), `Stroke-Background` stays `Neutral-20` (`#F4F5F9`). These are near-white borders intended for a white page.

The application already works around this twice, and says so in its own comments:

- `public/app.css:38-40` — "The DS forgets to dark-adapt the tertiary button's border (it stays light Neutral-300), so supply the missing dark value here."
- `public/app.css:259` — "Dark mode: the rest pill uses a non-adaptive light token, so darken it."

Not a WCAG failure in itself (the contrast is too high, not too low), but it means any future component consuming a stroke token will render wrong in dark mode by default. Worth fixing at the source rather than patching per-consumer.

---

## Appendix: contrast measurements

Measured from computed styles on live rendered elements, with opacity applied. Ratios calculated per WCAG 2.x relative luminance.

### Light mode

| Element | Foreground | Background | Ratio | Required | Result |
|---|---|---|---|---|---|
| `.sidebar__title` | — | `#FFFFFF` | pass | 4.5:1 | Pass |
| `.sidebar__nav-label` | `#808AA5` | `#FFFFFF` | 3.44:1 | 4.5:1 | **Fail** |
| `.sidebar__history-heading` | — | `#FFFFFF` | pass | 4.5:1 | Pass |
| `.session-item__title` | — | `#FFFFFF` | pass | 4.5:1 | Pass |
| `.empty-state__heading` | — | `#FFFFFF` | pass | 3:1 (large) | Pass |
| `.message__body` | — | `#FFFFFF` | pass | 4.5:1 | Pass |
| `.message__bubble` | — | bubble | pass | 4.5:1 | Pass |
| `.composer__hint` | `#99A1B7` | `#FFFFFF` | 2.58:1 | 4.5:1 | **Fail** |
| `.composer__textarea::placeholder` | `#66718F` | `#F4F5F9` | 4.46:1 | 4.5:1 | **Fail (marginal)** |
| Focus ring | `#1062FB` | `#FFFFFF` | 5.05:1 | 3:1 | Pass |

### Dark mode

| Element | Foreground | Background | Ratio | Required | Result |
|---|---|---|---|---|---|
| `.sidebar__title` | — | `#1D2740` | pass | 4.5:1 | Pass |
| `.sidebar__nav-label` | `#66718F` | `#1D2740` | 3.05:1 | 4.5:1 | **Fail** |
| `.sidebar__history-heading` | — | `#1D2740` | pass | 4.5:1 | Pass |
| `.session-item__title` | — | `#1D2740` | pass | 4.5:1 | Pass |
| `.message__body` | — | `#1D2740` | pass | 4.5:1 | Pass |
| `.composer__hint` | `#57627F` | `#1D2740` | 2.44:1 | 4.5:1 | **Fail** |
| `.composer__textarea::placeholder` | `#8B94AB` | `#26314C` | 4.26:1 | 4.5:1 | **Fail (marginal)** |
| `.button-secondary` (modal) | `#377DFF` | `#1D2740` | 3.91:1 | 4.5:1 | **Fail** |
| Focus ring | `#1062FB` | `#1D2740` | 2.94:1 | 3:1 | **Fail (marginal)** |

### Passing checks worth recording

- **Reflow (1.4.10):** at a 320 px viewport, `document.scrollWidth` equals `clientWidth` in both themes. No horizontal scrolling. Passes.
- **Reduced motion (2.3.3):** honored in six places across `app.css` — the thinking border, avatar breathing, streaming dot, hover transforms, and both composer conic layers.
- **Auto-scroll (2.2.2-adjacent):** `isChatNearBottom()` at `public/app.js:198` correctly suppresses auto-scroll when the user has scrolled up. Well handled.
- **Sidebar resizer:** a legitimate `role="separator"` with `aria-valuemin`/`max`/`now` kept in sync, arrow-key adjustment, and a bespoke `:focus-visible` treatment on the grip (`public/app.css:241-268`). One of the better-implemented widgets in the codebase.
- **Icon buttons:** decorative SVGs are consistently `aria-hidden="true"` with the accessible name on the parent button. Applied consistently throughout.
- **Send/Stop button:** correctly swaps its `aria-label` between "Send prompt", "Stop generation", and a concurrency-cap explanation (`public/app.js:1493-1519`).

---

## Prioritized remediation

**Phase 1 — restore basic usability with assistive technology.** Nothing else matters until these are done, and A1, A2, A3, and A11 all share a single root cause.

1. A1 / A2 / A11 — replace the wipe-and-rebuild render with reconciliation, and move live-region duties to one persistent `role="status"` element.
2. A3 — stop disabling the composer mid-stream; use `readOnly` and return focus on completion.
3. D1 — add a focus trap to the modal.
4. A5 — restore the `main` landmark.

**Phase 2 — keyboard and state correctness.**

5. A4 — restructure session rows as real buttons with a sibling delete; add `aria-current`.
6. D2 / D3 / D4 — fix dropdown focus management, listbox structure, and `aria-selected`.
7. D6 — associate the Temperature and Thinking labels with their widgets.
8. D5 — move `role="slider"` onto the handle.
9. A17 — restore focus when edit is cancelled.

**Phase 3 — visual and perceptual.**

10. A6 — give the composer a dark-mode focus indicator.
11. A7 / A8 — fix the focus-ring and text contrast tokens centrally.
12. A9 — enlarge the composer and delete targets to 24×24.
13. D7 — keep the portaled menu within the dialog's accessibility subtree.

**Phase 4 — completeness.**

14. A14 / A15 / D9 — set `lang` dynamically and route all accessible names through translation.
15. A10, A12, A13, A16, A18, A20, A21, A22, D8, D10, D11, D12.

---

## Retest checklist

After remediation, verify each of the following in **both** light and dark mode:

- [ ] Streaming a response announces status changes only, not the full transcript (VoiceOver, manual)
- [ ] Focus stays on a message action button across a full streaming response
- [ ] Focus remains in the composer through send → stream → complete
- [ ] Tab cannot leave an open modal in either direction
- [ ] The page exposes exactly one `main` landmark and one `<h1>`
- [ ] Enter on a session's Delete button deletes without also switching sessions
- [ ] Space on a session item activates it without scrolling the page
- [ ] The active conversation is exposed via `aria-current`
- [ ] Focusing the composer produces a visible indicator meeting 3:1
- [ ] All focus rings meet 3:1 against their adjacent background
- [ ] All text meets 4.5:1 (or 3:1 where large)
- [ ] All interactive targets are at least 24×24 CSS pixels
- [ ] Opening the model dropdown moves focus into the list; selecting returns focus to the toggle
- [ ] Each dropdown option exposes `aria-selected`
- [ ] The Temperature slider and Thinking dropdown announce their labels
- [ ] Setting `language` to Spanish updates `<html lang>` and all accessible names
- [ ] axe reports zero violations in all five application states
- [ ] Full task pass with VoiceOver: send a prompt, read the reply, copy it, regenerate, switch conversations, change settings

---

*Tooling: axe-core 4.x via Playwright, Chrome, 1440×900 and 320×720 viewports; contrast computed from live computed styles per WCAG 2.x relative luminance. Application states scanned: empty, streaming, populated, settings modal, settings modal with dropdown open, plus the isolated design-system dropdown page.*
