# XO5 — Puzzle Generator & Puzzle Play Mode
## HANDOFF PACKAGE

**Date:** 2026-09-20
**Phase reached:** Phases 1–11 complete. Phase 12 (Firebase) **NOT STARTED**.
**Browser-only implementation:** complete and verified.
**Committed / pushed:** **NOTHING.** All work is in the working tree only.

**Latest UI polish:** The generator modal now has a live Worker indicator, an
animated activity rail, a `Build → Prove → Save` phase timeline, a halo around
the live candidate board, and reduced-motion-safe animation. The source of
truth remains `shell3.html`; rebuild `index.html` with `node build3.js`.

**Latest board correction:** The generator preview is an XO board, not a
Gomoku intersection board. Its 15 × 15 grid uses cell boundaries and every X/O
is rendered at the centre of a square. This is implemented in `renderGenBoard`
and is covered by the existing generator/UI regression tests.

---

## 0. THE THIRTY-SECOND VERSION

A puzzle generator was added to XO5. It runs in a Web Worker, streams live
progress, and saves every accepted puzzle to `localStorage` the instant it is
found. Generated puzzles merge into the existing puzzle bank and are playable
in a rebuilt Puzzle Play Mode that supports both X and O and hides every
analysis surface.

Four real bugs were found and fixed along the way, one of which
(**Puzzle Mode accepted every legal move**) pre-dated this work and made the
whole puzzle feature non-functional. See §3.

Final state:

```
Engine: 148/148    (baseline 148 — unchanged)
UI:     319/319    (baseline 150 + 169 new)
Smoke:   30/30     (baseline 30 — unchanged)
E2E:    0 errors captured across every channel
Mobile:  40/40     (static + dynamic audit; see limits in §7)
```

---

## 1. FINAL IMPLEMENTATION STATUS

### 1.1 What was implemented

**Worker generator** (`worker3.js`)
- New streaming protocol: `generatePuzzle` / `stopGenerate` →
  `progress` / `accepted` / `generated-done` / `error`.
- Runs in ~45 ms slices scheduled through `setTimeout`. This is load-bearing,
  not a style choice: a synchronous loop starves the worker's own message
  queue, so `stopGenerate` would never be delivered and Stop would be a lie.
  Measured stop latency ≈ 25 ms with zero late messages.
- Candidate construction: 6–14 stones, alternating X/O from an empty board,
  grown around the centre, seeded PRNG, never overwrites a cell, never
  completes a five (so a position can never be already-won).
- Both sides supported via stone parity (even → X to move, odd → O to move).
- Acceptance requires `solveForcing()` to return `win === true`,
  `aborted === false`, and `seq.length` of exactly 1 or 3. Nothing is
  accepted on heuristics, score, or threat count.
- Per-candidate bounds always apply (400 ms, 15 000 nodes, maxPly 3) even in
  an Unlimited session.

**Durable save pipeline** (`app3.js`)
- `saveGeneratedPuzzle()` runs per accepted puzzle:
  validate → canonical dedupe → persist → bank merge → UI update.
- No end-of-session flush exists, because there is nothing to flush. Verified
  by test: puzzles are readable from `localStorage` *while the session is
  still running*.
- `localStorage` failure keeps the puzzle in memory, flips `persistOk`, shows
  a non-blocking warning, never truncates what was already on disk, and
  recovers when storage works again.

**Puzzle bank** (`app3.js`)
- `BUILTIN_PUZZLES` / `CONTRIBUTED_PUZZLES` / `GENERATED_PUZZLES` →
  `MERGED_PUZZLES`, deduplicated by canonical key, builtins first.
- Rebuilt **in place** so `PUZZLES` stays the same array object — existing
  tests and `window.__XO.PUZZLES` hold a live reference.
- `CONTRIBUTED_PUZZLES` is an empty, wired-up slot. It is the intended
  landing zone for a Firebase/remote bank (see §8).

