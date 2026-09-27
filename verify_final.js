/* verify_final.js — end-to-end verification of the puzzle generator + puzzle
   mode against the built artifact. This is a VERIFICATION harness, not part of
   the shipped test suites: it captures every error channel jsdom exposes and
   walks the full user flow once, reporting what it actually observed.
   Run with: node verify_final.js */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const problems = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/index.html',
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.Worker = undefined;                      // force the documented fallback
    w.URL.createObjectURL = () => 'blob:x';
    w.addEventListener('error', e => problems.push('window error: ' + (e.message || e.error)));
    w.addEventListener('unhandledrejection', e => problems.push('unhandled rejection: ' + (e.reason && e.reason.message || e.reason)));
    const ce = w.console.error, cw = w.console.warn;
    w.console.error = function () { problems.push('console.error: ' + [].join.call(arguments, ' ')); ce.apply(w.console, arguments); };
    w.console.warn = function () { problems.push('console.warn: ' + [].join.call(arguments, ' ')); cw.apply(w.console, arguments); };
  }
});
const win = dom.window, doc = win.document;
win.onerror = m => problems.push('onerror: ' + m);
process.on('unhandledRejection', r => problems.push('node unhandled rejection: ' + r));

const $ = id => doc.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const click = el => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function until(fn, max = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (fn()) return true; await sleep(60); }
  return false;
}
const out = [];
const say = (label, value) => { out.push([label, String(value)]); };

