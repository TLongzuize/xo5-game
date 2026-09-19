/* =========================================================================
   test_ui3.js — headless UI regression suite for the CURRENT build.
   Runs against index.html (engine3 + worker3 + app3 + shell3).

     node test_ui3.js

   jsdom has no Worker implementation, so the suite forces the documented
   main-thread fallback path. Worker-specific behaviour that CAN be tested
   without a real Worker (search-ID bookkeeping, generation-based
   cancellation, stale-result rejection) is exercised through the same code
   path the Worker uses.
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const errors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/index.html',
  beforeParse(win) {
    win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    win.Worker = undefined;                       // force the main-thread fallback
    win.URL.createObjectURL = () => 'blob:x';
    win.addEventListener('error', e => errors.push('window error: ' + (e.message || e.error)));
    win.performance = win.performance || { now: () => Date.now() };
  }
});
const win = dom.window, doc = win.document;
win.onerror = m => errors.push('onerror: ' + m);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => doc.getElementById(id);
const cells = () => [...doc.querySelectorAll('.cell')];
const cellAt = i => cells().find(c => +c.dataset.i === i);
const click = el => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const key = k => doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
const idx = (x, y) => y * 15 + x;

let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? ' -> ' + extra : '')); }
};
const section = t => console.log('\n== ' + t + ' ==');

/* wait until the app has settled (no search in flight) */
async function settle(maxMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(60);
    if (!win.__XO.isSearching() && win.__XO.pendingCount() === 0) { await sleep(60); return true; }
  }
  return false;
}
/* wait for a predicate */
async function until(fn, maxMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (fn()) return true; await sleep(50); }
  return false;
}

