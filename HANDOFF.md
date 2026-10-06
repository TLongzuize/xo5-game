# HANDOFF.md — XO 5-in-a-Row (15×15 XO engine & analysis app)

Written for an AI (or human) picking this project up with no other context.
The current-state section below was verified against the repository on
2026-10-06. All dated sections after it are historical notes and are superseded
where they conflict with the current state.

## CURRENT STATE — 2026-10-06

- XO5 Forge V3 is the only engine available in the UI. Gameplay, analysis, and
  puzzle features use `engine3.js` / `worker3.js`.
- V3 PRO support is temporarily suspended. Its source remains in the repository
  for offline benchmarks, but `build3.js` excludes `engine3pro.js` and
  `worker3pro.js` from `index.html`. Settings and game setup disable PRO and
  show “Support Suspended”; stale `xo5.selectedEngine3` selections reset to V3.
- The homepage and legacy XO5 pages show the support notice. V3 PRO logos remain
  in their original color; the PRO feature promotion is hidden.
- Rebuild the standalone UI with `node build3.js`.
- Verified tests: `test_ui3.js` 432/432, `test_engine3.js` 148/148,
  `test_tactical_correctness.js` 31/31, and `test_smoke3.js` 30/30.
- In this workspace, `test_engine3pro.js` does not complete: the version and two
  open-three assertions fail, then it throws `TypeError: tt.set is not a
  function` at line 213. This is a PRO-only diagnostic for the local PRO source
  and is separate from the shipped V3-only UI.
- PRO engine sources and benchmark outputs are separate development artifacts;
  the UI build must not bundle them while support is suspended.

## HISTORICAL NOTES — 2026-09-20 (SUPERSEDED)

The latest published change is a small analysis-controls update. This section
supersedes older statements below that say `app3.js` was visual-only or that
the application logic was unchanged.

- `tacticalAlert` now lives inside the `Move explanation` details block. The
  forced-win/block message is therefore hidden when `Move explanations` is
  off.
- The `Analysis Engine` master switch controls the analysis feature switches:
  `Auto analysis`, `Evaluation`, `Best-move arrow`, `Candidate moves`,
  `Threat map`, `Heatmap`, `Move quality labels`, `Move explanations`,
  `Analysis cache`, `Evaluation graph`, and `Engine details`.
- Turning `Analysis Engine` off stops active searches, turns those switches
  off, hides the related output, and disables the child switches. Turning it
  back on restores their previous values.
- Source changes are in `app3.js` and `shell3.html`; `index.html` was rebuilt
  with `node build3.js` and is the published artifact.
- The existing UI suite passes `150/150`. A focused jsdom check also verified
  alert nesting, master-off locking, and restoration after re-enabling.
- The latest GitHub commit is `16e3dfa` (`feat: add analysis engine master
  toggle`). Only `app3.js`, `shell3.html`, and `index.html` were pushed for
  that feature. Other legacy files in the local workspace remain untracked.

---

## HISTORICAL BENCHMARK WORK — 2026-09-27 (NOT CURRENT UI STATUS)

This section is newer than everything below it. It supersedes older statements
in this document about test counts, `index.html` size, and the file list.

### 1. Benchmark Suite Enhancement

- `benchmark_v3_vs_v3pro.js` compares **V3** (`engine3.js`) against **V3 PRO**
  (`engine3pro.js`).
- Positions expanded from **140 to 205** across **18 categories**
  (`benchmark_positions.json`).
- **ELO-style ratings** with composite scoring over **5 weighted components**
  (score outcome, tactical accuracy, NPS, node efficiency, depth reached).
- **Depth-vs-time curves** at 5 budgets — **100 / 250 / 500 / 1000 / 2000ms** —
  times 20 positions.
- **Statistical significance**: paired t-tests, Cohen's d, 95% confidence
  intervals.
- **JSONL output** for per-position data.

**Results**

| Metric | Finding | Significance |
|--------|---------|--------------|
| Overall ELO | V3 PRO **+4.4 ELO** | p = 0.224 — **not significant** |
| NPS | V3 faster | p = 6.67e-6 — significant |
| Nodes | V3 PRO uses more nodes | p = 1.80e-4 — significant |
| Tactical accuracy | V3 PRO higher | p = 0.083 — marginal |
| VCF/VCT solve rate | **100% for both engines** | — |

Read this honestly: the strength difference is **not** established. V3 PRO is
clearly slower and more node-hungry, and no category separates the two.

