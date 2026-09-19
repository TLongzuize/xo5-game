# HANDOFF.md — XO 5-in-a-Row (15×15 Gomoku-style analysis app)

Written for an AI (or human) picking this project up with no other context.
Everything below was checked against the actual files in this repository just
before writing this document — not from memory. **This supersedes all previous
HANDOFF.md versions.** The project has moved from initial delivery to a
fully-deployed, UI-polished, stable application.

---

## A. ONE-SENTENCE STATUS

**engine3.js is untouched and protected (148/148 tests passing); the full
application layer (app3.js + worker3.js + shell3.html) passes 150/150 UI
regression tests plus 30/30 smoke tests, builds into a single-file artifact
(`index.html`), and is deployed on GitHub Pages.**

---

## B. WHAT CHANGED SINCE THE LAST HANDOFF

### Round G (current) — UI Polish, Dismiss Fix, Graph Fix

#### Commits (newest first)

| Commit | Change |
|--------|--------|
| `a0201c7` | **Fix evaluation graph** — draws from move 1 (not move 2+) |
| `7abc9da` | **UI polish** — fix dismiss button, redesign feature cards, visual hierarchy |
| `41bc3cd` | UI: merge dev notice into dismissible errBar, fix feature cards |
| `c56f6e9` | UI: home page rewrite, permanent dev banner, About modal |
| `e3861ef` | Fix: infinite analysis (∞) no longer capped at 1s |
| `0bb190c` | Feat: dual independent web workers for AI and analysis |

#### Key changes in this round

**1. Development Notice Banner**
- Replaced the error-red `errBar` (misused as a dev notice) with a dedicated
  amber/warning `#devNotice` strip using `.devnotice` CSS class
- Session-dismissible: appears every page load, dismissed for the current SPA
  session only — no `localStorage`, `sessionStorage`, `cookies`, or `IndexedDB`
- `errBar` is now hidden by default and used exclusively for real runtime errors

**2. Dismiss Button Bug Fix (root cause)**
- Bug: CSS `.devnotice { display: flex }` and `.errbar { display: flex }` had
  higher specificity than the browser default for `[hidden]`, so `element.hidden
  = true` was not visually hiding the elements
- Fix 1: Added global `[hidden] { display: none !important }` rule
- Fix 2: `devDismiss.onclick` sets both `.hidden = true` and
  `.style.display = 'none'` (belt-and-suspenders)
- Fix 3: `errClose.onclick` does the same for `errBar`

**3. Feature Cards Redesign**
- Feature cards (`.feat-card`) visually separated from interactive game-mode
  buttons (`.mode`):
  - `.mode` buttons: clickable, hover elevation (`translateY(-2px)`), shadow,
    `cursor: pointer`
  - `.feat-card` cards: informational only, muted `card-2` background,
    left accent border, `cursor: default`, `user-select: none`, no hover lift
- Card content changed to engine/analysis features distinct from mode buttons:
  📊 Live Evaluation Bar · ✦ Best-Move Suggestions · ⏱ Flexible Time Controls ·
  ✓ Proven M# Mates · ≡ Candidate Moves · △ Move Quality

**4. Evaluation Graph Fix**
- Bug: graph required ≥ 2 `graphPts` to draw. At game start `rootEval = null`,
  so after move 1 only 1 data point existed → graph stayed empty
- Fix 1: `makeGame()` initializes `rootEval = root ? null : 0` for standard
  (non-custom-root) games — the empty board is a balanced position (score 0.0)
- Fix 2: `refreshGraph()` uses `G.rootEval ?? 0` as origin for standard games
- Fix 3: `applyIteration()` now calls `refreshGraph()` so the graph updates
  live each completed search depth (not only on final result)
- Fix 4: When only 1 data point is available, graph draws a line + accent dot
  instead of returning early with just the zero-line
- Fix 5: `gradeMove()` uses `rootEval = 0` as baseline for the opening move
  when `G.rootEval` hasn't been updated yet by the engine

**5. HTML Structure Fix**
- Previous build had a mangled `homeContinue` button (SVG path left open,
  merged with `<h3>` text) — fixed with proper SVG `d="M8 5v14l11-7z"`
- Removed dangling close tags (`</section>bout this web ›</button>`) left
  by a prior multi-replace operation

---

## C. TEST BASELINE — EXACT CURRENT NUMBERS

All suites were run against the current `index.html` immediately before
writing this document.

| Suite | File | Result |
|-------|------|--------|
| **Engine — base section** | `test_engine3.js` | **63/63** |
| **Engine — appended section** | `test_engine3.js` | **38/38** |
| **Engine — integration-contract section** | `test_engine3.js` | **47/47** |
| **Engine TOTAL** | | **148/148, 0 failures** |
| **UI regression suite** | `test_ui3.js` | **150/150, 0 failures** |
| **Smoke checklist** | `test_smoke3.js` | **30/30, 0 failures** |

Note: test counts increased since last handoff (149→150 UI, 29→30 smoke)
due to additional assertions added for new features.

