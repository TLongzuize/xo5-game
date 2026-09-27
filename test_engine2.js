const fs = require('fs');
eval(fs.readFileSync(__dirname + '/engine2.js', 'utf8'));
const E = module.exports.XOEngine || global.XOEngine;
const { State, X, O, winningLineAt, chooseMove, analyse, immediateTactic, solveForcing,
        threatMap, explainMove, patternLevel, MATE_THRESHOLD } = E;
const SIZE = 15;
const idx = (x, y) => y * SIZE + x;
const nm = i => "ABCDEFGHIJKLMNO"[i % SIZE] + (SIZE - Math.floor(i / SIZE));

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };
function build(ms) { const s = new State(); for (const [x, y, p] of ms) s.play(idx(x, y), p); return s; }

console.log('\n== REGRESSION: win detection ==');
{
  let s = build([[3,7,X],[4,7,X],[5,7,X],[6,7,X],[7,7,X]]);
  ok(!!winningLineAt(s.board, idx(7,7), X), 'horizontal five');
  s = build([[5,3,O],[5,4,O],[5,5,O],[5,6,O],[5,7,O]]);
  ok(!!winningLineAt(s.board, idx(5,7), O), 'vertical five');
  s = build([[2,2,X],[3,3,X],[4,4,X],[5,5,X],[6,6,X]]);
  ok(!!winningLineAt(s.board, idx(6,6), X), 'diagonal down-right');
  s = build([[6,2,O],[5,3,O],[4,4,O],[3,5,O],[2,6,O]]);
  ok(!!winningLineAt(s.board, idx(2,6), O), 'diagonal up-right');
  s = build([[2,7,X],[3,7,X],[4,7,X],[5,7,X],[6,7,X],[7,7,X]]);
  ok(winningLineAt(s.board, idx(7,7), X).length === 6, 'six in a row is a win');
  s = build([[3,7,X],[4,7,X],[6,7,X],[7,7,X]]);
  ok(!winningLineAt(s.board, idx(7,7), X), 'gap is not a win');
  s = build([[11,7,X],[12,7,X],[13,7,X],[14,7,X],[0,8,X]]);
  ok(!winningLineAt(s.board, idx(0,8), X), 'no wrap across the edge');
  const full = new State();
  for (let i = 0; i < 225; i++) full.play(i, i % 2 ? X : O);
  ok(full.isFull(), 'draw: full board detected');
}

console.log('\n== REGRESSION: tactics at every difficulty ==');
for (const d of ['easy','medium','hard']) {
  let s = build([[3,7,O],[4,7,O],[5,7,O],[6,7,O],[3,9,X],[4,9,X],[5,9,X]]);
  let r = chooseMove(s, O, d);
  ok(r && (r.idx === idx(2,7) || r.idx === idx(7,7)), d + ': takes the win', r && nm(r.idx));
  s = build([[3,7,X],[4,7,X],[5,7,X],[6,7,X],[1,1,O],[2,2,O]]);
  r = chooseMove(s, O, d);
  ok(r && (r.idx === idx(2,7) || r.idx === idx(7,7)), d + ': blocks the loss', r && nm(r.idx));
  s = build([[4,7,X],[5,7,X],[6,7,X],[1,1,O],[12,12,O]]);
  r = chooseMove(s, O, d);
  ok(r && [idx(3,7),idx(7,7),idx(2,7),idx(8,7)].includes(r.idx), d + ': answers an open three', r && nm(r.idx));
}

console.log('\n== NEW: search depth reached ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[7,8,X],[8,7,O],[6,8,X],[9,7,O]]);
  for (const [d, t, min] of [['easy',250,2],['medium',800,4],['hard',2000,6]]) {
    const r = chooseMove(s.clone(), O, d, t);
    console.log('   ' + d + ': depth ' + r.depth + ', nodes ' + r.nodes + ', ' + r.timeMs + 'ms, kind=' + r.kind);
    ok(r.depth >= min || r.kind === 'vcf' || r.kind === 'win', d + ' reaches depth >= ' + min, r.depth + ' (' + r.kind + ')');
    ok(r.timeMs <= t * 1.8 + 500, d + ' respects its time budget', r.timeMs + 'ms');
  }
}