### 2. Self-Play Benchmark Enhancement

- `benchmark_selfplay_v3_vs_v3pro.js` plays V3 against V3 PRO directly.
- **Multiple time controls**: 100ms (4 games), 250ms (4 games) = **8 games
  total**.
- Opening variety drawn from `benchmark_positions.json`.
- Statistics: ELO with **95% CI (delta-method)**, **Wilson score intervals**,
  **exact binomial tests**.
- Two rating models: **sequential ELO update (K = 32)** and **score-based ELO**.
- **Colour balance tracking** (games split between X and O).

**Results**: V3 **wins 4/0 at 100ms**, the games are **drawn 2/2 at 250ms**,
overall **V3 +66.92 ELO**.

### 3. Tactical Correctness Tests (NEW — 31 tests)

`test_tactical_correctness.js`, 31 tests, **all PASS for both V3 and V3 PRO**:

- VCF at depth 1, VCT at depth 3
- Double-threat forks
- Immediate win / block detection
- Multi-move forced sequences
- False-positive prevention
- `tacticalVerify` verification path

### 4. Homepage V3 PRO Promotion

Already in place in `shell3.html`:

- V3 PRO hero banner
- Engine hierarchy cards — **V3 PRO primary**, **V3 previous generation**,
  **V4 / V4 PRO "Coming Soon"**
- Feature comparison table
- Tactical solver highlight

### 5. Engine Selection UI

Already in place in `app3.js`:

- Engine dropdown inside the settings modal
- **V3 PRO is the default** engine
- **Engine is locked at game start** (cannot be switched mid-game)
- Selection persists via `localStorage` key **`xo5.selectedEngine3`**

### 6. All Tests Pass

**704 original tests + 31 new = 735 total PASS, 0 FAIL.**

| Suite | File | Result |
|-------|------|--------|
| Engine (base + appended + integration-contract) | `test_engine3.js` | **148/148** |
| Engine V3 PRO | `test_engine3pro.js` | **92/92** |
| UI regression | `test_ui3.js` | **434/434** |
| Smoke | `test_smoke3.js` | **30/30** |
| Tactical correctness (new) | `test_tactical_correctness.js` | **31/31** |
| Benchmark | `benchmark_v3_vs_v3pro.js` | completed |

V3 engine stays at **148/148**; the 92-test V3 PRO suite is a **separate** file
and is not folded into that number.

### 7. Build

`node build3.js` succeeds. `index.html` is **426,426 bytes** (verified against
the file on disk, 2026-09-27 12:03).

### 8. Reports Generated

- `BENCHMARK_REPORT_VI.md` — Vietnamese, **1,078 lines**
- `benchmark_v3_vs_v3pro.json`, `benchmark_v3_vs_v3pro.jsonl`,
  `benchmark_v3_vs_v3pro_curves.json`
- `benchmark_selfplay_v3_vs_v3pro.json`, `benchmark_selfplay_v3_vs_v3pro.jsonl`

---

## A. ONE-SENTENCE STATUS

**The home page, navigation, design system and in-app chrome were rebuilt as a
polished landing-page-style product surface; `engine3.js` was not touched, no
application logic was changed, and all three suites still pass at their
pre-redesign baselines (engine 148/148, UI 150/150, smoke 30/30).**

---

## B. WHAT CHANGED IN THIS ROUND — UI REDESIGN

This round was **visual only**. The scope rule was: change how the product
looks, not how it works.

### Files touched

| File | Change |
|------|--------|
| `shell3.html` | New `<head>` (fonts, title, meta), entire `<style>` block replaced with a new design system, new header, new dev-notice markup, `#viewHome` fully rewritten, new `<footer>`, About-modal body rewritten |
| `app3.js` | **Additive only** — 71 lines of new UI wiring added at three points. No existing line was modified or removed. |

### Files explicitly NOT touched

`engine3.js`, `worker3.js`, `puzzles.json`, `build3.js`, `test_engine3.js`,
`test_ui3.js`, `test_smoke3.js` are all **byte-identical** to their
pre-redesign state (verified by md5 against the pre-redesign archive).

```
engine3.js remains protected and was not modified during the UI redesign.
```

### The exact `app3.js` additions

There are only four:

1. `footAboutBtn` handler — opens the same `aboutOverlay` as `aboutBtn`
   (the footer now has an About link).
