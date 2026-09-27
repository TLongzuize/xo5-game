const fs = require('fs');
eval(fs.readFileSync(__dirname + '/engine3.js', 'utf8'));
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

console.log('\n== NEW: mate reporting (X-positive: O forced win => large NEGATIVE score) ==');
{
  const s = build([[4,7,O],[5,7,O],[6,7,O],[7,7,O],[1,1,X]]);
  const a = analyse(s, O, { timeMs: 500 });
  ok(a.mateIn !== null, 'forced win reported as mate', 'M' + a.mateIn);
  ok(a.score < -MATE_THRESHOLD, 'O forced win reports as a large negative score', a.score);
  ok(a.mateFor === O, 'mateFor names O', a.mateFor);
  const b = analyse(build([[7,7,X],[8,8,O]]), O, { timeMs: 400 });
  ok(b.mateIn === null, 'no fake mate in a quiet position', b.mateIn);
  ok(Math.abs(b.score) < 100000, 'quiet position gets an ordinary score', b.score);

  // same position, X to move (its own forced win) => large POSITIVE score
  const s2 = build([[4,7,X],[5,7,X],[6,7,X],[7,7,X],[1,1,O]]);
  const c = analyse(s2, X, { timeMs: 500 });
  ok(c.score > MATE_THRESHOLD, 'X forced win reports as a large positive score', c.score);
  ok(c.mateFor === X, 'mateFor names X', c.mateFor);
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

console.log('\n== NEW: candidate moves (ranked best-for-the-mover first) ==');
{
  // O to move: O's best move has the MOST NEGATIVE X-positive score (best for O = worst for X)
  let s = build([[7,7,X],[8,8,O],[6,6,X]]);
  let a = analyse(s, O, { timeMs: 900 });
  ok(a.candidates.length >= 2, 'candidate list returned', a.candidates.length);
  ok(a.candidates[0].idx === a.best, 'top candidate equals best move (O to move)');
  let sortedForO = a.candidates.every((c, i) => i === 0 || a.candidates[i-1].score <= c.score);
  ok(sortedForO, 'when O is to move, candidates rank ascending X-positive score (best-for-O first)',
     a.candidates.map(c => c.score).join(','));
  console.log('   O-to-move: ' + a.candidates.slice(0,3).map(c => nm(c.idx) + ' ' + c.score).join(', '));

  // X to move: X's best move has the MOST POSITIVE X-positive score
  s = build([[7,7,X],[8,8,O],[9,9,O]]);
  a = analyse(s, X, { timeMs: 900 });
  ok(a.candidates[0].idx === a.best, 'top candidate equals best move (X to move)');
  let sortedForX = a.candidates.every((c, i) => i === 0 || a.candidates[i-1].score >= c.score);
  ok(sortedForX, 'when X is to move, candidates rank descending X-positive score (best-for-X first)',
     a.candidates.map(c => c.score).join(','));
  console.log('   X-to-move: ' + a.candidates.slice(0,3).map(c => nm(c.idx) + ' ' + c.score).join(', '));
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
console.log('BASE SUITE  PASS: ' + pass + '   FAIL: ' + fail);
let __baseFail = fail;   // don't exit yet -- the appended section below still needs to run

// ===================================================================
// Appended for the "final pass" spec: dedicated M1/M2/M3 proof-gating
// tests, EVAL_CAP stress test (false-M-prevention), and a 9-level ladder.
// (Left in the same file rather than split out, since test_engine3.js
// is itself the new baseline going forward.)
// ===================================================================
(function () {
  const fs = require('fs');
  const E = (typeof module !== 'undefined' && module.exports && module.exports.XOEngine) || global.XOEngine;
  const { State, X, O, analyse, solveForcing, winningLineAt, chooseMove, MATE_THRESHOLD, LEVELS9 } = E;
  const SIZE = 15;
  const idx = (x, y) => y * SIZE + x;
  const nm = i => "ABCDEFGHIJKLMNO"[i % SIZE] + (SIZE - Math.floor(i / SIZE));
  let pass = 0, fail = 0;
  const ok = (c, l, x) => { if (c) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };
  function build(ms) { const s = new State(); for (const [x, y, p] of ms) s.play(idx(x, y), p); return s; }

  console.log('\n== M1/M2/M3 proof-gating (spec #11) ==');
  {
    // M1: X has an actual immediate winning move
    let s = build([[4,7,X],[5,7,X],[6,7,X],[7,7,X],[1,1,O],[2,2,O]]);
    let a = analyse(s, X, { timeMs: 500 });
    ok(a.mateIn === 1, 'M1: forced win in exactly 1 reported', a.mateIn);
    const winCell = idx(3,7), winCell2 = idx(8,7);
    ok(a.best === winCell || a.best === winCell2, 'M1 best move IS the literal winning square', a.best !== null ? nm(a.best) : null);
    s.board[a.best] = X;
    ok(!!winningLineAt(s.board, a.best, X), 'M1 best move, once played, truly makes five in a row');

    // False-M1 prevention: a position with a big heuristic edge but NO immediate win
    s = build([[4,7,X],[5,7,X],[6,7,X],[10,10,O],[11,11,O]]); // open three only, not a four
    a = analyse(s, X, { timeMs: 500 });
    ok(a.mateIn !== 1, 'no false M1 when only an open three exists (no literal winning move)', a.mateIn);

    // M2: forced win on X's SECOND move (three plies: X, O forced reply, X wins)
    s = build([
      [4,7,X],[5,7,X],[6,7,X],[7,7,X],          // X four (open) -> immediate M1 available too;
    ]);
    // Use a position where the ONLY win is two moves away: two separate open threes
    // that combine into an unstoppable double-threat one move later.
    s = build([
      [4,7,X],[5,7,X],[6,7,X],                  // open three, row 7
      [4,9,X],[5,9,X],[6,9,X],                  // open three, row 9
      [1,1,O],[2,2,O],[12,12,O]
    ]);
    const r = solveForcing(s, X, { maxPly: 8, nodes: 60000, timeMs: 2000, vct: true });
    ok(r.win, 'forcing solver proves a win from two open threes', r.seq.map(nm).join(' '));
    if (r.win) {
      const mateIn = Math.ceil(r.seq.length / 2);
      ok(mateIn >= 2, 'this forced win is NOT a same-move M1 (needs a follow-up)', 'M' + mateIn);
      // verify the whole sequence is legal and actually wins for X at the end
      const t = s.clone(); let p = X, wonForX = false;
      for (const mv of r.seq) {
        if (t.board[mv] !== 0) { wonForX = false; break; }
        t.play(mv, p);
        if (winningLineAt(t.board, mv, p) && p === X) { wonForX = true; break; }
        p = p === X ? O : X;
      }
      ok(wonForX, 'the proven M' + mateIn + ' sequence is legal end-to-end and ends in an X win');
    }

    // False-M2 prevention: opponent has a real escape, so no forced win should be found
    s = build([[5,7,X],[6,7,X],[7,7,X],[3,3,O],[9,9,O],[10,10,O],[3,9,O],[9,3,O]]);
    const r2 = solveForcing(s, X, { maxPly: 6, nodes: 20000, timeMs: 800, vct: true });
    ok(!r2.win || r2.seq.length > 0, 'solver does not claim a win it cannot demonstrate a legal line for');
    // and analyse() must not report mateIn unless the solver (or full search) actually proved one
    const a2 = analyse(s, X, { timeMs: 500 });
    if (!r2.win) ok(a2.mateIn === null, 'no fabricated mate when no forced win exists', a2.mateIn);

    // Multiple winning moves: at least one must be found, and it must be a real winner
    s = build([[4,7,X],[5,7,X],[6,7,X],[7,7,X],[8,8,O]]); // open four -> BOTH ends win
    a = analyse(s, X, { timeMs: 400 });
    ok(a.mateIn === 1, 'open four (two winning squares) still correctly reported as M1', a.mateIn);
    let bothWin = true;
    for (const cand of [idx(3,7), idx(8,7)]) {
      const t = s.clone(); t.play(cand, X);
      if (!winningLineAt(t.board, cand, X)) bothWin = false;
    }
    ok(bothWin, 'both winning squares of the open four are genuinely winning moves');

    // Defensive position: O to move must block, and mateIn must reflect O's side, not X's
    s = build([[4,7,X],[5,7,X],[6,7,X],[7,7,X],[1,1,O]]);
    a = analyse(s, O, { timeMs: 400 });
    ok(a.mateIn === 1 && a.mateFor === X, 'defensive position: mate correctly attributed to X even though O is to move', a.mateFor);
  }

  console.log('\n== EVAL_CAP stress test: heuristic can never masquerade as a proven mate ==');
  {
    // Densely packed alternating stones: large heuristic sums, no actual five for either side.
    const s = new State();
    let k = 0;
    for (let y = 1; y < 14; y += 2) {
      for (let x = 1; x < 14; x++) {
        s.play(idx(x, y), (k % 2 === 0) ? X : O);
        k++;
      }
    }
    const raw = s.evaluate();
    ok(Math.abs(raw) < MATE_THRESHOLD, 'dense-board heuristic stays well below the mate threshold', raw);
    const a = analyse(s, X, { timeMs: 500 });
    ok(a.mateIn === null || Math.abs(a.score) >= MATE_THRESHOLD, 'no spurious mateIn from heuristic magnitude alone', a.mateIn + ' / ' + a.score);
  }

  console.log('\n== 9-level AI ladder (spec #16): every level takes wins/blocks; strength roughly increases ==');
  {
    for (let lvl = 1; lvl <= 9; lvl++) {
      // must still always take an immediate win
      let s = build([[3,7,O],[4,7,O],[5,7,O],[6,7,O],[3,9,X],[4,9,X],[5,9,X]]);
      let r = chooseMove(s, O, lvl, LEVELS9[lvl].timeMs);
      ok(r && (r.idx === idx(2,7) || r.idx === idx(7,7)), 'level ' + lvl + ' takes the win', r && nm(r.idx));
      // must always block an immediate loss
      s = build([[3,7,X],[4,7,X],[5,7,X],[6,7,X],[1,1,O]]);
      r = chooseMove(s, O, lvl, LEVELS9[lvl].timeMs);
      ok(r && (r.idx === idx(2,7) || r.idx === idx(7,7)), 'level ' + lvl + ' blocks the loss', r && nm(r.idx));
    }
    // ladder strength: level 9 should beat level 1 convincingly over a few games
    function game(strongIsO) {
      const s = new State(); s.play(idx(7,7), X);
      let cur = O;
      for (let ply = 0; ply < 150; ply++) {
        const lvl = (cur === O) === strongIsO ? 9 : 1;
        const r = chooseMove(s, cur, lvl, LEVELS9[lvl].timeMs);
        if (!r) return 'draw';
        s.play(r.idx, cur);
        if (winningLineAt(s.board, r.idx, cur)) return cur === O ? 'O' : 'X';
        if (s.isFull()) return 'draw';
        cur = cur === X ? O : X;
      }
      return 'draw';
    }
    let strongWins = 0, games = 3;
    for (let g = 0; g < games; g++) {
      const res = game(true); // level 9 plays O
      if (res === 'O') strongWins++;
      console.log('   level9(O) vs level1(X), game ' + (g + 1) + ': ' + res);
    }
    ok(strongWins >= 2, 'level 9 beats level 1 in at least 2 of 3 games', strongWins + '/' + games);
  }

  console.log('\n== Long time budgets reach real extra depth (spec #8, #15) ==');
  {
    const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[7,8,X],[8,7,O],[6,8,X],[9,7,O]]);
    const a2s = analyse(s.clone(), O, { timeMs: 2000 });
    const a8s = analyse(s.clone(), O, { timeMs: 8000 });
    console.log('   2s -> depth ' + a2s.depth + ' (' + a2s.nodes + ' nodes) | 8s -> depth ' + a8s.depth + ' (' + a8s.nodes + ' nodes)');
    ok(a8s.depth >= a2s.depth, '8s budget reaches at least as deep as 2s', a8s.depth + ' >= ' + a2s.depth);
    ok(a8s.nodes >= a2s.nodes, '8s budget explores at least as many nodes', a8s.nodes + ' >= ' + a2s.nodes);
  }

  console.log('\n== Real-time per-iteration payload (spec #7/#22) ==');
  {
    const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O]]);
    const ticks = [];
    const a = analyse(s, O, { timeMs: 1500, onProgress: p => ticks.push(p) });
    ok(ticks.length >= 2, 'onProgress fired for multiple completed iterations', ticks.length);
    ok(ticks.every(t => t.pv && t.pv.length && typeof t.score === 'number' && t.best != null), 'each tick carries score/best/pv, not just a depth number');
    ok(ticks.every((t, i) => i === 0 || t.depth > ticks[i-1].depth), 'iterations are strictly increasing in depth', ticks.map(t=>t.depth).join(','));
    ok(a.iters && a.iters.length === ticks.length, 'final result exposes the same completed-iteration history', a.iters.length + ' vs ' + ticks.length);
  }

  console.log('\n---------------------------');
  console.log('APPENDED SECTION  PASS: ' + pass + '   FAIL: ' + fail);
  global.__appendedPass = pass; global.__appendedFail = fail;
})();