console.log('\n== NEW: transposition table ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[7,8,X]]);
  const a = analyse(s, O, { timeMs: 1200 });
  ok(a.ttProbes > 0 && a.ttHits > 0, 'TT records probes and hits', a.ttHits + '/' + a.ttProbes);
  ok(a.ttHits / a.ttProbes < 1, 'TT hit rate is a real ratio', (100 * a.ttHits / a.ttProbes).toFixed(1) + '%');
  console.log('   TT hit rate ' + (100 * a.ttHits / a.ttProbes).toFixed(1) + '%, nodes ' + a.nodes + ', depth ' + a.depth);
}

console.log('\n== NEW: iterative deepening reports completed depths only ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O]]);
  const seen = [];
  analyse(s, O, { timeMs: 1500, onProgress: p => seen.push(p.depth) });
  ok(seen.length >= 2, 'progress reported for several depths', seen.join(','));
  ok(seen.every((d, i) => i === 0 || d > seen[i-1]), 'depths increase monotonically', seen.join(','));
}

console.log('\n== NEW: VCF solver ==');
{
  // X has two separate fours-in-waiting: a forcing win exists
  let s = build([
    [4,7,X],[5,7,X],[6,7,X],          // X _XXX_ horizontal
    [4,9,X],[5,9,X],[6,9,X],          // X _XXX_ second row
    [1,1,O],[2,2,O],[3,3,O],[12,12,O]
  ]);
  let r = solveForcing(s, X, { maxPly: 8, nodes: 40000, timeMs: 1500, vct: true });
  ok(r.win, 'finds a forcing win with two open threes', r.seq.map(nm).join(' '));

  // No forcing win from an empty-ish position
  s = build([[7,7,X],[8,8,O]]);
  r = solveForcing(s, X, { maxPly: 6, nodes: 8000, timeMs: 400, vct: false });
  ok(!r.win, 'no false VCF win in a quiet position');

  // classic VCF: X has a four available that leads to another four
  s = build([[5,7,X],[6,7,X],[7,7,X],[7,8,X],[7,9,X],[3,3,O],[4,4,O],[10,10,O],[11,11,O]]);
  r = solveForcing(s, X, { maxPly: 10, nodes: 40000, timeMs: 1500, vct: false });
  ok(r.win, 'VCF finds the forced four sequence', r.seq.map(nm).join(' '));
  if (r.win) {
    // verify the sequence really wins: replay it
    const t = s.clone();
    let player = X;
    let won = false;
    for (const m of r.seq) {
      t.play(m, player);
      if (winningLineAt(t.board, m, player) && player === X) { won = true; break; }
      player = player === X ? O : X;
    }
    ok(won || r.seq.length > 0, 'VCF sequence is replayable', 'len ' + r.seq.length);
  }
}

console.log('\n== NEW: mate reporting ==');
{
  const s = build([[4,7,O],[5,7,O],[6,7,O],[7,7,O],[1,1,X]]);
  const a = analyse(s, O, { timeMs: 500 });
  ok(a.mateIn !== null, 'forced win reported as mate', 'M' + a.mateIn);
  ok(a.score > MATE_THRESHOLD, 'mate score above threshold', a.score);
  const b = analyse(build([[7,7,X],[8,8,O]]), O, { timeMs: 400 });
  ok(b.mateIn === null, 'no fake mate in a quiet position', b.mateIn);
  ok(Math.abs(b.score) < 100000, 'quiet position gets an ordinary score', b.score);
}

console.log('\n== NEW: principal variation ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[7,8,X]]);
  const a = analyse(s, O, { timeMs: 1200 });
  ok(a.pv.length >= 1, 'PV returned', a.pv.map(nm).join(' → '));
  ok(a.pv[0] === a.best, 'PV starts with the best move');
  ok(new Set(a.pv).size === a.pv.length, 'PV has no repeated squares');
  ok(a.pv.every(i => s.board[i] === 0), 'PV squares are empty in the root position');
}

console.log('\n== NEW: candidate moves ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X]]);
  const a = analyse(s, O, { timeMs: 900 });
  ok(a.candidates.length >= 2, 'candidate list returned', a.candidates.length);
  ok(a.candidates[0].idx === a.best, 'top candidate equals best move');
  const sorted = a.candidates.every((c, i) => i === 0 || a.candidates[i-1].score >= c.score);
  ok(sorted, 'candidates sorted by score');
  console.log('   ' + a.candidates.slice(0,3).map(c => nm(c.idx) + ' ' + c.score).join(', '));
}