2. A `closeNav()` call inside `applyRoute()` — closes the mobile nav drawer
   whenever the route changes.
3. A `[data-go]` delegated click handler — landing-page / header / footer
   calls to action. **These deliberately use `data-go`, not `data-route`**, so
   they never collide with the existing `.mode[data-route]` or `#navLinks`
   wiring, and so `test_ui3.js`'s "exactly six nav routes" assertion keeps
   passing.
4. A block containing: the mobile nav drawer toggle, the sticky-header
   `stuck` class on scroll, and `initReveal()` (the scroll-reveal observer).

A diff of `app3.js` against the pre-redesign copy shows only added lines.
Nothing was deleted or altered.

---

## C. TEST BASELINE — EXACT CURRENT NUMBERS

All suites below were run on 2026-09-27 against the current `index.html` after
the final build. **735 total: 0 failures.** See the "BENCHMARK WORK" section
above for the full breakdown.

| Suite | File | Result |
|-------|------|--------|
| **Engine — base section** | `test_engine3.js` | **63/63** |
| **Engine — appended section** | `test_engine3.js` | **38/38** |
| **Engine — integration-contract section** | `test_engine3.js` | **47/47** |
| **Engine TOTAL (V3)** | `test_engine3.js` | **148/148, 0 failures** |
| **Engine V3 PRO** | `test_engine3pro.js` | **92/92, 0 failures** |
| **UI regression suite** | `test_ui3.js` | **434/434, 0 failures** |
| **Smoke checklist** | `test_smoke3.js` | **30/30, 0 failures** |
| **Tactical correctness (new)** | `test_tactical_correctness.js` | **31/31, 0 failures** |
| **ALL** | | **735/735, 0 failures** |

The V3 engine number is still **148/148** — the 92 V3 PRO tests live in a
separate file and are **not** added to it. The UI suite grew from 150 to 434
and the 31-test tactical suite is new, both added in the 2026-09-27 round.
**No pre-existing test was changed, deleted or skipped to make anything pass.**
There is no separate Infinite-specific suite; infinite-time-control behaviour is
covered inside `test_ui3.js` and `test_smoke3.js`.

### How to run the tests

```bash
npm install                        # jsdom is the only dependency

node test_engine3.js               # V3 engine — run FIRST. Expect 148/148.
node test_engine3pro.js            # V3 PRO engine. Expect 92/92.
node test_tactical_correctness.js  # tactical solver correctness. Expect 31/31.
node build3.js                     # rebuild index.html from source files
node test_ui3.js                   # UI regression. Expect 434/434.
node test_smoke3.js                # end-to-end smoke. Expect 30/30.

# Benchmarks (slow — run only when engines change)
node benchmark_v3_vs_v3pro.js
node benchmark_selfplay_v3_vs_v3pro.js
```

---

## D. THE NEW DESIGN SYSTEM

All of it lives in the single `<style>` block in `shell3.html`, organised as:
tokens → base → chrome → home → game → modals → utilities.

### Typography

Two families, loaded from Google Fonts with real fallback stacks:

- **Archivo** (500/600/700/800) — all headings, every numeric readout, board
  coordinates, badges. `font-variant-numeric: tabular-nums` is set wherever
  digits change in place (eval number, timers, depth, stats).
- **Inter** (400/500/600/700) — body and UI text.

This replaced the previous Inter + Space Grotesk pairing. **The `.mono` class
still exists and is still applied by `app3.js`** — it now resolves to Archivo
with tabular figures rather than Space Grotesk. Do not delete `.mono`.

Scale: hero `clamp(31px, 4.3vw, 52px)` → section h3 `clamp(24px, 3.1vw, 36px)`
→ showcase h4 `clamp(22px, 2.7vw, 31px)` → body 14.5px → caption 11.5–12.5px.

### Colour

`--x: #EF4444` and `--o: #3B82F6` are **unchanged and must stay unchanged** —
the board's hover-ghost markers are inline SVG data-URIs in the CSS with those
hex values hard-coded (`%23EF4444`, `%233B82F6`). Changing the tokens without
changing the data-URIs would desynchronise them.

Everything else is new: a cool-paper page surface (`--bg #EDF0F5`), a deep
navy ink used for the hero band and the About band (`--ink-1 #101623`), and a
single brass accent (`--brass #A4660C`, `#E0AB53` in dark) used sparingly for
the active nav indicator, section eyebrows, list bullets, the dev-notice rule
and the engine's suggested square in the illustrations. Red and blue are
reserved for the players and are never used as interface chrome.

