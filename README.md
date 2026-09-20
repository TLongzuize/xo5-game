# 🔴🔵 XO 5-in-a-Row

> **A modern, responsive 15×15 XO web game powered by a 9-level Alpha-Beta search engine, real-time evaluation analysis, and solver-verified tactical puzzles.**

[![Play on Vercel](https://img.shields.io/badge/Play_Live-xo5.vercel.app-blue?style=for-the-badge&logo=vercel)](https://xo5.vercel.app)
[![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-Play_Online-darkgreen?style=for-the-badge&logo=github)](https://tlongzuize.github.io/xo5-game/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

---

## 🌟 Features

- 🤖 **9 AI Levels to Play Against:**
  - Alpha-Beta pruning with iterative deepening, from Beginner to Maximum.
  - Transposition table caching with Zobrist hashing.
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

---

## 🚀 Live Demo

You can play immediately in any web browser without installation:

- **Primary URL (Vercel):** [https://xo5.vercel.app](https://xo5.vercel.app)
- **Mirror URL (GitHub Pages):** [https://tlongzuize.github.io/xo5-game/](https://tlongzuize.github.io/xo5-game/)

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, Modern CSS (Design Tokens, Flexbox/Grid, Dark/Light theme), Vanilla JavaScript.
- **Engine:** Custom Alpha-Beta minimax engine with Web Worker concurrency.
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

If you edit modular source files (`shell3.html`, `app3.js`, `engine3.js`, `worker3.js`), compile them into `index.html`:

```bash
node build3.js
```

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
