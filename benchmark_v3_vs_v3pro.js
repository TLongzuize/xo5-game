/* benchmark_v3_vs_v3pro.js — Extended Engineering Benchmark: XO5 Forge V3 vs V3 PRO
   Comprehensive, deterministic benchmark suite across every dataset category.
   Identical conditions, statistical percentiles, zero-node tactical analysis,
   tactical accuracy against ground truth, engine move agreement, ELO-style
   performance ratings, depth-vs-time scaling curves, paired significance
   testing, plus JSON / JSONL / curve output files.

   Usage:
     node benchmark_v3_vs_v3pro.js
     TIME_MS=500 node benchmark_v3_vs_v3pro.js
     MODE=deep node benchmark_v3_vs_v3pro.js
     TIME_MS=1000 MODE=deep node benchmark_v3_vs_v3pro.js
     DEPTH_TIME_SAMPLES=0 node benchmark_v3_vs_v3pro.js   (skip the curve sweep)

   Optional environment variables:
     TIME_MS=<ms>               per-position time control (default 500, deep mode 1200)
     MODE=deep                  longer default time control
     DEPTH_TIME_SAMPLES=<n>     positions sampled for depth-vs-time curves (default 20, 0 disables)
     DEPTH_TIME_BUDGETS=a,b,c   time budgets in ms for the curves (default 100,250,500,1000,2000)

   Outputs:
     benchmark_v3_vs_v3pro.json       full report
     benchmark_v3_vs_v3pro.jsonl      one JSON object per position
     benchmark_v3_vs_v3pro_curves.json depth-vs-time curve data
*/
'use strict';

const fs = require('fs');
const path = require('path');

// Load engines into global scope
Function(fs.readFileSync(path.join(__dirname, 'engine3.js'), 'utf8'))();
Function(fs.readFileSync(path.join(__dirname, 'engine3pro.js'), 'utf8'))();

const V3 = global.XOEngine;
const V3Pro = global.XOEnginePro;

if (!V3) throw new Error('XOEngine (V3) not found');
if (!V3Pro) throw new Error('XOEnginePro (V3 PRO) not found');

const SIZE = 15;
const idx = (x, y) => y * SIZE + x;
const nm = i => (i == null || i < 0) ? 'none' : 'ABCDEFGHIJKLMNO'[i % SIZE] + (SIZE - Math.floor(i / SIZE));

/* ---------- Benchmark Configuration (Sections 1 & 2) ---------- */
const SEED = 12345;
const IS_DEEP = process.env.MODE === 'deep';
const DEFAULT_TIME = IS_DEEP ? 1200 : 500;
const TIME_LIMIT_MS = parseInt(process.env.TIME_MS, 10) || DEFAULT_TIME;

const DEPTH_TIME_BUDGETS = (process.env.DEPTH_TIME_BUDGETS || '100,250,500,1000,2000')
  .split(',')
  .map(s => parseInt(s, 10))
  .filter(n => Number.isFinite(n) && n > 0);
let DEPTH_TIME_SAMPLES = parseInt(process.env.DEPTH_TIME_SAMPLES, 10);
if (!Number.isFinite(DEPTH_TIME_SAMPLES) || DEPTH_TIME_SAMPLES < 0) DEPTH_TIME_SAMPLES = 20;

/* ---------- Load Benchmark Suite ---------- */
const positionsFile = path.join(__dirname, 'benchmark_positions.json');
if (!fs.existsSync(positionsFile)) {
  throw new Error('benchmark_positions.json not found. Run generator first.');
}
const BENCHMARK_SUITE = JSON.parse(fs.readFileSync(positionsFile, 'utf8'));
const POSITION_COUNT = BENCHMARK_SUITE.length;

/* ---------- Category Counts (Part 1.1) ---------- */
const categoryCounts = {};
for (const p of BENCHMARK_SUITE) {
  categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
}

/* ---------- Math Helpers (Part 3 & 4) ---------- */
function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p95(arr) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[index];
}

function maxVal(arr) {
  if (!arr.length) return 0;
  return Math.max(...arr);
}

function stdDev(arr, sample) {
  if (!arr || arr.length < 2) return 0;
  const m = avg(arr);
  const ss = arr.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(ss / (sample ? arr.length - 1 : arr.length));
}

/* ---------- Statistics: Student-t, P-values, Confidence Intervals ---------- */
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function betaContinuedFraction(a, b, x) {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function regularizedIncompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? front * betaContinuedFraction(a, b, x) / a
    : 1 - Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + b * Math.log(1 - x) + a * Math.log(x)) * betaContinuedFraction(b, a, 1 - x) / b;
}