**Generator UI** (`shell3.html` + `app3.js`)
- `#genOverlay` modal: time selector (30 s / 1 m / 5 m / 10 m / 30 m /
  Unlimited), target selector (5 / 10 / 25 / 50 / 100 / Unlimited), live
  candidate mini-board, phase indicator, eight live statistics, candidate
  reason line, and an explicit persistence line.
- The mini-board draws the actual candidate the worker reported. There is no
  placeholder: with no candidate it renders empty and dimmed.
- Animations gated behind `prefers-reduced-motion: no-preference`.
- The modal presents a `Puzzle lab` header, Worker-ready/active status, a live
  activity rail, `Build → Prove → Save` stage indicators, and a halo/pulse
  treatment around the candidate board. These are visual state treatments only;
  the counters and phase text still come from the real generator protocol.

**Puzzle Play Mode** (`app3.js` + `shell3.html`)
- `#puzHud` panel: title, dynamic X/O objective, attempts, timer, status,
  Show solution / Replay solution / Reset puzzle / Exit puzzle.
- `body.puzzle-mode` removes every analysis surface with
  `display:none !important` — not `visibility`, so it is gone from the
  accessibility tree too.
- The analysis pipeline is switched **off**, not merely hidden:
  `runAnalysis()` returns early, threats/heat/arrows are suppressed at source,
  and analysis-bearing controls are `disabled` so they are unreachable by
  keyboard.
- No auto-play: `aiToMove()` already excludes puzzles, and mode is `analysis`.

**Home page copy** (`shell3.html`)
- The home mode card and Puzzles showcase now describe both solving and local
  generation, including the live mini-board, Stop control, and private local
  bank. Keep this copy aligned with the actual browser-only scope until the
  Firebase/shared-bank phase begins.

**Export** (`app3.js`)
- `exportGeneratedJSON()` emits only the local generated bank, stripped of
  internal bookkeeping (`canon`, `proof`). Works with zero puzzles, mid-session
  and after Stop.

**Tests** (`test_ui3.js`)
- 169 new assertions across 11 sections covering generation correctness,
  validation, dedupe, immediate persistence, no-data-loss, storage failure,
  cancellation/resume, live UI, export, reload, and puzzle play.

### 1.2 What was fixed

See §3 for full detail. Summary: four real bugs, one pre-existing and severe.

### 1.3 What remains unfinished

| Item | Status | Notes |
|---|---|---|
| Firebase / shared bank | **Not started** | Deliberate. Spec §34 defers it. |
| Real-browser layout QA | **Not done** | jsdom has no layout engine. See §7. |
| Win-in-1 puzzle frequency | **Known characteristic** | ~3 % of output. See §6. |
| Smoke suite additions | **Deliberately none** | Kept at 30/30 as instructed. |

---

## 2. FILE INVENTORY

### 2.1 CURRENT / V3 FILES

| File | Modified | What changed |
|---|---|---|
| `engine3.js` | **NO** | **PROTECTED. Byte-identical to the uploaded archive.** SHA256 `e66f4df6923404866827bdf13fdf5668df3d52ced260630ab14bed53dd15f395`, verified against the zip. |
| `worker3.js` | **YES** | Added the whole generator: protocol docs, `genRandom`, `genCanonKey`, `genCandidate`, `GEN` session state, `genStep` slicing, `genStart`/`genStop`/`genFinish`, and `generatePuzzle`/`stopGenerate` dispatch branches. Existing search dispatch untouched. |
| `app3.js` | **YES** | Puzzle bank, validation, save pipeline, generator channel + session controller, generator UI, export, and a rewritten Puzzle Play Mode. Plus targeted edits to `runAnalysis`, `refreshThreats`, `applyHeat`, `drawArrows`, `updateInteractivity`, `refreshStatus`, `refreshGraph`, `setEvalDisplay`, `startGame`, `applyRoute`, `closeAll`, `__XO`. |
| `shell3.html` | **YES** | Generator modal markup, puzzle HUD markup, generator/puzzle CSS, `body.puzzle-mode` rules, narrow-screen tap-target rules, puzzles-view generator card. |
| `index.html` | **YES** | **BUILD ARTIFACT — never edit by hand.** Regenerate with `node build3.js`. |
| `test_ui3.js` | **YES** | +169 assertions (150 → 319). Existing assertions untouched. |
| `test_engine3.js` | **NO** | Unchanged. 148/148. |
| `test_smoke3.js` | **NO** | Unchanged. 30/30. Deliberately left alone so the count stays at 30. |
| `puzzles.json` | **NO** | Unchanged. Backward compatibility is handled in code, not by rewriting data. |
| `build3.js` | **NO** | Unchanged. Existing placeholder injection already covers everything. |

