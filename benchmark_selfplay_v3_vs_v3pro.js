/* benchmark_selfplay_v3_vs_v3pro.js — XO5 Forge V3 vs V3 PRO Enhanced Self-Play Match
   Statistical head-to-head series with multiple time controls, benchmark-opening
   variety, sequential ELO ratings, W/D/L confidence intervals and significance
   testing.

   Usage:
     node benchmark_selfplay_v3_vs_v3pro.js
     GAMES=50 TIME_CONTROLS=100,250,500,1000 node benchmark_selfplay_v3_vs_v3pro.js
     GAMES=100 TIME_CONTROLS=500 node benchmark_selfplay_v3_vs_v3pro.js
     GAMES=20 TIME_CONTROLS=250 LEVEL=8 SEED=777 node benchmark_selfplay_v3_vs_v3pro.js
     GAMES=10 TIME_CONTROLS=200 MAX_PLIES=40 node benchmark_selfplay_v3_vs_v3pro.js

   Environment variables:
     GAMES=<n>            games per time control (default 50)
     TIME_CONTROLS=a,b,c  per-move time budgets in ms (default 100,250,500,1000)
     LEVEL=<1-9>          engine level; sets width / rootWidth / maxDepth (default 7)
     SEED=<n>             base seed for reproducible move generation (default 12345)
     CATEGORY=<name>      benchmark_positions.json category for start positions (default Opening)
     MAX_PLIES=<n>        hard ply cap per game (default 225 = full board)
     PREMOVES=<0|1>       apply the opening's recorded moves before play (default 1)
     MOVEPICK=<pick>      choose = engines' real play path (default, includes PRO tactical
                          verification); analyse = noise-free, seeded, level-shaped search

   Outputs:
     benchmark_selfplay_v3_vs_v3pro.json    full report (all metrics, per time control)
     benchmark_selfplay_v3_vs_v3pro.jsonl   one JSON object per game

   NOTE: Experimental measurement only. Does not constitute a definitive ranking.
*/
'use strict';

const fs = require('fs');
const path = require('path');

/* ---------- Engines ---------- */
Function(fs.readFileSync(path.join(__dirname, 'engine3.js'), 'utf8'))();
Function(fs.readFileSync(path.join(__dirname, 'engine3pro.js'), 'utf8'))();

const V3 = global.XOEngine;
const V3Pro = global.XOEnginePro;
if (!V3 || !V3Pro) throw new Error('Engines not loaded');

const SIZE = 15;
const LEN = 225;
const X = 1;
const O = 2;
const idxOf = (x, y) => y * SIZE + x;
const nm = i => (i == null || i < 0) ? 'none' : 'ABCDEFGHIJKLMNO'[i % SIZE] + (SIZE - Math.floor(i / SIZE));

/* ---------- Configuration ---------- */
const V3_NAME = V3.ENGINE_NAME || 'XO5 Forge V3';
const PRO_NAME = V3Pro.ENGINE_NAME || 'XO5 Forge V3 PRO';

const GAMES = Math.max(1, parseInt(process.env.GAMES, 10) || 50);
const TIME_CONTROLS = (process.env.TIME_CONTROLS || '100,250,500,1000')
  .split(',')
  .map(s => parseInt(s, 10))
  .filter(n => Number.isFinite(n) && n > 0);
if (!TIME_CONTROLS.length) TIME_CONTROLS.push(500);
const LEVEL = Math.min(9, Math.max(1, parseInt(process.env.LEVEL, 10) || 7));
const BASE_SEED = parseInt(process.env.SEED, 10) || 12345;
const CATEGORY = process.env.CATEGORY || 'Opening';
const MAX_PLIES = Math.max(1, parseInt(process.env.MAX_PLIES, 10) || LEN);
const USE_PREMOVES = process.env.PREMOVES !== '0';
const MOVEPICK = (process.env.MOVEPICK || 'choose') === 'analyse' ? 'analyse' : 'choose';

const ELO_INITIAL = 1500;
const ELO_K = 32;
const Z_95 = 1.959964;
const ESTIMATED_PLIES = 40;

/* ---------- Start positions ---------- */
const positionsFile = path.join(__dirname, 'benchmark_positions.json');
if (!fs.existsSync(positionsFile)) throw new Error('benchmark_positions.json not found. Run generator first.');
const ALL_POSITIONS = JSON.parse(fs.readFileSync(positionsFile, 'utf8'));
const START_POSITIONS = ALL_POSITIONS.filter(p => p.category === CATEGORY);
if (!START_POSITIONS.length) throw new Error(`No positions with category "${CATEGORY}" in benchmark_positions.json`);

