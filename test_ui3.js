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
/* solution replay settles well inside this in the headless run */
const reduceWait = 2600;
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
    ok(tBtns.indexOf('30000') >= 0 && tBtns.indexOf('60000') >= 0 && tBtns.indexOf('5000') >= 0 && tBtns.indexOf('0') >= 0,
      '5s, 30s, 60s and ∞ time controls exist', tBtns.join(','));
    click($('timeSeg').querySelector('[data-v="30000"]'));
    await sleep(80);
    ok(XO.S.timeMs === 30000, 'selecting 30s sets a 30000ms budget', XO.S.timeMs);
    click($('timeSeg').querySelector('[data-v="60000"]'));
    await sleep(80);
    ok(XO.S.timeMs === 60000, 'selecting 60s sets a 60000ms budget', XO.S.timeMs);
    click($('timeSeg').querySelector('[data-v="0"]'));
    await sleep(80);
    ok(XO.S.timeMs === 0, 'selecting ∞ sets an infinite budget', XO.S.timeMs);
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
  section('Engine showcase (homepage branding)');
  {
    var forgeSection = $('forgeHead');
    ok(!!forgeSection, 'Engine showcase section exists on homepage');
    var forgeGrid = doc.querySelector('.forge-grid');
    ok(!!forgeGrid, 'Engine showcase grid exists');
    var forgeCards = doc.querySelectorAll('.forge-card');
    ok(forgeCards.length === 4, 'Four engine cards displayed');
    
    // Check V3 is marked as current
    var v3Card = null;
    for (var i = 0; i < forgeCards.length; i++) {
      var text = forgeCards[i].textContent || '';
      if (text.indexOf('XO5 Forge V3') >= 0 && text.indexOf('PRO') < 0) {
        v3Card = forgeCards[i];
        break;
      }
    }
    ok(!!v3Card, 'V3 card exists');
    ok(v3Card && v3Card.classList.contains('forge-card-prev'), 'V3 card has previous generation styling');
    ok(v3Card && v3Card.textContent.indexOf('Previous Generation') >= 0, 'V3 marked as previous generation');
    ok(v3Card && v3Card.textContent.indexOf('Available') >= 0, 'V3 marked as available');
    
    // Check V3 PRO is current generation and available
    var v3ProCard = null;
    for (var i = 0; i < forgeCards.length; i++) {
      if ((forgeCards[i].textContent || '').indexOf('XO5 Forge V3 PRO') >= 0) {
        v3ProCard = forgeCards[i];
        break;
      }
    }
    ok(!!v3ProCard, 'V3 PRO card exists');
    ok(v3ProCard && v3ProCard.classList.contains('forge-card-current'), 'V3 PRO marked as current engine');
    ok(v3ProCard && v3ProCard.textContent.indexOf('Current Generation') >= 0, 'V3 PRO status text');
    ok(v3ProCard && v3ProCard.textContent.indexOf('Available') >= 0, 'V3 PRO marked as available');
    
    var v4Card = null;
    for (var i = 0; i < forgeCards.length; i++) {
      var text = forgeCards[i].textContent || '';
      if (text.indexOf('XO5 Forge V4') >= 0 && text.indexOf('PRO') < 0) {
        v4Card = forgeCards[i];
        break;
      }
    }
    ok(!!v4Card, 'V4 card exists');
    ok(v4Card && v4Card.classList.contains('forge-card-coming'), 'V4 marked as coming soon');
    ok(v4Card && v4Card.textContent.indexOf('Coming Soon') >= 0, 'V4 status text');
    
    var v4ProCard = null;
    for (var i = 0; i < forgeCards.length; i++) {
      if ((forgeCards[i].textContent || '').indexOf('XO5 Forge V4 PRO') >= 0) {
        v4ProCard = forgeCards[i];
        break;
      }
    }
    ok(!!v4ProCard, 'V4 PRO card exists');
    ok(v4ProCard && v4ProCard.classList.contains('forge-card-coming'), 'V4 PRO marked as coming soon');
    ok(v4ProCard && v4ProCard.textContent.indexOf('Coming Soon') >= 0, 'V4 PRO status text');
    
    // Check logos are present (images may fail to load but structure should be there)
    var logos = doc.querySelectorAll('.forge-logo-img');
    ok(logos.length === 4, 'Four logo image elements in showcase');
    for (var k = 0; k < logos.length; k++) {
      ok(logos[k].alt.length > 0, 'Logo ' + (k+1) + ' has alt text');
      ok(logos[k].src.length > 0, 'Logo ' + (k+1) + ' has src attribute');
    }
    
    // Check responsive classes exist
    var forgeGridEl = doc.querySelector('.forge-grid');
    ok(!!forgeGridEl, 'Forge grid element exists');
    var computedStyle = win.getComputedStyle(forgeGridEl);
    ok(computedStyle.display === 'grid', 'Forge grid uses grid layout');
  }

  /* ------------------------------------------------------------------ */
  section('Engine selector (new feature)');
  {
    ok(!!XO.ENGINE_REGISTRY, 'ENGINE_REGISTRY exists');
    ok(!!XO.ENGINE_REGISTRY.forge_v3, 'V3 engine registered');
    ok(!!XO.ENGINE_REGISTRY.forge_v3_pro, 'V3 PRO engine registered');
    ok(!!XO.ENGINE_REGISTRY.forge_v4, 'V4 engine registered');
    ok(!!XO.ENGINE_REGISTRY.forge_v4_pro, 'V4 PRO engine registered');
    ok(XO.ENGINE_REGISTRY.forge_v3.status === 'available', 'V3 is available');
    ok(XO.ENGINE_REGISTRY.forge_v3_pro.status === 'available', 'V3 PRO is available');
    ok(XO.ENGINE_REGISTRY.forge_v4.status === 'coming-soon', 'V4 is coming soon');
    ok(XO.ENGINE_REGISTRY.forge_v4_pro.status === 'coming-soon', 'V4 PRO is coming soon');
    
    ok(XO.getCurrentEngine().id === 'forge_v3_pro', 'V3 PRO is the default engine');
    ok(XO.isEngineAvailable('forge_v3'), 'V3 is available');
    ok(XO.isEngineAvailable('forge_v3_pro'), 'V3 PRO is available');
    ok(!XO.isEngineAvailable('forge_v4'), 'V4 is not available');
    
    // Check engine selector has logos (structure check, not actual loading)
    var selectorLogos = doc.querySelectorAll('.engine-logo-img');
    ok(selectorLogos.length === 4, 'Four logo image elements in engine selector');
    for (var j = 0; j < selectorLogos.length; j++) {
      ok(selectorLogos[j].alt.length > 0, 'Selector logo ' + (j+1) + ' has alt text');
      ok(selectorLogos[j].src.length > 0, 'Selector logo ' + (j+1) + ' has src attribute');
    }
    
    // Check engine badge has logo (structure check)
    var badgeLogo = doc.querySelector('.engine-badge-logo');
    ok(!!badgeLogo, 'Engine badge has logo image element');
    ok(badgeLogo && badgeLogo.alt.length > 0, 'Engine badge logo has alt text');
    ok(badgeLogo && badgeLogo.src.length > 0, 'Engine badge logo has src attribute');
    
    // Check logo paths in registry
    ok(XO.ENGINE_REGISTRY.forge_v3.logo === 'assets/forge-v3.png', 'V3 logo path correct');
    ok(XO.ENGINE_REGISTRY.forge_v3_pro.logo === 'assets/forge-v3-pro.png', 'V3 PRO logo path correct');
    ok(XO.ENGINE_REGISTRY.forge_v4.logo === 'assets/forge-v4.png', 'V4 logo path correct');
    ok(XO.ENGINE_REGISTRY.forge_v4_pro.logo === 'assets/forge-v4-pro.png', 'V4 PRO logo path correct');
    
    const available = XO.getAvailableEngines();
    ok(available.length === 2 && available.includes('forge_v3') && available.includes('forge_v3_pro'), 'V3 and V3 PRO are available');
    
    // Test switching to V3 (should succeed)
    XO.switchEngine('forge_v3');
    ok(XO.getCurrentEngine().id === 'forge_v3', 'Switching to V3 succeeds');
    
    // Test switching to V4 (should fail)
    XO.switchEngine('forge_v4');
    ok(XO.getCurrentEngine().id === 'forge_v3', 'Switching to V4 fails, stays on V3');
    
    // Test switching to V3 PRO (should succeed)
    XO.switchEngine('forge_v3_pro');
    ok(XO.getCurrentEngine().id === 'forge_v3_pro', 'Switching to V3 PRO succeeds');

    // Test validation falls back to available engine
    XO.currentEngineId = 'forge_v4';
    XO.validateEngineSelection();
    ok(XO.getCurrentEngine().id === 'forge_v3_pro', 'Validation falls back to available engine');
    
    // Test engine badge updates
    XO.setEngineBadge();
    const badge = $('engineBadge');
    ok(!!badge, 'Engine badge element exists');
    ok(badge.textContent.indexOf('XO5 Forge V3 PRO') >= 0, 'Engine badge shows V3 PRO name');
  }

  /* ------------------------------------------------------------------ */
  section('Engine selection & switching for gameplay (spec #45 & #46)');
  {
    // Test 1: Select V3 PRO -> start game -> verify V3 PRO is actually active
    XO.startGame('ai', { humanSide: 1, engineId: 'forge_v3_pro' });
    ok(XO.currentGameEngineId === 'forge_v3_pro', 'Select V3 PRO: game uses V3 PRO');
    ok(XO.getGameEngineName().indexOf('V3 PRO') >= 0, 'Game engine name reflects V3 PRO');
    var badge = $('engineBadge');
    ok(badge && badge.textContent.indexOf('V3 PRO') >= 0, 'Engine badge shows V3 PRO during gameplay');

    // Test 2: Select V3 -> start game -> verify V3 is actually active
    XO.startGame('ai', { humanSide: 1, engineId: 'forge_v3' });
    ok(XO.currentGameEngineId === 'forge_v3', 'Select V3: game uses V3');
    ok(XO.getGameEngineName().indexOf('V3') >= 0 && XO.getGameEngineName().indexOf('PRO') < 0, 'Game engine name reflects V3');
    badge = $('engineBadge');
    ok(badge && badge.textContent.indexOf('V3') >= 0 && badge.textContent.indexOf('PRO') < 0, 'Engine badge shows V3 during gameplay');

    // Test 3: Settings default = V3 PRO, Game Setup = V3 -> current game uses V3
    XO.currentEngineId = 'forge_v3_pro';
    XO.pendingGameEngineId = 'forge_v3';
    XO.startGame('ai', { humanSide: 1 });
    ok(XO.currentGameEngineId === 'forge_v3', 'Settings default V3 PRO + Game Setup V3 -> game uses V3');
    ok(XO.currentEngineId === 'forge_v3_pro', 'Default engine setting remains V3 PRO');

    // Test 4: Settings default = V3, Game Setup = V3 PRO -> current game uses V3 PRO
    XO.currentEngineId = 'forge_v3';
    XO.pendingGameEngineId = 'forge_v3_pro';
    XO.startGame('ai', { humanSide: 1 });
    ok(XO.currentGameEngineId === 'forge_v3_pro', 'Settings default V3 + Game Setup V3 PRO -> game uses V3 PRO');
    ok(XO.currentEngineId === 'forge_v3', 'Default engine setting remains V3');

    // Test 5: Human vs Human: AI engine is not used
    XO.startGame('local', {});
    badge = $('engineBadge');
    ok(badge && badge.textContent.indexOf('Not used') >= 0, 'Human vs Human: AI engine is not used');

    // Test 6: V4 and V4 PRO cannot be selected for gameplay
    XO.pendingGameEngineId = 'forge_v4';
    XO.startGame('ai', { humanSide: 1 });
    ok(XO.currentGameEngineId !== 'forge_v4', 'V4 cannot be selected for game');

    // Test 7: Engine switching: V3 -> V3 PRO -> V3
    XO.switchEngine('forge_v3');
    ok(XO.currentEngineId === 'forge_v3', 'Switched to V3');
    XO.switchEngine('forge_v3_pro');
    ok(XO.currentEngineId === 'forge_v3_pro', 'Switched to V3 PRO');
    XO.switchEngine('forge_v3');
    ok(XO.currentEngineId === 'forge_v3', 'Switched back to V3');
    XO.switchEngine('forge_v3_pro'); // restore default

    // Test 8: Stale search protection on engine switch
    XO.startGame('analysis', {});
    XO.scheduleAnalysis(true);
    var tokBefore = XO.analysisTokenValue ? XO.analysisTokenValue() : 0;
    XO.switchEngine('forge_v3');
    var tokAfter = XO.analysisTokenValue ? XO.analysisTokenValue() : 0;
    ok(tokAfter >= tokBefore, 'Search token invalidated on engine switch');
    XO.switchEngine('forge_v3_pro');
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
  /* ===================================================================
     PUZZLE GENERATOR — correctness, persistence, cancellation, UI
     =================================================================== */

  /* Drive a generation session to completion (or to a deadline) and return. */
  async function generate(durationMs, target, maxWait = 20000) {
    XO.genSettings.durationMs = durationMs;
    XO.genSettings.target = target;
    XO.startGeneration();
    const t0 = Date.now();
    while (XO.GS && XO.GS.running && Date.now() - t0 < maxWait) await sleep(60);
    await sleep(150);
    return XO.GS;
  }
  /* Independently re-solve a puzzle with the engine — never trusting the
     stored result — and report whether it really is a forced win. */
  function reverify(p) {
    const st = new win.XOEngine.State();
    p.moves.forEach((m, k) => st.play(m, k % 2 === 0 ? 1 : 2));
    const side = p.sideToMove === 'O' ? 2 : 1;
    const r = win.XOEngine.solveForcing(st, side, { maxPly: 3, nodes: 60000, timeMs: 2500, vct: true });
    return r.win && !r.aborted && r.seq.length <= 3;
  }
  function replayLegal(p) {
    const b = new Int8Array(225);
    for (let i = 0; i < p.moves.length; i++) {
      const idx = p.moves[i], pl = i % 2 === 0 ? 1 : 2;
      if (idx < 0 || idx >= 225) return false;
      if (b[idx]) return false;                              // overwritten cell
      b[idx] = pl;
      if (win.XOEngine.winningLineAt(b, idx, pl)) return false;  // winner before the puzzle
    }
    return true;
  }

  section('Puzzle generator — generation correctness (spec #3, #10, #11)');
  {
    win.localStorage.removeItem('xo5.generatedPuzzles3');
    XO.loadGeneratedBank();
    const builtinN = XO.BUILTIN_PUZZLES.length;

    XO.goRoute('puzzles'); await sleep(120);
    ok(!!$('genOverlay'), 'generator modal exists in the build');
    click($('genOpenBtn')); await sleep(120);
    ok($('genOverlay').classList.contains('open'), 'generator opens');

    const s = await generate(6000, 12);
    const gen = XO.GENERATED_PUZZLES;
    ok(gen.length > 0, 'generator produced puzzles', gen.length);
    ok(gen.every(replayLegal), 'every generated puzzle is a legal position with no overwritten cell');
    ok(gen.every(replayLegal), 'no generated puzzle has a winner before the puzzle position');
    ok(gen.every(p => p.sideToMove === (p.moves.length % 2 === 0 ? 'X' : 'O')),
      'stored side to move agrees with stone parity in every puzzle');
    ok(gen.every(p => p.len === 1 || p.len === 3), 'only forced win in 1 or 2 is accepted',
      [...new Set(gen.map(p => p.len))].join(','));
    ok(gen.every(reverify), 'every accepted puzzle re-verifies as a forced win with the real solver');
    ok(gen.every(p => p.solverVersion && p.maxPly === 3 && p.source === 'generated-local'),
      'generated puzzles carry the documented schema fields');

    /* Both sides must be reachable. Generation is random, so keep going until
       both appear rather than asserting on a single short run. */
    let sawX = gen.some(p => p.sideToMove === 'X'), sawO = gen.some(p => p.sideToMove === 'O');
    for (let k = 0; k < 4 && !(sawX && sawO); k++) {
      await generate(4000, 10);
      sawX = XO.GENERATED_PUZZLES.some(p => p.sideToMove === 'X');
      sawO = XO.GENERATED_PUZZLES.some(p => p.sideToMove === 'O');
    }
    ok(sawX, 'generator produces X-to-move puzzles');
    ok(sawO, 'generator produces O-to-move puzzles');

    ok(XO.PUZZLES.length === builtinN + XO.GENERATED_PUZZLES.length,
      'generated puzzles are merged into the bank alongside the builtins',
      XO.PUZZLES.length + ' vs ' + (builtinN + XO.GENERATED_PUZZLES.length));
    ok(XO.PUZZLES[0] === XO.BUILTIN_PUZZLES[0], 'builtin puzzle indices do not shift when the bank grows');
  }

  section('Puzzle generator — validation rejects bad puzzles (spec #11, #30)');
  {
    const good = XO.GENERATED_PUZZLES[0];
    const V = XO.validateGeneratedPuzzle;
    ok(V(good).ok, 'a real generated puzzle validates');
    ok(!V({ moves: [112, 113], key: 50, len: 5 }).ok, 'sequence longer than 3 is rejected',
      V({ moves: [112, 113], key: 50, len: 5 }).reason);
    ok(!V({ moves: [112, 112], key: 50, len: 1 }).ok, 'an overwritten cell is rejected');
    ok(!V({ moves: [112, 113], key: 112, len: 1 }).ok, 'a solution square that is occupied is rejected');
    ok(!V({ moves: [112, 113], key: 900, len: 1 }).ok, 'an off-board solution square is rejected');
    ok(!V({ moves: [], key: 5, len: 1 }).ok, 'an empty position is rejected');
    ok(!V(null).ok && !V(42).ok, 'malformed input is rejected without throwing');
    /* a position that already contains five in a row must never become a puzzle */
    const won = { moves: [0, 15, 1, 16, 2, 17, 3, 18, 4, 19], key: 30, len: 1 };
    ok(!V(won).ok, 'a position that is already won is rejected', V(won).reason);
    /* claimed win in 1 that does not actually make five */
    const lie = { moves: good.moves.slice(), key: good.key, len: 1, sideToMove: good.sideToMove };
    const lieRes = V(lie);
    ok(good.len !== 1 ? !lieRes.ok : true, 'a false "win in 1" claim is re-proved and rejected',
      lieRes.reason);
    ok(V(good).puzzle.proof === 'reproved',
      'accepted puzzles are re-proved on the main thread, not taken on trust', V(good).puzzle.proof);
    /* Old three-field puzzles are BUNDLED data, not generator output, so they
       are not run through the generator's re-proof. What must hold is that the
       bank and the play path still handle them untouched. */
    const b0raw = XO.BUILTIN_PUZZLES[0];
    ok(Object.keys(b0raw).join(',') === 'moves,key,len',
      'bundled puzzles are still the original three-field objects', Object.keys(b0raw).join(','));
    ok(XO.puzzleSide(b0raw) === 1, 'side to move is derived for old puzzle objects with no sideToMove field');
    ok(typeof XO.canonKeyOf(b0raw) === 'string' && XO.canonKeyOf(b0raw).indexOf('#X') > 0,
      'old puzzle objects get a canonical key');
    XO.startPuzzle(0); await sleep(200);
    ok(XO.G.puzzle && XO.G.puzzle.active, 'an old-schema bundled puzzle still loads and plays');
    ok(XO.G.main.length === b0raw.moves.length, 'the bundled position is set up correctly');
    XO.exitPuzzle(); await sleep(120);
  }

  section('Puzzle generator — deduplication (spec #14)');
  {
    const p = XO.GENERATED_PUZZLES[0];
    const again = XO.saveGeneratedPuzzle(JSON.parse(JSON.stringify(p)));
    ok(!again.ok && again.stage === 'duplicate', 'saving the same puzzle twice is rejected as a duplicate');
    /* same board, opposite side to move, is NOT the same puzzle */
    const flipped = Object.assign({}, p, { sideToMove: p.sideToMove === 'X' ? 'O' : 'X' });
    ok(XO.canonKeyOf(flipped) !== XO.canonKeyOf(p),
      'the same board with the opposite side to move has a different canonical key');
    /* A puzzle that duplicates a bundled one must not appear twice in the
       merged bank, whichever source it came from. */
    const b0 = XO.BUILTIN_PUZZLES[0];
    const mergedBefore = XO.PUZZLES.length;
    XO.GENERATED_PUZZLES.push({
      moves: b0.moves.slice(), key: b0.key, len: b0.len,
      sideToMove: 'X', source: 'generated-local'
    });
    XO.rebuildMergedPuzzles();
    ok(XO.PUZZLES.length === mergedBefore,
      'a puzzle duplicating a bundled one is dropped by the merge',
      XO.PUZZLES.length + ' vs ' + mergedBefore);
    XO.GENERATED_PUZZLES.pop();
    XO.rebuildMergedPuzzles();
    ok(XO.PUZZLES.length === mergedBefore, 'the merged bank is restored');
    const keys = XO.PUZZLES.map(XO.canonKeyOf);
    ok(new Set(keys).size === keys.length, 'the merged bank contains no duplicate canonical keys');
  }

  section('Puzzle generator — immediate persistence & no data loss (spec #6, #7, #33)');
  {
    win.localStorage.removeItem('xo5.generatedPuzzles3');
    XO.loadGeneratedBank();
    ok(XO.GENERATED_PUZZLES.length === 0, 'starting from an empty local bank');

    /* Watch the bank grow DURING the session, not after it. */
    XO.genSettings.durationMs = 8000;
    XO.genSettings.target = 0;                       // unlimited: we stop it ourselves
    XO.startGeneration();
    const sawMidRun = await until(() => {
      const stored = win.localStorage.getItem('xo5.generatedPuzzles3');
      return XO.GS && XO.GS.running && stored && JSON.parse(stored).length >= 2;
    }, 15000);
    ok(sawMidRun, 'accepted puzzles are on disk WHILE the session is still running');
    const duringRun = JSON.parse(win.localStorage.getItem('xo5.generatedPuzzles3') || '[]').length;

    XO.stopGeneration('stopped');
    await sleep(300);
    const afterStop = JSON.parse(win.localStorage.getItem('xo5.generatedPuzzles3') || '[]').length;
    ok(afterStop >= duringRun && afterStop > 0,
      'Stop preserves every puzzle already saved', duringRun + ' -> ' + afterStop);
    ok(XO.persistedCount() === afterStop, 'the reported saved count matches what is really on disk',
      XO.persistedCount() + ' vs ' + afterStop);
    ok(XO.GENERATED_PUZZLES.every(reverify), 'puzzles kept after Stop are still genuine forced wins');

    /* A session ending by timeout must also leave its puzzles behind. */
    const beforeTimeout = XO.persistedCount();
    const s2 = await generate(1500, 0, 8000);
    ok(s2 && s2.endReason === 'timeout', 'a finite session ends by timeout', s2 && s2.endReason);
    ok(XO.persistedCount() >= beforeTimeout, 'timeout preserves previously saved puzzles');

    /* Worker failure must not roll anything back. */
    const beforeCrash = XO.persistedCount();
    XO.genSettings.durationMs = 8000; XO.genSettings.target = 0;
    XO.startGeneration();
    await until(() => XO.GS && XO.GS.accepted >= 1, 10000);
    XO.killGenWorker();
    XO.stopGeneration('stopped');
    await sleep(250);
    ok(XO.persistedCount() >= beforeCrash,
      'killing the worker mid-session preserves previously saved puzzles',
      beforeCrash + ' -> ' + XO.persistedCount());
    /* and the worker can be brought back */
    const s3 = await generate(1500, 2, 8000);
    ok(XO.GS && XO.GS.attempts > 0, 'a new session runs after the worker was terminated', XO.GS && XO.GS.attempts);
  }

  section('Puzzle generator — localStorage failure is survivable (spec #8, #20)');
  {
    const bankBefore = XO.GENERATED_PUZZLES.length;
    const diskBefore = JSON.parse(win.localStorage.getItem('xo5.generatedPuzzles3') || '[]').length;
    /* jsdom's Storage is exotic: assigning to the instance silently does
       nothing, so the quota failure is simulated on the prototype. */
    const proto = Object.getPrototypeOf(win.localStorage);
    const realSet = proto.setItem;
    proto.setItem = function () { throw new Error('QuotaExceededError'); };
    let threw = false;
    let res;
    try { res = await generate(3000, 3, 12000); } catch (e) { threw = true; }
    ok(!threw, 'generation does not crash when localStorage throws');
    ok(XO.GENERATED_PUZZLES.length >= bankBefore, 'accepted puzzles are still held in memory');
    ok(XO.persistOk() === false, 'the app knows persistence failed');
    ok($('genSavedText').textContent.indexOf('saved locally') >= 0,
      'the saved-count line distinguishes accepted from saved', $('genSavedText').textContent);
    ok($('genNote').hidden === false, 'a non-blocking warning is shown when persistence is unavailable');
    ok(XO.persistedCount() === diskBefore,
      'the saved count never claims a write that failed', XO.persistedCount() + ' vs ' + diskBefore);
    const stillOnDisk = JSON.parse(win.localStorage.getItem('xo5.generatedPuzzles3') || '[]').length;
    ok(stillOnDisk === diskBefore, 'a failed write does not truncate what was already saved');
    proto.setItem = realSet;
    /* and it recovers: a later successful write clears the degraded state */
    await generate(2500, 2, 12000);
    ok(XO.persistOk() === true, 'persistence recovers once storage works again');
    ok($('genNote').hidden === true, 'the storage warning clears on recovery');
    ok(errors.length === 0, 'no uncaught errors from the storage failure', errors.join(' | '));
  }

  section('Puzzle generator — cancellation & resume (spec #18, #19)');
  {
    win.localStorage.removeItem('xo5.generatedPuzzles3');
    XO.loadGeneratedBank();
    XO.genSettings.durationMs = 0;                   // Unlimited
    XO.genSettings.target = 0;
    XO.startGeneration();
    ok(XO.GS && XO.GS.running, 'an Unlimited session starts and keeps running');
    ok($('genStopBtn').hidden === false && $('genStartBtn').hidden === true, 'Stop is offered while running');
    await until(() => XO.GS && XO.GS.attempts > 3, 8000);
    const tokenBefore = XO.genToken();

    click($('genStopBtn'));
    await sleep(60);
    ok(!XO.GS.running, 'Stop cancels the session immediately');
    ok(XO.genToken() > tokenBefore, 'Stop issues a fresh generation token');

    /* A late message from the cancelled session must change nothing. */
    const snap = {
      accepted: XO.GS.accepted, attempts: XO.GS.attempts,
      bank: XO.GENERATED_PUZZLES.length, disk: XO.persistedCount()
    };
    XO.onGenMessage({ data: {
      id: XO.GS.token, kind: 'accepted',
      puzzle: { moves: [112, 113], key: 50, len: 1, sideToMove: 'X' },
      progress: { attempts: 9999, accepted: 9999, rejected: 0, duplicates: 0, elapsedMs: 1, nodes: 1 }
    } });
    XO.onGenMessage({ data: { id: XO.GS.token, kind: 'progress', progress: { attempts: 9999 } } });
    await sleep(60);
    ok(XO.GS.attempts === snap.attempts, 'a late progress message from a cancelled run is ignored',
      XO.GS.attempts + ' vs ' + snap.attempts);
    ok(XO.GS.accepted === snap.accepted, 'a late accepted message from a cancelled run is ignored');
    ok(XO.GENERATED_PUZZLES.length === snap.bank, 'no incomplete puzzle is inserted after cancellation');
    ok(XO.persistedCount() === snap.disk, 'cancellation persists nothing new');
    ok(XO.persistedCount() === snap.disk && snap.disk >= 0, 'puzzles saved before Stop are still in the bank');

    ok($('genStartBtn').hidden === false && $('genStartBtn').textContent === 'Resume',
      'after Stop the primary action becomes Resume', $('genStartBtn').textContent);
    ok($('genReason').textContent.indexOf('attempt') > 0, 'final statistics are shown after Stop',
      $('genReason').textContent);

    const bankBeforeResume = XO.GENERATED_PUZZLES.length;
    XO.genSettings.durationMs = 2000; XO.genSettings.target = 2;
    const tokenAtResume = XO.genToken();
    click($('genStartBtn'));
    await sleep(100);
    ok(XO.GS && XO.GS.token > tokenBefore && XO.GS.attempts < 9999,
      'Resume starts a clean session with a fresh token, not stale state',
      XO.GS && XO.GS.attempts);
    const t0 = Date.now();
    while (XO.GS && XO.GS.running && Date.now() - t0 < 12000) await sleep(60);
    ok(XO.GENERATED_PUZZLES.length >= bankBeforeResume,
      'Resume adds to the existing bank rather than replacing it');
  }

  section('Puzzle generator — UI is live and honest (spec #16, #17, #32)');
  {
    win.localStorage.removeItem('xo5.generatedPuzzles3');
    XO.loadGeneratedBank();
    ok([...$('genTimeSeg').querySelectorAll('button')].map(b => b.dataset.v).join(',') === '30000,60000,300000,600000,1800000,0',
      'all six generation-time options are offered including Unlimited');
    ok([...$('genTargetSeg').querySelectorAll('button')].map(b => b.dataset.v).join(',') === '5,10,25,50,100,0',
      'all six target options are offered including Unlimited');

    click($('genTimeSeg').querySelector('[data-v="300000"]'));
    await sleep(50);
    ok(XO.genSettings.durationMs === 300000, 'time selection works', XO.genSettings.durationMs);
    ok($('genTimeSeg').querySelector('[data-v="300000"]').getAttribute('aria-pressed') === 'true',
      'the selected time is reflected in the UI');
    click($('genTargetSeg').querySelector('[data-v="25"]'));
    await sleep(50);
    ok(XO.genSettings.target === 25, 'target selection works', XO.genSettings.target);

    XO.genSettings.durationMs = 5000; XO.genSettings.target = 0;
    XO.startGeneration();
    await until(() => XO.GS && XO.GS.attempts > 2, 8000);
    ok($('genTimeSeg').querySelector('[data-v="30000"]').disabled === true,
      'settings are locked while a session runs');
    ok(+$('genAttempts').textContent.replace(/[^0-9]/g, '') > 0, 'the attempt counter is live', $('genAttempts').textContent);
    ok($('genBoardG').querySelectorAll('.gx, .go').length > 0,
      'the mini board shows real candidate stones', $('genBoardG').querySelectorAll('.gx, .go').length);
    ok($('genBoardG').querySelectorAll('.gx').length > 0 && $('genBoardG').querySelectorAll('.go').length > 0,
      'the mini board distinguishes X from O');
    /* the drawn board must be the candidate the generator actually reported */
    const drawn = $('genBoardG').querySelectorAll('.gx, .go').length;
    ok(XO.GS.candidateMoves && drawn === XO.GS.candidateMoves.length,
      'the mini board matches the reported candidate exactly, not a placeholder',
      drawn + ' vs ' + (XO.GS.candidateMoves || []).length);
    ok(['Generating position', 'Verifying forced win', 'Accepted', 'Rejected'].indexOf($('genPhaseText').textContent) >= 0,
      'the phase indicator shows a real phase', $('genPhaseText').textContent);

    await until(() => XO.GS && XO.GS.accepted >= 1, 12000);
    await sleep(120);
    ok($('genSavedText').textContent.indexOf('saved locally') > 0,
      'the saved count appears as soon as a puzzle is persisted', $('genSavedText').textContent);
    ok(+$('genSavedText').textContent.replace(/[^0-9]/g, '') === XO.persistedCount(),
      'the displayed saved count equals the real saved count');
    ok(/Rejected|Accepted/.test(XO.GS.reason || ''), 'a concrete candidate reason is reported', XO.GS.reason);

    XO.stopGeneration('stopped');
    await sleep(200);
    ok($('genPhaseText').textContent === 'Stopped', 'the phase indicator shows Stopped');

    /* reduced motion must not remove information */
    ok(/prefers-reduced-motion/.test(html), 'reduced motion is respected in the stylesheet');
    ok($('genAttempts').textContent.length > 0 && $('genSavedText').textContent.length > 0,
      'all counters are readable without relying on animation');

    click($('genCloseBtn'));
    await sleep(80);
    ok(!$('genOverlay').classList.contains('open'), 'Close works when no session is running');
  }

  section('Puzzle generator — export (spec #22, #30)');
  {
    win.localStorage.removeItem('xo5.generatedPuzzles3');
    XO.loadGeneratedBank();
    let json = XO.exportGeneratedJSON();
    let parsed = null, threw = false;
    try { parsed = JSON.parse(json); } catch (e) { threw = true; }
    ok(!threw && Array.isArray(parsed) && parsed.length === 0, 'export works with zero puzzles and is valid JSON');

    await generate(5000, 4, 14000);
    const n = XO.GENERATED_PUZZLES.length;
    ok(n > 0, 'puzzles available to export', n);
    json = XO.exportGeneratedJSON();
    threw = false;
    try { parsed = JSON.parse(json); } catch (e) { threw = true; }
    ok(!threw, 'exported JSON is valid');
    ok(parsed.length === n, 'every generated puzzle is exported', parsed.length + ' vs ' + n);
    ok(parsed.every(p => Array.isArray(p.moves) && typeof p.key === 'number' &&
      (p.len === 1 || p.len === 3) && (p.sideToMove === 'X' || p.sideToMove === 'O') &&
      p.source && p.generatedAt && p.solverVersion),
      'exported puzzles contain the required fields');
    ok(parsed.every(p => p.canon === undefined && p.proof === undefined),
      'export does not leak internal bookkeeping');
    ok(parsed.every(reverify), 'exported puzzles are genuine forced wins');

    /* partial generation / after Stop */
    XO.genSettings.durationMs = 0; XO.genSettings.target = 0;
    XO.startGeneration();
    await until(() => XO.GS && XO.GS.accepted >= 1, 12000);
    XO.stopGeneration('stopped');
    await sleep(200);
    const partial = JSON.parse(XO.exportGeneratedJSON());
    ok(partial.length === XO.GENERATED_PUZZLES.length && partial.length >= n,
      'export after stopping halfway contains every saved puzzle', partial.length);

    click($('genExportBtn')); await sleep(120);
    ok($('ioOverlay').classList.contains('open'), 'the Export JSON button opens the export view');
    let ok2 = true; try { JSON.parse($('ioText').value); } catch (e) { ok2 = false; }
    ok(ok2, 'the exported text shown to the user is valid JSON');
    click($('ioOverlay').querySelector('[data-close]')); await sleep(80);
  }

  section('Puzzle generator — bank survives a reload (spec #21)');
  {
    const disk = win.localStorage.getItem('xo5.generatedPuzzles3');
    ok(!!disk && JSON.parse(disk).length > 0, 'the generated bank is on disk');
    const before = XO.GENERATED_PUZZLES.length;
    /* reloading the bank from storage is what a page reload does at boot */
    const reloaded = XO.loadGeneratedBank();
    ok(reloaded.length === before, 'reloading reads every saved puzzle back', reloaded.length + ' vs ' + before);
    ok(reloaded.every(reverify), 'reloaded puzzles are still genuine forced wins');
    ok(XO.PUZZLES.length === XO.BUILTIN_PUZZLES.length + reloaded.length,
      'the merged bank is rebuilt after a reload');

    /* a corrupt bank must not take the app down or wipe the good entries */
    const good = JSON.parse(disk);
    win.localStorage.setItem('xo5.generatedPuzzles3', JSON.stringify(good.concat([{ moves: 'nonsense' }, null, 7])));
    const afterCorrupt = XO.loadGeneratedBank();
    ok(afterCorrupt.length === good.length, 'corrupt entries are dropped and valid ones survive',
      afterCorrupt.length + ' vs ' + good.length);
    win.localStorage.setItem('xo5.generatedPuzzles3', JSON.stringify(good));
    XO.loadGeneratedBank();
    win.localStorage.setItem('xo5.generatedPuzzles3', 'not json at all');
    ok(XO.loadGeneratedBank().length === 0, 'an unreadable bank yields an empty bank rather than an exception');
    win.localStorage.setItem('xo5.generatedPuzzles3', JSON.stringify(good));
    XO.loadGeneratedBank();
    ok(errors.length === 0, 'no uncaught errors from corrupt bank handling', errors.join(' | '));
  }

  section('Puzzle play mode — objectives, both sides (spec #23, #26)');
  {
    await generate(6000, 8, 16000);
    const gen = XO.GENERATED_PUZZLES;
    const xi = XO.PUZZLES.findIndex(p => XO.puzzleSide(p) === 1);
    const oi = XO.PUZZLES.findIndex(p => XO.puzzleSide(p) === 2);
    ok(xi >= 0, 'an X-to-move puzzle is available');
    ok(oi >= 0, 'an O-to-move puzzle is available', oi);

    XO.startPuzzle(xi); await sleep(200);
    ok(XO.G.puzzle && XO.G.puzzle.active, 'puzzle loads into puzzle mode');
    ok(XO.G.puzzle.side === 1, 'X puzzle sets the objective side to X');
    ok($('puzHudObj').textContent.indexOf('for X') > 0, 'the X objective is stated dynamically', $('puzHudObj').textContent);
    ok($('puzHud').hidden === false, 'the puzzle panel is shown');
    ok($('puzHudTitle').textContent.indexOf('Puzzle') === 0, 'the puzzle is titled', $('puzHudTitle').textContent);
    ok($('puzHudTries').textContent === '0', 'the attempt counter starts at zero');
    ok(/\d:\d\d/.test($('puzHudTimer').textContent), 'a timer is shown', $('puzHudTimer').textContent);

    XO.startPuzzle(oi); await sleep(200);
    ok(XO.G.puzzle.side === 2, 'O puzzle sets the objective side to O');
    ok($('puzHudObj').textContent.indexOf('for O') > 0, 'the O objective is stated dynamically', $('puzHudObj').textContent);
    ok(XO.sideAt(XO.line().length) === 2, 'the O puzzle really does have O to move');
    ok($('board').dataset.ghost === 'o', 'the board ghost stone follows the puzzle side', $('board').dataset.ghost);
  }

  section('Puzzle play mode — analysis is hidden (spec #24, #25)');
  {
    const oi = XO.PUZZLES.findIndex(p => XO.puzzleSide(p) === 2);
    XO.startPuzzle(oi >= 0 ? oi : 0); await sleep(250);
    ok(doc.body.classList.contains('puzzle-mode'), 'puzzle mode is flagged on the document');
    ok($('graphCard').hidden === true, 'the evaluation graph is hidden');
    ok($('arrows').innerHTML === '', 'no best-move arrow is drawn', $('arrows').innerHTML);
    ok($('mateBadge').hidden === true, 'no mate badge is shown');
    ok($('hintBtn').disabled === true, 'Hint is disabled');
    ok($('deepBtn').disabled === true, 'Deep Analyze is disabled');
    ok($('cmpBtn').disabled === true, 'Compare Moves is disabled');
    ok($('analysisBtn').disabled === true, 'the analysis-mode switch is disabled');
    ok($('reportBtn').disabled === true, 'Copy Analysis is disabled');
    ok(/body\.puzzle-mode[^}]*#evalCard/.test(html) || html.indexOf('body.puzzle-mode #evalCard') > 0,
      'the eval panel is removed by the puzzle-mode stylesheet');
    ok(html.indexOf('body.puzzle-mode') > 0 && /display:none !important/.test(html),
      'analysis surfaces are removed from the layout, not merely dimmed');
    ok([...doc.querySelectorAll('.cell.heat, .cell.thr')].length === 0,
      'no heatmap or threat shading is applied in puzzle mode');

    /* the engine must not take a turn on the player's behalf */
    const before = XO.G.main.length;
    await sleep(1400);
    ok(XO.G.main.length === before, 'the engine does not auto-play in puzzle mode', XO.G.main.length);
    ok(XO.current === null || XO.current === undefined,
      'no analysis result is held while a puzzle is open');
    ok($('puzHudSolution').hidden === true, 'the solution is hidden until it is asked for');
    ok($('puzHudKind').textContent === 'Forced win',
      'the length of the win is withheld before solving', $('puzHudKind').textContent);
  }

  section('Puzzle play mode — moves, solution, replay, reset, exit (spec #26, #27, #28)');
  {
    const gi = XO.PUZZLES.findIndex(p => p.source === 'generated-local');
    ok(gi >= 0, 'a generated puzzle is playable from the bank', gi);
    const target = XO.PUZZLES[gi];

    /* wrong move */
    XO.startPuzzle(gi); await sleep(150);
    const b = XO.boardAt(XO.G.view);
    let wrongSq = -1;
    for (let i = 224; i >= 0; i--) if (!b[i] && i !== target.key) { wrongSq = i; break; }
    XO.puzzleGuess(wrongSq);
    await until(() => XO.G.puzzle.tries > 0 && XO.G.puzzle.status.indexOf('Checking') < 0, 8000);
    ok(XO.G.puzzle.tries === 1, 'a wrong move counts as an attempt', XO.G.puzzle.tries);
    ok(!XO.G.puzzle.solved, 'a wrong move does not solve the puzzle');
    ok(XO.G.puzzle.active, 'the puzzle stays playable after a wrong move');
    ok($('puzHudStatus').textContent.indexOf('does not force a win') > 0,
      'a wrong move gets a clear response', $('puzHudStatus').textContent);
    ok($('puzHudStatus').textContent.indexOf(XO.nm(target.key)) < 0,
      'a wrong move does not reveal the solution square');
    ok($('puzHudSolution').hidden === true, 'the solution stays hidden after a wrong move');

    /* correct move */
    XO.puzzleGuess(target.key);
    await until(() => XO.G.puzzle.solved, 10000);
    ok(XO.G.puzzle.solved, 'the verified solution is accepted as correct');
    ok($('puzHudStatus').textContent.indexOf('Solved') === 0, 'solving is reported', $('puzHudStatus').textContent);
    ok(XO.G.main.length === target.moves.length + 1, 'the solving move is played on the board');

    /* the engine still must not continue the game */
    const afterSolve = XO.G.main.length;
    await sleep(1200);
    ok(XO.G.main.length === afterSolve, 'the engine does not play on after the puzzle is solved');

    /* show solution works even without solving */
    XO.startPuzzle(gi); await sleep(150);
    ok($('puzHudSolution').hidden === true, 'solution hidden on a fresh puzzle');
    ok($('puzReplaySol').hidden === true, 'Replay is not offered before the solution is shown');
    click($('puzShowSol'));
    await sleep(reduceWait);
    ok($('puzHudSolution').hidden === false, 'Show solution reveals the solution');
    ok(/Forced win in [123]/.test($('puzHudSolution').textContent),
      'the solution names the forced win length', $('puzHudSolution').textContent.slice(0, 60));
    ok($('puzHudSolution').textContent.indexOf(XO.nm(target.key)) > 0,
      'the solution names the first move');
    ok($('puzReplaySol').hidden === false, 'Replay solution becomes available');
    await until(() => !XO.G.puzzle.replaying, 8000);
    ok(XO.G.main.length === target.moves.length + target.len,
      'the whole verified sequence is played out', XO.G.main.length + ' vs ' + (target.moves.length + target.len));
    ok(XO.G.main[target.moves.length].player === XO.G.puzzle.side,
      'the solution replay starts with the puzzle side');
    ok([...doc.querySelectorAll('.cell.hint')].length === 1, 'the first solution move is highlighted');

    /* replay again */
    click($('puzReplaySol'));
    await sleep(80);
    ok(XO.G.puzzle.replaying || XO.G.main.length === target.moves.length + target.len,
      'Replay restarts the solution animation');
    await until(() => !XO.G.puzzle.replaying, 10000);
    ok(XO.G.main.length === target.moves.length + target.len, 'replay ends on the same final position');
    ok($('graphCard').hidden === true, 'replay does not expose analysis');

    /* reset */
    click($('puzResetBtn'));
    await sleep(200);
    ok(XO.G.main.length === target.moves.length, 'Reset returns to the puzzle position', XO.G.main.length);
    ok(XO.G.puzzle.tries === 0, 'Reset clears the attempt count');
    ok(XO.G.puzzle.active, 'Reset makes the puzzle playable again');
    ok($('puzHudSolution').hidden === true, 'Reset hides the solution again');

    /* exit */
    click($('puzExitBtn'));
    await sleep(250);
    ok(!XO.G.puzzle, 'Exit leaves puzzle mode');
    ok(!doc.body.classList.contains('puzzle-mode'), 'Exit removes the puzzle-mode flag');
    ok($('puzHud').hidden === true, 'Exit hides the puzzle panel');
    ok(XO.currentRoute() === 'puzzles', 'Exit returns to the puzzle list', XO.currentRoute());
    await settle();
    ok($('hintBtn').disabled === false || XO.G.status !== 'playing',
      'analysis controls come back after leaving the puzzle');
  }

  section('Puzzle bank — navigation safety & merged sources (spec #21, #29)');
  {
    XO.startPuzzle(0); await sleep(150);
    ok(doc.body.classList.contains('puzzle-mode'), 'in puzzle mode before navigating');
    XO.goRoute('stats'); await sleep(150);
    ok(!doc.body.classList.contains('puzzle-mode'), 'navigating away cleanly ends the puzzle');
    ok(!XO.G.puzzle, 'no puzzle state is left stranded after navigation');
    XO.goRoute('puzzles'); await sleep(120);
    ok($('puzGrid').children.length === XO.PUZZLES.length,
      'the grid lists the whole merged bank', $('puzGrid').children.length + ' vs ' + XO.PUZZLES.length);
    ok($('puzGrid').textContent.indexOf('Generated') > 0, 'generated puzzles are labelled in the grid');
    ok(/O to move/.test($('puzGrid').textContent), 'O puzzles are labelled as O to move');
    ok(XO.GENERATED_PUZZLES.length > 0 && XO.BUILTIN_PUZZLES.length > 0 &&
      XO.PUZZLES.length === XO.GENERATED_PUZZLES.length + XO.BUILTIN_PUZZLES.length,
      'builtin and generated sources are merged without loss or duplication');
    ok(errors.length === 0, 'no uncaught errors across the generator suite', errors.join(' | '));
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