Dark theme is a token override on `html[data-theme="dark"]`, exactly as before.

### Other tokens

- Radius: `--r1` 8px → `--r5` 30px. `--radius` is kept as a legacy alias
  because `.card` and `.howto` referenced it.
- Depth: `--sh1` / `--sh2` / `--sh3`. `--shadow` kept as a legacy alias.
- Spacing: `--s1` 4px → `--s9` 104px.

---

## E. THE NEW HOME PAGE

Scroll order inside `#viewHome`:

```
hero  →  game modes  →  feature showcase (×3)  →  secondary trio
      →  how to play  →  about band      [ then the footer, outside the views ]
```

### Hero

Dark ink band with a 15-column hairline lattice (`.hero-lattice`, pure CSS
background-image plus a radial mask), two soft radial glows, headline, lede,
two calls to action and three facts. On the right is `.preview` — a board
illustration.

**The hero board is a static SVG illustration and is honest about it.** It is
hard-coded into `shell3.html` and has no JavaScript behind it. It carries a
"Sample position" tag, a "Move 14 · X to play" label, a legend, and the
caption *"A still illustration, not a live game. The real board is in Play and
Analysis."* There is no second engine and no fake live analysis on the page.

The illustrated position is internally consistent: 7 X stones, 7 O stones, X
to move, no accidental four-in-a-row for either side, and the marked square
(the dashed brass ring) is a genuinely strong move there — it makes a four on
row 8 and a three on column 7 at the same time.

### Game modes — actionable

`.modegrid` holds the six `.mode[data-route]` buttons (Continue, Play vs AI,
Local 2 player, Analysis board, Puzzles & daily, Progress). These look
deliberately clickable: hover lifts them 4px, adds elevation, reveals a
red→blue gradient rule along the top edge and inverts the icon tile. Each ends
in a "Start a game →" affordance. Capped at three columns above 900px so five
visible cards never leave a 4+1 orphan row.

`#homeContinue` and `#homeContinueText` are unchanged in id and behaviour —
`updateHomeCard()` still shows and hides it exactly as before.

### Feature showcase — informational, not actionable

Three full-width alternating `.show` sections (`.show.flip` reverses the
column order): **The engine**, **Analysis**, **Puzzles**. Each is a copy
column plus a `.mock` visual panel.

They are visually distinct from the mode cards on purpose: no hover lift, no
cursor change, no button affordance, no arrow. Every `.mock` in a showcase
section carries a "Visual preview" chip via `.show-visual .mock::after`
(with `padding-bottom: 46px` reserved so it never overlaps the artwork).

The mockups show only features that actually exist:

| Mockup | Shows | Real feature |
|--------|-------|--------------|
| Level select | 1–9 ladder, level 7 active, depth/time readout, board with suggested square | AI levels 1–9, `LEVELS9` |
| Engine panel | eval bar, eval number, candidate list with score bars, PV chips, evaluation graph | eval bar, `candList`, `pvList`, `graph` |
| Puzzle | tactical position, dashed target ring, "Forced win available" | puzzle bank + VCF/VCT solver |

Below them, `.trio` holds three smaller panels: local two-player, time
controls (1s / 5s / 30s / 60s / ∞ with the Stop note), and progress
(achievement badges plus stats). Text blocks are bottom-aligned with
`margin-top: auto` so the three read as one row.

### How to play / About band / Footer

`.howto` is now a four-step grid with brass step numbers rather than a bullet
list. `.aboutband` is a second ink band with the `#aboutBtn` modal trigger and
three fact tiles. `.site-foot` sits **outside** all four `.view` sections, so
it appears on every route, and its nav uses `data-go`.

---

## F. NAVIGATION

```
[logo] XO 5-in-a-Row      Home  Play AI  2 Player  Analysis  Puzzles  Progress
                                            [theme] [Settings] [Play] [hamburger]
```

- `#navLinks` still contains **exactly six `button[data-route]`**, one per
  entry in `ROUTES`. `test_ui3.js` asserts this. The "Stats" label was renamed
  to "Progress"; the `data-route="stats"` value is unchanged.
- Active state is a brass underline that scales in from the centre
  (`::after` plus `transform: scaleX()`), driven by the `aria-current`
  attribute `applyRoute()` already set.