**New (untracked) verification harnesses — not part of the shipped suites:**

| File | Purpose |
|---|---|
| `verify_final.js` | End-to-end flow walk with every error channel captured. `node verify_final.js` |
| `verify_mobile.js` | Narrow-viewport static CSS audit + dynamic 360px run. `node verify_mobile.js` |

### 2.2 LEGACY FILES — MUST NOT BE TOUCHED

All sixteen verified **byte-identical** to the uploaded archive by SHA256:

```
app.js            app2.js           shell.html        shell2.html
build.js          gomoku.html       xo5.html          xo5-pro.html
xo5-analysis.html engine.js         engine2.js        test_engine.js
test_engine2.js   test_ui.js        test_ui2.js       test_logic.js
```

No legacy file was read into the build, modified, staged, or migrated. No
parallel legacy implementation was created.

### 2.3 Git state — IMPORTANT QUIRK

The repository tracks only nine files (from an earlier "limit published files"
commit). **`worker3.js`, `build3.js`, `puzzles.json` and `test_engine3.js` are
untracked**, so `worker3.js` shows as `??` in `git status` even though it was
modified.

```
git status --short
 M app3.js
 M index.html
 M shell3.html
 M test_ui3.js
?? worker3.js          <-- MODIFIED but untracked; do not overlook it
?? verify_final.js     <-- new
?? verify_mobile.js    <-- new
?? (many legacy files, all untracked and unmodified)

git diff --stat
 app3.js     | 1210 ++++++++++++++++-
 index.html  | 1695 ++++++++++++++++++-
 shell3.html |  186 +++-
 test_ui3.js |  560 ++++++++
 4 files changed, 3567 insertions(+), 84 deletions(-)

git diff --check     -> clean, no whitespace errors
```

Nothing staged. Nothing committed. Nothing pushed.

---

## 3. BUGS FOUND AND FIXED

### 3.1 Puzzle Mode accepted every legal move (PRE-EXISTING, SEVERE)

`solveForcing(state, side)` always assumes `side` is the one to move. The
original `puzzleGuess()` played the user's move and then asked
"can `side` force a win?", which silently granted the player a **second move
in a row** — the original threat is still standing, so it "proves" a win.

Measured on bundled puzzle 1: **215 of 215 legal moves were accepted.** Puzzle
Mode was decorative.

The replacement reasons about the position with the **opponent** to move, using
only facts the engine can establish:

| After the player's move | Verdict |
|---|---|
| Immediate five | win, no search |
| ≥ 2 five-threats | win — opponent can block at most one |
| exactly 1 five-threat | block is forced → play it, then the solver is legitimately asked with `side` to move |
| no five-threat (quiet) | accepted only if it is the puzzle's own verified first move |

Sound, and complete for every puzzle this generator produces. After the fix:
**0 of 35 sampled wrong squares accepted**, intended solution accepted
**10/10**.

The last branch is sound but not complete — a quiet winning move that is not
the stored one is rejected. That is the conservative direction, and it costs
nothing for generated puzzles.

### 3.2 Late worker messages were not ignored

The guard read `d.id !== GS.token`, but a session's token never changes — only
`GEN_TOKEN` advances on Stop. Post-cancellation results were still being
counted. Now requires `GS.token === GEN_TOKEN` as well.

### 3.3 A stop for an already-finished session killed the *next* session

The graceful-stop handshake was sent to a session the worker no longer had, so
it never acknowledged, and the 1200 ms termination deadline then fired during
whatever session had started meanwhile. Symptom: sessions that should have
ended `timeout` reported `stopped`. `stopGeneration()` now returns early when
the session is not running.