/* ---------- Move generation ---------- */
/* Two play paths are available:
     'choose'   (default) — chooseMove(state, side, level, timeMs), the path the app and
                 tests use. Keeps every engine-specific feature in the play pipeline,
                 including the PRO-only tactical verification pass, so the match measures
                 the engines as they actually play. Level noise applies (2% V3 / 1% PRO
                 at level 7) and neither engine is seedable, so runs are repeatable only
                 in distribution, not move for move.
     'analyse'  — analyse(state, side, {maxDepth, width, rootWidth, timeMs, vcf, vct, seed}),
                 noise-free and seeded. Level shape still comes from each engine's own
                 level table. Note this path does not run the PRO tactical verification. */
function analyseOptions(Eng, level, timeMs, seed) {
  const table = Eng.LEVELS9_PRO || Eng.LEVELS9 || {};
  const cfg = table[level] || table[5] || {};
  return {
    maxDepth: cfg.maxDepth,
    width: cfg.width,
    rootWidth: cfg.rootWidth,
    timeMs: timeMs,
    vcf: cfg.vcf !== false,
    vct: !!cfg.vct,
    seed: seed
  };
}

function pickMove(Eng, state, side, timeMs, seed) {
  const started = Date.now();
  let res = null;
  let error = null;
  try {
    res = MOVEPICK === 'analyse'
      ? Eng.analyse(state, side, analyseOptions(Eng, LEVEL, timeMs, seed))
      : Eng.chooseMove(state, side, LEVEL, timeMs);
  } catch (err) {
    error = err.message;
  }
  const elapsed = Date.now() - started;
  let move = res && typeof res.idx === 'number' ? res.idx : (res && typeof res.best === 'number' ? res.best : -1);
  if (move < 0 || move >= LEN || state.board[move] !== 0) move = -1;
  return {
    move: move,
    error: error,
    depth: (res && res.depth) || 0,
    nodes: (res && res.nodes) || 0,
    score: (res && typeof res.score === 'number') ? res.score : 0,
    kind: (res && res.kind) || (error ? 'error' : 'none'),
    stoppedByTime: !!(res && res.stoppedByTime),
    elapsedMs: elapsed
  };
}

/* ---------- Math / Statistics ---------- */
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stdDev(arr, sample) {
  if (!arr || arr.length < 2) return 0;
  const m = avg(arr);
  const ss = arr.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(ss / (sample ? arr.length - 1 : arr.length));
}

/* Wilson score interval: robust for proportions near 0 or 1. */
function wilsonInterval(successes, total, z) {
  const n = total || 0;
  const zc = z || Z_95;
  if (n <= 0) return { point: 0, low: 0, high: 0, successes: 0, n: 0, method: 'wilson' };
  const p = successes / n;
  const denom = 1 + zc * zc / n;
  const centre = p + zc * zc / (2 * n);
  const margin = zc * Math.sqrt((p * (1 - p) + zc * zc / (4 * n)) / n);
  return {
    point: p,
    low: Math.max(0, (centre - margin) / denom),
    high: Math.min(1, (centre + margin) / denom),
    successes: successes,
    n: n,
    method: 'wilson'
  };
}

function logGamma(z) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  let y = x;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
const logChoose = (n, k) => logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
const binomPmf = (k, n, p) => Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));

/* Exact two-sided binomial test of H0: win probability = 0.5 (draws excluded). */
function binomialTestTwoSided(wins, losses, p0) {
  const p = p0 === undefined ? 0.5 : p0;
  const n = wins + losses;
  if (n <= 0) {
    return { wins: 0, losses: 0, decisive: 0, p0: p, pValue: null, method: 'exact-binomial-two-sided', significant: false, note: 'no decisive games' };
  }
  const pmf = k => binomPmf(k, n, p);
  const observed = pmf(wins);
  let total = 0;
  for (let k = 0; k <= n; k++) if (pmf(k) <= observed * (1 + 1e-7)) total += pmf(k);
  const pValue = Math.max(0, Math.min(1, total));
  return {
    wins: wins,
    losses: losses,
    decisive: n,
    p0: p,
    observedRate: wins / n,
    pValue: pValue,
    method: 'exact-binomial-two-sided',
    significant: pValue < 0.05
  };
}

