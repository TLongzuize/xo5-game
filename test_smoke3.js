/* test_smoke3.js — final end-to-end smoke test against the built index.html.
   Complements test_ui3.js (which is the detailed regression suite) with a
   short top-to-bottom checklist matching the project's release checklist:
   home page, routing, X-first under every side assignment, local 2P, AI
   levels, time controls + Stop, X-positive evaluation, best move, analysis,
   navigation, undo/reset, win/draw, puzzles, the mobile scroll-jump fix, and
   stale-search protection. Run with: node test_smoke3.js */
const fs=require('fs'),path=require('path');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const errors=[];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.com/index.html',
 beforeParse(w){w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  w.Worker=undefined; w.URL.createObjectURL=()=>'blob:x';
  w.addEventListener('error',e=>errors.push(e.message||e.error));}});
const win=dom.window,doc=win.document,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=id=>doc.getElementById(id);
const idx=(x,y)=>y*15+x;
const cellAt=i=>[...doc.querySelectorAll('.cell')].find(c=>+c.dataset.i===i);
const click=el=>el&&el.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
async function settle(max=15000){const t0=Date.now();while(Date.now()-t0<max){await sleep(80);if(!win.__XO.isSearching()&&win.__XO.pendingCount()===0){await sleep(80);return true;}}return false;}
let checks=[];
function C(name,cond,extra){checks.push({name,cond:!!cond,extra});}