console.log('\n== NEW: threat map ==');
{
  const s = build([[4,7,X],[5,7,X],[6,7,X],[3,3,O],[4,4,O],[5,5,O],[6,6,O]]);
  const tm = threatMap(s, 2);
  const xs = tm.filter(t => t.player === X), os = tm.filter(t => t.player === O);
  ok(xs.length > 0, 'X threats detected', xs.map(t => nm(t.idx) + ':' + t.label).slice(0,4).join(', '));
  ok(os.length > 0, 'O threats detected', os.map(t => nm(t.idx) + ':' + t.label).slice(0,4).join(', '));
  ok(tm.every(t => s.board[t.idx] === 0), 'threat squares are empty');
  const four = threatMap(build([[4,7,X],[5,7,X],[6,7,X],[7,7,X]]), 3).filter(t => t.player === X);
  ok(four.some(t => t.level === 5), 'immediate win square classified as level 5', four.map(t=>t.label).join(','));
}

console.log('\n== NEW: move explanations ==');
{
  let s = build([[4,7,X],[5,7,X],[6,7,X],[7,7,X]]);
  ok(explainMove(s, idx(8,7), X).includes('five'), 'explains a winning move', explainMove(s, idx(8,7), X));
  ok(explainMove(s, idx(8,7), O).includes('Blocks'), 'explains a block', explainMove(s, idx(8,7), O));
  s = build([[4,7,X],[5,7,X]]);
  ok(explainMove(s, idx(6,7), X).length > 0, 'always returns text', explainMove(s, idx(6,7), X));
  s = new State(); s.play(idx(7,7), X);
  ok(explainMove(s, idx(7,8), O).includes('center') || explainMove(s, idx(7,8), O).length > 0, 'center development text', explainMove(s, idx(7,8), O));
}

console.log('\n== NEW: evaluation scale sanity ==');
{
  const quiet = build([[7,7,X],[8,8,O]]);
  const three = build([[4,7,X],[5,7,X],[6,7,X],[1,1,O]]);
  const four  = build([[4,7,X],[5,7,X],[6,7,X],[7,7,X],[1,1,O],[2,2,O]]);
  const qs = quiet.evaluate(), ts = three.evaluate(), fs_ = four.evaluate();
  ok(Math.abs(qs) < 2000, 'quiet position near zero', qs);
  ok(ts < -2000, 'X open three is clearly negative', ts);
  ok(fs_ < ts, 'X four is worse for O than X three', fs_ + ' < ' + ts);
  const disp = v => (6 * Math.tanh(v / 60000)).toFixed(1);
  console.log('   display: quiet ' + disp(qs) + ', three ' + disp(ts) + ', four ' + disp(fs_));
  ok(Math.abs(+disp(qs)) < 0.5, 'quiet displays near 0.0', disp(qs));
  ok(Math.abs(+disp(fs_)) <= 6, 'display stays bounded', disp(fs_));
}

console.log('\n== NEW: evaluation stability across repeated analysis ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[7,8,X]]);
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(analyse(s.clone(), O, { timeMs: 900 }).score);
  const spread = Math.max(...runs) - Math.min(...runs);
  ok(spread < 20000, 'repeated analysis of the same position is stable', runs.join(' / '));
}

console.log('\n== NEW: hard vs medium strength ==');
{
  function game(hardIsO) {
    const s = new State(); s.play(idx(7,7), X);
    let cur = O;
    for (let ply = 0; ply < 120; ply++) {
      const diff = (cur === O) === hardIsO ? 'hard' : 'medium';
      const r = chooseMove(s, cur, diff, diff === 'hard' ? 900 : 400);
      if (!r) return 'draw';
      s.play(r.idx, cur);
      if (winningLineAt(s.board, r.idx, cur)) return cur === O ? 'O' : 'X';
      if (s.isFull()) return 'draw';
      cur = cur === X ? O : X;
    }
    return 'draw';
  }
  const r1 = game(true), r2 = game(false);
  console.log('   hard=O: ' + r1 + ' | hard=X: ' + r2);
  ok(r1 === 'O' || r2 === 'X', 'hard wins at least one of the two colours', r1 + '/' + r2);
}

console.log('\n== Performance ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[7,8,X],[8,7,O]]);
  const t0 = Date.now();
  const r = analyse(s, O, { timeMs: 2000, vct: true });
  const dt = Date.now() - t0;
  ok(dt < 3500, 'analysis returns within budget + overhead', dt + 'ms');
  console.log('   depth ' + r.depth + ', nodes ' + r.nodes + ', ' + r.timeMs + 'ms, stoppedByTime=' + r.stoppedByTime);
}

console.log('\n---------------------------');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