function significanceLabel(p) {
  if (!Number.isFinite(p)) return 'n/a';
  if (p < 0.01) return '***';
  if (p < 0.05) return '**';
  if (p < 0.1) return '*';
  return 'n.s.';
}
function significanceVerdict(p) {
  if (!Number.isFinite(p)) return 'insufficient data';
  if (p < 0.01) return 'highly significant (p<0.01)';
  if (p < 0.05) return 'significant (p<0.05)';
  if (p < 0.1) return 'marginal (p<0.10)';
  return 'not significant (p>=0.10)';
}

/* ---------- ELO ---------- */
const eloFromScore = p => {
  const pc = Math.min(0.999999, Math.max(0.000001, p));
  return 400 * Math.log10(pc / (1 - pc));
};

/* Sequential ELO ladder with a delta-method variance of the rating difference.
     D' = D + K (S - E(D)),   E(D) = 1 / (1 + 10^(-D/400))
     Var(D') = a^2 Var(D) + K^2 Var(S),  a = K ln10/400 * q/(1+q)^2,  q = 10^(-D/400)
     Var(S) = 0.25 for a win / draw / loss coded as 1 / 0.5 / 0. */
class EloLadder {
  constructor(initial, k) {
    this.initial = initial;
    this.k = k;
    this.v3 = initial;
    this.pro = initial;
    this.variance = 0;
    this.history = [];
    this.games = 0;
  }
  update(score) {
    const d = this.v3 - this.pro;
    const q = Math.pow(10, -d / 400);
    const expected = 1 / (1 + q);
    const a = this.k * Math.LN10 / 400 * q / Math.pow(1 + q, 2);
    const before = { v3: this.v3, pro: this.pro };
    this.v3 += this.k * (score - expected);
    this.pro += this.k * ((1 - score) - (1 - expected));
    this.variance = a * a * this.variance + this.k * this.k * 0.25;
    this.games++;
    const diff = this.v3 - this.pro;
    this.history.push({
      game: this.games,
      expectedScore: expected,
      actualScore: score,
      eloV3: this.v3,
      eloPro: this.pro,
      eloDiff: diff
    });
    return { expected: expected, before: before, eloV3: this.v3, eloPro: this.pro, eloDiff: diff };
  }
  snapshot() {
    const diff = this.v3 - this.pro;
    const se = Math.sqrt(this.variance);
    return {
      games: this.games,
      initial: this.initial,
      kFactor: this.k,
      v3: this.v3,
      pro: this.pro,
      diff: diff,
      se: se,
      ci95: { low: diff - Z_95 * se, high: diff + Z_95 * se },
      significant: (diff - Z_95 * se) * (diff + Z_95 * se) > 0,
      favourite: diff > 0 ? V3_NAME : (diff < 0 ? PRO_NAME : 'even')
    };
  }
}