(async function () {
  await sleep(700);
  const XO = win.__XO, E = win.XOEngine;

  /* ---------------- 1. boot ---------------- */
  say('boot: app initialised', !!XO);
  say('boot: generator channel mode', XO.genMode());
  say('boot: bundled puzzles', XO.BUILTIN_PUZZLES.length);
  say('boot: generated bank at start', XO.GENERATED_PUZZLES.length);

  /* ---------------- 2. generation session ---------------- */
  win.localStorage.removeItem('xo5.generatedPuzzles3');
  XO.loadGeneratedBank();
  XO.goRoute('puzzles'); await sleep(120);
  click($('genOpenBtn')); await sleep(100);
  say('generator: modal opened', $('genOverlay').classList.contains('open'));

  XO.genSettings.durationMs = 10000;
  XO.genSettings.target = 12;
  const t0 = Date.now();
  XO.startGeneration();

  /* observe that the bank grows DURING the run, not after */
  const midRun = await until(() => {
    const d = win.localStorage.getItem('xo5.generatedPuzzles3');
    return XO.GS && XO.GS.running && d && JSON.parse(d).length >= 3;
  }, 15000);
  say('generation: puzzles on disk while still running', midRun);
  const liveBoard = $('genBoardG').querySelectorAll('.gx, .go').length;
  say('generation: live candidate stones drawn', liveBoard);
  say('generation: candidate matches reported position',
    XO.GS && XO.GS.candidateMoves && liveBoard === XO.GS.candidateMoves.length);

  await until(() => XO.GS && !XO.GS.running, 25000);
  await sleep(200);
  const elapsed = Date.now() - t0;
  const S = XO.GS;
  say('generation: end reason', S.endReason);
  say('generation: attempts', S.attempts);
  say('generation: accepted', S.accepted);
  say('generation: rejected', S.rejected);
  say('generation: duplicates', S.duplicates);
  say('generation: nodes searched', S.nodes);
  say('generation: wall time (ms)', elapsed);
  say('generation: X puzzles this session', S.sideCount.X || 0);
  say('generation: O puzzles this session', S.sideCount.O || 0);
  say('generation: win-in-1 / win-in-2', (S.lenCount[1] || 0) + ' / ' + (S.lenCount[3] || 0));

  /* ---------------- 3. independent re-verification ---------------- */
  const gen = XO.GENERATED_PUZZLES;
  let bad = 0, illegal = 0, parity = 0;
  for (const p of gen) {
    const b = new Int8Array(225);
    let ok = true;
    for (let i = 0; i < p.moves.length; i++) {
      const idx = p.moves[i], pl = i % 2 === 0 ? 1 : 2;
      if (b[idx]) { ok = false; break; }
      b[idx] = pl;
      if (E.winningLineAt(b, idx, pl)) { ok = false; break; }
    }
    if (!ok) illegal++;
    if (p.sideToMove !== (p.moves.length % 2 === 0 ? 'X' : 'O')) parity++;
    const st = new E.State();
    p.moves.forEach((m, k) => st.play(m, k % 2 === 0 ? 1 : 2));
    const r = E.solveForcing(st, p.sideToMove === 'O' ? 2 : 1,
      { maxPly: 3, nodes: 60000, timeMs: 2500, vct: true });
    if (!r.win || r.aborted || r.seq.length > 3) bad++;
  }
  say('verify: puzzles re-solved independently', gen.length);
  say('verify: failed re-verification', bad);
  say('verify: illegal positions', illegal);
  say('verify: parity mismatches', parity);
  say('verify: all main-thread re-proved', gen.every(p => p.proof === 'reproved'));

  /* ---------------- 4. persistence ---------------- */
  const disk = JSON.parse(win.localStorage.getItem('xo5.generatedPuzzles3') || '[]');
  say('persist: on disk', disk.length);
  say('persist: reported saved count', XO.persistedCount());
  say('persist: counts agree', disk.length === XO.persistedCount() && disk.length === gen.length);
  const reloaded = XO.loadGeneratedBank();
  say('persist: survives a reload of the bank', reloaded.length === disk.length);
  say('persist: merged bank size', XO.PUZZLES.length);

  /* ---------------- 5. export ---------------- */
  let exported = null, exportOk = true;
  try { exported = JSON.parse(XO.exportGeneratedJSON()); } catch (e) { exportOk = false; }
  say('export: valid JSON', exportOk);
  say('export: puzzle count', exported ? exported.length : 'n/a');
  say('export: required fields present', exported && exported.every(p =>
    Array.isArray(p.moves) && typeof p.key === 'number' && (p.len === 1 || p.len === 3) &&
    (p.sideToMove === 'X' || p.sideToMove === 'O') && p.source && p.generatedAt && p.solverVersion));
  say('export: no internal state leaked', exported && exported.every(p => !p.canon && !p.proof));

  /* ---------------- 6. puzzle play: X and O ---------------- */
  for (const wantSide of [1, 2]) {
    const gi = XO.PUZZLES.findIndex(p => p.source === 'generated-local' && XO.puzzleSide(p) === wantSide);
    if (gi < 0) { say('play: no ' + (wantSide === 1 ? 'X' : 'O') + ' puzzle available', 'SKIPPED'); continue; }
    const target = XO.PUZZLES[gi];
    const nm = wantSide === 1 ? 'X' : 'O';
    XO.startPuzzle(gi); await sleep(200);
    say('play(' + nm + '): objective', $('puzHudObj').textContent.trim());
    say('play(' + nm + '): analysis hidden', doc.body.classList.contains('puzzle-mode') &&
      $('graphCard').hidden === true && $('arrows').innerHTML === '' &&
      $('hintBtn').disabled && $('deepBtn').disabled && $('cmpBtn').disabled);
    say('play(' + nm + '): solution hidden initially', $('puzHudSolution').hidden === true);
    const before = XO.G.main.length;
    await sleep(1200);
    say('play(' + nm + '): engine did not auto-play', XO.G.main.length === before);

    /* a wrong move */
    const b = XO.boardAt(XO.G.view);
    let wrongSq = -1;
    for (let i = 224; i >= 0; i--) if (!b[i] && i !== target.key) { wrongSq = i; break; }
    XO.puzzleGuess(wrongSq);
    await until(() => XO.G.puzzle.tries > 0 && XO.G.puzzle.status.indexOf('Checking') < 0, 9000);
    say('play(' + nm + '): wrong move rejected', !XO.G.puzzle.solved && XO.G.puzzle.active);
    say('play(' + nm + '): wrong move does not reveal answer',
      $('puzHudStatus').textContent.indexOf(XO.nm(target.key)) < 0 && $('puzHudSolution').hidden === true);

    /* the real solution */
    XO.puzzleGuess(target.key);
    await until(() => XO.G.puzzle.solved, 10000);
    say('play(' + nm + '): verified solution accepted', XO.G.puzzle.solved);
  }

  /* ---------------- 7. show solution + replay ---------------- */
  const gi = XO.PUZZLES.findIndex(p => p.source === 'generated-local');
  const tgt = XO.PUZZLES[gi];
  XO.startPuzzle(gi); await sleep(150);
  click($('puzShowSol'));
  await until(() => !XO.G.puzzle.replaying && $('puzHudSolution').hidden === false, 12000);
  say('solution: revealed on request', $('puzHudSolution').hidden === false);
  say('solution: text', $('puzHudSolution').textContent.slice(0, 96));
  say('solution: full sequence played', XO.G.main.length === tgt.moves.length + tgt.len);
  click($('puzReplaySol'));
  await until(() => !XO.G.puzzle.replaying, 12000);
  say('replay: ends on the same position', XO.G.main.length === tgt.moves.length + tgt.len);
  say('replay: analysis still hidden', $('graphCard').hidden === true && $('arrows').innerHTML === '');

  /* a BUNDLED puzzle: its line must be resolved from the solver */
  XO.startPuzzle(0); await sleep(150);
  click($('puzShowSol'));
  await until(() => !XO.G.puzzle.replaying && $('puzHudSolution').hidden === false, 14000);
  say('solution(bundled): line resolved from solver', (XO.G.puzzle.seq || []).length);
  say('solution(bundled): text', $('puzHudSolution').textContent.slice(0, 96));

  /* ---------------- 8. reset / exit ---------------- */
  click($('puzResetBtn')); await sleep(250);
  say('reset: back to the puzzle position', XO.G.main.length === XO.PUZZLES[0].moves.length &&
    XO.G.puzzle.tries === 0 && $('puzHudSolution').hidden === true);
  click($('puzExitBtn')); await sleep(250);
  say('exit: puzzle mode left cleanly', !XO.G.puzzle && !doc.body.classList.contains('puzzle-mode') &&
    $('puzHud').hidden === true);

  /* ---------------- 9. errors ---------------- */
  await sleep(400);
  say('errors: total captured', problems.length);

  const w = Math.max(...out.map(o => o[0].length));
  console.log('\n================ END-TO-END VERIFICATION ================');
  out.forEach(([k, v]) => console.log('  ' + k.padEnd(w) + '  ' + v));
  console.log('========================================================');
  if (problems.length) { console.log('\nPROBLEMS:'); problems.forEach(p => console.log('  - ' + p)); }
  else console.log('\nNo console errors, window errors or unhandled rejections.');
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error('\nVERIFICATION CRASHED: ' + (e && e.stack || e)); process.exit(1); });