### 3.4 `stopGenerate` was not scoped to a session

Messages queue, so a stop and the next start can cross; the worker stopped
whatever was current. Now id-checked in `worker3.js`.

---

## 4. SIGNIFICANT DISCOVERY — TWO `len` CONVENTIONS

**The bundled puzzles do not use the current solver's `len` encoding.**

Re-solving all ten with `engine3.solveForcing()` gives a sequence exactly two
plies longer than the stored value, in every case:

```
bundled len 1  ->  solver seq 3   (a forced win in 2)
bundled len 3  ->  solver seq 5   (a forced win in 3)
bundled len 5  ->  solver seq 7   (a forced win in 4)
```

The old UI displayed `Math.ceil(len / 2)`, so puzzle 1 was advertised as a
"forced win in 1" when the engine proves it is a win in **2**. That label was
wrong.

Per spec §11 ("preserve engine correctness and label the UI appropriately"),
the value is **translated rather than trusted**:

```js
function puzzleSeqLen(p) {
  if (p.seq && p.seq.length) return p.seq.length;              // verified: authoritative
  if (p.source === 'generated-local') return p.len || 1;       // current encoding
  return (p.len || 1) + 2;                                     // legacy bundled encoding
}
```

Two consequences a future agent must keep straight:

1. **`G.puzzle.len` is ALREADY a true sequence length** — `startPuzzle()`
   translates once on the way in. Use `activeWinIn()` for the active puzzle and
   `puzzleWinIn()` for bank objects. Translating twice is an easy mistake and
   was caught during testing.
2. **Show Solution resolves the full line from the solver for bundled
   puzzles**, which store only `key`. Without this, replay would show one move
   for a two-move win.

---

## 5. ARCHITECTURE NOTES FOR THE NEXT AGENT

### 5.1 The generator's main-thread fallback runs the REAL worker source

`workerSrc` is embedded as `type="text/plain"` and is only read as text to build
the Blob, so the worker's code is not available to the page. Where no `Worker`
exists — old browsers **and jsdom** — `makeInlineGenerator()` executes the same
`worker3.js` source against a stand-in `self`:

```js
var host = { XOEngine: E, GEN_SLICE_MS: 12, postMessage: fn };
(new Function('self', wrkEl.textContent))(host);
```

This is **not a reimplementation**. The tests therefore exercise the genuine
generator through the genuine protocol, not a stub. `GEN_SLICE_MS` is injected
(12 ms instead of 45 ms) so the page keeps painting.

Consequence: `worker3.js` must stay compatible with being run as
`new Function('self', src)` — no `importScripts`, no worker-only globals beyond
what the host object provides.

### 5.2 Cancellation model

```
GEN_TOKEN     module-level counter; the identity of the live session
GS.token      assigned ++GEN_TOKEN at session start
              a message is ours iff  d.id === GS.token && GS.token === GEN_TOKEN
stopPending   tracked OUTSIDE the token, because Stop invalidates the token
              and would otherwise discard the worker's own acknowledgement
```

Stop bumps `GEN_TOKEN` **before** talking to the worker, which is what makes
"late results are ignored" true rather than merely likely.

### 5.3 The target is enforced on the main thread

`targetAccepted: null` is sent to the worker deliberately. The target counts
puzzles that were accepted **and successfully persisted**, and only the main
thread knows which acceptances survived validation, dedupe and the disk write.
Delegating it would stop the session short whenever a candidate duplicated the
existing bank. The worker still *supports* `targetAccepted` — it is in the
protocol — the app simply does not delegate the decision.

### 5.4 `maxAttempts` is a stall guard, not a session cap

Interpreted as **consecutive rejections tolerated** before ending with reason
`exhausted`. A total-attempt cap would contradict Unlimited mode. At ~18 %
acceptance, 300 consecutive rejections is effectively unreachable, so it never
fires spuriously.

### 5.5 Validation re-proves rather than trusts