function studentTCdf(t, df) {
  if (!(df > 0)) return NaN;
  const x = df / (df + t * t);
  const ib = regularizedIncompleteBeta(df / 2, 0.5, x);
  return t > 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

function twoTailedPValue(t, df) {
  if (!Number.isFinite(t) || !(df > 0)) return NaN;
  return Math.max(0, Math.min(1, 2 * (1 - studentTCdf(Math.abs(t), df))));
}

const T_CRIT_95 = [
  [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [6, 2.447],
  [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228], [12, 2.179], [15, 2.131],
  [20, 2.086], [25, 2.060], [30, 2.042], [40, 2.021], [60, 2.000], [120, 1.980]
];

function tCritical95(df) {
  if (!(df > 0)) return NaN;
  if (df >= 120) return 1.96;
  for (let i = 0; i < T_CRIT_95.length; i++) {
    if (df <= T_CRIT_95[i][0]) {
      if (i === 0) return T_CRIT_95[0][1];
      const [d0, v0] = T_CRIT_95[i - 1];
      const [d1, v1] = T_CRIT_95[i];
      return v0 + (v1 - v0) * ((df - d0) / (d1 - d0));
    }
  }
  return 1.96;
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

/* Paired t-test: differences are computed per position (sampleA[i] - sampleB[i]). */
function pairedTTest(sampleA, sampleB) {
  const n = Math.min((sampleA || []).length, (sampleB || []).length);
  if (n < 2) return null;
  const diffs = [];
  for (let i = 0; i < n; i++) diffs.push((sampleA[i] || 0) - (sampleB[i] || 0));
  const meanDiff = avg(diffs);
  const sdDiff = stdDev(diffs, true);
  const stdErr = sdDiff / Math.sqrt(n);
  const df = n - 1;
  const tStatistic = stdErr > 0 ? meanDiff / stdErr : (meanDiff === 0 ? 0 : Infinity);
  const pValue = twoTailedPValue(tStatistic, df);
  const tCrit = tCritical95(df);
  return {
    n: n,
    meanDiff: meanDiff,
    sdDiff: sdDiff,
    stdErr: stdErr,
    tStatistic: tStatistic,
    df: df,
    pValue: pValue,
    tCritical: tCrit,
    ci95Low: meanDiff - tCrit * stdErr,
    ci95High: meanDiff + tCrit * stdErr,
    cohensD: sdDiff > 0 ? meanDiff / sdDiff : 0,
    significant: Number.isFinite(pValue) && pValue < 0.05,
    significance: significanceLabel(pValue)
  };
}

/* Wilson score interval for a proportion (robust for rates near 0 or 1). */
function wilsonInterval(successes, total, z) {
  const n = total || 0;
  if (n <= 0) return { point: 0, low: 0, high: 0, n: 0, method: 'wilson' };
  const zc = z || 1.959964;
  const p = successes / n;
  const denom = 1 + zc * zc / n;
  const centre = p + zc * zc / (2 * n);
  const margin = zc * Math.sqrt((p * (1 - p) + zc * zc / (4 * n)) / n);
  return {
    point: p,
    low: Math.max(0, (centre - margin) / denom),
    high: Math.min(1, (centre + margin) / denom),
    margin: margin / denom,
    successes: successes,
    n: n,
    method: 'wilson'
  };
}

/* Linear fit of log10(depth) against log10(timeBudget): scaling exponent. */
function logLogSlope(xs, ys) {
  const pts = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (xs[i] > 0 && ys[i] > 0) pts.push([Math.log10(xs[i]), Math.log10(ys[i])]);
  }
  if (pts.length < 2) return null;
  const mx = avg(pts.map(p => p[0]));
  const my = avg(pts.map(p => p[1]));
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p[0] - mx) * (p[1] - my);
    den += (p[0] - mx) * (p[0] - mx);
  }
  return den === 0 ? null : num / den;
}

/* ---------- ELO-Style Performance Rating Configuration ---------- */
const ELO_BASE = 1500;
const ELO_WEIGHTS = {
  tacticalAccuracy: 0.30, // hit rate on positions carrying verified ground truth
  moveAgreement: 0.25,    // agreement with the reference (ground-truth) move
  nodeEfficiency: 0.20,   // depth reached per 1,000 nodes searched
  timeEfficiency: 0.15,   // depth reached per millisecond
  vcfVctSolveRate: 0.10   // forced-win (VCF / VCT) solver coverage
};
const ELO_WEIGHT_TOTAL = Object.keys(ELO_WEIGHTS)
  .reduce((sum, key) => sum + ELO_WEIGHTS[key], 0);
if (Math.abs(ELO_WEIGHT_TOTAL - 1) > 1e-9) {
  throw new Error(`ELO weights must sum to 1 (got ${ELO_WEIGHT_TOTAL})`);
}

/* ---------- Run Single Engine on a Position (Part 2) ---------- */
function runBenchmark(Eng, pos, timeMs, seed) {
  const s = new Eng.State();
  for (const [x, y, p] of pos.moves) s.play(idx(x, y), p);

  const t0 = Date.now();
  let r;
  let errorMsg = null;
  try {
    r = Eng.analyse(s, pos.side, { timeMs: timeMs, vcf: true, vct: true, seed: seed });
  } catch (err) {
    errorMsg = err.message;
    r = { depth: 0, nodes: 0, score: 0, best: null, pv: [], kind: 'error', error: err.message, candidates: [] };
  }
  const elapsed = Math.max(Date.now() - t0, 1);

  // Tactical Ground Truth Evaluation (Part 6)
  let tacticalCorrect = false;
  let isTacticalPosition = false;

  if (pos.isImmediateWin && pos.expectedMoves) {
    isTacticalPosition = true;
    tacticalCorrect = r.best != null && pos.expectedMoves.includes(r.best);
  } else if (pos.isImmediateBlock && pos.expectedMoves) {
    isTacticalPosition = true;
    tacticalCorrect = r.best != null && pos.expectedMoves.includes(r.best);
  } else if (pos.expectedMoves && pos.expectedMoves.length) {
    isTacticalPosition = true;
    tacticalCorrect = r.best != null && pos.expectedMoves.includes(r.best);
  } else if (pos.vcf) {
    isTacticalPosition = true;
    tacticalCorrect = r.kind === 'vcf' || r.kind === 'win' || (r.mateIn != null && r.score > 0);
  } else if (pos.vct) {
    isTacticalPosition = true;
    tacticalCorrect = r.kind === 'vcf' || r.kind === 'win' || (r.mateIn != null && r.score > 0) || (r.best != null && r.score >= 500);
  }

  const vcfSolved = (pos.vcf || pos.vct) ? (r.kind === 'vcf' || r.kind === 'win' || (r.mateIn != null && r.score > 0)) : null;

  // Zero-Node Tactical Classification (Part 4)
  const isEarlyTactical = (r.kind === 'win' || r.kind === 'vcf' || (r.nodes === 0 && r.best != null));

  // Candidate moves
  const candidateIndices = (r.candidates || []).map(c => c.idx);

  return {
    timeMs: elapsed,
    depth: r.depth || 0,
    nodes: r.nodes || 0,
    nps: Math.round(((r.nodes || 0) / elapsed) * 1000),
    best: r.best,
    bestCoord: nm(r.best),
    score: r.score || 0,
    pvLength: (r.pv && r.pv.length) || (r.best != null ? 1 : 0),
    pv: (r.pv || []).map(nm),
    candidatesCount: candidateIndices.length,
    topCandidates: candidateIndices.slice(0, 3),
    tacticalCorrect: tacticalCorrect,
    isTacticalPosition: isTacticalPosition,
    vcfSolved: vcfSolved,
    timeout: elapsed >= timeMs + 400 || !!r.stoppedByTime,
    error: errorMsg,
    completed: !errorMsg && !(elapsed >= timeMs + 400),
    ttHits: r.ttHits || 0,
    ttProbes: r.ttProbes || 0,
    ttCutoffs: r.ttCutoffs || 0,
    ttStores: r.ttStores || 0,
    ttReplacements: r.ttReplacements || 0,
    pvsSearches: r.pvsSearches || 0,
    pvsResearches: r.pvsResearches || 0,
    aspirationSearches: r.aspirationSearches || 0,
    aspirationFails: r.aspirationFails || 0,
    historyUsage: r.historyUsage || 0,
    counterMoveUsage: r.counterMoveUsage || 0,
    tacticalProbes: r.tacticalProbes || 0,
    key2Checks: r.key2Checks || 0,
    key2Collisions: r.key2Collisions || 0,
    kind: r.kind || 'search',
    isEarlyTactical: isEarlyTactical
  };
}
function eloFromExpectedScore(p) {
  const pc = Math.min(0.999, Math.max(0.001, p));
  return ELO_BASE - 400 * Math.log10(1 / pc - 1);
}