- `#navPlayBtn` and `#navToggle` sit **outside** `#navLinks` so they do not
  affect the six-route assertion.
- The header is `position: sticky` with a backdrop blur and picks up a
  hairline border (`.stuck`) once the page scrolls past 4px.
- **Below 940px** the nav collapses into a drawer: `#navToggle` toggles
  `.nav-open` on `header.top`, `#navPlayBtn` hides, and the drawer closes on
  route change, on outside click and on Escape.

---

## G. ANIMATION AND MOTION

### Scroll reveal

`initReveal()` in `app3.js` observes the 11 `[data-reveal]` elements with an
`IntersectionObserver` (`rootMargin: 0px 0px -12% 0px`, `threshold: 0.12`) and
adds `.in`. Each target is unobserved once revealed, so nothing runs after the
first pass.

The CSS is written so that **hidden is the exception, not the default**:

```css
@media (prefers-reduced-motion: no-preference){
  [data-reveal]{opacity:0; transform:translateY(22px); ...}
  [data-reveal].in{opacity:1; transform:none}
}
```

If the stylesheet never applies (reduced motion) the content is simply
visible. If the JavaScript never runs or `IntersectionObserver` is missing
(jsdom, old browsers), `initReveal()` calls `revealAll()` immediately. The
whole call is wrapped in `try/catch`. **Content can never be left invisible.**

Inside a revealed section the visual and the copy are staggered
(visual +0.06s, copy +0.16s) so the panel lands before the text.

### Everything else

Only `transform` and `opacity` are animated. There are no continuous
JavaScript animation loops, no video, no raster images and no animation
library — every illustration is inline SVG or CSS. The scroll listener is
`passive` and rAF-throttled.

### Reduced motion

There are two `prefers-reduced-motion` blocks. The `reduce` block globally
collapses animation and transition durations to 0.001ms, disables smooth
scrolling, and switches off the board's win-pulse, hint-pulse and stone-pop
animations plus the hover lifts.

---

## H. DEVELOPMENT NOTICE — BEHAVIOUR UNCHANGED

The markup was restyled (it now reads as an integrated in-development strip
with a brass left rule and an "In development" badge, rather than an amber
error alert). **The logic in `app3.js` was not touched.**

- Appears on **every page load**.
- **Dismiss** (`#devDismiss`) hides it for the current SPA session only — it
  sets both `.hidden = true` and `.style.display = 'none'`.
- A full page reload brings it back.
- No `localStorage`, `sessionStorage`, cookies or `IndexedDB` are involved.
- It is separate from `#errBar`, which stays hidden and is used only for real
  runtime JavaScript errors.
- The global `[hidden] { display: none !important }` rule is still present and
  is still what makes the dismiss actually work. **Do not remove it.**

---

## I. RESPONSIVE BEHAVIOUR

Verified in headless Chromium at 1440, 820 and 390px. `scrollWidth` equals
`clientWidth` at all three — **no horizontal scrolling anywhere**.

| Breakpoint | Effect |
|-----------|--------|
| 1100px | Game view drops from two columns to one |
| 940px | Nav collapses to the drawer; `#navPlayBtn` hides |
| 900px | Hero stacks (copy over board); CTAs go full-width; mode grid leaves the 3-column cap |
| 860px | Showcase sections stack, `.show.flip` ordering is neutralised so copy always leads |
| 820px | About band stacks |
| 760px | Board eval bar moves above the board and turns horizontal (pre-existing) |
| 620px | Tighter shell padding, smaller hero radius and facts |
| 560px | Modals become bottom sheets (pre-existing) |
| 420px | Theme button hides to protect the header |

Safe-area insets (`env(safe-area-inset-*)`) are applied to the shell's
horizontal padding, the sticky header's top padding and the body's bottom
padding, for notched devices and for the published artifact viewer.

---

## J. APP3.JS / WORKER3.JS ARCHITECTURE — UNCHANGED

Everything in this section was true before the redesign and is still true.

### Game state — one authoritative object (`G`)

```js
G = {
  mode: 'ai' | 'local' | 'analysis',
  humanSide: X | O,          // only meaningful in 'ai' mode
  level: 1..9,
  root: Int8Array|null,      // non-null ONLY for an explicit analysis root
  rootSide: X | O,           // X for every real game
  main: [...moves], redo: [...],
  status, winner, winCells,
  view, variation, analysisMode, whatIf,
  hintIdx, hintsUsed, sawForcedWin,
  puzzle, snapshots, clock, startTime, lastAiMs,
  rootEval                   // number|null — 0 for standard empty boards
}
```