Main-thread validation is structural + legality (cheap, respects spec §31's
"no expensive main-thread search"), **plus** a re-proof wherever one is
possible without a search:

- `len 1` → fully re-proved via `winningLineAt`.
- `len 3` → re-proved as forced when the attacker threatens five after the
  first move (one threat ⇒ block forced; two ⇒ uncoverable).
- open-three lines → fall back to `proof: 'worker-verified'`.

In practice every generated puzzle comes back `proof: 'reproved'`.

### 5.6 Canonical dedupe key

Must stay **identical** in `worker3.js` (`genCanonKey`) and `app3.js`
(`canonKeyOf`):

```
sorted("<cell><x|o>", …).join('.') + '#' + ('X'|'O')
```

Same board with the opposite side to move is deliberately a **different** key.

### 5.7 Puzzle schema

```js
{
  moves: [...],            // replayed alternately starting with X
  key: <cell>,             // first move of the solution
  len: 1 | 3,              // solver sequence length (generated puzzles)
  seq: [...],              // full verified line — generated only
  sideToMove: "X" | "O",   // derivable from moves.length parity
  canon: "...",            // in-memory/disk only; stripped from export
  proof: "reproved" | "worker-verified",   // stripped from export
  source: "generated-local",
  generatedAt, elapsedMs, nodes, maxPly, solverVersion
}
```

Old `{ moves, key, len }` objects still validate, merge, label and play.

---

## 6. MEASURED GENERATOR BEHAVIOUR

A full 30-second Unlimited session, main-thread fallback, inside jsdom:

```
end reason        timeout
attempts          1909
accepted           348
rejected          1561
duplicates           0
nodes searched    7203
elapsed          30022 ms
X puzzles          207
O puzzles          141
forced win in 1     11
forced win in 2    337
persisted          348   (all of them)
```

**Known characteristic — win-in-1 frequency.** Forced-win-in-1 puzzles are
~3 % of output. Spec §13 says priority *can* be given to them; it is optional
and must never override correctness, which it does not. If more variety is
wanted, the cleanest lever is in `genCandidate()`: bias a fraction of
candidates toward leaving the attacker an unblocked four. Do **not** relax the
acceptance test to get there.

**Note on pacing.** At ~18 % acceptance a 100-puzzle target completes in a few
seconds, which makes the longer duration options less meaningful than the spec
anticipated. That is honest behaviour, not padding. A stricter quality filter
would make sessions feel more substantial.

---

## 7. VERIFICATION PERFORMED

### 7.1 Suites (final pass, after the last edit)

```
node build3.js        -> built index.html — 323655 bytes
node test_engine3.js  -> 148/148   (63 base + 38 appended + 47 integration)
node test_ui3.js      -> 319/319
node test_smoke3.js   ->  30/30
```

UI suite was run repeatedly and is stable; the new async tests are not flaky.

### 7.2 End-to-end (`verify_final.js`)

Zero problems captured across `window.onerror`, the `error` event,
`unhandledrejection`, `console.error` and `console.warn`.

Verified: generation with live disk writes mid-run, mini-board matching the
reported candidate, independent re-solving of all output (0 failures, 0 illegal
positions, 0 parity mismatches), persistence counts agreeing with disk, reload,
export validity, X and O play, wrong move rejected without revealing the
answer, verified solution accepted, engine never auto-playing, Show Solution,
Replay, bundled-puzzle line resolution, Reset and Exit.

### 7.3 Narrow viewport (`verify_mobile.js`) — 40/40

Static CSS audit plus a dynamic 360 px run. Confirmed the generator layout
collapses to one column, the mini-board is vw-sized, stats drop to two columns,
modals become bottom sheets, text wraps rather than overflowing, all twelve
setting options stay reachable, Stop stays visible and labelled, and generation
and puzzle play both work at 360 px.

**NOT verifiable in this environment — a real browser is still required for:**

- actual pixel geometry, overflow and scroll behaviour (jsdom does no layout;
  `offsetWidth` is always 0)
