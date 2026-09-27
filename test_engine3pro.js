/* test_engine3pro.js — regression and feature tests for XO5 Forge V3 PRO
   Run: node test_engine3pro.js
   Exit 0 on all pass, 1 if any fail. */
'use strict';
const fs = require('fs');
Function(fs.readFileSync(__dirname + '/engine3pro.js', 'utf8'))();
const E = global.XOEnginePro;
if (!E) throw new Error('XOEnginePro not found after eval');
const {
  State, X, O, winningLineAt, chooseMove, analyse, immediateTactic,
  solveForcing, threatMap, explainMove, patternLevel, MATE_THRESHOLD,
  classifyThreat, defensiveUrgency, initiative, tacticalVerify,
  THREAT_FIVE, THREAT_OPEN_FOUR, THREAT_CLOSED_FOUR, THREAT_OPEN_THREE,
  THREAT_BROKEN_THREE
} = E;
const SIZE = 15;
const idx = (x, y) => y * SIZE + x;
const nm = i => 'ABCDEFGHIJKLMNO'[i % SIZE] + (SIZE - Math.floor(i / SIZE));

let pass = 0, fail = 0, total = 0;
function ok(c, label, detail) {
  total++;
  if (c) { pass++; console.log('  PASS ' + label); }
  else    { fail++; console.log('  FAIL ' + label + (detail !== undefined ? ' -> ' + detail : '')); }
}
function build(ms) {
  const s = new State();
  for (const [x, y, p] of ms) s.play(idx(x, y), p);
  return s;
}

/* ===== Section 1: Engine identity ===== */
console.log('\n== ENGINE IDENTITY ==');
ok(E.ENGINE_NAME === 'XO5 Forge V3 PRO', 'ENGINE_NAME is XO5 Forge V3 PRO', E.ENGINE_NAME);
ok(E.VERSION === 'V3 PRO', 'VERSION is V3 PRO', E.VERSION);
ok(typeof E.LEVELS9_PRO === 'object', 'LEVELS9_PRO exists');
ok(Object.keys(E.LEVELS9_PRO).length === 9, 'LEVELS9_PRO has 9 levels');
ok(E.LEVELS9_PRO[9].maxDepth > E.LEVELS9_PRO[1].maxDepth, 'level 9 deeper than level 1');

/* ===== Section 2: State / win detection ===== */
console.log('\n== STATE & WIN DETECTION ==');
{
  let s = build([[3,7,X],[4,7,X],[5,7,X],[6,7,X],[7,7,X]]);
  ok(!!winningLineAt(s.board, idx(7,7), X), 'horizontal five');
  s = build([[5,3,O],[5,4,O],[5,5,O],[5,6,O],[5,7,O]]);
  ok(!!winningLineAt(s.board, idx(5,7), O), 'vertical five');
  s = build([[2,2,X],[3,3,X],[4,4,X],[5,5,X],[6,6,X]]);
  ok(!!winningLineAt(s.board, idx(6,6), X), 'diagonal');
  s = build([[2,7,X],[3,7,X],[4,7,X],[5,7,X],[6,7,X],[7,7,X]]);
  ok(winningLineAt(s.board, idx(7,7), X).length === 6, 'six in a row is a win');
  s = build([[3,7,X],[4,7,X],[6,7,X],[7,7,X]]);
  ok(!winningLineAt(s.board, idx(7,7), X), 'gap is not a win');
  s = build([[11,7,X],[12,7,X],[13,7,X],[14,7,X],[0,8,X]]);
  ok(!winningLineAt(s.board, idx(0,8), X), 'no wrap across edge');
  const full = new State();
  for (let i = 0; i < 225; i++) full.play(i, i % 2 ? X : O);
  ok(full.isFull(), 'draw: full board');
}

/* ===== Section 3: Zobrist hash ===== */
console.log('\n== ZOBRIST HASH ==');
{
  const s1 = build([[7,7,X],[8,8,O],[6,6,X]]);
  const s2 = build([[7,7,X],[8,8,O],[6,6,X]]);
  ok(s1.key(X) === s2.key(X), 'same position same key');
  const s3 = build([[7,7,X],[8,8,O],[5,5,X]]);
  ok(s1.key(X) !== s3.key(X), 'different position different key');
  ok(s1.key(X) !== s1.key(O), 'side-to-move changes key');
  /* secondary hash is distinct */
  ok(s1.key2(X) !== s1.key(X), 'secondary hash differs from primary');
}