/* ---------- Rating Component Extraction (ELO-style) ---------- */
/* Per-position rating inputs for a V3 / V3-PRO pair:
     - tactical accuracy against verified ground truth
     - move agreement with the reference move
     - node efficiency  (depth per 1,000 nodes)
     - time efficiency  (depth per millisecond)
     - VCF / VCT solve rate
   The two efficiency components are absolute raw quantities, so they are scaled
   against the better of the pair on that position: the pair always sums to 1 and
   a component advantage therefore translates directly into rating points. */
function buildRatingEntry(pos, a, b) {
  const expected = (Array.isArray(pos.expectedMoves) && pos.expectedMoves.length) ? pos.expectedMoves : null;
  const exactMatch = a.best != null && a.best === b.best;

  let referenceBest = null;
  let referenceSource = 'none';
  if (expected) {
    referenceBest = expected[0];
    referenceSource = 'ground-truth';
  } else if (exactMatch) {
    referenceBest = a.best;
    referenceSource = 'consensus';
  }

  const isTactical = !!(a.isTacticalPosition || b.isTacticalPosition);

  // 1. Tactical accuracy (ground truth available on this position)
  const tacticalPoints = { v3: 0.5, pro: 0.5 };
  if (isTactical) {
    tacticalPoints.v3 = a.tacticalCorrect ? 1 : 0;
    tacticalPoints.pro = b.tacticalCorrect ? 1 : 0;
  }

  // 2. Move agreement with the reference move
  const moveAgreementPoints = { v3: 0.5, pro: 0.5 };
  if (referenceSource === 'ground-truth') {
    moveAgreementPoints.v3 = expected.includes(a.best) ? 1 : 0;
    moveAgreementPoints.pro = expected.includes(b.best) ? 1 : 0;
  } else if (referenceSource === 'consensus') {
    moveAgreementPoints.v3 = 1;
    moveAgreementPoints.pro = 1;
  }

  // 3. Node efficiency: depth reached per 1,000 nodes searched
  const depthPer1kNodes = r => (r.nodes > 0 ? (r.depth / r.nodes) * 1000 : 0);
  const rawNodeEfficiency = { v3: depthPer1kNodes(a), pro: depthPer1kNodes(b) };
  const nodeScale = Math.max(rawNodeEfficiency.v3, rawNodeEfficiency.pro);
  const nodeEfficiency = nodeScale > 0
    ? { v3: rawNodeEfficiency.v3 / nodeScale, pro: rawNodeEfficiency.pro / nodeScale }
    : { v3: 0.5, pro: 0.5 };

  // 4. Time efficiency: depth reached per millisecond
  const depthPerMs = r => (r.timeMs > 0 ? r.depth / r.timeMs : 0);
  const rawTimeEfficiency = { v3: depthPerMs(a), pro: depthPerMs(b) };
  const timeScale = Math.max(rawTimeEfficiency.v3, rawTimeEfficiency.pro);
  const timeEfficiency = timeScale > 0
    ? { v3: rawTimeEfficiency.v3 / timeScale, pro: rawTimeEfficiency.pro / timeScale }
    : { v3: 0.5, pro: 0.5 };

  // 5. VCF / VCT solve rate
  const isForcing = !!(pos.vcf || pos.vct);
  const vcfVctSolveRate = { v3: 0.5, pro: 0.5 };
  if (isForcing) {
    vcfVctSolveRate.v3 = a.vcfSolved ? 1 : 0;
    vcfVctSolveRate.pro = b.vcfSolved ? 1 : 0;
  }

  // Head-to-head result for this position
  let outcome = 'draw';
  if (isTactical && a.tacticalCorrect !== b.tacticalCorrect) {
    outcome = a.tacticalCorrect ? 'v3-win' : 'pro-win';
  } else if (a.score !== b.score) {
    outcome = a.score > b.score ? 'v3-win' : 'pro-win';
  } else if (a.depth !== b.depth) {
    outcome = a.depth > b.depth ? 'v3-win' : 'pro-win';
  }
  const outcomePoints = outcome === 'draw' ? { v3: 0.5, pro: 0.5 }
    : outcome === 'v3-win' ? { v3: 1, pro: 0 } : { v3: 0, pro: 1 };

  return {
    position: pos.name,
    category: pos.category,
    tacticalAccuracy: tacticalPoints,
    moveAgreement: moveAgreementPoints,
    nodeEfficiency: nodeEfficiency,
    timeEfficiency: timeEfficiency,
    vcfVctSolveRate: vcfVctSolveRate,
    raw: {
      depthPer1kNodes: rawNodeEfficiency,
      depthPerMs: rawTimeEfficiency
    },
    isTactical: isTactical,
    isForcing: isForcing,
    outcome: outcome,
    outcomePoints: outcomePoints,
    referenceBest: referenceBest,
    referenceSource: referenceSource
  };
}