- touch scrolling inside the bottom-sheet modal
- real font metrics, so text collision is inferred from wrap rules only
- safe-area insets on notched devices
- rendered tap-target heights (minimums are declared in CSS, not measured)

A narrow-screen tap-target rule was added for the puzzle actions (40 px), the
generator footer including Stop (44 px) and the time/target segments (38 px),
scoped so the global `.btn.sm` is untouched.

---

## 8. FIREBASE — NOT STARTED, AND HOW TO START

Nothing Firebase-related exists in the codebase. Do not begin until the user
supplies the project, Firestore instance, Web App and config.

Groundwork already in place:

- `CONTRIBUTED_PUZZLES` is a wired-up, currently empty source. Remote puzzles
  should land there, then `rebuildMergedPuzzles()`.
- `canonKeyOf()` gives bundled/local/remote dedupe for free.
- `validateGeneratedPuzzle()` already rejects anything structurally wrong or
  illegal, and re-proves what it can.
- Export already produces exactly the shape a `puzzles/{puzzleId}` document
  wants.

Required when it begins:

- **Do not trust client-provided `nodes`, `elapsedMs`, `solverVersion`,
  `verified` or `status` as proof of correctness.**
- If there is no server-side verification, **document explicitly that
  client-side validation is not anti-cheat.**
- Network failure must never break local generation or local puzzle play;
  offline must stay fully usable.

---

## 9. HOW TO PICK THIS UP

```bash
# 1. baseline — expect 148 / 319 / 30
node build3.js && node test_engine3.js && node test_ui3.js && node test_smoke3.js

# 2. deeper verification
node verify_final.js        # expect 0 errors
node verify_mobile.js       # expect 40/40

# 3. after ANY change to app3.js / shell3.html / worker3.js / puzzles.json
node build3.js              # index.html is generated, never hand-edited
```

Rules that still apply:

- `engine3.js` is protected. It is currently byte-identical to the original and
  should stay that way.
- Never touch the sixteen legacy files in §2.2.
- Never hand-edit `index.html`.
- Do not weaken a failing test — diagnose the cause. Every failure encountered
  during this work turned out to be a real bug or a mis-specified test, and
  three of the four product bugs were found exactly this way.
- Keep `test_smoke3.js` at 30 unless asked otherwise.

---

## 10. FINAL REPORT (spec §40 format)

```
Files changed:
  worker3.js     — generator protocol + generation engine
  app3.js        — bank, save pipeline, generator channel/UI, export, puzzle mode
  shell3.html    — generator modal, puzzle HUD, CSS
  test_ui3.js    — +169 assertions
  index.html     — rebuilt artifact
  verify_final.js, verify_mobile.js — new verification harnesses (not shipped)
  engine3.js     — UNCHANGED (byte-identical, SHA256 verified)

Generator:
  Time options:          30s / 1m / 5m / 10m / 30m / Unlimited
  Target options:        5 / 10 / 25 / 50 / 100 / Unlimited
  X puzzles:             207   (30s sample session)
  O puzzles:             141
  Accepted:              348
  Rejected:              1561
  Duplicates:            0
  Total attempts:        1909
  Total generation time: 30022 ms
  Total nodes:           7203

Persistence:
  Real-time save:        PASS  (verified on disk mid-session)
  localStorage:          PASS  (incl. quota failure + recovery)
  Reload persistence:    PASS
  Export:                PASS  (empty, partial, post-Stop)

Puzzle Mode:
  Analysis hidden:       PASS
  X puzzles:             PASS
  O puzzles:             PASS
  Show solution:         PASS  (generated and bundled)
  Replay:                PASS

Cancellation:
  Stop:                  PASS  (~25 ms latency)
  Resume:                PASS  (fresh token, bank preserved)
  Late results ignored:  PASS  (after fixing a real bug)
  Worker recovery:       PASS

Tests:
  Engine:                148/148
  UI:                    319/319
  Smoke:                  30/30

Firebase:
  Not implemented
```

Nothing above is claimed as passing that was not actually observed. The three
items I could **not** verify in this environment are listed explicitly in §7.3.