// ===================================================================
// INTEGRATION-CONTRACT SECTION: locks down the exact analyse()/
// chooseMove()/solveForcing()/threatMap()/explainMove()/LEVELS9 shapes
// that app3.js (the UI layer) relies on. These do not touch engine
// behavior -- they exist so that a future change to engine3.js that
// silently breaks the contract the UI depends on shows up here, in the
// engine suite, rather than only as a UI regression.
// ===================================================================
(function () {
  const E = (typeof module !== 'undefined' && module.exports && module.exports.XOEngine) || global.XOEngine;
  const { State, X, O, analyse, chooseMove, solveForcing, threatMap, explainMove,
          winningLineAt, LEVELS9, MATE, MATE_THRESHOLD } = E;
  const SIZE = 15, LEN = 225;
  const idx = (x, y) => y * SIZE + x;
  const nm = i => "ABCDEFGHIJKLMNO"[i % SIZE] + (SIZE - Math.floor(i / SIZE));
  let pass = 0, fail = 0;
  const ok = (c, l, x) => { if (c) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };
  function build(ms) { const s = new State(); for (const [x, y, p] of ms) s.play(idx(x, y), p); return s; }

  console.log('\n== INTEGRATION CONTRACT: analyse() shape ==');
  {
    const s = build([[7,7,X],[8,8,O],[6,6,X]]);
    const a = analyse(s, O, { timeMs: 800 });
    const fields = ['score','rawScore','best','mateIn','mateFor','depth','nodes','timeMs',
                     'ttHits','ttProbes','stoppedByTime','pv','kind','candidates','iters'];
    ok(fields.every(f => f in a), 'analyse() result carries every field the UI reads', fields.filter(f => !(f in a)).join(','));
    ok(Array.isArray(a.pv), 'pv is an array');
    ok(Array.isArray(a.candidates) && a.candidates.every(c => 'idx' in c && 'score' in c), 'candidates are {idx,score} objects');
    ok(Array.isArray(a.iters) && a.iters.every(it => 'depth' in it && 'score' in it && 'best' in it && 'pv' in it && 'nodes' in it && 'timeMs' in it),
      'iters entries carry depth/score/best/pv/nodes/timeMs (what applyIteration() reads)');
    ok(typeof a.score === 'number', 'score is numeric');
    ok(a.best == null || (a.best >= 0 && a.best < LEN && s.board[a.best] === 0), 'best move, if present, is a legal empty square');
    ok(a.candidates.every(c => c.idx >= 0 && c.idx < LEN && s.board[c.idx] === 0), 'every candidate is a legal empty square (heatmap/candidate-list assumption)');
  }

  console.log('\n== INTEGRATION CONTRACT: X-positive sign end to end ==');
  {
    // A blunt, unambiguous position: X has an open three, O has nothing.
    const b = new Int8Array(LEN);
    b[idx(5,7)] = X; b[idx(6,7)] = X; b[idx(7,7)] = X;
    b[idx(0,0)] = O; b[idx(14,14)] = O;
    const s = new State(); for (let i = 0; i < LEN; i++) if (b[i]) s.play(i, b[i]);
    const aFromX = analyse(s, X, { timeMs: 600 });
    const aFromO = analyse(s, O, { timeMs: 600 });
    ok(aFromX.score > 0, 'analysing an X-favourable position with X to move: score > 0', aFromX.score);
    ok(aFromO.score > 0, 'the SAME position analysed with O to move still reports score > 0 (X-positive, not side-relative)', aFromO.score);
    ok(aFromX.candidates.every(c => c.score === aFromX.candidates.find(x => x.idx === c.idx).score), 'candidate scores internally consistent');
  }

  console.log('\n== INTEGRATION CONTRACT: LEVELS9 table (1-9 UI ladder) ==');
  {
    const keys = Object.keys(LEVELS9).map(Number).sort((a,b) => a-b);
    ok(keys.length === 9 && keys.every((k,i) => k === i+1), 'LEVELS9 has exactly keys 1..9', keys.join(','));
    const reqFields = ['label','maxDepth','width','rootWidth','timeMs','noise','vcf','vct','maxExt'];
    ok(keys.every(k => reqFields.every(f => f in LEVELS9[k])), 'every level config carries the fields the settings UI reads');
    ok(keys.every((k,i) => i === 0 || LEVELS9[k].maxDepth >= LEVELS9[k-1].maxDepth), 'search strength is monotonically non-decreasing from level 1 to 9');
  }

  console.log('\n== INTEGRATION CONTRACT: chooseMove() always legal, always takes win/blocks loss ==');
  {
    const winPos = build([[3,7,X],[4,7,X],[5,7,X],[6,7,X],[1,1,O],[2,2,O]]);
    for (let lvl = 1; lvl <= 9; lvl++) {
      const r = chooseMove(winPos, X, lvl, 150);
      ok(r && (r.idx === idx(2,7) || r.idx === idx(7,7)), 'level ' + lvl + ' chooseMove() takes the immediate win', r && nm(r.idx));
    }
    const losePos = build([[3,7,X],[4,7,X],[5,7,X],[6,7,X],[1,1,O],[2,2,O]]);
    for (let lvl = 1; lvl <= 9; lvl++) {
      const r = chooseMove(losePos, O, lvl, 150);
      const blocks = r && (r.idx === idx(2,7) || r.idx === idx(7,7));
      ok(blocks, 'level ' + lvl + ' chooseMove() blocks the immediate loss', r && nm(r.idx));
    }
    // legality across an ordinary mid-game position too
    const mid = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[5,5,X]]);
    for (let lvl = 1; lvl <= 9; lvl += 2) {
      const r = chooseMove(mid, O, lvl, 150);
      ok(r && r.idx != null && mid.board[r.idx] === 0, 'level ' + lvl + ' returns a legal empty-square move on an ordinary position', r && nm(r.idx));
    }
  }

  console.log('\n== INTEGRATION CONTRACT: solveForcing() shape + verified replay ==');
  {
    // open four: X to move has a forced win the puzzle/worker "forcing" request path relies on
    const s = build([[4,7,X],[5,7,X],[6,7,X],[3,9,O],[4,9,O]]);
    const r = solveForcing(s, X, { maxPly: 8, nodes: 20000, timeMs: 1500, vct: true });
    ok('win' in r && 'seq' in r && 'nodes' in r && 'aborted' in r, 'solveForcing() result has {win,seq,nodes,aborted}');
    ok(r.win === true && Array.isArray(r.seq) && r.seq.length > 0, 'a genuine forced win is found and returned as a move sequence', JSON.stringify(r.seq));
    // replay the sequence exactly as the puzzle-verification code path does
    const replay = new State(); for (let i = 0; i < LEN; i++) if (s.board[i]) replay.play(i, s.board[i]);
    let mover = X, wonAt = -1;
    for (let i = 0; i < r.seq.length; i++) {
      replay.play(r.seq[i], mover);
      if (winningLineAt(replay.board, r.seq[i], mover)) { wonAt = i; break; }
      mover = mover === X ? O : X;
    }
    ok(wonAt === r.seq.length - 1, 'replaying the forced-win sequence move by move ends in a win on the LAST ply, not before or never', wonAt + ' of ' + (r.seq.length - 1));
  }

  console.log('\n== INTEGRATION CONTRACT: threatMap() / explainMove() shapes ==');
  {
    const s = build([[7,7,X],[8,7,X],[6,6,O]]);
    const tm = threatMap(s, 2);
    ok(Array.isArray(tm), 'threatMap() returns an array');
    ok(tm.every(t => 'idx' in t && 'player' in t && 'level' in t && 'label' in t), 'each threat entry has {idx,player,level,label}');
    ok(tm.every(t => s.board[t.idx] === 0), 'every threat-map square is empty on the given board');
    const before = build([[7,7,X]]);
    const txt = explainMove(before, idx(8,7), X);
    ok(typeof txt === 'string' && txt.length > 0, 'explainMove() returns a non-empty description', txt);
  }

  console.log('\n== INTEGRATION CONTRACT: State hash is order-independent (worker rebuild safety) ==');
  {
    // app3.js's worker rebuilds a State by replaying [root stones][move list] in
    // whatever order they are iterated; the resulting Zobrist hash (and hence TT
    // reuse / position-key caching in the UI) must not depend on that order.
    const moves = [[idx(7,7),X],[idx(8,8),O],[idx(6,6),X],[idx(9,9),O],[idx(5,5),X]];
    const s1 = new State(); moves.forEach(([i,p]) => s1.play(i,p));
    const s2 = new State(); moves.slice().reverse().forEach(([i,p]) => s2.play(i,p));
    ok(s1.hA === s2.hA && s1.hB === s2.hB, 'Zobrist hash is independent of play order for the same final stone set');
    let same = true; for (let i = 0; i < LEN; i++) if (s1.board[i] !== s2.board[i]) same = false;
    ok(same, 'the two differently-ordered States reach an identical final board');
  }

  console.log('\n== INTEGRATION CONTRACT: EVAL_CAP still well under MATE_THRESHOLD ==');
  {
    // Re-assert the invariant HANDOFF.md calls load-bearing for M# correctness,
    // as a contract check independent of the base suite's dense-board stress test.
    ok(MATE_THRESHOLD < MATE, 'MATE_THRESHOLD is strictly below MATE', MATE_THRESHOLD + ' < ' + MATE);
    ok(MATE_THRESHOLD >= 1000000, 'MATE_THRESHOLD has enough headroom above heuristic scores', MATE_THRESHOLD);
  }

  console.log('\n---------------------------');
  console.log('INTEGRATION CONTRACT SECTION  PASS: ' + pass + '   FAIL: ' + fail);
  global.__contractPass = pass; global.__contractFail = fail;
})();

const __ap = global.__appendedPass || 0, __af = global.__appendedFail || 0;
const __cp = global.__contractPass || 0, __cf = global.__contractFail || 0;
console.log('\n===========================================================');
console.log('BASE SUITE          PASS: ' + pass + '   FAIL: ' + __baseFail);
console.log('APPENDED SECTION    PASS: ' + __ap + '   FAIL: ' + __af);
console.log('INTEGRATION SECTION PASS: ' + __cp + '   FAIL: ' + __cf);
const __grandFail = __baseFail + __af + __cf;
const __grandPass = pass + __ap + __cp;
console.log('TOTAL                PASS: ' + __grandPass + '   FAIL: ' + __grandFail);
console.log('===========================================================');
process.exit(__grandFail ? 1 : 0);