/* Aggregates a list of rating entries into ELO-style ratings (zero-sum around 1500). */
function computeRating(entries, label) {
  const n = entries.length;
  const meanOf = (key, side) => n ? avg(entries.map(e => e[key][side])) : 0;
  const pair = key => ({ v3: meanOf(key, 'v3'), pro: meanOf(key, 'pro') });

  const components = {
    tacticalAccuracy: pair('tacticalAccuracy'),
    moveAgreement: pair('moveAgreement'),
    nodeEfficiency: pair('nodeEfficiency'),
    timeEfficiency: pair('timeEfficiency'),
    vcfVctSolveRate: pair('vcfVctSolveRate')
  };

  const composite = {
    v3: entries.reduce((s, e) => s + ELO_WEIGHTS.tacticalAccuracy * e.tacticalAccuracy.v3 + ELO_WEIGHTS.moveAgreement * e.moveAgreement.v3 + ELO_WEIGHTS.nodeEfficiency * e.nodeEfficiency.v3 + ELO_WEIGHTS.timeEfficiency * e.timeEfficiency.v3 + ELO_WEIGHTS.vcfVctSolveRate * e.vcfVctSolveRate.v3, 0) / (n || 1),
    pro: entries.reduce((s, e) => s + ELO_WEIGHTS.tacticalAccuracy * e.tacticalAccuracy.pro + ELO_WEIGHTS.moveAgreement * e.moveAgreement.pro + ELO_WEIGHTS.nodeEfficiency * e.nodeEfficiency.pro + ELO_WEIGHTS.timeEfficiency * e.timeEfficiency.pro + ELO_WEIGHTS.vcfVctSolveRate * e.vcfVctSolveRate.pro, 0) / (n || 1)
  };

  const expectedScore = Math.min(0.999, Math.max(0.001, 0.5 + (composite.v3 - composite.pro) / 2));
  const expectedScorePro = 1 - expectedScore;

  const h2hExpected = n ? avg(entries.map(e => e.outcomePoints.v3)) : 0.5;
  const h2hExpectedClamped = Math.min(0.999, Math.max(0.001, h2hExpected));

  const wins = entries.filter(e => e.outcome === 'v3-win').length;
  const losses = entries.filter(e => e.outcome === 'pro-win').length;
  const draws = n - wins - losses;

  const rawMeans = n ? {
    depthPer1kNodes: {
      v3: avg(entries.map(e => e.raw.depthPer1kNodes.v3)),
      pro: avg(entries.map(e => e.raw.depthPer1kNodes.pro))
    },
    depthPerMs: {
      v3: avg(entries.map(e => e.raw.depthPerMs.v3)),
      pro: avg(entries.map(e => e.raw.depthPerMs.pro))
    }
  } : null;

  return {
    label: label || 'full-suite',
    positions: n,
    weights: ELO_WEIGHTS,
    components: components,
    compositeScore: composite,
    rawMeans: rawMeans,
    expectedScore: { v3: expectedScore, pro: expectedScorePro },
    rating: {
      v3: eloFromExpectedScore(expectedScore),
      pro: eloFromExpectedScore(expectedScorePro)
    },
    ratingDiff: eloFromExpectedScore(expectedScore) - eloFromExpectedScore(expectedScorePro),
    headToHead: {
      wins: wins,
      draws: draws,
      losses: losses,
      expectedScore: h2hExpectedClamped,
      elo: {
        v3: eloFromExpectedScore(h2hExpectedClamped),
        pro: eloFromExpectedScore(1 - h2hExpectedClamped)
      },
      eloDiff: eloFromExpectedScore(1 - h2hExpectedClamped) - eloFromExpectedScore(h2hExpectedClamped)
    }
  };
}

/* ---------- Depth-vs-Time Curve Sampling ---------- */
/* Picks `count` representative positions by cycling category buckets, so the
   curve sample stays spread across Opening / Midgame / Tactical / VCF / Endgame ...
   instead of being dominated by whichever category is largest. */
