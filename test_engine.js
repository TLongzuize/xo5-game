const fs = require('fs');
eval(fs.readFileSync(__dirname + '/engine.js', 'utf8'));
const E = (typeof self !== 'undefined' ? self : this).XOEngine || global.XOEngine;
const { State, X, O, winningLineAt, chooseMove, analyse, immediateTactic, MATE_THRESHOLD } = E;
const SIZE = 15;
const idx = (x, y) => y * SIZE + x;
const name = i => "ABCDEFGHIJKLMNO"[i % SIZE] + (Math.floor(i / SIZE) + 1);

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
}

function build(moves) { // moves: [[x,y,player],...]
  const s = new State();
  for (const [x, y, p] of moves) s.play(idx(x, y), p);
  return s;
}

console.log('\n== Win detection ==');
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
  const line = winningLineAt(s.board, idx(7,7), X);
  ok(line && line.length === 6, 'six in a row counts as a win', line && line.length);

  s = build([[3,7,X],[4,7,X],[6,7,X],[7,7,X]]);
  ok(!winningLineAt(s.board, idx(7,7), X), 'gap of one is NOT a win');

  s = build([[11,7,X],[12,7,X],[13,7,X],[14,7,X],[0,8,X]]);
  ok(!winningLineAt(s.board, idx(0,8), X), 'no wrap-around across row edge');
}

console.log('\n== Draw detection ==');
{
  const s = new State();
  // fill board in a pattern that never makes 5 in a row:
  // blocks of 4 columns alternating owner per 4-row band would be complex;
  // just verify isFull triggers on a fully occupied board.
  for (let i = 0; i < 225; i++) s.play(i, (i % 2) ? X : O);
  ok(s.isFull(), 'isFull true when 225 stones placed', s.stoneCount);
  const empty = new State();
  ok(!empty.isFull(), 'isFull false on empty board');
}

console.log('\n== Immediate tactics ==');
{
  // O has four in a row -> must complete
  let s = build([[3,7,O],[4,7,O],[5,7,O],[6,7,O], [3,9,X],[4,9,X]]);
  let t = immediateTactic(s, O);
  ok(t && t.kind === 'win' && (t.idx === idx(2,7) || t.idx === idx(7,7)), 'O finds its own winning move', t && name(t.idx));

  // X has four -> O must block
  s = build([[3,7,X],[4,7,X],[5,7,X],[6,7,X], [1,1,O]]);
  t = immediateTactic(s, O);
  ok(t && t.kind === 'block' && (t.idx === idx(2,7) || t.idx === idx(7,7)), 'O blocks X four', t && name(t.idx));
}

console.log('\n== AI move quality (all difficulties) ==');
for (const diff of ['easy','medium','hard']) {
  // must win when a win is available
  let s = build([[3,7,O],[4,7,O],[5,7,O],[6,7,O], [3,9,X],[4,9,X],[5,9,X]]);
  let r = chooseMove(s, O, diff);
  ok(r && (r.idx === idx(2,7) || r.idx === idx(7,7)), diff + ': takes the win', r && name(r.idx));

  // must block an immediate loss
  s = build([[3,7,X],[4,7,X],[5,7,X],[6,7,X], [1,1,O],[2,2,O]]);
  r = chooseMove(s, O, diff);
  ok(r && (r.idx === idx(2,7) || r.idx === idx(7,7)), diff + ': blocks the loss', r && name(r.idx));

  // must respond to an open three (X: _XXX_ at E7..G7)
  s = build([[4,7,X],[5,7,X],[6,7,X], [1,1,O],[12,12,O]]);
  r = chooseMove(s, O, diff);
  const acceptable = [idx(3,7), idx(7,7), idx(2,7), idx(8,7)];
  ok(r && acceptable.includes(r.idx), diff + ': answers an open three', r && name(r.idx));
}

console.log('\n== Difficulty separation (hard beats easy over several games) ==');
{
  function playGame(aiHardIsO) {
    const s = new State();
    let cur = X; // X moves first
    s.play(idx(7,7), X); cur = O;
    for (let ply = 0; ply < 200; ply++) {
      const diff = (cur === O) === aiHardIsO ? 'hard' : 'easy';
      const r = chooseMove(s, cur, diff);
      if (!r) return 'draw';
      s.play(r.idx, cur);
      if (winningLineAt(s.board, r.idx, cur)) return cur === O ? 'O' : 'X';
      if (s.isFull()) return 'draw';
      cur = cur === X ? O : X;
    }
    return 'draw';
  }
  let hardWins = 0, games = 3;
  for (let g = 0; g < games; g++) {
    // O is hard, X is easy
    const res = playGame(true);
    if (res === 'O') hardWins++;
    console.log('   game ' + (g+1) + ' result: ' + res);
  }
  ok(hardWins >= 2, 'hard wins at least 2 of 3 vs easy', hardWins + '/' + games);
}

console.log('\n== Evaluation sanity ==');
{
  let s = build([[4,7,X],[5,7,X],[6,7,X]]); // X open three, O nothing
  ok(s.evaluate() < -1000, 'X open three -> clearly negative (X favoured)', s.evaluate());

  s = build([[4,7,O],[5,7,O],[6,7,O]]);
  ok(s.evaluate() > 1000, 'O open three -> clearly positive', s.evaluate());

  s = build([[4,7,X],[5,7,X],[6,7,X],[4,9,O],[5,9,O],[6,9,O]]);
  ok(Math.abs(s.evaluate()) < 5000, 'mirrored threes -> near balanced', s.evaluate());

  s = new State();
  ok(s.evaluate() === 0, 'empty board evaluates to 0', s.evaluate());

  // incremental update correctness: play then undo returns to zero
  s = new State();
  s.play(idx(7,7), X); s.play(idx(8,8), O); s.play(idx(6,6), X);
  s.undo(); s.undo(); s.undo();
  ok(s.evaluate() === 0 && s.stoneCount === 0, 'undo fully restores state', s.evaluate() + '/' + s.stoneCount);
}

console.log('\n== Analyse() output ==');
{
  let s = build([[4,7,X],[5,7,X],[6,7,X],[7,7,X],[1,1,O]]); // X four, O to move
  const a = analyse(s, O, 400);
  ok(a.best === idx(3,7) || a.best === idx(8,7), 'analyse suggests the blocking square', a.best !== null ? name(a.best) : null);
  ok(a.score < 0, 'analyse reports X advantage (negative)', a.score);

  s = build([[4,7,O],[5,7,O],[6,7,O],[7,7,O],[1,1,X]]);
  const b = analyse(s, O, 400);
  ok(b.score > MATE_THRESHOLD * 0.5 || b.mateIn !== null, 'analyse detects O forced win', b.score + ' mateIn=' + b.mateIn);
}

console.log('\n== Performance ==');
{
  const s = build([[7,7,X],[8,8,O],[6,6,X],[9,9,O],[7,8,X],[8,7,O]]);
  const t0 = Date.now();
  const r = chooseMove(s, O, 'hard');
  const dt = Date.now() - t0;
  ok(dt < 3000, 'hard move within 3s', dt + 'ms, depth=' + r.depth + ', nodes=' + r.nodes);
  console.log('   hard picked ' + name(r.idx) + ' depth ' + r.depth + ' nodes ' + r.nodes + ' in ' + dt + 'ms');
}

console.log('\n---------------------------');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
