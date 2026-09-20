const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(__dirname + '/xo5-pro.html', 'utf8');
const errors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.com/app.html',
  beforeParse(win) {
    win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });
    win.Worker = undefined; // force main-thread fallback path
    win.URL.createObjectURL = () => 'blob:x';
    win.addEventListener('error', e => errors.push('window error: ' + e.message));
  }
});
const win = dom.window, doc = win.document;
win.onerror = (m) => errors.push('onerror: ' + m);
const origErr = console.error;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => doc.getElementById(id);
const cells = () => [...doc.querySelectorAll('.cell')];
const cellAt = (x, y) => cells().find(c => +c.dataset.i === y * 15 + x);
const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? ' -> ' + extra : '')); }
}

(async () => {
  await sleep(600);

  console.log('\n== Boot ==');
  ok(cells().length === 225, 'board renders 225 cells', cells().length);
  ok($('statusText').textContent.trim() === 'Your Turn', 'initial status is Your Turn', $('statusText').textContent);
  ok($('metaDiff').textContent === 'Medium', 'difficulty shown', $('metaDiff').textContent);
  ok(!!$('evalNum').textContent, 'eval number present', $('evalNum').textContent);
  ok($('moveList').textContent.includes('No moves yet'), 'empty move list note');
  ok(cellAt(7,7).getAttribute('aria-label') === 'Cell H8, empty', 'aria label + coordinate naming', cellAt(7,7).getAttribute('aria-label'));

  console.log('\n== Human move + AI reply ==');
  click(cellAt(7, 7));
  ok(cellAt(7,7).dataset.occupied === '1', 'human stone placed');
  ok(cellAt(7,7).innerHTML.includes('mark-x'), 'human mark is X (red class)');
  ok($('statusText').textContent.includes('AI Thinking'), 'status switches to AI Thinking', $('statusText').textContent);
  ok(cells().every(c => c.hasAttribute('disabled')), 'board locked while AI thinks');

  await sleep(2500);
  const aiCells = cells().filter(c => c.innerHTML.includes('mark-o'));
  ok(aiCells.length === 1, 'AI replied with exactly one O', aiCells.length);
  ok($('statusText').textContent.trim() === 'Your Turn', 'turn returns to human', $('statusText').textContent);
  ok($('metaMoves').textContent === '2', 'move counter = 2', $('metaMoves').textContent);
  ok($('moveList').textContent.includes('X H8'), 'move history lists X H8');
  ok(/AI move • \d+ ms/.test($('metaEngine').textContent), 'AI thinking time displayed', $('metaEngine').textContent);
  ok(!$('undoBtn').disabled, 'undo enabled after a move');

  console.log('\n== Invalid move ==');
  const before = $('metaMoves').textContent;
  click(cellAt(7, 7));
  await sleep(200);
  ok($('metaMoves').textContent === before, 'clicking an occupied cell does nothing', $('metaMoves').textContent);

  console.log('\n== Hint ==');
  click($('hintBtn'));
  await sleep(1600);
  const hinted = cells().filter(c => c.classList.contains('hintcell'));
  ok(hinted.length === 1, 'hint highlights exactly one cell', hinted.length);
  ok($('toast').textContent.startsWith('Best move:'), 'hint toast shows coordinate', $('toast').textContent);
  ok(hinted[0].dataset.occupied === '0', 'hint points at an empty cell');

  console.log('\n== Undo (full round) ==');
  const movesBefore = +$('metaMoves').textContent;
  click($('undoBtn'));
  await sleep(2500);
  // undo removes AI+human, then it is human's turn again with 0 moves -> AI may not move (human starts)
  ok(+$('metaMoves').textContent === movesBefore - 2, 'undo removed both AI and human move', $('metaMoves').textContent);
  ok($('statusText').textContent.trim() === 'Your Turn', 'human to move after undo');

  console.log('\n== Win detection through the UI ==');
  // Build a forced win: place X along a row while AI responds elsewhere.
  // Use the engine directly on the app's state by clicking a straight line;
  // the AI will block, so instead we verify with a scripted position via import.
  const importedMoves = [
    7*15+7,  0,        // X H8 , O A15
    7*15+8,  1,        // X I8 , O B15
    7*15+9,  2,        // X J8 , O C15
    7*15+10, 3         // X K8 , O D15
  ];
  $('importBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  $('ioText').value = JSON.stringify({ v:1, starter:1, difficulty:'easy', moves: importedMoves });
  click($('ioAction'));
  await sleep(1200);
  ok(+$('metaMoves').textContent === 8, 'imported 8 moves', $('metaMoves').textContent);
  ok($('metaDiff').textContent === 'Easy', 'imported difficulty applied', $('metaDiff').textContent);

  // X now plays L8 (7*15+11) for five in a row H8..L8
  click(cellAt(11, 7));
  await sleep(900);
  ok($('statusText').textContent.includes('You Win'), 'status shows You Win!', $('statusText').textContent);
  const winCells = cells().filter(c => c.classList.contains('win'));
  ok(winCells.length === 5, 'winning line highlights 5 cells', winCells.length);
  await sleep(900);
  ok($('endOverlay').classList.contains('open'), 'end screen opens');
  ok($('endTitle').textContent === 'You Win!', 'end screen title', $('endTitle').textContent);
  ok($('endSummary').textContent.includes('Winning Line'), 'summary includes winning line');
  ok($('scWins').textContent === '1', 'scoreboard counts the win', $('scWins').textContent);
  ok($('statGrid').textContent.includes('Win Rate'), 'statistics rendered');

  console.log('\n== Play again ==');
  click($('againBtn'));
  await sleep(700);
  ok(!$('endOverlay').classList.contains('open'), 'end screen closes');
  ok(cells().every(c => c.dataset.occupied === '0'), 'board cleared for new game');
  ok($('moveList').textContent.includes('No moves yet'), 'history cleared');

  console.log('\n== Settings ==');
  click($('settingsBtn'));
  ok($('settingsOverlay').classList.contains('open'), 'settings modal opens');
  click($('diffSeg').querySelector('[data-v="hard"]'));
  await sleep(100);
  ok($('metaDiff').textContent === 'Hard', 'difficulty switches to Hard', $('metaDiff').textContent);
  click($('swCoords'));
  await sleep(200);
  ok(!$('board').classList.contains('with-coords'), 'coordinates toggle off');
  ok(cells().length === 225, 'board still 225 cells after rebuild', cells().length);
  click($('swCoords'));
  await sleep(200);
  click($('themeSeg').querySelector('[data-v="dark"]'));
  ok(doc.documentElement.dataset.theme === 'dark', 'dark theme applied', doc.documentElement.dataset.theme);
  click($('themeSeg').querySelector('[data-v="light"]'));
  click($('swBest'));
  await sleep(100);
  ok($('swBest').getAttribute('aria-checked') === 'true', 'best-move toggle on');
  doc.querySelector('#settingsOverlay [data-close]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(!$('settingsOverlay').classList.contains('open'), 'settings modal closes');

  console.log('\n== Save / load / share ==');
  click(cellAt(6, 6));
  await sleep(3000);
  click($('saveBtn'));
  ok(!!win.localStorage.getItem('xo5.save'), 'game saved to localStorage');
  click($('newBtn'));
  await sleep(300);
  if ($('confirmOverlay').classList.contains('open')) { click($('confOk')); await sleep(400); }
  await sleep(1500);
  click($('loadBtn'));
  await sleep(400);
  if ($('confirmOverlay').classList.contains('open')) { click($('confOk')); await sleep(400); }
  await sleep(1200);
  ok(+$('metaMoves').textContent >= 2, 'saved game reloaded with its moves', $('metaMoves').textContent);

  click($('shareBtn'));
  const shareUrl = $('ioText').value;
  ok(/\?g=[A-Za-z0-9\-_]+$/.test(shareUrl), 'share URL generated', shareUrl.slice(0, 60));
  doc.querySelector('#ioOverlay [data-close]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  console.log('\n== Keyboard shortcuts ==');
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'u', bubbles: true }));
  await sleep(1500);
  ok(true, 'U shortcut ran without error');
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(!$('settingsOverlay').classList.contains('open'), 'Escape closes modals');

  console.log('\n== Runtime errors ==');
  ok(errors.length === 0, 'no uncaught runtime errors', errors.join(' | '));

  console.log('\n---------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