function selectCurvePositions(count) {
  if (!(count > 0)) return [];
  const byCategory = new Map();
  for (const p of BENCHMARK_SUITE) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(p);
  }
  const buckets = Array.from(byCategory.values());
  const picked = [];
  for (let round = 0; picked.length < count; round++) {
    let progressed = false;
    for (const bucket of buckets) {
      if (picked.length >= count) break;
      if (round < bucket.length) {
        picked.push(bucket[round]);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return picked;
}

/* Runs both engines over one position at every requested time control. */
function runDepthTimeCurve(pos, budgets, seed) {
  const points = [];
  for (const budget of budgets) {
    const v3 = runBenchmark(V3, pos, budget, seed);
    const pro = runBenchmark(V3Pro, pos, budget, seed + 1);
    points.push({
      timeMs: budget,
      v3: { depth: v3.depth, nodes: v3.nodes, elapsedMs: v3.timeMs, nps: v3.nps, best: v3.bestCoord },
      pro: { depth: pro.depth, nodes: pro.nodes, elapsedMs: pro.timeMs, nps: pro.nps, best: pro.bestCoord }
    });
  }
  return {
    position: pos.name,
    category: pos.category,
    side: pos.side,
    moveCount: pos.moves.length,
    points: points
  };
}

/* Aggregates the raw curves into per-time-control depth statistics + a
   log10(depth) ~ log10(time) scaling exponent for each engine. */
function summarizeCurves(curves, budgets) {
  const byBudget = [];
  const v3Depths = [];
  const proDepths = [];
  const v3Nodes = [];
  const proNodes = [];

  for (const budget of budgets) {
    const v3d = curves.map(c => (c.points.find(p => p.timeMs === budget) || {}).v3).filter(Boolean);
    const prod = curves.map(c => (c.points.find(p => p.timeMs === budget) || {}).pro).filter(Boolean);
    if (!v3d.length || !prod.length) {
      byBudget.push({ timeMs: budget, v3: null, pro: null });
      continue;
    }
    for (const r of v3d) v3Depths.push(r.depth);
    for (const r of prod) proDepths.push(r.depth);
    for (const r of v3d) v3Nodes.push(r.nodes);
    for (const r of prod) proNodes.push(r.nodes);
    byBudget.push({
      timeMs: budget,
      v3: {
        depth: { mean: avg(v3d.map(r => r.depth)), median: median(v3d.map(r => r.depth)), max: maxVal(v3d.map(r => r.depth)) },
        nodes: { mean: avg(v3d.map(r => r.nodes)), median: median(v3d.map(r => r.nodes)) },
        nps: avg(v3d.map(r => r.nps))
      },
      pro: {
        depth: { mean: avg(prod.map(r => r.depth)), median: median(prod.map(r => r.depth)), max: maxVal(prod.map(r => r.depth)) },
        nodes: { mean: avg(prod.map(r => r.nodes)), median: median(prod.map(r => r.nodes)) },
        nps: avg(prod.map(r => r.nps))
      }
    });
  }

  const growth = { v3: [], pro: [] };
  if (budgets.length >= 2) {
    const lo = budgets[0];
    const hi = budgets[budgets.length - 1];
    for (const c of curves) {
      const a = c.points.find(p => p.timeMs === lo);
      const b = c.points.find(p => p.timeMs === hi);
      if (!a || !b) continue;
      growth.v3.push(b.v3.depth - a.v3.depth);
      growth.pro.push(b.pro.depth - a.pro.depth);
    }
  }

  return {
    budgets: budgets.slice(),
    positions: curves.length,
    byBudget: byBudget,
    scaling: {
      method: 'ols of log10(depth) on log10(timeMs)',
      v3Slope: logLogSlope(budgets, budgets.map((b, i) => (byBudget[i].v3 ? byBudget[i].v3.depth.mean : 0))),
      proSlope: logLogSlope(budgets, budgets.map((b, i) => (byBudget[i].pro ? byBudget[i].pro.depth.mean : 0)))
    },
    totals: {
      v3DepthSum: v3Depths.reduce((s, v) => s + v, 0),
      proDepthSum: proNodes.length ? proDepths.reduce((s, v) => s + v, 0) : 0,
      v3NodesSum: v3Nodes.reduce((s, v) => s + v, 0),
      proNodesSum: proNodes.reduce((s, v) => s + v, 0)
    },
    depthGrowth: {
      fromMs: budgets[0],
      toMs: budgets[budgets.length - 1],
      v3Mean: growth.v3.length ? avg(growth.v3) : 0,
      proMean: growth.pro.length ? avg(growth.pro) : 0,
      paired: growth.v3.length >= 2 ? pairedTTest(growth.pro, growth.v3) : null
    }
  };
}

/* ---------- Paired Significance Reporting ---------- */
/* paired comparison PRO - V3: mean difference with a 95% CI and Cohen's d. */
function significanceRow(label, proValues, v3Values) {
  const test = pairedTTest(proValues, v3Values);
  if (!test) return { metric: label, n: Math.min(proValues.length, v3Values.length), test: null };
  return {
    metric: label,
    n: test.n,
    test: test,
    v3Mean: avg(v3Values.slice(0, test.n)),
    proMean: avg(proValues.slice(0, test.n)),
    meanDiff: test.meanDiff,
    sdDiff: test.sdDiff,
    stdErr: test.stdErr,
    ci95: { low: test.ci95Low, high: test.ci95High, tCritical: test.tCritical },
    tStatistic: test.tStatistic,
    df: test.df,
    pValue: test.pValue,
    cohensD: test.cohensD,
    effectSize: effectSizeLabel(test.cohensD),
    significant: test.significant,
    significance: test.significance,
    verdict: significanceVerdict(test.pValue)
  };
}

function effectSizeLabel(d) {
  const a = Math.abs(d);
  if (!Number.isFinite(a)) return 'undefined';
  if (a < 0.2) return 'negligible';
  if (a < 0.5) return 'small';
  if (a < 0.8) return 'medium';
  if (a < 1.3) return 'large';
  return 'very large';
}

/* ---------- Aggregate Metric Extraction ---------- */
function entryComposite(entry, side) {
  let total = 0;
  for (const key of Object.keys(ELO_WEIGHTS)) total += ELO_WEIGHTS[key] * entry[key][side];
  return total;
}

function metricSeries(rows, engine) {
  return rows.map(r => r[engine]);
}

function accuracyStats(rows, engine) {
  const tactical = rows.filter(r => r[engine].isTacticalPosition);
  const correct = tactical.filter(r => r[engine].tacticalCorrect).length;
  const forcing = rows.filter(r => r[engine].vcfSolved !== null);
  const solved = forcing.filter(r => r[engine].vcfSolved).length;
  return {
    tactical: { correct: correct, total: tactical.length, rate: tactical.length ? correct / tactical.length : 0,
      wilson95: wilsonInterval(correct, tactical.length) },
    forcing: { solved: solved, total: forcing.length, rate: forcing.length ? solved / forcing.length : 0,
      wilson95: wilsonInterval(solved, forcing.length) }
  };
}

function agreementStats(rows) {
  const both = rows.filter(r => r.v3.best != null && r.pro.best != null);
  const identical = both.filter(r => r.v3.best === r.pro.best);
  const shared = both.map(r => ({ r, a: r.v3.best, b: r.pro.best }));
  let inTop3 = 0;
  for (const { r } of shared) {
    const a3 = (r.v3.topCandidates || []).includes(r.pro.best);
    const b3 = (r.pro.topCandidates || []).includes(r.v3.best);
    if (a3 || b3) inTop3++;
  }
  return {
    comparable: both.length,
    identicalMove: { count: identical.length, rate: both.length ? identical.length / both.length : 0,
      wilson95: wilsonInterval(identical.length, both.length) },
    top3Overlap: { count: inTop3, rate: both.length ? inTop3 / both.length : 0,
      wilson95: wilsonInterval(inTop3, both.length) }
  };
}

/* ---------- JSONL Output ---------- */
function toJsonlRecord(i, pos, v3, pro, rating) {
  return {
    index: i,
    category: pos.category,
    name: pos.name,
    side: pos.side,
    moveCount: pos.moves.length,
    tactical: !!(pos.tactical || pos.vcf || pos.vct || pos.isImmediateWin || pos.isImmediateBlock),
    isImmediateWin: !!pos.isImmediateWin,
    isImmediateBlock: !!pos.isImmediateBlock,
    vcf: !!pos.vcf,
    vct: !!pos.vct,
    expectedMoves: pos.expectedMoves || null,
    timeControlMs: TIME_LIMIT_MS,
    mode: IS_DEEP ? 'deep' : 'standard',
    v3: v3,
    pro: pro,
    rating: rating ? {
      tacticalAccuracy: rating.tacticalAccuracy,
      moveAgreement: rating.moveAgreement,
      nodeEfficiency: rating.nodeEfficiency,
      timeEfficiency: rating.timeEfficiency,
      vcfVctSolveRate: rating.vcfVctSolveRate,
      raw: rating.raw,
      outcome: rating.outcome,
      referenceSource: rating.referenceSource
    } : null
  };
}

function writeJsonl(file, records) {
  const body = records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  fs.writeFileSync(file, body);
  return body.length;
}

/* ---------- Console Formatting Helpers ---------- */
const line = (ch) => ch.repeat(76);
function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padLeft(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}
function num(v, d) {
  return Number.isFinite(v) ? v.toFixed(d === undefined ? 2 : d) : 'n/a';
}
function sig(v, d) {
  if (!Number.isFinite(v)) return 'n/a';
  return (v > 0 ? '+' : '') + v.toFixed(d === undefined ? 2 : d);
}

/* ---------- Main ---------- */
console.log(line('='));
console.log('   XO5 Forge V3 vs V3 PRO — Extended Engineering Benchmark');
console.log(line('='));
console.log(` Positions:        ${POSITION_COUNT} (from benchmark_positions.json)`);
console.log(` Categories:       ${Object.keys(categoryCounts).length}`);
console.log(` Time control:     ${TIME_LIMIT_MS} ms / position`);
console.log(` Mode:             ${IS_DEEP ? 'deep' : 'standard'}`);
console.log(` Deterministic:    seed ${SEED}`);
console.log(` Curve budgets:    ${DEPTH_TIME_BUDGETS.join(', ')} ms`);
console.log(` Curve positions:  ${DEPTH_TIME_SAMPLES}`);
console.log(line('-'));

const jsonlRecords = [];
const pairedRows = [];
const ratingEntries = [];
const categoryRows = Object.keys(categoryCounts).map(c => ({ category: c, rows: [], entries: [] }));
const categoryIndex = new Map(categoryRows.map(r => [r.category, r]));

const started = Date.now();
for (let i = 0; i < BENCHMARK_SUITE.length; i++) {
  const pos = BENCHMARK_SUITE[i];
  const v3 = runBenchmark(V3, pos, TIME_LIMIT_MS, SEED);
  const pro = runBenchmark(V3Pro, pos, TIME_LIMIT_MS, SEED + 1);
  const entry = buildRatingEntry(pos, v3, pro);

  pairedRows.push({ v3: v3, pro: pro });
  ratingEntries.push(entry);
  const crow = categoryIndex.get(pos.category);
  if (crow) {
    crow.rows.push({ v3: v3, pro: pro });
    crow.entries.push(entry);
  }
  jsonlRecords.push(toJsonlRecord(i + 1, pos, v3, pro, entry));

  if ((i + 1) % 10 === 0 || i + 1 === BENCHMARK_SUITE.length) {
    const pct = (((i + 1) / BENCHMARK_SUITE.length) * 100).toFixed(0);
    process.stdout.write(`   [${padLeft(pct, 3)}%] ${i + 1}/${BENCHMARK_SUITE.length} positions — ${pos.category}\r`);
  }
}
process.stdout.write('\n');
const suiteElapsed = Date.now() - started;

const v3Rows = pairedRows.map(r => r.v3);
const proRows = pairedRows.map(r => r.pro);

const v3Acc = accuracyStats(pairedRows, 'v3');
const proAcc = accuracyStats(pairedRows, 'pro');
const agreement = agreementStats(pairedRows);
const overallRating = computeRating(ratingEntries, 'full-suite');
const categoryRatings = categoryRows
  .filter(r => r.entries.length)
  .map(r => Object.assign(computeRating(r.entries, r.category), { category: r.category, positions: r.entries.length }));

const significance = [
  significanceRow('depth', metricSeries(proRows, 'depth'), metricSeries(v3Rows, 'depth')),
  significanceRow('nodes', metricSeries(proRows, 'nodes'), metricSeries(v3Rows, 'nodes')),
  significanceRow('nps', metricSeries(proRows, 'nps'), metricSeries(v3Rows, 'nps')),
  significanceRow('score (side-to-move)', metricSeries(proRows, 'score'), metricSeries(v3Rows, 'score')),
  significanceRow('candidate moves', metricSeries(proRows, 'candidatesCount'), metricSeries(v3Rows, 'candidatesCount')),
  significanceRow('pv length', metricSeries(proRows, 'pvLength'), metricSeries(v3Rows, 'pvLength')),
  significanceRow('tactical correct (0/1)', pairedRows.map(r => r.pro.tacticalCorrect ? 1 : 0), pairedRows.map(r => r.v3.tacticalCorrect ? 1 : 0)),
  significanceRow('move agreement (0/1)', ratingEntries.map(e => e.moveAgreement.pro), ratingEntries.map(e => e.moveAgreement.v3)),
  significanceRow('vcf/vct solved (0/1)', pairedRows.map(r => (r.pro.vcfSolved == null ? null : (r.pro.vcfSolved ? 1 : 0))), pairedRows.map(r => (r.v3.vcfSolved == null ? null : (r.v3.vcfSolved ? 1 : 0)))),
  significanceRow('elo composite', ratingEntries.map(e => entryComposite(e, 'pro')), ratingEntries.map(e => entryComposite(e, 'v3')))
];

/* ---------- Depth-vs-Time Sweep ---------- */
let curves = [];
let curveSummary = null;
if (DEPTH_TIME_SAMPLES > 0) {
  const curvePositions = selectCurvePositions(DEPTH_TIME_SAMPLES);
  console.log(`\n   Depth-vs-time sweep: ${curvePositions.length} positions x ${DEPTH_TIME_BUDGETS.length} time controls`);
  for (let i = 0; i < curvePositions.length; i++) {
    curves.push(runDepthTimeCurve(curvePositions[i], DEPTH_TIME_BUDGETS, SEED + 1000 * (i + 1)));
    const pct = (((i + 1) / curvePositions.length) * 100).toFixed(0);
    process.stdout.write(`   [${padLeft(pct, 3)}%] curve ${i + 1}/${curvePositions.length}\r`);
  }
  process.stdout.write('\n');
  curveSummary = summarizeCurves(curves, DEPTH_TIME_BUDGETS);
}

/* ---------- Reports ---------- */
console.log('\n' + line('='));
console.log(`   AGGREGATE METRICS  (${POSITION_COUNT} positions @ ${TIME_LIMIT_MS} ms)`);
console.log(line('='));
console.log(` ${pad('Metric', 26)}${padLeft('V3', 14)}${padLeft('V3 PRO', 14)}${padLeft('Diff', 14)}`);
console.log(' ' + line('-').slice(1));
const rowsOut = [
  ['Mean depth', avg(metricSeries(v3Rows, 'depth')), avg(metricSeries(proRows, 'depth'))],
  ['Median depth', median(metricSeries(v3Rows, 'depth')), median(metricSeries(proRows, 'depth'))],
  ['Max depth', maxVal(metricSeries(v3Rows, 'depth')), maxVal(metricSeries(proRows, 'depth'))],
  ['Mean nodes', avg(metricSeries(v3Rows, 'nodes')), avg(metricSeries(proRows, 'nodes'))],
  ['Mean nps', avg(metricSeries(v3Rows, 'nps')), avg(metricSeries(proRows, 'nps'))],
  ['Mean elapsed ms', avg(metricSeries(v3Rows, 'timeMs')), avg(metricSeries(proRows, 'timeMs'))],
  ['Mean score', avg(metricSeries(v3Rows, 'score')), avg(metricSeries(proRows, 'score'))],
  ['Tactical accuracy %', v3Acc.tactical.rate * 100, proAcc.tactical.rate * 100],
  ['VCF/VCT solve rate %', v3Acc.forcing.rate * 100, proAcc.forcing.rate * 100]
];
for (const [label, v3v, prov] of rowsOut) {
  console.log(` ${pad(label, 26)}${padLeft(num(v3v), 14)}${padLeft(num(prov), 14)}${padLeft(sig(prov - v3v), 14)}`);
}

console.log('\n' + line('='));
console.log('   ELO-STYLE PERFORMANCE RATING');
console.log(line('='));
console.log(` Weights: tactical ${ELO_WEIGHTS.tacticalAccuracy * 100}% | agreement ${ELO_WEIGHTS.moveAgreement * 100}% | nodes ${ELO_WEIGHTS.nodeEfficiency * 100}% | time ${ELO_WEIGHTS.timeEfficiency * 100}% | vcf/vct ${ELO_WEIGHTS.vcfVctSolveRate * 100}%`);
console.log(` ${pad('Component', 22)}${padLeft('V3', 12)}${padLeft('V3 PRO', 12)}`);
console.log(' ' + line('-').slice(1));
for (const key of Object.keys(ELO_WEIGHTS)) {
  const c = overallRating.components[key];
  console.log(` ${pad(key, 22)}${padLeft(num(c.v3, 4), 12)}${padLeft(num(c.pro, 4), 12)}`);
}
console.log(` ${pad('composite score', 22)}${padLeft(num(overallRating.compositeScore.v3, 4), 12)}${padLeft(num(overallRating.compositeScore.pro, 4), 12)}`);
console.log(` ${pad('rating (ELO)', 22)}${padLeft(num(overallRating.rating.v3, 1), 12)}${padLeft(num(overallRating.rating.pro, 1), 12)}`);
console.log(`   Rating difference: ${sig(overallRating.ratingDiff, 1)} points (V3 PRO - V3) in favour of ${overallRating.ratingDiff >= 0 ? 'V3' : 'V3 PRO'}`);
console.log(`   Raw node efficiency (depth/1k nodes): V3 ${num(overallRating.rawMeans.depthPer1kNodes.v3, 3)} vs PRO ${num(overallRating.rawMeans.depthPer1kNodes.pro, 3)}`);
console.log(`   Raw time efficiency (depth/ms):        V3 ${num(overallRating.rawMeans.depthPerMs.v3, 5)} vs PRO ${num(overallRating.rawMeans.depthPerMs.pro, 5)}`);
console.log(`   Head-to-head: V3 ${overallRating.headToHead.wins}W / ${overallRating.headToHead.draws}D / ${overallRating.headToHead.losses}L  (h2h ELO diff V3 PRO - V3: ${sig(overallRating.headToHead.eloDiff, 1)})`);

console.log('\n' + line('='));
console.log('   PAIRED COMPARISON (V3 PRO - V3), 95% CI + Cohen\'s d');
console.log(line('='));
console.log(` ${pad('Metric', 24)}${padLeft('n', 5)}${padLeft('mean diff', 12)}${padLeft('95% CI', 24)}${padLeft("Cohen's d", 18)}${padLeft('p', 9)} verdict`);
console.log(' ' + line('-').slice(1));
for (const s of significance) {
  if (!s.test) {
    console.log(` ${pad(s.metric, 24)}${padLeft(s.n, 5)}${pad('insufficient paired data', 45)}`);
    continue;
  }
  const ci = `[${sig(s.test.ci95Low)}, ${sig(s.test.ci95High)}]`;
  const p = Number.isFinite(s.test.pValue) ? (s.test.pValue < 1e-4 ? '<0.0001' : s.test.pValue.toFixed(4)) : 'n/a';
  console.log(` ${pad(s.metric, 24)}${padLeft(s.test.n, 5)}${padLeft(sig(s.test.meanDiff), 12)}${padLeft(ci, 24)}${padLeft(sig(s.test.cohensD) + ' ' + s.effectSize, 18)}${padLeft(p, 9)} ${s.test.significance} ${s.verdict}`);
}

if (curveSummary) {
  console.log('\n' + line('='));
  console.log(`   DEPTH-VS-TIME CURVES (${curveSummary.positions} positions)`);
  console.log(line('='));
  console.log(` ${pad('time (ms)', 12)}${padLeft('V3 depth', 12)}${padLeft('PRO depth', 12)}${padLeft('V3 nodes', 14)}${padLeft('PRO nodes', 14)}`);
  console.log(' ' + line('-').slice(1));
  for (const b of curveSummary.byBudget) {
    if (!b.v3 || !b.pro) continue;
    console.log(` ${pad(b.timeMs, 12)}${padLeft(num(b.v3.depth.mean), 12)}${padLeft(num(b.pro.depth.mean), 12)}${padLeft(Math.round(b.v3.nodes.mean), 14)}${padLeft(Math.round(b.pro.nodes.mean), 14)}`);
  }
  console.log(`   Scaling exponent d(log depth)/d(log time): V3 ${num(curveSummary.scaling.v3Slope, 3)} | PRO ${num(curveSummary.scaling.proSlope, 3)}`);
  if (curveSummary.depthGrowth.paired) {
    console.log(`   Mean depth growth ${curveSummary.depthGrowth.fromMs}->${curveSummary.depthGrowth.toMs} ms: V3 ${sig(curveSummary.depthGrowth.v3Mean)} | PRO ${sig(curveSummary.depthGrowth.proMean)}  (paired ${curveSummary.depthGrowth.paired.significance})`);
  }
}

console.log('\n' + line('='));
console.log('   CATEGORY BREAKDOWN');
console.log(line('='));
console.log(` ${pad('Category', 26)}${padLeft('n', 5)}${padLeft('V3 depth', 11)}${padLeft('PRO depth', 11)}${padLeft('V3 ELO', 10)}${padLeft('PRO ELO', 10)}`);
console.log(' ' + line('-').slice(1));
for (const cr of categoryRatings) {
  const rows = categoryIndex.get(cr.category).rows;
  console.log(` ${pad(cr.category, 26)}${padLeft(cr.positions, 5)}${padLeft(num(avg(rows.map(r => r.v3.depth))), 11)}${padLeft(num(avg(rows.map(r => r.pro.depth))), 11)}${padLeft(num(cr.rating.v3, 0), 10)}${padLeft(num(cr.rating.pro, 0), 10)}`);
}

console.log('\n' + line('='));
console.log('   RELIABILITY');
console.log(line('='));
console.log(` Errors:            V3 ${v3Rows.filter(r => r.error).length} | PRO ${proRows.filter(r => r.error).length}`);
console.log(` Time-limit stops:  V3 ${v3Rows.filter(r => r.timeout).length} | PRO ${proRows.filter(r => r.timeout).length}`);
console.log(` Zero-node searches V3 ${v3Rows.filter(r => r.isEarlyTactical).length} | PRO ${proRows.filter(r => r.isEarlyTactical).length}`);
console.log(` Identical best move: ${agreement.identicalMove.count}/${agreement.comparable} (${num(agreement.identicalMove.rate * 100, 1)}%)  top-3 overlap ${num(agreement.top3Overlap.rate * 100, 1)}%`);
console.log(` Suite wall time:   ${(suiteElapsed / 1000).toFixed(1)} s`);
console.log(line('=') + '\n');

/* ---------- File Output ---------- */
const outputFile = path.join(__dirname, 'benchmark_v3_vs_v3pro.json');
const jsonlFile = path.join(__dirname, 'benchmark_v3_vs_v3pro.jsonl');
const curvesFile = path.join(__dirname, 'benchmark_v3_vs_v3pro_curves.json');

const jsonlBytes = writeJsonl(jsonlFile, jsonlRecords);
console.log(`JSONL written: ${path.basename(jsonlFile)} (${jsonlRecords.length} records, ${(jsonlBytes / 1024).toFixed(1)} KB)`);

if (curveSummary) {
  fs.writeFileSync(curvesFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    budgets: DEPTH_TIME_BUDGETS,
    seed: SEED,
    summary: curveSummary,
    curves: curves
  }, null, 2));
  console.log(`Curves written: ${path.basename(curvesFile)} (${curves.length} positions x ${DEPTH_TIME_BUDGETS.length} budgets)`);
}