`sideAt(n) = (n % 2 === 0) ? G.rootSide : other(G.rootSide)` is the **entire**
turn-order logic. A real game's `rootSide` is always `X` (enforced in
`makeGame()`), so X always moves first, in every mode.

### Evaluation sign

**Higher score = better for X, always.** Every consumer — eval bar, eval
number, graph, candidate ranking, move grading, end-of-game summary — treats
`analyse().score` identically. No side-dependent sign handling anywhere.

### Worker / search-ID / cancellation model

- Every `ask()` gets a unique incrementing `id` and the current generation
  (`WK.gen`); stale results from a superseded generation are dropped before
  reaching application code.
- `cancelAllSearches()` increments the generation, rejects pending promises
  with `{cancelled: true}`, and **terminates + respawns the Worker** — the only
  honest way to stop a synchronous in-flight search.
- Two separate workers: `WK` (AI moves) and `AW` (analysis).
- There is a main-thread fallback when `Worker` / `URL.createObjectURL` are
  unavailable, which is what keeps the app working inside sandboxed iframes.

### Evaluation graph data flow

```
startGame() → makeGame() → G.rootEval = root ? null : 0   (origin point)
runAnalysis() → onProgress → applyIteration() → refreshGraph()   (live)
applyAnalysis() → records evalAfter, gradeMove(), refreshGraph()
```

### Time controls

1s / 5s / 30s / 60s / Infinite (`S.timeMs === 0`). Infinite relies on Stop
(terminate + respawn) to end.

---

## K. DO NOT BREAK THESE INVARIANTS

1. **Evaluation sign**: positive = X, negative = O, everywhere. No flipping.
2. **`mateFor` is sign-convention-independent** (engine-internal).
3. **M1 must be a literal, verified, immediate winning move** — `EVAL_CAP`
   (800,000) stays well under `MATE_THRESHOLD` (9,000,000).
4. **An open four is M2, not M1.**
5. **X always moves first** — `G.rootSide === X` after `startGame()`.
6. **Every AI level (1–9) takes an immediate win and blocks an immediate
   loss** — verified through the full UI call path.
7. **The engine suite must stay at 148/148.**
8. **Don't rewrite working engine internals.**
9. **Stale worker results must never overwrite newer state.**
10. **UI state is always recomputed from `line()`**, never a mutated cache.
11. **`[hidden] { display: none !important }`** — the dismiss-button fix.
12. **`rootEval = 0` for standard empty boards.**
13. **`applyIteration()` must call `refreshGraph()`.**
14. **`#navLinks` must contain exactly six `button[data-route]`**, all with
    visible text. Header and footer CTAs use `data-go` for this reason.
15. **`--x` / `--o` must stay `#EF4444` / `#3B82F6`** unless the board's
    hover-ghost SVG data-URIs are updated to match in the same edit.
16. **`.mono` must keep existing** — `app3.js` applies it to generated markup.
17. **Reveal animations must fail open** — content visible if the observer,
    the JavaScript or the stylesheet is missing.

---

## L. KNOWN LIMITATIONS — STATED HONESTLY

### Carried over (unchanged by this round)

- **Multi-PV is not a true multi-line search** — best-line PV plus a ranked
  candidate list, not independently searched N-best lines.
- **The variation tree is a flat list**, not a branching diagram.
- **Puzzles are a fixed bank of 10 solver-verified positions.** Every guess is
  still re-verified live against the engine.
- **`solveForcing`'s VCT branch caps defensive replies at 6** — it can
  under-report forced wins, never over-report them.
- **The transposition table has no eviction policy** beyond "clear when full."
  Not a practical problem: a fresh TT is created per `ask()`.
- **Achievements and statistics are localStorage-based, single device.** No
  accounts, no sync.
- **The development notice is session-level only** — intentional.

### New / specific to the redesign

- **Typography was not visually verified with the real fonts.** The build
  environment blocks `fonts.googleapis.com`, so every screenshot was taken
  with fallback system faces. Layout, spacing and wrapping were checked;
  Archivo's actual rendering was not.
- **The hero and mockup illustrations are hand-authored static SVG.** If the
  real UI changes (new panel layout, different candidate list), they will not
  follow automatically — they are marketing artwork and must be updated by
  hand. They are labelled as previews for exactly this reason.