(async()=>{
  await sleep(700);
  const XO=win.__XO, X=1, O=2;

  // Home page loads
  C('Home page loads', $('viewHome').hidden===false && doc.title.indexOf('XO 5')>=0, doc.title);

  // hash routing works
  win.location.hash='#/analysis';
  await sleep(200);
  C('hash routing works', $('viewGame').hidden===false && XO.currentRoute()==='analysis');

  // Play vs AI works + X always starts
  XO.S.level=1; XO.S.timeMs=800;
  XO.startGame('ai',{humanSide:X});
  await sleep(150);
  C('Play vs AI: game created', XO.G.mode==='ai');
  C('X always starts', XO.G.rootSide===X);
  click(cellAt(idx(7,7)));
  await settle();
  C('human-as-X works (human moved as X)', XO.G.main[0] && XO.G.main[0].player===X);
  C('AI replied as O', XO.G.main[1] && XO.G.main[1].player===O);

  // human-as-O works
  XO.startGame('ai',{humanSide:O});
  const aiOpened = await (async()=>{const t0=Date.now();while(Date.now()-t0<15000){if(XO.G.main.length>=1)return true;await sleep(80);}return false;})();
  C('human-as-O works (engine opened as X)', aiOpened && XO.G.main[0].player===X);
  await settle();

  // Local 2 Player works
  XO.startGame('local',{});
  await sleep(100);
  click(cellAt(idx(7,7))); await sleep(80);
  click(cellAt(idx(8,8))); await sleep(80);
  C('Local 2 Player works, no AI move', XO.G.main.length===2 && XO.G.main[0].player===X && XO.G.main[1].player===O);
  await sleep(1200);
  C('Local 2P: still no AI move after waiting', XO.G.main.length===2);

  // AI levels 1-9 present
  const lvBtns=[...$('levelSeg').querySelectorAll('button')].map(b=>b.dataset.v);
  C('AI levels 1-9 present', lvBtns.join(',')==='1,2,3,4,5,6,7,8,9', lvBtns.join(','));

  // time controls: 5s, 30s, 60s
  const tBtns=[...$('timeSeg').querySelectorAll('button')].map(b=>b.dataset.v);
  C('5s control present', tBtns.includes('5000'));
  C('30s control present', tBtns.includes('30000'));
  C('60s control present', tBtns.includes('60000'));

  // Stop works — check immediately (the main-thread fallback used in this
  // headless test environment can finish a shallow search in well under
  // 300ms, so the assertion must sample the state right after the search
  // is kicked off, exactly as the UI suite does).
  XO.startGame('analysis',{});
  XO.S.timeMs=30000;
  XO.runAnalysis(true, 20000);
  const stopAppeared = await (async()=>{const t0=Date.now();while(Date.now()-t0<3000){if($('stopBtn').hidden===false)return true;await sleep(20);}return false;})();
  const pendingWhileSearching = XO.pendingCount()>0 || stopAppeared;
  click($('stopBtn'));
  await sleep(200);
  C('Stop works (control appears during search, clears pending on click)', pendingWhileSearching && XO.pendingCount()===0, 'stopAppeared='+stopAppeared);
  XO.S.timeMs=1000;
  await settle();

  // evaluation X-positive (accept either a plain positive number or a
  // mate label naming X, e.g. "M2 X" — both are correct X-positive display)
  const bx=new Int8Array(225); bx[idx(5,7)]=X;bx[idx(6,7)]=X;bx[idx(7,7)]=X;bx[idx(0,0)]=O;bx[idx(14,14)]=O;
  XO.startGame('analysis',{root:bx, rootSide:X});
  await settle(20000);
  const evalTxt = $('evalNum').textContent;
  const evalOk = XO.current && XO.current.score>0 && (/^M\d+ X$/.test(evalTxt) || +evalTxt >= 0);
  C('evaluation displays X-positive correctly', evalOk, 'score='+(XO.current&&XO.current.score)+' evalNum='+evalTxt);

  // best move works
  C('best move works', XO.current && XO.current.best!=null && $('arrows').innerHTML.indexOf('circle')>=0);

  // analysis works: PV always populated; candidates are populated for a
  // normal search result, and legitimately empty only for a proven forced
  // win found by the VCF short-circuit (kind:'vcf'), which returns before
  // the candidate-generating search loop runs.
  const analysisOk = XO.current && Array.isArray(XO.current.pv) && XO.current.pv.length>0 &&
    (XO.current.kind === 'vcf' || (XO.current.candidates && XO.current.candidates.length>0));
  C('analysis works (PV populated; candidates populated unless a forced win short-circuits)', analysisOk, 'kind='+(XO.current&&XO.current.kind));

  // also verify the ordinary (non-forced-win) path populates candidates,
  // since the position above happened to resolve via the VCF shortcut
  const ordinary = new Int8Array(225); ordinary[idx(7,7)]=X; ordinary[idx(8,8)]=O;
  XO.startGame('analysis',{root:ordinary, rootSide:X});
  await settle(20000);
  C('analysis populates a real candidate list on an ordinary (non-forced) position',
    XO.current && XO.current.candidates && XO.current.candidates.length>0,
    'kind='+(XO.current&&XO.current.kind)+' candidates='+(XO.current&&XO.current.candidates&&XO.current.candidates.length));

  // move navigation works
  XO.startGame('local',{moves:[idx(7,7),idx(8,8),idx(6,6)]});
  await sleep(100);
  XO.G.view=0; win.__XO.goRoute && null;
  // use nav buttons directly
  click($('navLast')); await sleep(100);
  const atLast = XO.G.view===XO.line().length;
  click($('navFirst')); await sleep(100);
  const atFirst = XO.G.view===0;
  C('move navigation works (first/last)', atLast && atFirst);

  // undo/reset works
  XO.startGame('local',{moves:[idx(7,7),idx(8,8)]});
  await sleep(100);
  click($('undoBtn')); await sleep(100);
  C('undo works', XO.G.main.length===1);
  click($('newBtn')); await sleep(120);
  // New Game with a move already on the board asks for confirmation first
  const confirmShown = doc.getElementById('confirmOverlay').classList.contains('open');
  if (confirmShown) click($('confOk'));
  await sleep(150);
  C('reset (New Game) works', XO.G.main.length===0, 'confirmDialogShown='+confirmShown);

  // win/draw logic
  XO.startGame('local',{});
  await sleep(80);
  for(const s of [idx(3,7),idx(3,0),idx(4,7),idx(4,0),idx(5,7),idx(5,0),idx(6,7),idx(6,0)]){click(cellAt(s));await sleep(60);}
  click(cellAt(idx(7,7)));
  await sleep(300);
  C('win logic works', XO.G.status==='won' && XO.G.winner===X);

  // puzzle functionality
  C('puzzle functionality present', XO.PUZZLES.length>0);
  XO.goRoute('puzzles'); await sleep(100);
  click($('puzGrid').children[0]); await sleep(300);
  C('puzzle starts correctly', XO.G.puzzle && XO.G.puzzle.active && XO.sideAt(XO.line().length)===X);
  XO.G.puzzle=null;
  await settle();

  // mobile layout doesn't jump (structural check)
  C('mobile: no scrollIntoView in build', html.indexOf('scrollIntoView')<0);
  C('mobile: preventScroll used on focus', html.indexOf('preventScroll: true')>0);

  // stale worker results cannot mutate a new position
  XO.startGame('analysis',{});
  await sleep(80);
  const tok0=XO.analysisTokenValue();
  XO.scheduleAnalysis(true);
  await sleep(100);
  XO.startGame('analysis',{moves:[idx(7,7),idx(8,8)]});
  await sleep(80);
  C('stale search token invalidated on new position', XO.analysisTokenValue()>tok0);
  await settle(20000);
  C('newer position not overwritten by stale search', XO.G.main.length===2);

  C('no uncaught errors during full smoke run', errors.length===0, errors.join(' | '));

  console.log('\n=== FINAL SMOKE TEST RESULTS ===');
  let p=0,f=0;
  checks.forEach(c=>{if(c.cond){p++;console.log('  PASS '+c.name);}else{f++;console.log('  FAIL '+c.name+(c.extra?' -> '+c.extra:''));}});
  console.log('\nSMOKE TEST  PASS: '+p+'   FAIL: '+f);
  try{dom.window.close();}catch(e){}
  process.exit(f?1:0);
})().catch(e=>{console.error('SMOKE CRASHED:',e.stack||e);process.exit(1);});