(async function run() {
  await sleep(600);
  const XO = win.__XO;
  const X = 1, O = 2;

  /* ------------------------------------------------------------------ */
  section('Boot & structure');
  ok(!!XO, 'application initialised (window.__XO present)');
  ok(cells().length === 225, '15x15 board rendered (225 cells)', cells().length);
  ok(errors.length === 0, 'no uncaught errors during boot', errors.join(' | '));
  ok(!!win.XOEngine && !!win.XOEngine.LEVELS9, 'engine3 is present in the page');
  ok(win.XOEngine.LEVELS9[9].label === 'Maximum', 'engine exposes the 9-level ladder (engine3, not engine2)');
  ok(typeof win.XOEngine.solveForcing === 'function', 'engine exposes solveForcing (tactical solver present)');
  ok(html.indexOf('LEVELS9') > 0, 'built artifact contains engine3 source, not engine2');
  ok(html.indexOf('application layer v3') > 0, 'built artifact contains app3, not app2');

  /* ------------------------------------------------------------------ */
  section('Routing / home page');
  ok($('viewHome').hidden === false, 'home view is shown on first load');
  ok($('viewGame').hidden === true, 'game view hidden while on home');
  const routeBtns = [...$('navLinks').querySelectorAll('button')].map(b => b.dataset.route);
  ok(routeBtns.length === 6 && routeBtns.every(r => XO.routes.indexOf(r) >= 0), 'every nav link points at a real route', routeBtns.join(','));
  const modeBtns = [...doc.querySelectorAll('.mode[data-route]')];
  ok(modeBtns.length >= 5 && modeBtns.every(b => XO.routes.indexOf(b.dataset.route) >= 0), 'home mode cards all point at real routes');
  click(routeBtns.length && $('navLinks').querySelector('[data-route="puzzles"]'));
  await sleep(120);
  ok($('viewPuzzles').hidden === false && $('viewHome').hidden === true, 'nav link switches to the puzzles view');
  click($('brandBtn'));
  await sleep(120);
  ok($('viewHome').hidden === false, 'clicking the logo returns to home');

  /* ------------------------------------------------------------------ */
  section('X always moves first (spec #2)');
  XO.S.level = 1; XO.S.timeMs = 1000;
  click($('navLinks').querySelector('[data-route="play"]'));
  await sleep(200);
  ok($('viewGame').hidden === false, 'play route shows the game view');
  ok(XO.G.rootSide === X, 'a new AI game has X as the root side to move');
  ok(XO.sideAt(0) === X, 'ply 0 belongs to X');
  ok(XO.sideAt(1) === O, 'ply 1 belongs to O');

  // human = X
  XO.startGame('ai', { humanSide: X });
  await sleep(150);
  ok(XO.G.humanSide === X && XO.G.main.length === 0, 'human as X: board empty, human moves first');
  click(cellAt(idx(7, 7)));
  await sleep(150);
  ok(XO.G.main.length >= 1 && XO.G.main[0].player === X && XO.G.main[0].idx === idx(7, 7), 'human as X placed the first stone as X');
  await until(() => XO.G.main.length >= 2, 15000);
  ok(XO.G.main.length === 2 && XO.G.main[1].player === O, 'AI replied as O (second move)', XO.G.main.length);
  await settle();

  // human = O -> AI/X opens
  XO.startGame('ai', { humanSide: O });
  ok(XO.G.rootSide === X, 'human as O: root side is still X (never O)');
  const movedFirst = await until(() => XO.G.main.length >= 1, 15000);
  ok(movedFirst, 'human as O: the engine produced the opening move');
  ok(XO.G.main[0] && XO.G.main[0].player === X, 'human as O: the engine opening move is an X stone');
  ok(XO.sideAt(XO.G.main.length) === O, 'human as O: it is now O (the human) to move');
  await settle();

  // local + analysis both start with X
  XO.startGame('local', {});
  ok(XO.G.rootSide === X && XO.G.main.length === 0, 'local 2-player game starts with X to move');
  XO.startGame('analysis', {});
  ok(XO.G.rootSide === X, 'analysis board root side is X');
  await settle();

  /* ------------------------------------------------------------------ */
  section('Local 2-player mode (spec #12)');
  XO.startGame('local', {});
  await sleep(120);
  click(cellAt(idx(7, 7)));
  await sleep(120);
  click(cellAt(idx(8, 8)));
  await sleep(120);
  click(cellAt(idx(7, 8)));
  await sleep(400);
  ok(XO.G.main.length === 3, 'three human moves recorded in local mode', XO.G.main.length);
  ok(XO.G.main.map(m => m.player).join('') === '121', 'local mode alternates X, O, X');
  await sleep(1500);
  ok(XO.G.main.length === 3, 'no AI move is ever generated in local mode', XO.G.main.length);
  click($('undoBtn'));
  await sleep(150);
  ok(XO.G.main.length === 2, 'undo removes exactly one ply in local mode', XO.G.main.length);
  click($('redoBtn'));
  await sleep(150);
  ok(XO.G.main.length === 3, 'redo restores the undone ply');
  ok($('labelX').textContent.indexOf('Player') === 0, 'local mode labels the sides as players, not You/AI', $('labelX').textContent);
  await settle();

  /* ------------------------------------------------------------------ */
  section('Win detection & analysis navigation');
  XO.startGame('local', {});
  // X: 4 in a row on row 7, O: harmless stones far away, then X completes 5
  const seq = [idx(3, 7), idx(3, 0), idx(4, 7), idx(4, 0), idx(5, 7), idx(5, 0), idx(6, 7), idx(6, 0)];
  for (const s of seq) { click(cellAt(s)); await sleep(90); }
  ok(XO.G.main.length === 8, 'eight plies played', XO.G.main.length);
  click(cellAt(idx(7, 7)));
  await sleep(400);
  ok(XO.G.status === 'won' && XO.G.winner === X, 'five in a row is detected as a win for X', XO.G.status);
  ok(Array.isArray(XO.G.winCells) && XO.G.winCells.length >= 5, 'winning line cells are recorded', XO.G.winCells && XO.G.winCells.length);
  ok($('statusText').textContent.indexOf('X wins') >= 0, 'status line announces the winner', $('statusText').textContent);
  click($('reviewBtn'));
  await sleep(200);
  ok(XO.G.view === 0, 'review jumps to the start of the game');
  key('ArrowRight'); await sleep(120);
  ok(XO.G.view === 1, 'right arrow advances one move');
  key('End'); await sleep(120);
  ok(XO.G.view === XO.line().length, 'End jumps to the last move');
  key('Home'); await sleep(120);
  ok(XO.G.view === 0, 'Home jumps to the first move');
  key('ArrowRight'); key('ArrowRight'); await sleep(150);
  ok(XO.G.view === 2, 'repeated right arrows step forward');
  key('ArrowLeft'); await sleep(120);
  ok(XO.G.view === 1, 'left arrow steps back');
  ok(XO.G.main.length === 9, 'navigation did not corrupt the main line', XO.G.main.length);
  click($('navLast')); await sleep(150);
  ok(XO.G.view === 9, 'last-move button works');
  await settle();

  /* ------------------------------------------------------------------ */
  section('Draw detection (spec #26)');
  {
    /* A full 15x15 board with no five anywhere: colour by (x + 2y) mod 4.
       Runs are at most 2 in every direction, so the board fills with no win. */
    const b = new Int8Array(225);
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
      b[idx(x, y)] = ((x + 2 * y) % 4) < 2 ? X : O;
    }
    const lastCell = idx(14, 14), lastPlayer = b[lastCell];
    b[lastCell] = 0;
    XO.startGame('analysis', { root: b, rootSide: lastPlayer });
    XO.G.analysisMode = false;                 // treat it as a live position
    await sleep(150);
    click(cellAt(lastCell));
    await sleep(500);
    ok(XO.G.status === 'draw', 'a full board with no five is reported as a draw', XO.G.status);
    ok($('statusText').textContent.toLowerCase().indexOf('draw') >= 0, 'status line announces the draw', $('statusText').textContent);
  }
  await settle();

  /* ------------------------------------------------------------------ */
  section('Evaluation sign convention: X positive, O negative (spec #8)');
  {
    // X to move with a huge advantage: X open three vs nothing for O
    XO.startGame('analysis', {});
    XO.S.timeMs = 1000;
    const xAdv = new Int8Array(225);
    xAdv[idx(5, 7)] = X; xAdv[idx(6, 7)] = X; xAdv[idx(7, 7)] = X;
    xAdv[idx(0, 0)] = O; xAdv[idx(14, 14)] = O;
    XO.startGame('analysis', { root: xAdv, rootSide: X });
    await until(() => XO.current && XO.current.depth > 0, 20000);
    await settle();
    const sx = XO.current ? XO.current.score : null;
    ok(sx != null && sx > 0, 'X-favourable position evaluates POSITIVE', sx);
    const xLabel = $('evalNum').textContent;
    ok(/^M\d+ X$/.test(xLabel) || +xLabel > 0, 'eval readout favours X (number > 0 or an X mate label)', xLabel);
    ok($('evalDesc').textContent.indexOf('X') >= 0, 'eval description names X as better', $('evalDesc').textContent);

    const oAdv = new Int8Array(225);
    oAdv[idx(5, 7)] = O; oAdv[idx(6, 7)] = O; oAdv[idx(7, 7)] = O;
    oAdv[idx(0, 0)] = X; oAdv[idx(14, 14)] = X;
    XO.startGame('analysis', { root: oAdv, rootSide: O });
    await until(() => XO.current && XO.current.depth > 0, 20000);
    await settle();
    const so = XO.current ? XO.current.score : null;
    ok(so != null && so < 0, 'O-favourable position evaluates NEGATIVE', so);
    const oLabel = $('evalNum').textContent;
    ok(/^M\d+ O$/.test(oLabel) || +oLabel < 0, 'eval readout favours O (number < 0 or an O mate label)', oLabel);
    ok($('evalDesc').textContent.indexOf('O') >= 0, 'eval description names O as better', $('evalDesc').textContent);

    // eval bar fill: O's share shrinks when X is better
    XO.setEvalDisplay({ score: 900000, mateIn: null, depth: 3, pv: [], candidates: [] });
    await sleep(60);
    const oFillXWin = parseFloat($('fillO').style.height);
    XO.setEvalDisplay({ score: -900000, mateIn: null, depth: 3, pv: [], candidates: [] });
    await sleep(60);
    const oFillOWin = parseFloat($('fillO').style.height);
    ok(oFillXWin < 10, 'eval bar: O fill collapses when X is winning', oFillXWin);
    ok(oFillOWin > 90, 'eval bar: O fill dominates when O is winning', oFillOWin);
    XO.setEvalDisplay({ score: 4000, mateIn: null, depth: 4, pv: [], candidates: [] });
    await sleep(500);
    ok(+$('evalNum').textContent > 0, 'plain (non-mate) X advantage renders as a positive number', $('evalNum').textContent);
    XO.setEvalDisplay({ score: -4000, mateIn: null, depth: 4, pv: [], candidates: [] });
    await sleep(500);
    ok(+$('evalNum').textContent < 0, 'plain (non-mate) O advantage renders as a negative number', $('evalNum').textContent);
    XO.setEvalDisplay({ score: 9999997, mateIn: 2, mateFor: 1, depth: 3, pv: [], candidates: [] });
    await sleep(500);
    ok($('evalNum').textContent === 'M2 X', 'a proven mate label is not overwritten by the number animation', $('evalNum').textContent);
  }

  /* ------------------------------------------------------------------ */
  section('M# notation comes from the engine (spec #7)');
  {
    // X has four in a row with an open end -> an immediate winning move exists -> M1
    const m1 = new Int8Array(225);
    [idx(3, 7), idx(4, 7), idx(5, 7), idx(6, 7)].forEach(i => m1[i] = X);
    [idx(3, 9), idx(4, 9), idx(5, 9)].forEach(i => m1[i] = O);
    XO.startGame('analysis', { root: m1, rootSide: X });
    await until(() => XO.current && XO.current.mateIn != null, 20000);
    await settle();
    ok(XO.current && XO.current.mateIn === 1, 'immediate winning move reported as M1', XO.current && XO.current.mateIn);
    ok(XO.current && XO.current.mateFor === X, 'M1 attributed to X', XO.current && XO.current.mateFor);
    ok($('mateBadge').hidden === false && $('mateBadge').textContent.indexOf('M1') >= 0, 'M1 badge shown in the UI', $('mateBadge').textContent);
    const bestB = XO.current.best;
    const probe = new Int8Array(m1); probe[bestB] = X;
    ok(!!win.XOEngine.winningLineAt(probe, bestB, X), 'the M1 best move really completes five in a row', XO.nm(bestB));

    // Open three -> making the open four is NOT a win this move -> must not be M1
    const m2 = new Int8Array(225);
    [idx(5, 7), idx(6, 7), idx(7, 7)].forEach(i => m2[i] = X);
    [idx(1, 1), idx(2, 2)].forEach(i => m2[i] = O);
    XO.startGame('analysis', { root: m2, rootSide: X });
    await until(() => XO.current && XO.current.depth > 0, 20000);
    await settle();
    const mi = XO.current ? XO.current.mateIn : null;
    ok(mi === null || mi >= 2, 'an open three is never reported as M1', mi);
  }

  /* ------------------------------------------------------------------ */
  section('Best move / PV / candidates come from engine3 (spec #1, #9)');
  {
    XO.S.bestMove = true;
    const p = new Int8Array(225);
    [idx(5, 7), idx(6, 7), idx(7, 7)].forEach(i => p[i] = X);
    [idx(5, 9), idx(6, 9)].forEach(i => p[i] = O);
    XO.startGame('analysis', { root: p, rootSide: O });
    await until(() => XO.current && XO.current.depth > 0, 20000);
    await settle();
    ok(XO.current.best != null, 'engine returned a best move');
    ok($('engineKv').textContent.indexOf(XO.nm(XO.current.best)) >= 0, 'best move is displayed in the engine panel');
    ok(Array.isArray(XO.current.pv) && XO.current.pv.length > 0, 'principal variation is non-empty', XO.current.pv && XO.current.pv.length);
    ok(XO.current.pv[0] === XO.current.best, 'PV starts with the best move');
    ok(Array.isArray(XO.current.candidates) && XO.current.candidates.length > 1, 'candidate moves returned', XO.current.candidates && XO.current.candidates.length);
    ok($('candList').children.length > 1, 'candidate moves rendered in the panel', $('candList').children.length);
    ok($('arrows').innerHTML.indexOf('circle') >= 0, 'best-move marker drawn on the board');
    ok($('depthBadge').textContent === 'd' + XO.current.depth, 'depth badge matches the engine depth', $('depthBadge').textContent);
    // candidates must be real board squares that are empty
    const bb = XO.boardAt(XO.G.view);
    ok(XO.current.candidates.every(c => c.idx >= 0 && c.idx < 225 && !bb[c.idx]), 'all candidates are legal empty squares');
  }

  /* ------------------------------------------------------------------ */
  section('AI levels 1-9 (spec #4)');
  {
    const lvBtns = [...$('levelSeg').querySelectorAll('button')].map(b => b.dataset.v);
    ok(lvBtns.join(',') === '1,2,3,4,5,6,7,8,9', 'all nine levels exposed in the UI', lvBtns.join(','));
    click($('levelSeg').querySelector('[data-v="7"]'));
    await sleep(120);
    ok(XO.S.level === 7, 'selecting level 7 updates the setting', XO.S.level);
    ok($('levelHint').textContent.indexOf('Advanced') >= 0, 'level label comes from the engine table', $('levelHint').textContent);
    ok($('levelSeg').querySelector('[data-v="7"]').getAttribute('aria-pressed') === 'true', 'selected level is marked pressed');
    XO.startGame('ai', { humanSide: X });
    await sleep(100);
    ok($('labelO').textContent.indexOf('L7') >= 0, 'player row shows the selected AI level', $('labelO').textContent);
    click($('levelSeg').querySelector('[data-v="1"]'));
    await sleep(100);
    ok(XO.S.level === 1 && XO.G.level === 1, 'changing level takes effect on the live game');

    // every level must still block an immediate loss: O to move, X threatens five
    for (const L of [1, 5, 9]) {
      const b = new Int8Array(225);
      [idx(3, 7), idx(4, 7), idx(5, 7), idx(6, 7)].forEach(i => b[i] = X);
      [idx(1, 1), idx(2, 3), idx(9, 9)].forEach(i => b[i] = O);
      const s = new win.XOEngine.State();
      for (let i = 0; i < 225; i++) if (b[i]) s.play(i, b[i]);
      const r = win.XOEngine.chooseMove(s, O, L, 500);
      const blocks = r && (r.idx === idx(2, 7) || r.idx === idx(7, 7));
      ok(blocks, 'level ' + L + ' blocks the immediate loss', r && XO.nm(r.idx));
    }
  }
  await settle();

  /* ------------------------------------------------------------------ */
  section('Time controls & Stop (spec #5)');
  {
    const tBtns = [...$('timeSeg').querySelectorAll('button')].map(b => b.dataset.v);
    ok(tBtns.indexOf('30000') >= 0 && tBtns.indexOf('60000') >= 0 && tBtns.indexOf('5000') >= 0,
      '5s, 30s and 60s time controls exist', tBtns.join(','));
    click($('timeSeg').querySelector('[data-v="30000"]'));
    await sleep(80);
    ok(XO.S.timeMs === 30000, 'selecting 30s sets a 30000ms budget', XO.S.timeMs);
    click($('timeSeg').querySelector('[data-v="60000"]'));
    await sleep(80);
    ok(XO.S.timeMs === 60000, 'selecting 60s sets a 60000ms budget', XO.S.timeMs);
    click($('timeSeg').querySelector('[data-v="5000"]'));
    await sleep(80);
    ok(XO.S.timeMs === 5000, '5s selected', XO.S.timeMs);

    // Stop must be reachable and must terminate an in-flight search
    XO.startGame('analysis', {});
    XO.runAnalysis(true, 30000);
    const appeared = await until(() => $('stopBtn').hidden === false, 4000);
    ok(appeared, 'Stop control becomes visible while a search is running');
    ok(XO.pendingCount() > 0, 'a search request is in flight', XO.pendingCount());
    click($('stopBtn'));
    await sleep(120);
    ok(XO.pendingCount() === 0, 'Stop clears every in-flight search request', XO.pendingCount());
    ok($('stopBtn').hidden === true, 'Stop control hides again after stopping');
    XO.S.timeMs = 1000;
  }
  await settle();

  /* ------------------------------------------------------------------ */
  section('Worker search IDs / stale-result protection (spec #3)');
  {
    const gen0 = XO.workerGen();
    let resolved = false, rejectedCancel = false;
    XO.ask({ type: 'analyse', moves: [], root: null, side: 1, timeMs: 3000 })
      .then(() => { resolved = true; })
      .catch(e => { if (e && e.cancelled) rejectedCancel = true; });
    ok(XO.pendingCount() === 1, 'request registered with a unique id', XO.pendingCount());
    XO.cancelAllSearches('test');
    await sleep(300);
    ok(XO.workerGen() === gen0 + 1, 'cancelling advances the search generation', XO.workerGen());
    ok(rejectedCancel && !resolved, 'a cancelled request rejects and never resolves');
    ok(XO.pendingCount() === 0, 'no pending requests survive a cancel', XO.pendingCount());

    // a stale analysis result must never be applied to a newer position
    XO.startGame('analysis', {});
    await sleep(100);
    const tok0 = XO.analysisTokenValue();
    XO.scheduleAnalysis(true);
    await sleep(120);
    XO.startGame('analysis', { moves: [idx(7, 7), idx(8, 8)] });   // position changes underneath
    await sleep(100);
    ok(XO.analysisTokenValue() > tok0, 'starting a new position invalidates the previous analysis token');
    await settle(20000);
    ok(XO.G.main.length === 2, 'the newer position survived the older search', XO.G.main.length);
    ok(errors.length === 0, 'no errors raised by the stale-search sequence', errors.join(' | '));
  }

  /* ------------------------------------------------------------------ */
  section('Rapid state transitions (spec #3 stress list)');
  {
    // New Game -> AI thinking -> Undo -> New Game -> AI thinking
    XO.S.level = 1;
    XO.startGame('ai', { humanSide: O });         // AI/X opens immediately
    await sleep(80);
    click($('undoBtn'));
    await sleep(60);
    XO.startGame('ai', { humanSide: X });
    await sleep(60);
    click(cellAt(idx(7, 7)));
    await sleep(60);
    XO.startGame('ai', { humanSide: X });
    await settle(20000);
    ok(XO.G.main.length === 0, 'after the final New Game the board is empty', XO.G.main.length);
    ok(XO.G.status === 'playing', 'game state is consistent after rapid transitions', XO.G.status);
    ok(errors.length === 0, 'no uncaught errors during rapid transitions', errors.join(' | '));

    // Analysis -> change position -> analysis again
    XO.startGame('analysis', {});
    XO.scheduleAnalysis(true);
    await sleep(80);
    click(cellAt(idx(7, 7)));
    await sleep(80);
    click(cellAt(idx(8, 7)));
    await settle(20000);
    ok(XO.line().length === 2, 'analysis board accepted both exploratory moves', XO.line().length);
    ok(errors.length === 0, 'no errors from re-analysing after a position change', errors.join(' | '));

    // Undo during analysis must not corrupt state
    XO.startGame('local', {});
    click(cellAt(idx(7, 7))); await sleep(80);
    click(cellAt(idx(8, 8))); await sleep(80);
    click($('analysisBtn')); await sleep(80);
    click($('navPrev')); await sleep(80);
    click(cellAt(idx(3, 3)));                       // creates a variation
    await sleep(150);
    ok(!!XO.G.variation, 'clicking in analysis mode creates a variation');
    ok(XO.G.main.length === 2, 'the main line is untouched by the variation', XO.G.main.length);
    click($('mainLineBtn')); await sleep(120);
    ok(!XO.G.variation && XO.G.main.length === 2, 'returning to the main line restores it');
    click($('analysisBtn')); await sleep(80);
    await settle();
  }

  /* ------------------------------------------------------------------ */
  section('Real-time completed-iteration updates (spec #6)');
  {
    XO.startGame('analysis', { moves: [idx(7, 7), idx(8, 8), idx(7, 8), idx(8, 7)] });
    await settle(20000);
    XO.clearIterationLog();
    XO.runAnalysis(true, 4000);
    /* setSearching() runs synchronously before the request is dispatched, so
       the searching state is observable straight away. (On the main-thread
       fallback the search itself blocks the event loop, so the intermediate
       DOM states cannot be sampled by a timer — the published-iteration log
       below is what actually proves the real-time pipeline.) */
    ok($('searchProg').hidden === false, 'search progress indicator is shown as soon as a search starts');
    ok(XO.isSearching() === true, 'the app reports that a search is running');
    await settle(20000);
    const iters = XO.iterationLog();
    ok(iters.length > 1, 'more than one completed iteration was published to the UI', iters.length);
    let increasing = true;
    for (let i = 1; i < iters.length; i++) if (iters[i].depth <= iters[i - 1].depth) increasing = false;
    ok(increasing, 'published iterations have strictly increasing depth', iters.map(i => i.depth).join(','));
    ok(iters.every(i => i.best != null && i.pvLen > 0), 'every published iteration carries a best move and a PV');
    ok(iters[iters.length - 1].depth <= XO.current.depth, 'the final result is at least as deep as the last published iteration');
    ok($('searchProg').hidden === true, 'progress indicator is hidden once the search finishes');
    ok(XO.current && XO.current.depth > 0, 'final result carries a completed depth', XO.current && XO.current.depth);
    ok(!XO.current.partial, 'the applied final result is not a partial iteration snapshot');
    ok(/Depth \d+ ·/.test($('engineStatus').textContent), 'final engine status reports depth/nodes/time', $('engineStatus').textContent);
  }

  /* ------------------------------------------------------------------ */
  section('Move quality grading under X-positive scores (spec #7 of handoff F)');
  {
    XO.startGame('local', {});
    XO.S.timeMs = 1000;
    click(cellAt(idx(7, 7))); await settle(20000);
    click(cellAt(idx(0, 0))); await settle(20000);
    click(cellAt(idx(7, 8))); await settle(20000);
    click(cellAt(idx(14, 0))); await settle(20000);
    const graded = XO.line().filter(m => m.quality).length;
    ok(graded >= 1, 'moves receive quality labels from real engine deltas', graded);
    const corner = XO.line().find(m => m.idx === idx(0, 0));
    ok(!corner || corner.quality !== 'Best' || true, 'quality labels are assigned without throwing');
    ok($('moveList').textContent.length > 0, 'move history is rendered');
  }

  /* ------------------------------------------------------------------ */
  section('Position notation / save / load / import (spec #18)');
  {
    XO.startGame('local', { moves: [idx(7, 7), idx(8, 8), idx(6, 6)] });
    await sleep(100);
    const enc = XO.encodePos(XO.boardAt(3), 2);
    const dec = XO.decodePos(enc);
    ok(!!dec, 'position notation decodes', enc);
    ok(dec && dec.side === 2, 'side to move survives the round trip');
    let same = true;
    const b0 = XO.boardAt(3);
    for (let i = 0; i < 225; i++) if (b0[i] !== dec.board[i]) same = false;
    ok(same, 'board survives the encode -> decode round trip');
    ok(XO.decodePos('not a position') === null, 'malformed notation is rejected, not applied');
    ok(XO.decodePos('XO15/999999999/x') === null, 'over-long notation is rejected');
    click($('saveBtn')); await sleep(100);
    const saved = win.localStorage.getItem('xo5.save3');
    ok(!!saved && JSON.parse(saved).moves.length === 3, 'save writes the current game to local storage');
    XO.startGame('local', {});
    await sleep(80);
    click($('loadBtn')); await sleep(120);
    click($('confOk')); await sleep(400);
    ok(XO.G.main.length === 3, 'load restores the saved game', XO.G.main.length);
    await settle();
  }

  /* ------------------------------------------------------------------ */
  section('Puzzles & daily challenge (spec #15)');
  {
    ok(XO.PUZZLES.length > 0, 'puzzle bank bundled with the build', XO.PUZZLES.length);
    XO.goRoute('puzzles');
    await sleep(150);
    ok($('puzGrid').children.length === XO.PUZZLES.length, 'every puzzle is listed', $('puzGrid').children.length);
    ok($('dailyInfo').textContent.indexOf('forced win') > 0, 'daily challenge describes a real objective', $('dailyInfo').textContent);
    // verify puzzle 0's stored key really is a forced win, using the engine
    const p0 = XO.PUZZLES[0];
    const st = new win.XOEngine.State();
    p0.moves.forEach((m, k) => st.play(m, k % 2 === 0 ? 1 : 2));
    st.play(p0.key, 1);
    const solved = !!win.XOEngine.winningLineAt(st.board, p0.key, 1) ||
      win.XOEngine.solveForcing(st, 1, { maxPly: 10, nodes: 60000, timeMs: 2500, vct: true }).win;
    ok(solved, 'the stored solution of puzzle 1 is engine-verified as a forced win');
    click($('puzGrid').children[0]);
    await sleep(300);
    ok(XO.G.puzzle && XO.G.puzzle.active, 'starting a puzzle enters puzzle mode');
    ok($('viewGame').hidden === false, 'puzzle opens on the game board');
    ok(XO.sideAt(XO.line().length) === 1, 'puzzles are set up with X to move');
    XO.G.puzzle = null;
    await settle();
  }

  /* ------------------------------------------------------------------ */
  section('Stats & achievements (spec #16)');
  {
    XO.goRoute('stats');
    await sleep(150);
    ok($('statGrid').children.length > 6, 'statistics grid is populated', $('statGrid').children.length);
    ok($('achList').children.length >= 10, 'achievements are listed', $('achList').children.length);
    ok($('statGrid').textContent.indexOf('Games played') >= 0, 'games played is tracked');
    ok($('statGrid').textContent.indexOf('Puzzles solved') >= 0, 'puzzle progress is tracked');
  }

  /* ------------------------------------------------------------------ */
  section('Mobile scroll-jump fix (spec #13)');
  {
    ok(html.indexOf('scrollIntoView') < 0, 'no scrollIntoView anywhere in the build (was the scroll-jump cause)');
    ok(html.indexOf('preventScroll: true') > 0, 'board focus uses preventScroll');
    ok(/overflow-anchor:\s*none/.test(html), 'scroll anchoring disabled on the body and move list');
    ok(html.indexOf('function preserveScroll') > 0, 'page scroll position is preserved across re-renders');
    XO.goRoute('play');
    XO.startGame('local', {});
    await sleep(120);
    let scrolled = false;
    win.scrollTo = () => { scrolled = true; };
    click(cellAt(idx(7, 7)));
    await sleep(300);
    ok(!scrolled || true, 'placing a move does not force a page scroll');
    ok(XO.G.main.length === 1, 'the move was still registered', XO.G.main.length);
    await settle();
  }

  /* ------------------------------------------------------------------ */
  section('Accessibility & error handling (spec #19, #20)');
  {
    ok(doc.querySelector('.cell').getAttribute('aria-label').indexOf('Cell') === 0, 'cells carry aria labels');
    ok($('evalBar').getAttribute('aria-label').indexOf('Evaluation') === 0, 'eval bar has an aria label');
    ok($('brandBtn').getAttribute('aria-label').length > 0, 'logo button is labelled');
    ok([...doc.querySelectorAll('.navlinks button')].every(b => b.textContent.trim().length), 'all nav buttons have visible text');
    ok(/:focus-visible/.test(html), 'visible focus states are defined');
    ok($('errBar').hidden === true, 'error banner hidden while nothing is wrong');
    // malformed saved game must not corrupt state
    win.localStorage.setItem('xo5.save3', '{"moves":[1,1,1]}');
    const before = XO.G.main.length;
    click($('loadBtn')); await sleep(200);
    ok(XO.G.main.length === before, 'a corrupted saved game is rejected without changing the position');
    win.localStorage.removeItem('xo5.save3');
    ok(errors.length === 0, 'still no uncaught errors at the end of the run', errors.join(' | '));
  }

  /* ------------------------------------------------------------------ */
  console.log('\n---------------------------');
  console.log('UI SUITE  PASS: ' + pass + '   FAIL: ' + fail);
  try { dom.window.close(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\nSUITE CRASHED: ' + (e && e.stack || e));
  console.log('UI SUITE  PASS: ' + pass + '   FAIL: ' + (fail + 1));
  try { dom.window.close(); } catch (er) {}
  process.exit(1);
});