### How to run the tests

```bash
npm install                  # jsdom is the only dev dependency

node test_engine3.js         # engine correctness — run FIRST. Expect 148/148.

node build3.js               # rebuild index.html from source files

node test_ui3.js             # UI regression. ~60-120s. Expect 150/150.

node test_smoke3.js          # end-to-end smoke. ~20-40s. Expect 30/30.
```

---

## D. APP3.JS / WORKER3.JS ARCHITECTURE

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
turn-order logic. Since a real game's `rootSide` is always `X` (enforced in
`makeGame()`), X always moves first for every real game, in every mode.

### Evaluation sign — single convention, no per-call flipping

**Higher score = better for X, always.** Every consumer (eval bar, eval
number, evaluation graph, candidate ranking, move-quality grading, end-of-game
summary) treats `analyse().score` identically. No side-dependent sign
handling anywhere in app3.js.

### Evaluation graph — data flow

```
startGame()
  └─ makeGame()  →  G.rootEval = root ? null : 0   (origin point)
      └─ scheduleAnalysis()

runAnalysis()
  └─ onProgress callback → applyIteration()
       ├─ updates eval bar, eval num, engine panel
       └─ refreshGraph()   ← NEW: live per-iteration graph update

applyAnalysis() [on final result]
  ├─ L[view-1].evalAfter = res.score   (records point for completed move)
  ├─ gradeMove()                       (uses rootEval=0 for ply 0)
  └─ refreshGraph()

refreshGraph()
  ├─ origin: G.rootEval ?? 0  (always has a point at i=0 for standard games)
  ├─ per move: evalAfter if final, or current.score if view is at that move
  └─ draws line from move 0 → available data, even with only 1 move played
```

### Worker / search-ID / cancellation model

- Every `ask()` call gets a unique incrementing `id` and current generation
  (`WK.gen`)
- Stale results (from a superseded generation) are silently dropped before
  reaching application code
- `cancelAllSearches()` increments generation, rejects all pending promises
  with `{cancelled: true}`, and **terminates + respawns the Worker** (the only
  honest way to stop a synchronous in-flight search)
- Two separate workers: `WK` (AI moves) and `AW` (analysis) — neither blocks
  the other

### Real-time iterative-deepening UI updates