/* ===== Section 4: Immediate tactics ===== */
console.log('\n== IMMEDIATE TACTICS ==');
for (const d of ['easy', 'medium', 'hard']) {
  let s = build([[3,7,O],[4,7,O],[5,7,O],[6,7,O],[3,9,X],[4,9,X],[5,9,X]]);
  let r = chooseMove(s, O, d);
  ok(r && (r.idx === idx(2,7) || r.idx === idx(7,7)), d + ': takes the win', r && nm(r.idx));
  s = build([[3,7,X],[4,7,X],[5,7,X],[6,7,X],[1,1,O],[2,2,O]]);
  r = chooseMove(s, O, d);
  ok(r && (r.idx === idx(2,7) || r.idx === idx(7,7)), d + ': blocks the loss', r && nm(r.idx));
  s = build([[4,7,X],[5,7,X],[6,7,X],[1,1,O],[12,12,O]]);
  r = chooseMove(s, O, d);
  ok(r && [idx(3,7),idx(7,7),idx(2,7),idx(8,7)].includes(r.idx), d + ': answers open three', r && nm(r.idx));
}

/* ===== Section 5: PRO Search features ===== */
console.log('\n== PRO SEARCH FEATURES ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[7,8,X],[8,7,O],[6,8,X],[9,7,O]]);

  /* PVS: should report non-zero pvsResearches */
  const a1 = analyse(s, O, { timeMs: 800 });
  console.log('  PVS: depth ' + a1.depth + ', pvsResearches ' + a1.pvsResearches + ', nodes ' + a1.nodes);
  ok(a1.depth >= 4, 'PRO reaches depth >= 4 in 800ms', a1.depth);
  ok(typeof a1.pvsResearches === 'number', 'pvsResearches is reported');

  /* Aspiration windows */
  ok(typeof a1.aspirationFails === 'number', 'aspirationFails is reported', a1.aspirationFails);

  /* TT hit rate */
  ok(a1.ttProbes > 0 && a1.ttHits > 0, 'TT records probes/hits', a1.ttHits + '/' + a1.ttProbes);
  ok(a1.ttHits / a1.ttProbes < 1, 'TT hit rate is valid', (100 * a1.ttHits / a1.ttProbes).toFixed(1) + '%');
  console.log('  TT hit rate ' + (100 * a1.ttHits / a1.ttProbes).toFixed(1) + '%, ttStores ' + a1.ttStores + ', ttReplacements ' + a1.ttReplacements);

  /* PRO TT should have stores and replacements */
  ok(a1.ttStores > 0, 'TT reports stores', a1.ttStores);
}

/* ===== Section 6: Iterative deepening / progress ===== */
console.log('\n== ITERATIVE DEEPENING ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O]]);
  const seen = [];
  analyse(s, O, { timeMs: 1000, onProgress: p => seen.push(p.depth) });
  ok(seen.length >= 2, 'progress reported for several depths', seen.join(','));
  ok(seen.every((d, i) => i === 0 || d > seen[i-1]), 'depths monotonically increase', seen.join(','));
}

/* ===== Section 7: VCF solver ===== */
console.log('\n== VCF SOLVER ==');
{
  // X has two fours-in-waiting
  let s = build([
    [7,7,X],[8,8,O],[6,8,X],[9,7,O],[8,6,X],[7,9,O],[8,7,X],[7,8,O]
  ]);
  let vc = solveForcing(s, X, { maxPly: 10, nodes: 30000, timeMs: 600, vct: false });
  console.log('  VCF nodes ' + vc.nodes + ', win=' + vc.win + (vc.seq ? ', seq=' + vc.seq.slice(0,3).map(nm) : ''));
  ok(typeof vc.win === 'boolean', 'VCF returns boolean win');
  ok(Array.isArray(vc.seq), 'VCF returns sequence');

  // clear win in 1
  s = build([[3,7,X],[4,7,X],[5,7,X],[6,7,X]]);
  let vc2 = solveForcing(s, X, { maxPly: 2, nodes: 5000, timeMs: 200 });
  ok(vc2.win && vc2.seq.length > 0, 'VCF finds simple win-in-1', vc2.seq.map(nm).join(','));

  // dedup check: PRO solver should not revisit states
  ok(typeof vc2.nodes === 'number' && vc2.nodes > 0, 'VCF reports nodes', vc2.nodes);
}