const report = {
  timestamp: new Date().toISOString(),
  configuration: {
    positions: POSITION_COUNT,
    categories: categoryCounts,
    timeMs: TIME_LIMIT_MS,
    mode: IS_DEEP ? 'deep' : 'standard',
    seed: SEED,
    depthTimeBudgets: DEPTH_TIME_BUDGETS,
    depthTimeSamples: DEPTH_TIME_SAMPLES
  },
  aggregateMetrics: {
    v3: {
      depth: { mean: avg(metricSeries(v3Rows, 'depth')), median: median(metricSeries(v3Rows, 'depth')), max: maxVal(metricSeries(v3Rows, 'depth')), p95: p95(metricSeries(v3Rows, 'depth')) },
      nodes: { mean: avg(metricSeries(v3Rows, 'nodes')), median: median(metricSeries(v3Rows, 'nodes')), total: metricSeries(v3Rows, 'nodes').reduce((s, v) => s + v, 0) },
      nps: { mean: avg(metricSeries(v3Rows, 'nps')), max: maxVal(metricSeries(v3Rows, 'nps')) },
      timeMs: { mean: avg(metricSeries(v3Rows, 'timeMs')), max: maxVal(metricSeries(v3Rows, 'timeMs')) },
      score: { mean: avg(metricSeries(v3Rows, 'score')) },
      tacticalAccuracy: v3Acc,
      zeroNodeSearches: v3Rows.filter(r => r.isEarlyTactical).length,
      errors: v3Rows.filter(r => r.error).length,
      stoppedByTimeLimit: v3Rows.filter(r => r.timeout).length
    },
    pro: {
      depth: { mean: avg(metricSeries(proRows, 'depth')), median: median(metricSeries(proRows, 'depth')), max: maxVal(metricSeries(proRows, 'depth')), p95: p95(metricSeries(proRows, 'depth')) },
      nodes: { mean: avg(metricSeries(proRows, 'nodes')), median: median(metricSeries(proRows, 'nodes')), total: metricSeries(proRows, 'nodes').reduce((s, v) => s + v, 0) },
      nps: { mean: avg(metricSeries(proRows, 'nps')), max: maxVal(metricSeries(proRows, 'nps')) },
      timeMs: { mean: avg(metricSeries(proRows, 'timeMs')), max: maxVal(metricSeries(proRows, 'timeMs')) },
      score: { mean: avg(metricSeries(proRows, 'score')) },
      tacticalAccuracy: proAcc,
      zeroNodeSearches: proRows.filter(r => r.isEarlyTactical).length,
      errors: proRows.filter(r => r.error).length,
      stoppedByTimeLimit: proRows.filter(r => r.timeout).length
    }
  },
  engineMoveAgreement: agreement,
  eloRating: overallRating,
  categoryRatings: categoryRatings,
  statisticalSignificance: significance,
  depthTimeCurves: curveSummary,
  jsonl: path.basename(jsonlFile),
  perPositionResults: jsonlRecords
};
fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
console.log(`Report written: ${path.basename(outputFile)}`);