- **Reveal animations were verified in headless Chromium and structurally in
  jsdom, not on a physical mobile device.** The jsdom path exercises the
  fallback (no `IntersectionObserver`), not the observer itself.
- **The board illustrations do not adapt to the dark theme.** They
  deliberately keep a white board in both themes, matching the real board,
  which is also white in both themes.
- **The in-game, puzzle and progress views were restyled, not restructured.**
  They inherited the new tokens, type and card treatment, but their layout is
  the pre-redesign layout. The home page is where the structural work went.
- **No real-device testing.** As before, all automated testing is jsdom; the
  visual pass is headless Chromium at three fixed viewports.

---

## M. FILE STRUCTURE

### Active files (part of the current build)

| File | Role |
|------|------|
| `engine3.js` | Core AI engine — protected, **not modified in this round** |
| `worker3.js` | Web Worker dispatcher for engine3 — not modified |
| `app3.js` | Application layer (2,109 lines; +71 UI-wiring lines this round) |
| `shell3.html` | HTML/CSS shell, design system and all markup (1,608 lines) |
| `puzzles.json` | 10 solver-verified puzzle positions — not modified |
| `build3.js` | Build script → `index.html` — not modified |
| `index.html` | **The published artifact** (242,881 characters / 243,092 bytes UTF-8) |
| `test_engine3.js` | Engine suite (148/148) — not modified |
| `test_ui3.js` | UI regression suite (150/150) — not modified |
| `test_smoke3.js` | Smoke checklist (30/30) — not modified |
| `package.json` / `package-lock.json` | jsdom is the only dependency |

### Legacy / historical files (not part of the build, do not modify)

`engine.js`, `engine2.js`, `app.js`, `app2.js`, `shell.html`, `shell2.html`,
`build.js`, `gomoku.html`, `xo5.html`, `xo5-pro.html`, `xo5-analysis.html`,
`test_engine.js`, `test_engine2.js`, `test_ui.js`, `test_ui2.js`,
`test_logic.js`, `bench.js`, `dbg.js`

---

## N. BUILD PROCESS

```bash
node build3.js
```

Reads `engine3.js` + `worker3.js` + `app3.js` + `shell3.html` + `puzzles.json`
and writes `index.html`. Idempotent. Fails loudly if a placeholder is left
unreplaced or a source file is missing. Nothing about the build changed in
this round.

`index.html` is fully self-contained apart from the Google Fonts stylesheet.
If the font request fails the page still renders correctly on the fallback
stacks.

---

## O. DELIVERABLES FROM THIS ROUND

- **Source archive:** `xo5-project-final-ui-redesign.zip`
- **Preview artifact:** https://claude.ai/artifact/7Luus2P6vZUCzVfYaHZUmB —
  published from the byte-identical `index.html` contained in that archive
  (md5 `53e12072afc5b04f1a647d0bff72f489`).
- **Clean-extraction check:** the archive was extracted into a fresh
  directory, `npm install` was run there, `node build3.js` reproduced an
  `index.html` byte-identical to the development copy, and all three suites
  were re-run from the extracted tree. Results are in section C.

---

## P. HOW TO CONTINUE FROM HERE

1. `npm install`.
2. `node test_engine3.js` — confirm 148/148 before touching anything.
3. `node test_ui3.js` and `node test_smoke3.js` — confirm 150/150 and 30/30.
4. After editing `app3.js`, `worker3.js` or `shell3.html`:
   `node build3.js` → re-run both UI suites.
5. After editing `engine3.js` (only for a demonstrated correctness bug):
   `node test_engine3.js` → `node build3.js` → re-run the UI suites.
6. Keep all three suites green: 148/148, 150/150, 30/30.
7. Update this HANDOFF.md before handing off again.

### Open work / next priorities

**Short-term (UI, no engine changes needed):**

- Verify the redesign on a physical phone and with the real Archivo webfont.
- Give the in-game views the same structural attention the home page got —
  they inherited the new tokens but their layout is unchanged.
- Persist the light/dark preference across reloads.

**Medium-term (engine work required):**

- True Multi-PV: extend `Search.run()`'s root loop for independently searched
  N-best lines.
- Expand the puzzle bank beyond 10 positions.

**Longer-term:**

- Online multiplayer.
- Import/export in standard Gomoku notation (GIB/RIF).
- Opening book.