`applyIteration()` (engine3's `onProgress` callback) is only called once a
depth **fully completes** — engine3 discards aborted iterations before they
reach `onProgress`. Each call now also calls `refreshGraph()` so the graph
tracks evaluation in real time across search depths.

### AI levels 1–9

Nine `LEVELS9` entries exposed directly from the engine's own table. Every
level always takes an immediate win and always blocks an immediate loss
(structural in engine3, verified via full UI call path in `test_ui3.js`).

### Time controls

1s / 5s / 30s / 60s / Infinite (`S.timeMs === 0`). Two independent Web Workers
(`WK` for AI moves, `AW` for analysis) allow analysis to run while the AI is
thinking. Infinite mode relies on the Stop control (terminate+respawn) to end.

### Home page & UI structure

**Shell layout:**
```
┌─ Header (logo + nav + theme + settings) ─────────────────────────┐
│ #devNotice (amber warning strip, session-dismissible)             │
│ #errBar (hidden by default — real JS errors only)                 │
├─ #viewHome ───────────────────────────────────────────────────────┤
│  .hero (title, description, feature pills)                        │
│  .modegrid (Play vs AI, Local 2P, Analysis, Puzzles, Stats,       │
│             Continue — all interactive .mode buttons)             │
│  .feat-grid (6 informational .feat-card — NOT buttons)            │
│  .howto (how to play)                                             │
│  About this web › (ghost button → aboutOverlay modal)             │
├─ #viewGame (hidden) ──────────────────────────────────────────────┤
├─ #viewPuzzles (hidden) ───────────────────────────────────────────┤
├─ #viewStats (hidden) ─────────────────────────────────────────────┤
└─ Overlays: settings, confirm, end, edit, io, about ───────────────┘
```

### Development Notice behavior

- Appears every page load (no persistent dismissed state)
- User clicks **Dismiss** → hidden for current SPA session only
- Full page reload → appears again
- NO `localStorage`, `sessionStorage`, `cookies`, or `IndexedDB` involved
- Separate from `#errBar` which is only for runtime JavaScript errors

---

## E. DO NOT BREAK THESE INVARIANTS

1. **Evaluation sign**: positive = X advantage, negative = O advantage,
   zero = equal, everywhere in app3.js. No per-call flipping.
2. **`mateFor` is sign-convention-independent** (engine-internal, unchanged).
3. **M1 must correspond to a literal, verified, immediate winning move** —
   `EVAL_CAP` (800,000) stays well under `MATE_THRESHOLD` (9,000,000).
4. **An open four is M2, not M1** — unchanged, covered by base+appended tests.
5. **X always moves first** — structurally enforced for every real game in
   every mode. `G.rootSide === X` after `startGame()` with any humanSide.
6. **Every AI level (1–9) always takes an immediate win and blocks an
   immediate loss** — verified via full UI call path for every level.
7. **The engine test suite must remain passing** — 148/148 (63+38+47).
8. **Don't rewrite working engine internals** — engine3.js not touched.
9. **Stale worker/analysis results must never overwrite newer state** —
   generation-based cancellation with terminate+respawn.
10. **UI state and engine state must stay synchronized** — `displayBoard()`
    always recomputed from `line()`, never a separately-mutated cache.
11. **A real game's root side-to-move is always X** — `G.rootSide === X`
    for every `mode: 'ai' | 'local'` game.
12. **`[hidden]` elements must actually be invisible** — `[hidden] { display:
    none !important }` is a global CSS rule. Do not remove it; it is the fix
    for the dismiss-button bug.
13. **`rootEval = 0` for standard empty boards** — `makeGame()` sets
    `rootEval: root ? null : 0`. This is the origin point for the evaluation
    graph. Changing it to `null` will break the graph on move 1.
14. **`applyIteration()` must call `refreshGraph()`** — this is what makes
    the graph update live during search. If this call is removed, the graph
    will only update after the final result, appearing to not draw in early
    game positions.

---

## F. KNOWN LIMITATIONS — STATED HONESTLY

- **Multi-PV is not a true multi-line search.** Shows best-line PV + ranked
  candidate list, not independently-searched N-best lines.
- **Variation Tree is a flat list**, not a graphical branching diagram.
- **Puzzles are a fixed pre-generated bank** (10 positions, solver-verified).
  Every guess is still re-verified live against the engine.
- **No real browser/device testing.** All tests run in jsdom (no real Worker).
  Mobile scroll-jump fix verified structurally but not on a real device.
- **`solveForcing` VCT branch caps defensive replies at 6** — can
  under-report forced wins in open-three-heavy positions with >6 replies,
  never over-reports (no false positives).
- **Transposition table has no eviction policy** beyond "clear when full."
  Not a practical problem since a fresh TT is created per `ask()` call.
- **Achievements/statistics are localStorage-based, single device.** No
  account system or cross-device sync.
- **Development notice is session-level only.** No persistent user preference
  to permanently dismiss it — this is intentional (it communicates active
  development status).

---

## G. FILE STRUCTURE

### Active files (part of the current build)

| File | Role |
|------|------|
| `engine3.js` | Core AI engine — protected, do not touch |
| `worker3.js` | Web Worker dispatcher for engine3 |
| `app3.js` | Application layer (~2,040 lines) |
| `shell3.html` | HTML/CSS shell + all markup |
| `puzzles.json` | 10 solver-verified puzzle positions |
| `build3.js` | Build script → `index.html` |
| `index.html` | **The published artifact** |
| `test_engine3.js` | Engine test suite (148/148) |
| `test_ui3.js` | UI regression suite (150/150) |
| `test_smoke3.js` | Smoke checklist (30/30) |

### Legacy/historical files (not part of build, do not modify)

`engine.js`, `engine2.js`, `app.js`, `app2.js`, `shell.html`, `shell2.html`,
`build.js`, `gomoku.html`, `xo5.html`, `xo5-pro.html`, `xo5-analysis.html`,
`test_engine.js`, `test_engine2.js`, `test_ui.js`, `test_ui2.js`,
`test_logic.js`, `bench.js`, `dbg.js`

---

## H. BUILD PROCESS

```bash
node build3.js
```

Reads `engine3.js` + `worker3.js` + `app3.js` + `shell3.html` + `puzzles.json`
→ writes `index.html`. Idempotent. Fails loudly if any placeholder is
unreplaced or a source file is missing.

---

## I. HOW TO CONTINUE FROM HERE

1. `npm install` (jsdom is the only dependency).
2. `node test_engine3.js` — confirm 148/148 before touching anything.
3. `node test_ui3.js` and `node test_smoke3.js` — confirm 150/150 and 30/30.
4. After editing `app3.js`, `worker3.js`, or `shell3.html`:
   `node build3.js` → re-run both UI suites.
5. After editing `engine3.js` (only for demonstrated correctness bugs):
   `node test_engine3.js` → `node build3.js` → re-run UI suites.
6. Keep all three suites green: 148/148, 150/150, 30/30.
7. Update this HANDOFF.md before handing off again.

### Open work / next priorities

**Short-term (UI, no engine changes needed):**
- Mobile layout verification on a real device (current testing is jsdom only)
- Graphical variation tree (branching diagram) instead of flat list
- Persistent user preference for dark/light mode across reloads

**Medium-term (engine work required):**
- True Multi-PV: extend `Search.run()`'s root loop for independently-searched
  N-best lines — currently shows candidates with top-level scores only
- Puzzle bank expansion (current bank: 10 positions)

**Longer-term:**
- Online multiplayer
- Game import/export in standard Gomoku notation (GIB/RIF format)
- Opening book integration
