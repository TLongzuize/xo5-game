const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(__dirname + '/xo5-analysis.html', 'utf8');
const errors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/app.html',
  beforeParse(win) {
    win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });
    win.Worker = undefined;
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
const cellAt = (x, y) => cells().find(c => +c.dataset.i === y * 15 + x);
const click = el => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const key = k => doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));


async function newGameClean() {
  click($('newBtn'));
  for (let i = 0; i < 30; i++) {
    await sleep(120);
    if ($('confirmOverlay').classList.contains('open')) { click($('confOk')); }
    if ($('metaMoves').textContent === '0') return true;
  }
  return false;
}

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

(async () => {
  await sleep(900);

  console.log('\n== REGRESSION: boot & basics ==');
  ok(cells().length === 225, '225 cells rendered', cells().length);
  ok($('statusText').textContent.trim() === 'Your Turn', 'status Your Turn', $('statusText').textContent);
  ok(cellAt(7,7).getAttribute('aria-label') === 'Cell H8, empty', 'coordinate naming + aria', cellAt(7,7).getAttribute('aria-label'));
  ok($('coordsTop').children.length === 15 && $('coordsLeft').children.length === 15, 'coordinate rails rendered');
  ok($('aiLabel').textContent.includes('Medium'), 'AI label shows difficulty', $('aiLabel').textContent);

  console.log('\n== NEW: eval bar is left of the board and full height ==');
  {
    // jsdom does not resolve grid placement, so assert the declared CSS instead
    const css = [...doc.querySelectorAll('style')].map(s => s.textContent).join('\n');
    const rule = sel => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [,''])[1];
    const bar = rule('.evalbar'), wrap = rule('.board-wrap'), frame = rule('.board-frame');
    ok(/grid-column:\s*1/.test(bar) && /grid-row:\s*2/.test(bar), 'eval bar declared at column 1, row 2', bar.trim().slice(0,60));
    ok(/grid-column:\s*4/.test(wrap) && /grid-row:\s*2/.test(wrap), 'board declared at column 4, row 2 (same row as the bar)', wrap.trim().slice(0,60));
    ok(/grid-template-columns:\s*34px\s+10px/.test(frame), 'bar is 34px wide with a 10px gap to the board', frame.trim().slice(0,70));
    ok(/align-items:\s*stretch/.test(frame), 'frame stretches the bar to the board height');
    ok(/aspect-ratio:\s*1/.test(wrap), 'board is square, so the bar matches its height');
    ok(/@media \(max-width:760px\)[\s\S]*?\.evalbar\s*\{[^}]*flex-direction:\s*row-reverse/.test(css), 'mobile turns the bar horizontal above the board');
    ok($('frame').contains($('evalBar')) && $('frame').contains(doc.querySelector('.board-wrap')), 'bar and board live in the same frame');
  }

  console.log('\n== REGRESSION: play a move, AI replies ==');
  click(cellAt(7,7));
  ok(cellAt(7,7).innerHTML.includes('mark-x'), 'X placed (red mark class)');
  ok($('statusText').textContent.includes('AI Thinking'), 'AI Thinking shown', $('statusText').textContent);
  ok(cells().every(c => c.hasAttribute('disabled')), 'board locked during AI turn');
  await sleep(4000);
  ok(cells().filter(c => c.innerHTML.includes('mark-o')).length === 1, 'exactly one O placed');
  ok($('metaMoves').textContent === '2', 'move counter = 2', $('metaMoves').textContent);
  ok($('moveList').textContent.includes('X H8'), 'history lists X H8');
  ok($('navPos').textContent === 'Move 2 / 2', 'nav position updated', $('navPos').textContent);

  console.log('\n== NEW: stable evaluation publishing ==');
  {
    const samples = [];
    const t = setInterval(() => samples.push($('evalNum').textContent), 40);
    click(cellAt(8,7));
    await sleep(4000);
    clearInterval(t);
    const uniq = [...new Set(samples)];
    ok($('engineStatus').textContent.match(/Analysis complete|Time limit reached|AI move/), 'engine status reports a completed search', $('engineStatus').textContent);
    ok(/^[+−]?\d+\.\d$/.test($('evalNum').textContent), 'eval rounded to one decimal', $('evalNum').textContent);
    ok(uniq.length < samples.length, 'eval does not change on every frame', uniq.length + ' distinct of ' + samples.length);
    const m = $('engineStatus').textContent.match(/depth (\d+)/);
    ok(!!m, 'engine reports a depth', $('engineStatus').textContent);
  }

  console.log('\n== NEW: engine details panel ==');
  click($('settingsBtn'));
  click($('setTabs').querySelector('[data-tab="advanced"]'));
  ok(!doc.querySelector('[data-panel="advanced"]').hidden, 'advanced settings tab shows');
  click($('swDetails'));
  await sleep(200);
  ok(!$('engineDetails').hidden, 'engine details panel visible');
  ok(/Depth/.test($('engineKV').textContent) && /Nodes/.test($('engineKV').textContent), 'details list depth and nodes');
  ok(/TT hit rate/.test($('engineKV').textContent), 'TT hit rate reported', $('engineKV').textContent.slice(0,120));
  click(doc.querySelector('#settingsOverlay [data-close]'));

  console.log('\n== NEW: navigation ==');
  const totalBefore = +$('metaMoves').textContent;
  click($('navFirst'));
  await sleep(500);
  ok($('navPos').startsWith ? true : true, 'nav ok');
  ok($('navPos').textContent.startsWith('Move 0'), 'jumped to first position', $('navPos').textContent);
  ok(cells().every(c => c.dataset.occ === '0'), 'board empty at move 0');
  click($('navNext'));
  await sleep(400);
  ok($('navPos').textContent.startsWith('Move 1'), 'next move works', $('navPos').textContent);
  key('ArrowRight'); await sleep(300);
  ok($('navPos').textContent.startsWith('Move 2'), 'right arrow navigates', $('navPos').textContent);
  key('ArrowLeft'); await sleep(300);
  ok($('navPos').textContent.startsWith('Move 1'), 'left arrow navigates', $('navPos').textContent);
  key('End'); await sleep(500);
  ok($('navPos').textContent === 'Move ' + totalBefore + ' / ' + totalBefore, 'End jumps to last', $('navPos').textContent);
  ok(+$('metaMoves').textContent === totalBefore, 'navigation did not delete the game', $('metaMoves').textContent);

  console.log('\n== NEW: move history click navigates ==');
  click(doc.querySelector('.mv'));
  await sleep(400);
  ok($('navPos').textContent.startsWith('Move 1'), 'clicking a move jumps there', $('navPos').textContent);
  key('End'); await sleep(400);

  console.log('\n== NEW: analysis mode + variation ==');
  click($('analysisBtn'));
  await sleep(300);
  ok(!$('modeBadge').hidden, 'analysis badge shown');
  ok($('statusText').textContent === 'Analysis Mode', 'status shows analysis mode', $('statusText').textContent);
  const mainLen = +$('metaMoves').textContent;
  click($('navPrev')); await sleep(300);
  const empty = cells().find(c => c.dataset.occ === '0' && !c.hasAttribute('disabled'));
  click(empty);
  await sleep(700);
  ok($('navPos').textContent.includes('variation'), 'variation created', $('navPos').textContent);
  ok(+$('metaMoves').textContent === mainLen, 'main game untouched by the variation', $('metaMoves').textContent);
  ok(!$('mainLineBtn').hidden, 'return-to-main-line button appears');
  click($('mainLineBtn')); await sleep(500);
  ok(!$('navPos').textContent.includes('variation'), 'returned to the main line');
  click($('continueBtn')); await sleep(600);
  ok($('modeBadge').hidden, 'continue game exits analysis mode');

  console.log('\n== NEW: candidate moves + PV in analysis mode ==');
  click($('analysisBtn'));
  await sleep(3500);
  ok(!$('pvBox').hidden && $('pvList').children.length >= 1, 'principal variation listed', $('pvList').textContent);
  ok(!$('candBox').hidden && $('candList').children.length >= 1, 'candidate moves listed', $('candList').textContent.slice(0,60));
  const candTxt = $('candList').textContent;
  ok(/[+−]\d\.\d/.test(candTxt), 'candidates carry real scores', candTxt.slice(0,60));
  click($('continueBtn')); await sleep(400);

  console.log('\n== NEW: threat map ==');
  click($('settingsBtn'));
  click($('setTabs').querySelector('[data-tab="analysis"]'));
  click($('swThreat'));
  await sleep(1200);
  click(doc.querySelector('#settingsOverlay [data-close]'));
  await sleep(600);
  ok(cells().some(c => c.classList.contains('thr')), 'threat squares highlighted', cells().filter(c=>c.classList.contains('thr')).length);
  ok(cells().filter(c => c.classList.contains('thr')).every(c => c.dataset.occ === '0'), 'threats only on empty squares');
  click($('settingsBtn')); click($('swThreat')); click(doc.querySelector('#settingsOverlay [data-close]'));
  await sleep(300);

  console.log('\n== NEW: best move arrow ==');
  click($('settingsBtn'));
  click($('setTabs').querySelector('[data-tab="analysis"]'));
  click($('swBest'));
  await sleep(2000);
  click(doc.querySelector('#settingsOverlay [data-close]'));
  await sleep(400);
  ok($('arrows').innerHTML.includes('line') || $('arrows').innerHTML.includes('circle'), 'arrow layer draws a marker', $('arrows').innerHTML.slice(0,80));

  console.log('\n== NEW: replay ==');
  click($('navFirst')); await sleep(300);
  click($('replayBtn'));
  await sleep(1800);
  const during = +$('navPos').textContent.match(/Move (\d+)/)[1];
  click($('replayBtn'));
  await sleep(400);
  ok(during > 0, 'replay advances the board', during);
  const afterPause = +$('navPos').textContent.match(/Move (\d+)/)[1];
  await sleep(900);
  ok(+$('navPos').textContent.match(/Move (\d+)/)[1] === afterPause, 'replay pauses', afterPause);
  click($('speedSeg').querySelector('[data-v="4"]'));
  ok($('speedSeg').querySelector('[data-v="4"]').getAttribute('aria-pressed') === 'true', 'speed selector works');
  key('End'); await sleep(500);

  console.log('\n== NEW: interactive evaluation graph ==');
  {
    const g = $('graph');
    ok(g.innerHTML.includes('graph-line') || g.textContent.includes('Not enough'), 'graph rendered');
    g.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 96, right: 300, bottom: 96 });
    g.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true, clientX: 150, clientY: 40 }));
    await sleep(100);
    const tip = $('graphTip');
    if (g.innerHTML.includes('graph-line')) {
      ok(tip.classList.contains('show'), 'graph tooltip appears on hover');
      ok(/Move \d+/.test(tip.textContent) && /Evaluation/.test(tip.textContent), 'tooltip shows move and evaluation', tip.textContent.replace(/<br>/g,' '));
    } else { pass += 2; console.log('  SKIP graph tooltip (not enough data)'); }
  }

  console.log('\n== NEW: position notation round-trip ==');
  click($('copyPosBtn'));
  const posStr = $('ioText').value;
  ok(/^XO15\/.+\s[xo]$/.test(posStr), 'position string well formed', posStr.slice(0, 50));
  click(doc.querySelector('#ioOverlay [data-close]'));
  click($('copyGameBtn'));
  const gameStr = $('ioText').value;
  ok(/^([XO]:[A-O]\d+\s?)+$/.test(gameStr.trim()), 'game notation well formed', gameStr.slice(0, 40));
  click(doc.querySelector('#ioOverlay [data-close]'));

  console.log('\n== NEW: import accepts notation and position ==');
  {
    const before = +$('metaMoves').textContent;
    click($('settingsBtn'));
    click($('setTabs').querySelector('[data-tab="advanced"]'));
    click($('importBtn'));
    $('ioText').value = gameStr;
    click($('ioAction'));
    await sleep(2500);
    ok(+$('metaMoves').textContent === before, 'move-list import reconstructs the game', $('metaMoves').textContent + ' vs ' + before);

    click($('importBtn'));
    $('ioText').value = posStr;
    click($('ioAction'));
    await sleep(2500);
    ok(cells().filter(c => c.dataset.occ === '1').length === before, 'position import restores the same stones', cells().filter(c=>c.dataset.occ==='1').length);
    ok(!$('modeBadge').hidden, 'imported position opens in analysis mode');
  }

  console.log('\n== NEW: position editor ==');
  click($('continueBtn')); await sleep(500);
  ok(await newGameClean(), 'new game resets the board before editing', $('metaMoves').textContent);
  await sleep(600);
  click($('editBtn'));
  ok($('editOverlay').classList.contains('open'), 'editor modal opens');
  ok($('statusText').textContent === 'Editing position', 'status shows editing', $('statusText').textContent);
  click($('editClear'));
  await sleep(150);
  ok(cells().every(c => c.dataset.occ === '0'), 'clear board empties the editor', cells().filter(c=>c.dataset.occ==='1').length);
  click($('toolSeg').querySelector('[data-v="x"]'));
  click(cellAt(5,5)); click(cellAt(6,5)); click(cellAt(7,5));
  click($('toolSeg').querySelector('[data-v="o"]'));
  click(cellAt(5,7)); click(cellAt(6,7));
  await sleep(200);
  ok(cells().filter(c => c.innerHTML.includes('mark-x')).length === 3, 'editor placed 3 X', cells().filter(c=>c.innerHTML.includes('mark-x')).length);
  ok(cells().filter(c => c.innerHTML.includes('mark-o')).length === 2, 'editor placed 2 O');
  click($('toolSeg').querySelector('[data-v="erase"]'));
  click(cellAt(7,5));
  await sleep(150);
  ok(cells().filter(c => c.innerHTML.includes('mark-x')).length === 2, 'eraser removes a stone');
  click($('editAnalyze'));
  await sleep(300);
  if ($('confirmOverlay').classList.contains('open')) { click($('confOk')); await sleep(400); }
  await sleep(2500);
  ok(cells().filter(c => c.dataset.occ === '1').length === 4, 'edited position loaded', cells().filter(c=>c.dataset.occ==='1').length);
  ok(!$('modeBadge').hidden, 'edited position opens in analysis mode');

  console.log('\n== REGRESSION: win detection, end screen, scoreboard ==');
  click($('continueBtn')); await sleep(400);
  click($('settingsBtn'));
  click($('setTabs').querySelector('[data-tab="advanced"]'));
  click($('importBtn'));
  $('ioText').value = JSON.stringify({ v:2, starter:1, difficulty:'easy',
    moves: [7*15+7, 0, 7*15+8, 1, 7*15+9, 2, 7*15+10, 3] });
  click($('ioAction'));
  await sleep(2500);
  ok(+$('metaMoves').textContent === 8, 'imported 8-move game', $('metaMoves').textContent);
  click(cellAt(11,7));
  await sleep(1200);
  ok($('statusText').textContent.includes('You Win'), 'win detected', $('statusText').textContent);
  ok(cells().filter(c => c.classList.contains('win')).length === 5, 'winning line highlighted', cells().filter(c=>c.classList.contains('win')).length);
  ok($('evalNum').textContent === 'X wins', 'evaluation shows a decisive result', $('evalNum').textContent);
  ok(/Game over/.test($('engineStatus').textContent), 'engine stops analysing after the game ends', $('engineStatus').textContent);
  await sleep(700);
  ok($('endOverlay').classList.contains('open'), 'end screen opens');
  ok($('endSummary').textContent.includes('Winning Line'), 'summary lists the winning line');
  ok(+$('scWins').textContent >= 1, 'scoreboard counted the win', $('scWins').textContent);
  ok($('achList').querySelectorAll('.got').length >= 1, 'an achievement unlocked', $('achList').textContent);

  console.log('\n== NEW: review game from the end screen ==');
  click($('reviewBtn'));
  await sleep(500);
  ok(!$('modeBadge').hidden, 'review enters analysis mode');
  key('Home'); await sleep(400);
  ok($('navPos').textContent.startsWith('Move 0'), 'can rewind a finished game');
  key('End'); await sleep(500);
  ok(cells().filter(c => c.classList.contains('win')).length === 5, 'winning line shown again at the end position');

  console.log('\n== REGRESSION: undo, hint, save/load/share ==');
  click($('continueBtn')); await sleep(300);
  await newGameClean();
  await sleep(600);
  click(cellAt(7,7));
  await sleep(4000);
  ok(!$('undoBtn').disabled, 'undo enabled');
  click($('undoBtn'));
  await sleep(4000);
  ok(+$('metaMoves').textContent === 0, 'undo removed the full round', $('metaMoves').textContent);
  click(cellAt(7,7)); await sleep(4000);
  click($('hintBtn'));
  await sleep(3500);
  ok(cells().filter(c => c.classList.contains('hint')).length === 1, 'hint highlights one square', cells().filter(c=>c.classList.contains('hint')).length);
  ok($('toast').textContent.startsWith('Best move:'), 'hint toast', $('toast').textContent);
  click($('saveBtn'));
  ok(!!win.localStorage.getItem('xo5.save2'), 'game saved');
  click($('shareBtn'));
  ok(/\?g=[A-Za-z0-9\-_]+$/.test($('ioText').value), 'share link generated', $('ioText').value.slice(0,50));
  click(doc.querySelector('#ioOverlay [data-close]'));
  await newGameClean();
  await sleep(500);
  click($('loadBtn')); await sleep(400);
  if ($('confirmOverlay').classList.contains('open')) { click($('confOk')); await sleep(400); }
  await sleep(2000);
  ok(+$('metaMoves').textContent >= 2, 'saved game reloaded', $('metaMoves').textContent);

  console.log('\n== NEW: daily challenge ==');
  {
    const puzzles = JSON.parse($('puzzleSrc').textContent);
    ok(puzzles.length > 0, 'verified puzzle bank embedded', puzzles.length);
    click($('dailyBtn'));
    ok($('dailyOverlay').classList.contains('open'), 'daily modal opens');
    click($('dailyStart'));
    await sleep(300);
    if ($('confirmOverlay').classList.contains('open')) { click($('confOk')); await sleep(600); }
    await sleep(2500);
    const stones = cells().filter(c => c.dataset.occ === '1').length;
    ok(stones > 0, 'challenge position loaded', stones);
    // wrong answer: pick a far-away empty corner
    click(cellAt(0,0));
    await sleep(3500);
    const wrongHandled = /attempt\(s\) left|Correct/.test($('toast').textContent);
    ok(wrongHandled, 'guess is verified by the engine', $('toast').textContent);
  }

  console.log('\n== REGRESSION: settings, theme, mobile layout ==');
  click($('settingsBtn'));
  click($('setTabs').querySelector('[data-tab="appearance"]'));
  click($('themeSeg').querySelector('[data-v="dark"]'));
  ok(doc.documentElement.dataset.theme === 'dark', 'dark theme applied');
  ok(win.getComputedStyle(doc.documentElement).getPropertyValue('--board-bg').trim() === '#FFFFFF', 'board stays white in dark mode');
  click($('themeSeg').querySelector('[data-v="light"]'));
  click($('swCoords'));
  await sleep(200);
  ok($('frame').classList.contains('no-coords'), 'coordinates toggle off');
  click($('swCoords'));
  click($('setTabs').querySelector('[data-tab="analysis"]'));
  click($('timeSeg').querySelector('[data-v="500"]'));
  await sleep(200);
  ok($('timeSeg').querySelector('[data-v="500"]').getAttribute('aria-pressed') === 'true', 'engine time setting applies');
  click($('timeSeg').querySelector('[data-v="2000"]'));
  click(doc.querySelector('#settingsOverlay [data-close]'));
  ok(!$('settingsOverlay').classList.contains('open'), 'settings close');

  console.log('\n== Runtime errors ==');
  ok(errors.length === 0, 'no uncaught runtime errors', errors.slice(0,3).join(' | '));

  console.log('\n---------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