/* ---------- Game simulation ---------- */
function playGame(params) {
  const { opening, timeMs, v3IsX, seed, maxPlies } = params;

  const xEngine = v3IsX ? V3 : V3Pro;
  const oEngine = v3IsX ? V3Pro : V3;
  const xName = v3IsX ? V3_NAME : PRO_NAME;
  const oName = v3IsX ? PRO_NAME : V3_NAME;

  const s = new V3Pro.State();
  const history = [];
  let sideToMove = X;
  let winner = 0;
  let termination = '';
  let errors = 0;
  let fallbacks = 0;
  let timeStops = 0;

  if (USE_PREMOVES) {
    for (const mv of opening.moves) {
      const cell = idxOf(mv[0], mv[1]);
      const p = mv[2];
      if (cell < 0 || cell >= LEN || s.board[cell] !== 0) continue;
      s.play(cell, p);
      sideToMove = p === X ? O : X;
      if (V3Pro.winningLineAt(s.board, cell, p)) {
        winner = p;
        termination = `Five in a row already inside the start position (${opening.name})`;
      }
    }
  }
  if (s.stoneCount % 2 !== 1) sideToMove = X;
  const startingSideToMove = sideToMove;

  const telemetry = {
    v3: { depth: [], nodes: [], elapsedMs: 0, moves: 0 },
    pro: { depth: [], nodes: [], elapsedMs: 0, moves: 0 }
  };

  let ply = 0;
  while (!winner && s.stoneCount < maxPlies) {
    const side = sideToMove;
    const curEngine = (side === X) ? xEngine : oEngine;
    const curName = (side === X) ? xName : oName;
    const curKey = ((side === X) === v3IsX) ? 'v3' : 'pro';

    const mv = pickMove(curEngine, s, side, timeMs, seed + ply);
    if (mv.error) errors++;
    if (mv.stoppedByTime) timeStops++;

    let chosen = mv.move;
    if (chosen < 0) {
      fallbacks++;
      chosen = -1;
      for (let i = 0; i < LEN; i++) {
        if (s.board[i] === 0) { chosen = i; break; }
      }
      if (chosen < 0 || s.board[chosen] !== 0) {
        termination = 'No legal moves remaining';
        break;
      }
    }

    s.play(chosen, side);
    telemetry[curKey].depth.push(mv.depth);
    telemetry[curKey].nodes.push(mv.nodes);
    telemetry[curKey].elapsedMs += mv.elapsedMs;
    telemetry[curKey].moves++;
    history.push({ ply: s.stoneCount, side: side === X ? 'X' : 'O', idx: chosen, coord: nm(chosen), engine: curName, depth: mv.depth, score: mv.score, kind: mv.kind });
    ply++;

    if (V3Pro.winningLineAt(s.board, chosen, side)) {
      winner = side;
      termination = `Five in a row by ${curName} at ${nm(chosen)}`;
      break;
    }
    if (s.isFull()) {
      termination = 'Board completely filled (draw)';
      break;
    }
    sideToMove = side === X ? O : X;
  }

  if (!termination) termination = `Ply cap reached (${maxPlies} plies)`;

  const outcome = winner === 0 ? 'draw' : (((winner === X) === v3IsX) ? 'v3-win' : 'pro-win');
  const score = outcome === 'v3-win' ? 1 : (outcome === 'pro-win' ? 0 : 0.5);

  const sum = k => ({
    avgDepth: telemetry[k].depth.length ? avg(telemetry[k].depth) : 0,
    maxDepth: telemetry[k].depth.length ? Math.max.apply(null, telemetry[k].depth) : 0,
    totalNodes: telemetry[k].nodes.reduce((a, b) => a + b, 0),
    avgNodes: telemetry[k].nodes.length ? avg(telemetry[k].nodes) : 0,
    totalEngineMs: telemetry[k].elapsedMs,
    moves: telemetry[k].moves
  });

  return {
    xEngine: xName,
    oEngine: oName,
    v3Color: v3IsX ? 'X' : 'O',
    opening: opening.name,
    openingCategory: opening.category,
    startingSide: startingSideToMove === X ? 'X' : 'O',
    winnerSide: winner === X ? 'X' : (winner === O ? 'O' : 'Draw'),
    winnerEngine: winner === 0 ? null : (((winner === X) === v3IsX) ? V3_NAME : PRO_NAME),
    outcome: outcome,
    score: score,
    terminationReason: termination,
    gameLength: history.length,
    searchedPlies: ply,
    fallbackMoves: fallbacks,
    engineErrors: errors,
    timeLimitStops: timeStops,
    finalMove: history.length ? history[history.length - 1] : null,
    v3: sum('v3'),
    pro: sum('pro'),
    history: history
  };
}