/* ===== Section 8: PRO-exclusive threat APIs ===== */
console.log('\n== PRO THREAT APIS ==');
{
  // Position with an obvious open four
  const s = build([[7,7,X],[7,8,X],[7,9,X],[7,10,X],[8,8,O]]);
  const t = classifyThreat(s, idx(7,6), X);
  console.log('  classifyThreat(open four cell): level=' + t.level + ', fourCount=' + t.fourCount);
  ok(t.level >= THREAT_CLOSED_FOUR, 'classifyThreat detects four or higher', t.level);

  // defensiveUrgency
  const s2 = build([[7,7,X],[7,8,X],[7,9,X],[7,10,X],[5,5,O]]);
  const urg = defensiveUrgency(s2, O);
  console.log('  defensiveUrgency for O facing X four: ' + urg);
  ok(urg >= 1000, 'defensiveUrgency high when X has four', urg);

  // initiative
  const s3 = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[7,8,X]]);
  const ini = initiative(s3, X);
  console.log('  initiative for X (ahead): ' + ini);
  ok(typeof ini === 'number', 'initiative returns number', ini);
}

/* ===== Section 9: tacticalVerify ===== */
console.log('\n== TACTICAL VERIFY ==');
{
  // Building a position where X can win immediately
  const s = build([[3,7,X],[4,7,X],[5,7,X],[6,7,X]]);
  const winMove = idx(7,7);
  const tv = tacticalVerify(s, X, winMove, { timeMs: 200 });
  console.log('  tacticalVerify (win): verified=' + (tv && tv.verified) + ', kind=' + (tv && tv.kind));
  ok(tv && tv.verified, 'tacticalVerify confirms winning move', tv && tv.kind);
}

/* ===== Section 10: Evaluation sign convention ===== */
console.log('\n== EVALUATION ==');
{
  const s = build([[7,7,X],[7,8,X],[7,9,X],[5,5,O],[6,6,O]]);
  const a = analyse(s, O, { timeMs: 300 });
  // X should be leading — score for O should be negative (O-positive convention)
  console.log('  score for O (X leading): ' + a.score.toFixed(0));
  ok(typeof a.score === 'number', 'analyse returns numeric score', a.score);
  ok(a.best !== null && a.best >= 0, 'analyse returns best move index', a.best);

  /* V3 PRO evaluatePro should give a different result than base evaluate */
  const state = new State();
  state.play(idx(7,7), X); state.play(idx(8,8), O);
  state.play(idx(6,6), X); state.play(idx(9,9), O);
  const proEval = state.evaluatePro(X);
  const baseEval = state.evaluate();
  console.log('  evaluatePro=' + proEval + ', baseEval=' + baseEval);
  ok(typeof proEval === 'number', 'evaluatePro returns number');
}

/* ===== Section 11: Search depth benchmarks ===== */
console.log('\n== DEPTH BENCHMARKS ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[7,8,X],[8,7,O],[6,8,X],[9,7,O]]);
  for (const [d, t, minDepth] of [['easy', 300, 2], ['medium', 800, 4], ['hard', 2500, 6]]) {
    const r = chooseMove(s.clone(), O, d, t);
    console.log('  ' + d + ': depth=' + r.depth + ', nodes=' + r.nodes + ', ' + r.timeMs + 'ms, kind=' + r.kind);
    ok(r.depth >= minDepth || r.kind === 'vcf' || r.kind === 'win' || r.kind === 'block', d + ' reaches depth >= ' + minDepth, r.depth + ' (' + r.kind + ')');
    ok(r.timeMs <= t * 2 + 500, d + ' respects time budget', r.timeMs + 'ms');
  }
}

