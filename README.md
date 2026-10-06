# 🔴🔵 XO 5-in-a-Row

> **A modern, responsive 15×15 XO web game powered by XO5 Forge V3, with nine AI levels, real-time position analysis, and solver-verified tactical puzzles. V3 PRO support is temporarily suspended and it is unavailable in the UI.**

[![Play on Vercel](https://img.shields.io/badge/Play_Live-xo5.vercel.app-blue?style=for-the-badge&logo=vercel)](https://xo5.vercel.app)
[![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-Play_Online-darkgreen?style=for-the-badge&logo=github)](https://tlongzuize.github.io/xo5-game/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![UI Tests](https://img.shields.io/badge/UI%20Tests-432%20passing-brightgreen?style=for-the-badge&logo=pytest)](https://github.com/TLongzuize/xo5-game)

---

## 🌟 Features

- 🤖 **9 AI Levels to Play Against:**
  - Alpha-Beta pruning with iterative deepening, from Beginner to Maximum.
  - **XO5 Forge V3** is the only engine currently available to gameplay, analysis, and puzzle features.
  - **V3 PRO support is temporarily suspended.** It cannot be selected or run in the UI; the standalone app build uses V3.
  - Dedicated VCF (Victory of Continuous Four) and VCT (Victory of Continuous Threat) solvers for discovering forced wins during play.
- 📊 **Deep Position Analysis:**
  - Live evaluation bar and candidate move suggestions.
  - Interactive evaluation graph plotting win probability across the match.
  - What-If exploration mode to analyze alternative move variations.
- 🧩 **Solver-Verified Puzzles:**
  - Curated tactical puzzles to sharpen tactical play (finding short forced-win sequences).
  - Dedicated Puzzle Play Mode hides engine analysis while you solve; the solution appears only after you ask for it.
  - Browser Puzzle Generator builds candidate positions in a Web Worker, shows a live mini-board, and accepts only proven mate-in-1/mate-in-2 positions.
  - Stop generation at any time; accepted puzzles are saved immediately to a local bank and can be exported as JSON.
- 👥 **Game Modes:**
  - **Play vs AI:** Challenge 9 difficulty tiers from casual to master.
  - **2 Players (Pass & Play):** Play locally with a friend on the same device.
  - **Analysis Board:** Freely setup positions and analyze engine evaluations.
- 🎨 **Modern & Responsive UI:**
  - Sleek modern dark and light themes.
  - Fully responsive layout optimized for mobile screens, tablets, and desktops.
  - Smooth micro-interactions, animations, and sound effects.
- 🔒 **100% Client-Side & Private:**
  - Runs entirely inside the browser using Vanilla JavaScript and Web Workers.
  - No Firebase/backend, accounts, or data tracking is required. Match statistics, settings, and generated puzzles are saved in browser `localStorage`.
- 🧪 **Regression Coverage:** The current UI suite passes 432 checks; see [Test Suite](#test-suite) for verified results and the separate PRO-suite caveat.

---

## 🚀 Live Demo

You can play immediately in any web browser without installation:

- **Primary URL (Vercel):** [https://xo5.vercel.app](https://xo5.vercel.app)
- **Mirror URL (GitHub Pages):** [https://tlongzuize.github.io/xo5-game/](https://tlongzuize.github.io/xo5-game/)

---

## 🏗️ Engines

| Engine | Source | Description |
|---|---|---|
| **XO5 Forge V3** | `engine3.js` + `worker3.js` | Original engine: Alpha-Beta minimax with iterative deepening, transposition table (Zobrist hashing), and VCF/VCT forcing solvers. |
| **XO5 Forge V3 PRO** | `engine3pro.js` + `worker3pro.js` | Support is temporarily suspended. Source remains available for offline benchmarks, but the UI build does not bundle it and it cannot be selected for gameplay, analysis, or puzzles. |

The UI defaults to **V3**. Engine selection is persisted in `localStorage`
(`xo5.selectedEngine3`) and locked at game start. A previously saved V3 PRO selection is reset
to V3. V4 and V4 PRO remain coming soon.

---

## 📊 Benchmark & Self-Play

The comparisons below are historical development benchmarks; they do not indicate that V3 PRO is
currently available in the UI.

### Position Benchmark (500 ms / move)

| Metric | V3 | V3 PRO | Notes |
|---|---|---|---|
| Positions | 205 | 205 | Across **18 categories** |
| ELO rating (move-quality composite) | **1497.82** | **1502.18** | Δ = −4.37 (PRO); *not statistically significant* (p = 0.224) |
| Head-to-head move agreement | 24 W / 142 D / 39 L | — | PRO leads by **+50.94 ELO** on raw agreement; CI includes 0 |
| Tactical accuracy | 60/100 (60.0%) | 63/100 (63.0%) | Wilson 95% CIs **overlap**; p = 0.083 (suggestive, not significant) |
| VCF/VCT forcing solve rate | 40/40 (100%) | 40/40 (100%) | Saturated — both perfect |
| Nodes searched (total) | 495,159 | 448,674 | PRO uses **9.4% fewer nodes** (p = 1.8×10⁻⁴, **significant**) |
| Nodes per move (mean) | 2,415 | 2,189 | V3 explores more per move |
| NPS (mean) | **4,815** | 4,303 | V3 ~11.9% faster per node (p = 6.7×10⁻⁶, **significant**) |
| Average search depth | 3.84 | 3.79 | Within 0.05 ply |
| Engine errors | 0 | 0 | Clean — no crashes or fallbacks |

**Key insight:** On static 500-ms positions the two engines are **statistically indistinguishable on move quality** (ΔELO 4.4, p = 0.22). However, V3 PRO achieves this depth using **9.4% fewer nodes** while V3 runs **11.9% faster per node** — both highly significant — confirming that PRO's PVS + aspiration windows prune the search tree more aggressively, while V3 retains higher raw throughput.

### Depth-vs-Time Curves

| Budget (ms) | V3 depth | V3 PRO depth | V3 nodes | V3 PRO nodes |
|---|---|---|---|---|
| 100 | 3.35 | 3.20 | 742 | 654 |
| 250 | 4.00 | 3.80 | 1,557 | 1,357 |
| 500 | 4.20 | 4.15 | 2,919 | 2,547 |
| 1,000 | 4.55 | 4.35 | 5,811 | 4,941 |
| 2,000 | 4.90 | 4.55 | 10,952 | 9,728 |

- **200 sampled positions** × 5 time budgets × 2 engines = **200 search trials**
- Depth scaling via OLS regression (log₁₀ depth ~ log₁₀ time): V3 slope = **0.1217**, V3 PRO = **0.1154**
- Mean depth growth (100 → 2,000 ms): V3 **+1.55 ply**, V3 PRO **+1.35 ply**
- Paired t-test on depth deltas: p = 0.104 (not significant)

### Self-Play Match Series

| Parameter | Value |
|---|---|
| Games | 8 (2 time controls × 4 games) |
| Time controls | 100 ms, 250 ms |
| Openings | 17 named starting positions |
| Color assignment | Alternating per game |
| Win/Draw/Loss (V3) | 6 / 0 / 2 |
| Wilson 95% CI (V3 win rate) | [40.9%, 92.9%] |
| Sequential ELO (final) | V3 **1533.46**, V3 PRO 1466.54 |
| ELO delta | **+66.92** (V3); 95% CI [+35.5, +98.3] |
| Binomial test (6–2 split) | p = 0.289 (not significant) |
| Engine errors | 0 |

**Key insight:** V3 dominates at the shortest time control (100 ms: 4–0, +111.6 ELO) but is caught by V3 PRO at 250 ms (2–0–2, −10.7 ELO). The overall binomial test (p = 0.289) and the wide Wilson intervals reflect the small 8-game sample — the sequential ELO CI excluding zero is driven by the method, not causal dominance.

Full benchmark data: `benchmark_v3_vs_v3pro.json`, `benchmark_v3_vs_v3pro_curves.json`, `benchmark_selfplay_v3_vs_v3pro.json`.

---

## 🧪 Test Suite

**Verified on 2026-10-06:** 641 checks pass across the four passing suites below. The separate V3 PRO engine suite currently does not complete successfully; details are listed in its row.

| Suite | File | Tests | Scope |
|---|---|---|---|
| Engine regression — V3 | `test_engine3.js` | 148 passing | Win detection, tactics, TT, VCF/VCT, evaluation, 9-level ladder |
| Engine regression — V3 PRO | `test_engine3pro.js` | Not passing | Current run fails version/open-three assertions, then stops because `tt.set` is not a function. PRO is not bundled in the UI. |
| Tactical correctness | `test_tactical_correctness.js` | 31 passing | VCF/VCT, forks, win/block detection, tacticalVerify — runs against both engines |
| UI / integration | `test_ui3.js` | 432 passing | Engine suspension and selection, V3-only runtime, persistence, puzzles, and analysis |
| Smoke | `test_smoke3.js` | 30 passing | End-to-end gameplay, routing, themes, mobile layout |
| Engine v2 | `test_engine2.js` | _(legacy)_ | Previous generation |
| Engine v1 | `test_engine.js` | _(legacy)_ | Original baseline |

### Tactical Correctness Suite

**31 tests** across 9 categories, each run against both V3 and V3 PRO:

| Category | Coverage |
|---|---|
| VCF depth-1 (immediate wins) | Open four on horizontal, vertical, and diagonal |
| VCT depth-3 (3-ply forcing sequences) | Open-three forcing wins |
| Forks | 4-3 forks, 3-3 double-threat coverage |
| Win detection | Immediate win is always taken |
| Block detection | Immediate opponent win is always blocked |
| VCF sequences | Multi-move forced four sequences |
| VCT sequences | Open-three-to-four continuous threats |
| False-positive prevention | No mate claimed on calm or defended positions |
| `tacticalVerify` (V3 PRO) | Verifies wins, catches missed blocks, confirms double-threats |

Run any suite with `node <test-file>.js`.

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, Modern CSS (Design Tokens, Flexbox/Grid, Dark/Light theme), Vanilla JavaScript.
- **Engines:**
  - **XO5 Forge V3** — Alpha-Beta minimax with iterative deepening and Web Worker concurrency (`engine3.js`, `worker3.js`).
  - **XO5 Forge V3 PRO** — source and worker remain for offline benchmarks; they are not included in the UI artifact while support is suspended.
- **Build:** Simple build script bundling engine, worker, and app logic into a standalone single-file `index.html`.

### Puzzle workflow

The current puzzle contribution flow is browser-only. Open **Puzzles**, choose
**Generate puzzles**, then watch the live candidate board and solver phases.
The generator can be stopped at any time. Only positions proven by the forcing
solver with a sequence of one or three plies are kept, corresponding to
mate-in-1 or mate-in-2. Accepted puzzles are written immediately to the local
bank and can be exported as JSON. Firebase/shared-bank sync is intentionally
not implemented yet.

---

## 💻 Local Development

Clone the repository and open directly:

```bash
# Clone this repository
git clone https://github.com/TLongzuize/xo5-game.git

# Navigate into project directory
cd xo5-game

# Open the standalone index.html directly in any browser
open index.html
```

### Rebuilding the Standalone Bundle

If you edit UI source files (`shell3.html`, `app3.js`, `engine3.js`, `worker3.js`, or `puzzles.json`), compile them into `index.html`. The build intentionally excludes `engine3pro.js` and `worker3pro.js`:

```bash
node build3.js
```

### Running Tests

```bash
node test_engine3.js          # V3 engine regression (148 tests)
node test_engine3pro.js       # V3 PRO diagnostics (currently fails; see Test Suite)
node test_tactical_correctness.js  # Tactical correctness (31 tests)
node test_ui3.js              # UI + integration (432 checks)
node test_smoke3.js           # End-to-end smoke (30 tests)
```

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