/* ---------- Aggregation ---------- */
function summarizeGames(games) {
  const n = games.length;
  const v3Wins = games.filter(g => g.outcome === 'v3-win').length;
  const proWins = games.filter(g => g.outcome === 'pro-win').length;
  const draws = games.filter(g => g.outcome === 'draw').length;
  const xWins = games.filter(g => g.winnerSide === 'X').length;
  const oWins = games.filter(g => g.winnerSide === 'O').length;

  const score = games.reduce((s, g) => s + g.score, 0);
  const scoreRate = n ? score / n : 0;
  const scoreCi = wilsonInterval(Math.round(score), n);

  const v3AsX = games.filter(g => g.v3Color === 'X');
  const v3AsO = games.filter(g => g.v3Color === 'O');
  const split = {
    v3AsX: { games: v3AsX.length, wins: v3AsX.filter(g => g.outcome === 'v3-win').length, draws: v3AsX.filter(g => g.outcome === 'draw').length, losses: v3AsX.filter(g => g.outcome === 'pro-win').length },
    v3AsO: { games: v3AsO.length, wins: v3AsO.filter(g => g.outcome === 'v3-win').length, draws: v3AsO.filter(g => g.outcome === 'draw').length, losses: v3AsO.filter(g => g.outcome === 'pro-win').length }
  };

  const lengths = games.map(g => g.gameLength);
  const plyOf = k => games.filter(g => g.outcome === k).map(g => g.gameLength);
  const maxOf = arr => (arr.length ? Math.max.apply(null, arr) : 0);

  return {
    games: n,
    wdl: {
      v3Wins: v3Wins,
      proWins: proWins,
      draws: draws,
      v3WinRate: n ? v3Wins / n : 0,
      proWinRate: n ? proWins / n : 0,
      drawRate: n ? draws / n : 0
    },
    confidenceIntervals95: {
      v3WinRate: wilsonInterval(v3Wins, n),
      drawRate: wilsonInterval(draws, n),
      proWinRate: wilsonInterval(proWins, n),
      v3ScoreRate: scoreCi
    },
    scoreBasedElo: {
      v3: ELO_INITIAL / 2 + eloFromScore(scoreRate) / 2,
      pro: ELO_INITIAL / 2 - eloFromScore(scoreRate) / 2,
      diff: eloFromScore(scoreRate),
      diffCi95: { low: eloFromScore(scoreCi.low), high: eloFromScore(scoreCi.high) }
    },
    binomialTest: binomialTestTwoSided(v3Wins, proWins),
    colorBalance: {
      firstMoveXWins: xWins,
      secondMoveOWins: oWins,
      firstMoveWinRate: n ? xWins / n : 0,
      firstMoveWinRate95: wilsonInterval(xWins, n),
      v3ScoreAsX: v3AsX.length ? avg(v3AsX.map(g => g.score)) : null,
      v3ScoreAsO: v3AsO.length ? avg(v3AsO.map(g => g.score)) : null,
      split: split
    },
    gameLength: {
      mean: avg(lengths),
      stdDev: stdDev(lengths, true),
      min: lengths.length ? Math.min.apply(null, lengths) : 0,
      max: maxOf(lengths),
      meanV3Win: avg(plyOf('v3-win')),
      meanProWin: avg(plyOf('pro-win')),
      meanDraw: avg(plyOf('draw'))
    },
    telemetry: {
      v3: {
        avgDepth: n ? avg(games.map(g => g.v3.avgDepth)) : 0,
        maxDepth: maxOf(games.map(g => g.v3.maxDepth)),
        totalNodes: games.reduce((s, g) => s + g.v3.totalNodes, 0),
        totalEngineMs: games.reduce((s, g) => s + g.v3.totalEngineMs, 0)
      },
      pro: {
        avgDepth: n ? avg(games.map(g => g.pro.avgDepth)) : 0,
        maxDepth: maxOf(games.map(g => g.pro.maxDepth)),
        totalNodes: games.reduce((s, g) => s + g.pro.totalNodes, 0),
        totalEngineMs: games.reduce((s, g) => s + g.pro.totalEngineMs, 0)
      }
    },
    reliability: {
      engineErrors: games.reduce((s, g) => s + g.engineErrors, 0),
      fallbackMoves: games.reduce((s, g) => s + g.fallbackMoves, 0),
      plyCapped: games.filter(g => g.terminationReason.indexOf('Ply cap') === 0).length,
      timeLimitStops: games.reduce((s, g) => s + g.timeLimitStops, 0)
    }
  };
}

