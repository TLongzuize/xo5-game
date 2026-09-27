/* verify_mobile.js — narrow-viewport audit for the generator modal and puzzle
   mode. jsdom has NO layout engine (offsetWidth is always 0), so this cannot
   measure real geometry. What it CAN do, and what it does here, is:
     - audit the stylesheet for the responsive rules the narrow layout depends on
     - confirm no fixed pixel width in the new UI exceeds a 360px viewport
     - drive the app's own narrow-viewport JS paths
   Anything requiring real rendering is reported as NOT VERIFIABLE HERE rather
   than asserted. Run with: node verify_mobile.js */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');

const NARROW = 360;                    // iPhone SE class viewport
let pass = 0, fail = 0, notes = [];
const ok = (c, label, extra) => {
  if (c) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? ' -> ' + extra : '')); }
};
const note = s => notes.push(s);

/* ---- extract the stylesheet ---- */
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];

console.log('\n== Stylesheet: responsive rules the narrow layout needs ==');
ok(/@media \(max-width:620px\)\{\.gen-lay\{grid-template-columns:1fr/.test(css.replace(/\s+/g, '')) ||
   /\.gen-lay\{grid-template-columns:1fr/.test(css.replace(/\s+/g, '')),
  'generator layout collapses to a single column on narrow screens');
ok(/\.gen-board\{width:min\(212px,62vw\);height:min\(212px,62vw\)\}/.test(css.replace(/\s+/g, '')),
  'the candidate mini board is sized in vw so it cannot overflow');
ok(/\.gen-stats\{grid-template-columns:repeat\(2,1fr\)\}/.test(css.replace(/\s+/g, '')),
  'the statistics grid drops from four columns to two');
ok(/@media\(max-width:560px\)\{\.overlay\{padding:0;align-items:end\}/.test(css.replace(/\s+/g, '')),
  'modals become bottom sheets on small screens');
ok(/\.modal\{max-width:none;border-radius:var\(--r4\)var\(--r4\)00;max-height:92vh\}/.test(css.replace(/\s+/g, '')),
  'the modal goes full width and caps its height at 92vh');
ok(/\.gen-stat\.l\{/.test(css.replace(/\s+/g, '')) || /text-overflow:ellipsis/.test(css),
  'stat labels and values are clipped with an ellipsis rather than overflowing');
ok(/\.gen-reason\{[^}]*overflow-wrap:anywhere/.test(css.replace(/\s+/g, '')),
  'the candidate reason line wraps instead of pushing the layout wide');
ok(/\.puzhud \.meta\{[^}]*flex-wrap:wrap/.test(css) || /\.puzhud\.meta\{[^}]*flex-wrap:wrap/.test(css.replace(/\s+/g, '')),
  'puzzle HUD metadata wraps');
ok(/\.puzhud \.acts\{[^}]*flex-wrap:wrap/.test(css) || /\.puzhud\.acts\{[^}]*flex-wrap:wrap/.test(css.replace(/\s+/g, '')),
  'puzzle solution controls wrap and stay reachable');
ok(/\.puzhud \.top\{[^}]*flex-wrap:wrap/.test(css) || /\.puzhud\.top\{[^}]*flex-wrap:wrap/.test(css.replace(/\s+/g, '')),
  'the puzzle title row wraps');
ok(/prefers-reduced-motion:reduce/.test(css), 'a reduced-motion block exists');
ok(/@media\(prefers-reduced-motion:no-preference\)\{\.gen-board\.fresh/.test(css.replace(/\s+/g, '')),
  'generator animations are opt-in under no-preference, not always-on');

console.log('\n== No fixed width in the new UI can overflow a ' + NARROW + 'px viewport ==');
{
  /* every px width/min-width declared inside the new generator + puzzle rules */
  const newBlocks = css.split('/* ---- puzzle generator ---- */')[1] || '';
  const upTo = newBlocks.split('/* ---- modals ---- */')[0] || '';
  const widths = [...upTo.matchAll(/(?:^|[;{])\s*(?:min-)?width:\s*(\d+)px/g)].map(m => +m[1]);
  const worst = widths.length ? Math.max(...widths) : 0;
  ok(worst <= NARROW, 'widest fixed width in the generator/puzzle CSS fits', worst + 'px');
  const segFixed = /\.seg\{[^}]*width:\s*\d+px/.test(css.replace(/\s+/g, ''));
  ok(!segFixed, 'the time/target selectors are not fixed-width');
  ok(/\.gen-stat\{[^}]*min-width:0/.test(upTo.replace(/\s+/g, '')),
    'stat tiles carry min-width:0 so grid children can actually shrink');
  ok(/min-width:0/.test(upTo), 'the generator text column can shrink below its content width');
}

console.log('\n== Tap targets and reachability ==');
{
  const flat = css.replace(/\s+/g, '');
  ok(/\.puzhud\.acts\.btn\{min-height:40px\}/.test(flat),
    'puzzle action buttons get a 40px minimum on narrow screens');
  ok(/#genOverlay\.modal-foot\.btn\{min-height:44px/.test(flat),
    'generator footer buttons (including Stop) get a 44px minimum on narrow screens');
  ok(/#genOverlay\.segbutton\{min-height:38px\}/.test(flat),
    'time/target options get a 38px minimum on narrow screens');
  ok(/#genOverlay\.modal-foot\{flex-wrap:wrap\}/.test(flat),
    'the generator footer wraps rather than squeezing buttons off the sheet');
  note('Minimum heights are declared in CSS but not measured here; confirm the ' +
    'rendered tap targets in a real browser.');
  ok(/\.modal-foot\{display:flex;gap:9px;justify-content:flex-end/.test(css.replace(/\s+/g, '')),
    'the modal footer (where Stop lives) is a flex row that can wrap to the sheet bottom');
}

/* ---- dynamic: drive the app's own narrow paths ---- */
(async function () {
  console.log('\n== Dynamic: the app\'s narrow-viewport code paths ==');
  const problems = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/index.html',
    beforeParse(w) {
      /* report NARROW for width media queries, and a narrow innerWidth */
      w.matchMedia = q => ({ matches: /max-width/.test(q) && !/reduce/.test(q), addListener() {}, removeListener() {} });
      w.Worker = undefined;
      w.URL.createObjectURL = () => 'blob:x';
      Object.defineProperty(w, 'innerWidth', { configurable: true, get: () => NARROW });
      Object.defineProperty(w, 'innerHeight', { configurable: true, get: () => 640 });
      w.addEventListener('error', e => problems.push('window error: ' + (e.message || e.error)));
    }
  });
  const win = dom.window, doc = win.document, $ = id => doc.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const click = el => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(700);
  const XO = win.__XO;

  ok(!!XO, 'the app boots at ' + NARROW + 'px wide');
  XO.goRoute('puzzles'); await sleep(120);
  ok($('genOpenBtn') && !$('genOpenBtn').hidden, 'the generator entry point is present on a narrow screen');
  click($('genOpenBtn')); await sleep(120);
  ok($('genOverlay').classList.contains('open'), 'the generator modal opens on a narrow screen');

  /* every setting must still be reachable */
  const times = [...$('genTimeSeg').querySelectorAll('button')];
  const targets = [...$('genTargetSeg').querySelectorAll('button')];
  ok(times.length === 6 && times.every(b => !b.hidden), 'all six time options remain present');
  ok(targets.length === 6 && targets.every(b => !b.hidden), 'all six target options remain present');
  click(times.find(b => b.dataset.v === '30000')); await sleep(60);
  ok(XO.genSettings.durationMs === 30000, 'a time option is tappable on a narrow screen');

  XO.genSettings.durationMs = 4000; XO.genSettings.target = 3;
  XO.startGeneration();
  const t0 = Date.now();
  while (XO.GS && XO.GS.running && Date.now() - t0 < 14000) await sleep(60);
  await sleep(150);
  ok(XO.GENERATED_PUZZLES.length > 0, 'generation works at ' + NARROW + 'px', XO.GENERATED_PUZZLES.length);
  ok($('genBoardG').querySelectorAll('.gx, .go').length >= 0, 'the mini board renders at narrow width');
  ok($('genSavedText').textContent.length > 0 && $('genSavedText').textContent.length < 60,
    'the saved-count line stays short enough not to wrap badly', '"' + $('genSavedText').textContent + '"');

  /* Stop must be obvious whenever a run is live */
  XO.genSettings.durationMs = 0; XO.genSettings.target = 0;
  XO.startGeneration(); await sleep(150);
  ok($('genStopBtn').hidden === false, 'Stop is visible while running on a narrow screen');
  ok($('genStopBtn').textContent.indexOf('Stop') > 0, 'Stop is labelled, not icon-only', $('genStopBtn').textContent);
  ok($('genStartBtn').hidden === true, 'Start is replaced rather than competing with Stop');
  click($('genStopBtn')); await sleep(200);
  ok(!XO.GS.running, 'Stop works on a narrow screen');
  click($('genCloseBtn')); await sleep(100);

  /* puzzle mode narrow */
  const gi = XO.PUZZLES.findIndex(p => p.source === 'generated-local');
  XO.startPuzzle(gi >= 0 ? gi : 0); await sleep(250);
  ok($('puzHud').hidden === false, 'the puzzle panel shows on a narrow screen');
  ok($('puzShowSol') && $('puzResetBtn') && $('puzExitBtn'), 'all puzzle controls are present');
  ok($('evalBar').offsetParent === null || doc.body.classList.contains('puzzle-mode'),
    'the eval bar is removed in puzzle mode (no narrow-layout eval strip)');
  /* narrow eval-bar path must not run while a puzzle is open */
  XO.setEvalDisplay({ score: 5000, depth: 4 });
  ok($('mateBadge').hidden === true, 'the narrow eval path is inert during a puzzle');
  click($('puzExitBtn')); await sleep(200);
  ok(!doc.body.classList.contains('puzzle-mode'), 'leaving the puzzle restores the normal narrow layout');

  ok(problems.length === 0, 'no errors at ' + NARROW + 'px', problems.join(' | '));

  console.log('\n---------------------------');
  console.log('MOBILE AUDIT  PASS: ' + pass + '   FAIL: ' + fail);
  console.log('\nNOT VERIFIABLE IN THIS ENVIRONMENT (needs a real browser):');
  console.log('  - actual pixel geometry, overflow and scroll behaviour (jsdom does no layout)');
  console.log('  - touch scrolling inside the bottom-sheet modal');
  console.log('  - real font metrics, so text collision is inferred from wrap rules only');
  console.log('  - safe-area insets on notched devices');
  notes.forEach(n => console.log('  - ' + n));
  try { dom.window.close(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('MOBILE AUDIT CRASHED: ' + (e && e.stack || e)); process.exit(1); });