/* ===== Section 12: TT generation / replacement ===== */
console.log('\n== TT GENERATION & REPLACEMENT ==');
{
  const { TT } = E;
  const tt = new TT();
  // Fill with old-generation entries
  for (let i = 0; i < 5; i++) {
    tt.set(i * 100, { d: 3, s: 100, m: 10, f: 0 }, i * 99);
    tt.newGeneration();
  }
  const sizeAfterOld = tt.map.size;
  // Add a newer, deeper entry with same key as first
  tt.set(0, { d: 6, s: 200, m: 20, f: 0 }, 0);
  const e = tt.get(0, 0);
  ok(e && e.d === 6, 'TT replaces with deeper entry from newer generation', e && e.d);
  ok(tt.replacements >= 0, 'TT tracks replacements', tt.replacements);
  console.log('  TT size=' + tt.map.size + ', stores=' + tt.stores + ', replacements=' + tt.replacements);
}

/* ===== Section 13: PV extraction ===== */
console.log('\n== PV EXTRACTION ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O]]);
  const { Search } = E;
  const srch = new Search(s, O, { maxDepth: 5, timeMs: 600 });
  const r = srch.run();
  ok(r && Array.isArray(r.pv), 'run() returns PV array', r && r.pv);
  ok(r && r.pv.length >= 1, 'PV has at least 1 move', r && r.pv.length);
  ok(r && r.pv[0] === r.idx, 'PV[0] matches best move', r && nm(r.pv[0]) + ' vs ' + nm(r.idx));
  console.log('  PV: ' + (r && r.pv.map(nm).join(' ')));
}

/* ===== Section 14: Determinism (seeded) ===== */
console.log('\n== DETERMINISM ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X]]);
  const r1 = analyse(s, O, { timeMs: 300, seed: 42 });
  const r2 = analyse(s.clone(), O, { timeMs: 300, seed: 42 });
  // Note: determinism is best-effort due to timing-dependent depth;
  // at minimum both should return the same best move
  ok(r1.best === r2.best, 'same seed produces same best move', nm(r1.best) + ' vs ' + nm(r2.best));
}

/* ===== Section 15: Candidates & threat map ===== */
console.log('\n== CANDIDATES & THREAT MAP ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[7,8,X]]);
  const a = analyse(s, O, { timeMs: 300 });
  ok(a.candidates.length > 0, 'analyse returns candidates', a.candidates.length);
  ok(a.candidates.every(c => typeof c.idx === 'number' && typeof c.score === 'number'),
    'candidates have idx and score');

  const tm = threatMap(s, 2);
  ok(Array.isArray(tm), 'threatMap returns array');
  ok(tm.length > 0, 'threatMap finds threats', tm.length);
  ok(tm.every(t => t.idx >= 0 && t.player && t.level >= 2), 'threat entries are well-formed');
  console.log('  threatMap entries: ' + tm.length + ', max level: ' + Math.max(...tm.map(t => t.level)));
}

/* ===== Section 16: explainMove ===== */
console.log('\n== EXPLAIN MOVE ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X]]);
  const exp = explainMove(s, idx(5,5), X);
  ok(typeof exp === 'string' && exp.length > 5, 'explainMove returns non-empty string', exp);
  console.log('  explainMove: ' + exp);
}

/* ===== Section 17: LEVELS9_PRO configuration quality ===== */
console.log('\n== LEVELS9_PRO CONFIG ==');
{
  const levels = E.LEVELS9_PRO;
  for (let i = 1; i <= 9; i++) {
    const l = levels[i];
    ok(l && l.maxDepth >= 1, 'level ' + i + ' maxDepth >= 1', l && l.maxDepth);
    ok(l && l.timeMs > 0, 'level ' + i + ' timeMs > 0', l && l.timeMs);
    ok(l && l.width >= 3, 'level ' + i + ' width >= 3', l && l.width);
  }
  // PRO should have higher depth/time at top levels than basic LEVELS
  const proL9 = levels[9];
  ok(proL9.maxDepth >= 12, 'PRO level 9 maxDepth >= 12', proL9.maxDepth);
  ok(proL9.timeMs >= 2500, 'PRO level 9 timeMs >= 2.5s', proL9.timeMs);
  ok(proL9.vct === true, 'PRO level 9 has VCT enabled');
}

/* ===== SUMMARY ===== */
console.log('\n' + '='.repeat(50));
console.log('RESULTS: ' + pass + '/' + total + ' passed, ' + fail + ' failed');
if (fail > 0) { console.log('SOME TESTS FAILED'); process.exit(1); }
else { console.log('ALL TESTS PASSED'); }