/* ---------- Console helpers ---------- */
const WIDTH = 78;
const rule = ch => ch.repeat(WIDTH);
const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };
const padL = (s, n) => { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
const num = (v, d) => Number.isFinite(v) ? v.toFixed(d === undefined ? 2 : d) : 'n/a';
const sgn = (v, d) => Number.isFinite(v) ? ((v > 0 ? '+' : '') + v.toFixed(d === undefined ? 2 : d)) : 'n/a';
const pct = v => (100 * v).toFixed(1) + '%';
const fmtP = p => (!Number.isFinite(p) ? 'n/a' : (p < 1e-4 ? '<0.0001' : p.toFixed(4)));

/* ---------- Main ---------- */
const estimatedMinutes = (TIME_CONTROLS.reduce((s, t) => s + t, 0) * GAMES * ESTIMATED_PLIES) / 60000;

console.log(rule('='));
console.log('   XO5 Forge V3 vs V3 PRO — Enhanced Self-Play Match Series');
console.log(rule('='));
console.log(` Games per control: ${GAMES}`);
console.log(` Time controls:      ${TIME_CONTROLS.join(', ')} ms / move`);
console.log(` Total games:        ${GAMES * TIME_CONTROLS.length}`);
console.log(` Engine level:       Level ${LEVEL}`);
console.log(` Start positions:    ${START_POSITIONS.length} "${CATEGORY}" positions (${USE_PREMOVES ? 'pre-moves applied' : 'empty board'})`);
console.log(` ELO:                initial ${ELO_INITIAL}, K=${ELO_K}`);
console.log(` Base seed:          ${BASE_SEED}`);
console.log(` Move selection:    ${MOVEPICK === 'analyse' ? 'analyse (noise-free, seeded)' : 'chooseMove (real play path, level noise)'}`);
console.log(` Rough wall time:    ~${estimatedMinutes.toFixed(1)} min (at ~${ESTIMATED_PLIES} plies per game)`);
console.log(rule('-'));

const jsonlFile = path.join(__dirname, 'benchmark_selfplay_v3_vs_v3pro.jsonl');
const jsonFile = path.join(__dirname, 'benchmark_selfplay_v3_vs_v3pro.json');
const jsonlStream = fs.createWriteStream(jsonlFile, { flags: 'w' });

const overallLadder = new EloLadder(ELO_INITIAL, ELO_K);
const allGames = [];
const perControl = [];
const runStarted = Date.now();

TIME_CONTROLS.forEach((timeMs, tcIndex) => {
  const ladder = new EloLadder(ELO_INITIAL, ELO_K);
  const games = [];
  const controlStarted = Date.now();

  console.log(`\n${rule('-')}`);
  console.log(`   TIME CONTROL ${timeMs} ms / move  (games 1-${GAMES})`);
  console.log(rule('-'));

  for (let g = 1; g <= GAMES; g++) {
    const v3IsX = (g % 2 === 1);
    const opening = START_POSITIONS[(g - 1) % START_POSITIONS.length];
    const seed = BASE_SEED + tcIndex * 1000000 + g * 10000;

    const t0 = Date.now();
    const result = playGame({ opening: opening, timeMs: timeMs, v3IsX: v3IsX, seed: seed, maxPlies: MAX_PLIES });
    result.gameNumber = g;
    result.timeControlMs = timeMs;
    result.wallMs = Date.now() - t0;

    const elo = ladder.update(result.score);
    overallLadder.update(result.score);
    result.elo = {
      expectedScore: elo.expected,
      before: elo.before,
      after: { v3: elo.eloV3, pro: elo.eloPro },
      diff: elo.eloDiff
    };

    games.push(result);
    allGames.push(result);

    const verdict = result.outcome === 'draw' ? 'Draw' : (result.outcome === 'v3-win' ? V3_NAME + ' wins' : PRO_NAME + ' wins');
    jsonlStream.write(JSON.stringify(Object.assign({
      timestamp: new Date().toISOString(),
      timeControlMs: timeMs,
      gameNumber: g,
      globalGameNumber: (tcIndex * GAMES) + g,
      level: LEVEL,
      seed: seed
    }, result)) + '\n');

    const running = summarizeGames(games);
    console.log(
      `  g${padL(g, 3)}  [${result.v3Color}] ${pad(result.opening.replace(/^Opening \d+: /, ''), 22)} ` +
      `${pad(verdict, 24)} ${padL(result.gameLength, 3)}p  ` +
      `ELO ${padL(sgn(elo.eloDiff, 1), 6)}  (${running.wdl.v3Wins}W ${running.wdl.draws}D ${running.wdl.proWins}L)`
    );
  }

  const summary = summarizeGames(games);
  summary.timeControlMs = timeMs;
  summary.elo = ladder.snapshot();
  summary.eloProgression = ladder.history;
  summary.wallMs = Date.now() - controlStarted;
  summary.gameList = games;
  perControl.push(summary);
});

jsonlStream.end();

const overallSummary = summarizeGames(allGames);
overallSummary.elo = overallLadder.snapshot();
overallSummary.eloProgression = overallLadder.history;
overallSummary.wallMs = Date.now() - runStarted;

function printSummary(label, s, withProgression) {
  console.log('\n' + rule('='));
  console.log(`   ${label}`);
  console.log(rule('='));
  const w = s.wdl;
  console.log(`  ${pad(V3_NAME, 24)}${padL(w.v3Wins, 4)} W ${padL(w.draws, 4)} D ${padL(w.proWins, 4)} L   / ${s.games} games`);
  console.log(`  ${pad(PRO_NAME, 24)}${padL(w.proWins, 4)} W ${padL(w.draws, 4)} D ${padL(w.v3Wins, 4)} L`);
  console.log('  ' + rule('-').slice(3));
  const ci = s.confidenceIntervals95;
  console.log('  Rates with 95% Wilson intervals:');
  console.log(`    V3 win   ${padL(pct(w.v3WinRate), 7)}  [${padL(pct(ci.v3WinRate.low), 7)}, ${padL(pct(ci.v3WinRate.high), 7)}]`);
  console.log(`    Draw     ${padL(pct(w.drawRate), 7)}  [${padL(pct(ci.drawRate.low), 7)}, ${padL(pct(ci.drawRate.high), 7)}]`);
  console.log(`    V3 PRO   ${padL(pct(w.proWinRate), 7)}  [${padL(pct(ci.proWinRate.low), 7)}, ${padL(pct(ci.proWinRate.high), 7)}]`);
  const bt = s.binomialTest;
  console.log(`  Binomial test (wins vs losses, H0 p=0.5): ${bt.decisive} decisive games, ` +
    `p = ${fmtP(bt.pValue)} ${significanceLabel(bt.pValue)} — ${significanceVerdict(bt.pValue)}`);
  console.log(`  ELO (start ${s.elo.initial}, K=${s.elo.kFactor}): ${V3_NAME} ${num(s.elo.v3, 1)}  vs  ${PRO_NAME} ${num(s.elo.pro, 1)}`);
  console.log(`    diff (V3 - V3 PRO): ${sgn(s.elo.diff, 1)}  95% CI [${num(s.elo.ci95.low, 1)}, ${num(s.elo.ci95.high, 1)}]  SE ${num(s.elo.se, 1)}  ${s.elo.significant ? 'excludes 0' : 'includes 0'}`);
  console.log(`    score-based cross-check: diff ${sgn(s.scoreBasedElo.diff, 1)}  95% CI [${num(s.scoreBasedElo.diffCi95.low, 1)}, ${num(s.scoreBasedElo.diffCi95.high, 1)}]`);
  console.log(`  First-move (X) wins: ${s.colorBalance.firstMoveXWins}/${s.games} (${pct(s.colorBalance.firstMoveWinRate)}); ` +
    `V3 score as X ${num(s.colorBalance.v3ScoreAsX, 3)} vs as O ${num(s.colorBalance.v3ScoreAsO, 3)}`);
  console.log(`  Game length: mean ${num(s.gameLength.mean, 1)} (${s.gameLength.min}-${s.gameLength.max}); ` +
    `V3 win ${num(s.gameLength.meanV3Win, 1)}, PRO win ${num(s.gameLength.meanProWin, 1)}, draw ${num(s.gameLength.meanDraw, 1)}`);
  console.log(`  Avg depth: V3 ${num(s.telemetry.v3.avgDepth, 2)} vs PRO ${num(s.telemetry.pro.avgDepth, 2)}; ` +
    `total nodes ${(s.telemetry.v3.totalNodes / 1e6).toFixed(2)}M vs ${(s.telemetry.pro.totalNodes / 1e6).toFixed(2)}M`);
  console.log(`  Engine errors: ${s.reliability.engineErrors}   fallback moves: ${s.reliability.fallbackMoves}   ` +
    `time-limit stops: ${s.reliability.timeLimitStops}   ply-capped games: ${s.reliability.plyCapped}`);
  console.log(`  Wall time: ${(s.wallMs / 1000).toFixed(1)} s`);
  if (withProgression && s.eloProgression) {
    console.log('  ELO progression:');
    const step = Math.max(1, Math.ceil(s.eloProgression.length / 12));
    for (let i = 0; i < s.eloProgression.length; i += step) {
      const h = s.eloProgression[i];
      console.log(`    ${padL('#' + h.game, 5)}  V3 ${padL(num(h.eloV3, 1), 8)}  PRO ${padL(num(h.eloPro, 1), 8)}  diff ${padL(sgn(h.eloDiff, 1), 7)}`);
    }
    const last = s.eloProgression[s.eloProgression.length - 1];
    if (last && (s.eloProgression.length - 1) % step !== 0) {
      console.log(`    ${padL('#' + last.game, 5)}  V3 ${padL(num(last.eloV3, 1), 8)}  PRO ${padL(num(last.eloPro, 1), 8)}  diff ${padL(sgn(last.eloDiff, 1), 7)}`);
    }
  }
  console.log(rule('='));
}

perControl.forEach(s => printSummary(`TIME CONTROL ${s.timeControlMs} ms / move`, s, true));
printSummary('OVERALL (all time controls, single ELO ladder)', overallSummary, true);

console.log('\n' + rule('='));
console.log('   CROSS-TIME-CONTROL COMPARISON');
console.log(rule('='));
console.log(` ${pad('time (ms)', 9)}${padL('V3 W', 6)}${padL('D', 5)}${padL('PRO L', 7)}${padL('V3 rate', 10)}${padL('ELO diff', 11)}${padL('95% CI', 20)}${padL('p', 9)} verdict`);
console.log(' ' + rule('-').slice(1));
for (const s of perControl) {
  console.log(` ${pad(s.timeControlMs, 9)}${padL(s.wdl.v3Wins, 6)}${padL(s.wdl.draws, 5)}${padL(s.wdl.proWins, 7)}` +
    `${padL(pct(s.wdl.v3WinRate), 10)}${padL(sgn(s.elo.diff, 1), 11)}` +
    `${padL(`[${num(s.elo.ci95.low, 0)}, ${num(s.elo.ci95.high, 0)}]`, 20)}` +
    `${padL(fmtP(s.binomialTest.pValue), 9)} ${significanceVerdict(s.binomialTest.pValue)}`);
}
console.log('  ' + rule('-').slice(3));
console.log('  Note: Gomoku self-play under equal conditions strongly favours the first mover (X).');
console.log('  Colors are alternated for parity; ELO is updated after every game with K=32.');
console.log(rule('=') + '\n');

/* ---------- File output ---------- */
function serialiseGame(g) {
  const copy = Object.assign({}, g);
  delete copy.history;
  copy.moves = g.history;
  return copy;
}

const report = {
  timestamp: new Date().toISOString(),
  configuration: {
    gamesPerTimeControl: GAMES,
    timeControls: TIME_CONTROLS,
    totalGames: allGames.length,
    level: LEVEL,
    seed: BASE_SEED,
    plyCap: MAX_PLIES,
    startCategory: CATEGORY,
    startPositions: START_POSITIONS.map(p => p.name),
    preMovesApplied: USE_PREMOVES,
    moveSelection: MOVEPICK,
    engineNames: { v3: V3_NAME, pro: PRO_NAME },
    elo: { initial: ELO_INITIAL, kFactor: ELO_K }
  },
  methods: {
    moveGeneration: MOVEPICK === 'analyse'
      ? 'engine.analyse(state, side, {maxDepth, width, rootWidth, timeMs, vcf, vct, seed}) — noise-free, seeded, exact time control'
      : 'engine.chooseMove(state, side, level, timeMs) — real play path including level noise and the PRO tactical verification pass',
    colorAssignment: 'alternating per game (odd games: V3 = X, even games: V3 PRO = X)',
    winRateInterval: 'Wilson score interval, 95%',
    significance: 'exact two-sided binomial test on decisive games, H0: win probability = 0.5',
    eloUpdate: 'D += K * (S - 1/(1 + 10^(-D/400))), S = 1 win / 0.5 draw / 0 loss',
    eloInterval: 'delta-method propagation of Var(D) with Var(S) = 0.25, 95% normal interval'
  },
  overall: overallSummary,
  perTimeControl: perControl.map(s => {
    const copy = Object.assign({}, s);
    delete copy.gameList;
    return copy;
  }),
  summary: {
    v3Wins: overallSummary.wdl.v3Wins,
    v3ProWins: overallSummary.wdl.proWins,
    draws: overallSummary.wdl.draws
  },
  games: allGames.map(serialiseGame),
  notes: [
    'Experimental self-play measurement; not a definitive ranking.',
    'Time-based searches are only approximately reproducible: the wall-clock cut-off is a hard limit, so identical seeds can still diverge slightly on a loaded machine.',
    'Games[] is the single source of truth for per-game detail; every record carries timeControlMs, and perTimeControl[] holds the per-time-control aggregates.',
    "MOVEPICK=choose (default) includes each engine's level noise and the PRO tactical verification pass, so the match reflects real play; MOVEPICK=analyse is noise-free and seeded but skips the PRO tactical verification."
  ]
};

fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));
console.log(`JSONL written: ${path.basename(jsonlFile)} (${allGames.length} games)`);
console.log(`Report written: ${path.basename(jsonFile)}`);
