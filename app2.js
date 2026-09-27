/* ===========================================================
   XO 5-in-a-Row — application layer v2
   =========================================================== */
(function () {
  'use strict';
  var E = window.XOEngine;
  var SIZE = E.SIZE, LEN = E.LEN, X = E.X, O = E.O;
  var COLS = 'ABCDEFGHIJKLMNO';
  var $ = function (id) { return document.getElementById(id); };
  function nm(i) { return COLS[i % SIZE] + (SIZE - ((i / SIZE) | 0)); }
  function other(p) { return p === X ? O : X; }

  /* display scale: calibrated so an open three ≈ 2, a four ≈ 5.5 */
  var K_SCALE = 9000, MAXP = 6;
  function dp(score) {
    if (score == null) return 0;
    if (Math.abs(score) >= E.MATE_THRESHOLD) return score > 0 ? MAXP : -MAXP;
    return MAXP * Math.tanh(score / K_SCALE);
  }

  /* ---------------- settings & persistence ---------------- */
  var DEFAULTS = {
    difficulty: 'medium', first: 'you', timer: 0, hints: true,
    engineTime: 2000, evalBar: true, bestMove: false, candidates: true,
    threatMap: false, quality: true, explain: true, graph: true,
    theme: 'light', coords: true, boardSize: 620, sound: true, details: false
  };
  var S = Object.assign({}, DEFAULTS);
  function store(k, v) { try { localStorage.setItem('xo5.' + k, JSON.stringify(v)); } catch (e) {} }
  function load(k, d) { try { var v = localStorage.getItem('xo5.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }

  var STATS = load('stats2', {
    played: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0, moveTotal: 0,
    firstMoves: 0, centerFirst: 0, firstDistTotal: 0
  });
  var ACH_DEFS = [
    { id: 'first_win', label: 'First Win' },
    { id: 'hard_win', label: 'Win on Hard' },
    { id: 'streak5', label: '5-Win Streak' },
    { id: 'fast_win', label: 'Win Under 20 Moves' },
    { id: 'comeback', label: 'Comeback Win' },
    { id: 'perfect_defense', label: 'Perfect Defense' },
    { id: 'tactical', label: 'Tactical Master' },
    { id: 'clean_hard', label: 'Beat Hard AI, No Hints' }
  ];
  var ACH = load('ach', {});

  /* ---------------- game state ---------------- */
  var G = null;

  function newGame(starter) {
    return {
      main: [], starter: starter, status: 'playing', winner: null, winCells: null,
      view: 0, variation: null, analysis: false, editing: false, editBoard: null,
      sideOverride: null, hintIdx: null, hintsUsed: 0, sawMateForX: false, worstForX: 0,
      clock: { 1: S.timer * 60000, 2: S.timer * 60000 },
      startTime: Date.now(), lastAiMs: null, puzzle: null
    };
  }
  function line() {
    if (!G) return [];
    return G.variation ? G.main.slice(0, G.variation.from).concat(G.variation.moves) : G.main;
  }
  function boardAt(n) {
    var b = new Int8Array(LEN), L = line();
    for (var i = 0; i < n && i < L.length; i++) b[L[i].idx] = L[i].player;
    return b;
  }
  function sideAt(n) {
    if (G.sideOverride != null && n === line().length) return G.sideOverride;
    return (n % 2 === 0) ? G.starter : other(G.starter);
  }
  function atLive() {
    return G && G.status === 'playing' && !G.analysis && !G.variation && !G.editing &&
      G.view === G.main.length;
  }
  function humanToMove() { return atLive() && sideAt(G.view) === X; }

  /* ---------------- worker ---------------- */
  var worker = null, reqId = 0, pending = {};
  function initWorker() {
    try {
      var src = $('engineSrc').textContent + '\n' +
        'function rebuild(ms){var s=new XOEngine.State();for(var i=0;i<ms.length;i++)s.play(ms[i][0],ms[i][1]);return s;}\n' +
        'self.onmessage=function(e){var d=e.data;var s=rebuild(d.moves);var r;\n' +
        ' var prog=function(p){self.postMessage({id:d.id,kind:"progress",p:p});};\n' +
        ' if(d.type==="move") r=XOEngine.chooseMove(s,d.player,d.difficulty,d.timeMs,prog);\n' +
        ' else if(d.type==="analyse") r=XOEngine.analyse(s,d.player,{timeMs:d.timeMs,vct:d.vct,onProgress:prog});\n' +
        ' else if(d.type==="threats") r=XOEngine.threatMap(s,2);\n' +
        ' else if(d.type==="explain") r=XOEngine.explainMove(s,d.idx,d.player);\n' +
        ' else if(d.type==="forcing") r=XOEngine.solveForcing(s,d.player,{maxPly:d.maxPly||10,nodes:80000,timeMs:d.timeMs||2000,vct:true});\n' +
        ' self.postMessage({id:d.id,kind:"done",res:r});};';
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
      worker.onmessage = function (e) {
        var p = pending[e.data.id];
        if (!p) return;
        if (e.data.kind === 'progress') { if (p.onProgress) p.onProgress(e.data.p); return; }
        delete pending[e.data.id];
        p.resolve(e.data.res);
      };
      worker.onerror = function () { worker = null; };
    } catch (err) { worker = null; }
  }
  function ask(payload, onProgress) {
    return new Promise(function (resolve) {
      if (worker) {
        var id = ++reqId; payload.id = id;
        pending[id] = { resolve: resolve, onProgress: onProgress };
        worker.postMessage(payload);
      } else {
        setTimeout(function () {
          var s = new E.State();
          payload.moves.forEach(function (m) { s.play(m[0], m[1]); });
          var r;
          if (payload.type === 'move') r = E.chooseMove(s, payload.player, payload.difficulty, Math.min(payload.timeMs, 900), onProgress);
          else if (payload.type === 'analyse') r = E.analyse(s, payload.player, { timeMs: Math.min(payload.timeMs, 900), vct: payload.vct, onProgress: onProgress });
          else if (payload.type === 'threats') r = E.threatMap(s, 2);
          else if (payload.type === 'explain') r = E.explainMove(s, payload.idx, payload.player);
          else if (payload.type === 'forcing') r = E.solveForcing(s, payload.player, { maxPly: 8, nodes: 40000, timeMs: 1200, vct: true });
          resolve(r);
        }, 15);
      }
    });
  }
  function movesUpTo(n) { return line().slice(0, n).map(function (m) { return [m.idx, m.player]; }); }

  /* ---------------- engine cache ---------------- */
  var cache = new Map();
  function posKey(n) {
    return movesUpTo(n).map(function (m) { return m[0] + '.' + m[1]; }).join(',') + '|' + sideAt(n) + '|' + S.engineTime;
  }
  function cacheClear() { cache.clear(); }

  /* ---------------- sound ---------------- */
  var actx = null;
  function beep(f, d, t, g) {
    if (!S.sound) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), gn = actx.createGain();
      o.type = t || 'sine'; o.frequency.value = f;
      gn.gain.setValueAtTime(0, actx.currentTime);
      gn.gain.linearRampToValueAtTime(g == null ? .05 : g, actx.currentTime + .012);
      gn.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + d);
      o.connect(gn); gn.connect(actx.destination); o.start(); o.stop(actx.currentTime + d + .02);
    } catch (e) {}
  }
  var SND = {
    x: function () { beep(660, .08, 'triangle', .05); },
    o: function () { beep(440, .08, 'sine', .05); },
    click: function () { beep(320, .04, 'sine', .028); },
    win: function () { beep(523, .12, 'sine', .06); setTimeout(function () { beep(784, .22, 'sine', .06); }, 110); },
    lose: function () { beep(330, .18, 'sine', .05); setTimeout(function () { beep(247, .26, 'sine', .05); }, 140); },
    err: function () { beep(180, .09, 'square', .03); }
  };

  /* ---------------- board ---------------- */
  var boardEl = $('board'), cellEls = new Array(LEN), focusIdx = 112;

  function buildBoard() {
    var html = '';
    for (var i = 0; i < LEN; i++) {
      html += '<button class="cell" role="gridcell" data-i="' + i + '" data-occ="0" tabindex="-1" aria-label="Cell ' + nm(i) + ', empty"></button>';
    }
    boardEl.innerHTML = html;
    var n = boardEl.children;
    for (var k = 0; k < n.length; k++) cellEls[+n[k].dataset.i] = n[k];
    var top = '', left = '';
    for (var c = 0; c < SIZE; c++) { top += '<span>' + COLS[c] + '</span>'; left += '<span>' + (SIZE - c) + '</span>'; }
    $('coordsTop').innerHTML = top; $('coordsLeft').innerHTML = left;
    setFocus(focusIdx);
  }
  function setFocus(i) {
    if (cellEls[focusIdx]) cellEls[focusIdx].tabIndex = -1;
    focusIdx = i;
    if (cellEls[i]) cellEls[i].tabIndex = 0;
  }

  var SVG_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><line class="mark-x" x1="5" y1="5" x2="19" y2="19"/><line class="mark-x" x1="19" y1="5" x2="5" y2="19"/></svg>';
  var SVG_O = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="mark-o" cx="12" cy="12" r="7.4"/></svg>';

  var shownBoard = new Int8Array(LEN);
  function invalidateBoard() { shownBoard.fill(-1); }   // -1 forces a full repaint
  function renderPosition(animateIdx) {
    if (!G) return;
    var b = G.editing ? G.editBoard : boardAt(G.view);
    for (var i = 0; i < LEN; i++) {
      var el = cellEls[i];
      if (shownBoard[i] !== b[i]) {
        el.innerHTML = b[i] === X ? SVG_X : (b[i] === O ? SVG_O : '');
        el.dataset.occ = b[i] ? '1' : '0';
        el.setAttribute('aria-label', 'Cell ' + nm(i) + ', ' + (b[i] ? 'occupied by ' + (b[i] === X ? 'X' : 'O') : 'empty'));
        shownBoard[i] = b[i];
      }
      el.className = 'cell';
      el.style.removeProperty('--tc'); el.style.removeProperty('--ti');
    }
    if (animateIdx != null && cellEls[animateIdx]) {
      cellEls[animateIdx].classList.add('pop');
      setTimeout(function () { cellEls[animateIdx] && cellEls[animateIdx].classList.remove('pop'); }, 220);
    }
    var L = line();
    var lastMove = (!G.editing && G.view > 0) ? L[G.view - 1] : null;

    // winning line for the displayed position
    var wc = null;
    if (lastMove) {
      var w = E.winningLineAt(b, lastMove.idx, lastMove.player);
      if (w) wc = w;
    }
    if (wc) wc.forEach(function (i) { cellEls[i].classList.add('win'); });
    else if (lastMove) cellEls[lastMove.idx].classList.add('last');
    if (G.hintIdx != null && !b[G.hintIdx]) cellEls[G.hintIdx].classList.add('hint');

    applyThreatClasses(b);
    drawArrow(lastMove);
    updateInteractivity(b);
    boardEl.dataset.ghost = G.editing ? (editTool === 'o' ? 'o' : 'x') : (sideAt(G.view) === X ? 'x' : 'o');
  }

  function updateInteractivity(b) {
    var can = G.editing || (G.analysis && G.status !== 'x') || humanToMove();
    for (var i = 0; i < LEN; i++) {
      var el = cellEls[i];
      var allow = G.editing ? true : (b[i] === 0 && (humanToMove() || G.analysis));
      if (allow) el.removeAttribute('disabled'); else el.setAttribute('disabled', '');
    }
  }

  /* threat map */
  var threats = [];
  function applyThreatClasses(b) {
    if (!S.threatMap || !threats.length) return;
    threats.forEach(function (t) {
      var el = cellEls[t.idx];
      if (!el || b[t.idx] !== 0) return;
      el.classList.add('thr');
      el.style.setProperty('--tc', t.player === X ? 'var(--x)' : 'var(--o)');
      el.style.setProperty('--ti', String(Math.min(1, 0.25 + t.level * 0.18)));
      el.title = (t.player === X ? 'X: ' : 'O: ') + t.label;
    });
  }
  function refreshThreats() {
    threats = [];
    if (!S.threatMap || !G) { renderPosition(); return; }
    var key = posKey(G.view);
    ask({ type: 'threats', moves: movesUpTo(G.view) }).then(function (r) {
      if (key !== posKey(G.view)) return;
      threats = r || [];
      renderPosition();
    });
  }

  /* best-move arrow */
  function drawArrow(lastMove) {
    var svg = $('arrows');
    var best = current && current.best;
    var show = S.bestMove && best != null && G.status === 'playing' &&
      (humanToMove() || G.analysis) && boardAt(G.view)[best] === 0;
    if (!show) { svg.innerHTML = ''; return; }
    var bx = (best % SIZE) + .5, by = ((best / SIZE) | 0) + .5;
    var html = '<defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2.6" refY="2" orient="auto">' +
      '<path d="M0,0 L4,2 L0,4 z" fill="#12B76A"/></marker></defs>';
    if (lastMove) {
      var ax = (lastMove.idx % SIZE) + .5, ay = ((lastMove.idx / SIZE) | 0) + .5;
      var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      ax += dx / len * .42; ay += dy / len * .42;
      bx -= dx / len * .42; by -= dy / len * .42;
      html += '<line x1="' + ax + '" y1="' + ay + '" x2="' + bx + '" y2="' + by + '" stroke="#12B76A" stroke-width="0.16" ' +
        'stroke-linecap="round" marker-end="url(#ah)" opacity="0.85"/>';
    }
    html += '<circle cx="' + ((best % SIZE) + .5) + '" cy="' + (((best / SIZE) | 0) + .5) + '" r="0.42" fill="none" stroke="#12B76A" stroke-width="0.11" opacity="0.9"/>';
    svg.innerHTML = html;
  }

  /* ---------------- evaluation display (stable) ---------------- */
  var current = null;          // last COMPLETED analysis for the displayed position
  var displayedPawns = 0, tweenRAF = null;

  function setEvalDisplay(res) {
    $('engineCard').hidden = !S.evalBar && !S.details;
    $('evalBar').style.visibility = S.evalBar ? '' : 'hidden';
    var pawns = res ? dp(res.score) : 0;
    var mate = res && res.mateIn;
    var pct = 50 + 47 * (pawns / MAXP);
    $('fillO').style[isNarrow() ? 'width' : 'height'] = Math.max(2, Math.min(98, pct)) + '%';
    if (isNarrow()) $('fillO').style.height = '100%'; else $('fillO').style.width = '';

    var label, desc;
    if (mate) {
      label = (res.score > 0 ? '+M' : '−M') + mate;
      desc = 'Winning for ' + (res.score > 0 ? 'O' : 'X');
    } else {
      var a = Math.abs(pawns);
      label = (pawns >= 0 ? '+' : '−') + a.toFixed(1);
      if (a < 0.25) { label = '0.0'; desc = 'Equal position'; }
      else if (a < 1) desc = 'Slight advantage for ' + (pawns > 0 ? 'O' : 'X');
      else if (a < 2.5) desc = 'Advantage for ' + (pawns > 0 ? 'O' : 'X');
      else if (a < 4.5) desc = 'Strong advantage for ' + (pawns > 0 ? 'O' : 'X');
      else desc = 'Winning for ' + (pawns > 0 ? 'O' : 'X');
    }
    if (res && res.terminalLabel) { $('barTick').textContent = ''; tweenNumber(pawns, res.terminalLabel); $('evalNum').style.color = pawns > 0 ? 'var(--o)' : 'var(--x)'; $('evalDesc').textContent = desc; return; }
    $('barTick').textContent = mate ? 'M' + mate : '';
    tweenNumber(pawns, mate ? label : null);
    $('evalNum').style.color = (mate || Math.abs(pawns) >= .25) ? (pawns > 0 ? 'var(--o)' : 'var(--x)') : 'var(--text)';
    $('evalDesc').textContent = desc;
  }
  function tweenNumber(target, fixedLabel) {
    if (fixedLabel) { cancelAnimationFrame(tweenRAF); $('evalNum').textContent = fixedLabel; displayedPawns = target; return; }
    var from = displayedPawns, t0 = performance.now(), dur = 320;
    cancelAnimationFrame(tweenRAF);
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      var v = from + (target - from) * (1 - Math.pow(1 - k, 3));
      displayedPawns = v;
      var a = Math.abs(v);
      $('evalNum').textContent = a < 0.25 ? '0.0' : (v >= 0 ? '+' : '−') + a.toFixed(1);
      if (k < 1) tweenRAF = requestAnimationFrame(step);
    })(t0);
  }
  function isNarrow() { return window.innerWidth <= 760; }

  function setEngineStatus(txt) { $('engineStatus').textContent = txt; }

  function showEngineInfo(res) {
    $('engineDetails').hidden = !S.details;
    if (!res) { $('pvBox').hidden = true; $('candBox').hidden = true; return; }
    var kv = '';
    kv += '<dt>Depth</dt><dd>' + res.depth + '</dd>';
    kv += '<dt>Nodes</dt><dd>' + res.nodes.toLocaleString() + '</dd>';
    kv += '<dt>Time</dt><dd>' + (res.timeMs / 1000).toFixed(2) + 's</dd>';
    if (res.ttProbes) kv += '<dt>TT hit rate</dt><dd>' + Math.round(100 * res.ttHits / res.ttProbes) + '%</dd>';
    kv += '<dt>Source</dt><dd>' + (res.kind === 'vcf' ? 'forcing solver' : res.kind) + '</dd>';
    $('engineKV').innerHTML = kv;

    var pv = res.pv || [];
    $('pvBox').hidden = !pv.length;
    if (pv.length) {
      var side = sideAt(G.view);
      var shown = pvExpanded ? pv : pv.slice(0, 5);
      $('pvList').innerHTML = shown.map(function (m, i) {
        var p = (i % 2 === 0) ? side : other(side);
        return '<button class="pvm ' + (p === X ? 'x' : 'o') + '" data-pv="' + m + '">' + nm(m) + '</button>';
      }).join('');
      $('pvMoreBtn').hidden = pv.length <= 5;
      $('pvMoreBtn').textContent = pvExpanded ? 'Show less' : 'Show more';
    }

    var showCand = S.candidates && G.analysis && res.candidates && res.candidates.length > 1;
    $('candBox').hidden = !showCand;
    if (showCand) {
      $('candList').innerHTML = res.candidates.slice(0, 3).map(function (c, i) {
        var v = dp(c.score);
        return '<div class="cand" data-cand="' + c.idx + '"><span>' + (i + 1) + '. <b>' + nm(c.idx) + '</b></span>' +
          '<b>' + (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '</b></div>';
      }).join('');
    }
  }
  var pvExpanded = false;

  /* ---------------- analysis scheduling ---------------- */
  var analysisSeq = 0;
  function scheduleAnalysis() {
    if (!G || G.editing) return;
    var n = G.view, key = posKey(n);
    var L = line();
    // terminal position: no engine call needed
    if (n > 0) {
      var lm = L[n - 1], b = boardAt(n);
      if (E.winningLineAt(b, lm.idx, lm.player)) {
        current = { score: lm.player === O ? E.MATE : -E.MATE, mateIn: 0, depth: 0, nodes: 0, timeMs: 0, pv: [], candidates: [], kind: 'terminal' };
        setEvalDisplay({ score: current.score, mateIn: null, terminalLabel: lm.player === O ? 'O wins' : 'X wins' });
        $('evalDesc').textContent = 'Winning for ' + (lm.player === O ? 'O' : 'X');
        setEngineStatus('Game over — no further analysis');
        $('pvBox').hidden = true; $('candBox').hidden = true;
        drawArrow(lm);
        return;
      }
      if (n >= LEN) { setEngineStatus('Draw — board full'); return; }
    }
    if (cache.has(key)) { applyAnalysis(cache.get(key), key, false); return; }

    var mySeq = ++analysisSeq;
    var budget = G.analysis ? S.engineTime : Math.min(S.engineTime, 800);
    setEngineStatus('Analysing… depth 1');
    ask({
      type: 'analyse', moves: movesUpTo(n), player: sideAt(n),
      timeMs: budget, vct: S.difficulty === 'hard' || G.analysis
    }, function (p) {
      if (mySeq !== analysisSeq) return;
      setEngineStatus('Analysing… depth ' + p.depth);   // depth only — eval stays stable
    }).then(function (res) {
      if (mySeq !== analysisSeq || !G) return;
      cache.set(key, res);
      applyAnalysis(res, key, true);
    });
  }

  function applyAnalysis(res, key, fresh) {
    if (!G || key !== posKey(G.view)) return;
    current = res;
    setEvalDisplay(res);
    setEngineStatus(res.stoppedByTime
      ? 'Time limit reached · best completed depth ' + res.depth + ' · ' + (res.timeMs / 1000).toFixed(2) + 's'
      : 'Analysis complete · depth ' + res.depth + ' · ' + (res.timeMs / 1000).toFixed(2) + 's');
    showEngineInfo(res);
    if (res.mateFor === X) G.sawMateForX = true;

    // record stable evaluation for the move that produced this position
    if (!G.variation && G.view > 0 && G.view <= G.main.length) {
      var mv = G.main[G.view - 1];
      if (mv.evalAfter == null || fresh) mv.evalAfter = res.score;
      if (dp(res.score) > G.worstForX) G.worstForX = dp(res.score);
      gradeMove(G.view - 1);
      refreshMoves(); refreshGraph();
    }
    renderPosition();
    refreshExplain();
  }

  function gradeMove(i) {
    if (!S.quality) return;
    var mv = G.main[i];
    if (!mv || mv.player !== X || mv.evalAfter == null) return;
    var before = i >= 1 ? G.main[i - 1].evalAfter : 0;
    if (i >= 1 && G.main[i - 1].evalAfter == null) return;
    var drop = dp(mv.evalAfter) - dp(before);      // O-positive: rise = X lost ground
    mv.quality = drop <= 0.35 ? 'Excellent' : drop <= 0.9 ? 'Good'
      : drop <= 1.8 ? 'Inaccuracy' : drop <= 3.2 ? 'Mistake' : 'Blunder';
  }

  function refreshExplain() {
    var box = $('explainBox');
    var L = line();
    if (!S.explain || G.view === 0 || G.editing || !L[G.view - 1]) { box.hidden = true; return; }
    var mv = L[G.view - 1];
    var key = 'ex' + posKey(G.view - 1) + mv.idx;
    if (explainCache[key]) { box.hidden = false; box.textContent = explainCache[key]; return; }
    ask({ type: 'explain', moves: movesUpTo(G.view - 1), idx: mv.idx, player: mv.player }).then(function (t) {
      explainCache[key] = t;
      if (!G || !L[G.view - 1] || L[G.view - 1].idx !== mv.idx) return;
      box.hidden = false;
      box.textContent = (mv.player === X ? 'X ' : 'O ') + nm(mv.idx) + ': ' + t;
    });
  }
  var explainCache = {};

  /* ---------------- panels ---------------- */
  function refreshStatus() {
    $('aiLabel').textContent = 'AI — ' + cap(S.difficulty);
    $('metaMoves').textContent = G.main.length;
    $('modeBadge').hidden = !G.analysis;
    $('modeBadge').classList.toggle('on', !!G.analysis);
    $('engineTag').textContent = G.editing ? 'position editor' : (G.analysis ? 'analysis' : '');
    var st = $('statusText');
    st.className = '';
    if (G.editing) { st.textContent = 'Editing position'; $('thinkDepth').textContent = ''; }
    else if (G.status === 'over') {
      if (G.winner === X) { st.textContent = 'You Win!'; st.className = 'win'; }
      else if (G.winner === O) { st.textContent = 'AI Wins'; st.className = 'lose'; }
      else st.textContent = 'Draw';
      $('thinkDepth').textContent = '';
    } else if (G.analysis) { st.textContent = 'Analysis Mode'; $('thinkDepth').textContent = ''; }
    else if (!atLive()) { st.textContent = 'Reviewing'; $('thinkDepth').textContent = ''; }
    else if (sideAt(G.view) === X) { st.textContent = 'Your Turn'; $('thinkDepth').textContent = ''; }
    else st.innerHTML = 'AI Thinking<span class="dots"><i></i><i></i><i></i></span>';
    $('srStatus').textContent = st.textContent;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function refreshNav() {
    var L = line(), n = L.length;
    $('navPos').textContent = 'Move ' + G.view + ' / ' + n + (G.variation ? ' · variation' : '');
    $('navFirst').disabled = $('navPrev').disabled = G.view === 0;
    $('navNext').disabled = $('navLast').disabled = G.view >= n;
    $('mainLineBtn').hidden = !G.variation;
    $('replayBtn').disabled = n === 0;
    $('analysisBtn').classList.toggle('on', !!G.analysis);
    $('continueBtn').hidden = !(G.analysis || G.variation || G.editing);
    $('undoBtn').disabled = !humanToMove() || !G.main.length;
    $('hintBtn').disabled = !S.hints || !humanToMove();
    $('editBtn').textContent = G.editing ? 'Cancel edit' : 'Edit Position';
  }

  function refreshMoves() {
    var listEl = $('moveList'), L = line();
    if (!L.length) { listEl.innerHTML = '<p class="empty-note">No moves yet.</p>'; return; }
    var html = '', n = 1;
    for (var i = 0; i < L.length; i += 2) {
      html += '<div class="move-row"><span class="n">' + n + '.</span>';
      for (var j = 0; j < 2; j++) {
        var m = L[i + j];
        if (!m) { html += '<span></span>'; continue; }
        var k = i + j;
        var q = (m.quality && S.quality) ? ' <span class="q ' + m.quality.toLowerCase() + '">' + m.quality + '</span>' : '';
        html += '<button class="mv ' + (m.player === X ? 'x' : 'o') + (k === G.view - 1 ? ' current' : '') +
          '" data-mi="' + (k + 1) + '">' + (m.player === X ? 'X' : 'O') + ' ' + nm(m.idx) + q + '</button>';
      }
      html += '</div>'; n++;
    }
    listEl.innerHTML = html;
    var cur = listEl.querySelector('.mv.current');
    if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
  }

  var graphPts = [];
  function refreshGraph() {
    $('graphCard').hidden = !S.graph;
    if (!S.graph || !G) return;
    var g = $('graph');
    graphPts = [];
    G.main.forEach(function (m, i) { if (m.evalAfter != null) graphPts.push({ i: i + 1, v: dp(m.evalAfter), m: m }); });
    if (graphPts.length < 2) { g.innerHTML = '<text x="150" y="52" text-anchor="middle" font-size="11" fill="#98A2B3">Not enough data yet</text>'; return; }
    var W = 300, H = 96, pad = 6, maxI = G.main.length;
    var xs = function (i) { return pad + (i - 1) / Math.max(1, maxI - 1) * (W - 2 * pad); };
    var ys = function (v) { return H / 2 - (v / MAXP) * (H / 2 - pad); };
    var d = graphPts.map(function (p, k) { return (k ? 'L' : 'M') + xs(p.i).toFixed(1) + ' ' + ys(p.v).toFixed(1); }).join(' ');
    var area = d + ' L' + xs(graphPts[graphPts.length - 1].i).toFixed(1) + ' ' + H / 2 + ' L' + xs(graphPts[0].i).toFixed(1) + ' ' + H / 2 + ' Z';
    var cursor = G.view > 0 ? '<line class="graph-cursor" x1="' + xs(G.view) + '" y1="0" x2="' + xs(G.view) + '" y2="' + H + '"/>' : '';
    g.innerHTML = '<path d="' + area + '" class="graph-area"/><line class="graph-zero" x1="0" y1="' + H / 2 + '" x2="' + W + '" y2="' + H / 2 + '"/>' +
      '<path class="graph-line" d="' + d + '"/>' + cursor;
    g._xs = xs;
  }

  function refreshScore() {
    $('scWins').textContent = STATS.wins; $('scLosses').textContent = STATS.losses; $('scDraws').textContent = STATS.draws;
    var rate = STATS.played ? Math.round(STATS.wins / STATS.played * 100) : 0;
    var rows = [['Games Played', STATS.played], ['Win Rate', rate + '%'],
      ['Current Streak', STATS.streak], ['Best Streak', STATS.best],
      ['Avg. Game Length', STATS.played ? Math.round(STATS.moveTotal / STATS.played) + ' moves' : '—']];
    if (STATS.firstMoves) {
      rows.push(['Center Openings', Math.round(100 * STATS.centerFirst / STATS.firstMoves) + '%']);
      rows.push(['Avg. Opening Distance', (STATS.firstDistTotal / STATS.firstMoves).toFixed(1)]);
    }
    $('statGrid').innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');
    $('achList').innerHTML = ACH_DEFS.map(function (a) {
      return '<span class="' + (ACH[a.id] ? 'got' : '') + '">' + a.label + '</span>';
    }).join('');
  }

  function refreshTimers() {
    $('timers').hidden = !S.timer;
    if (!S.timer) return;
    fmt($('timerX'), 'You', G.clock[X], sideAt(G.view) === X);
    fmt($('timerO'), 'AI', G.clock[O], sideAt(G.view) === O);
    function fmt(el, lab, ms, act) {
      var s = Math.max(0, Math.ceil(ms / 1000));
      el.textContent = lab + ' ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      el.classList.toggle('active', act && atLive());
      el.classList.toggle('low', s <= 15);
    }
  }

  function refreshAll() { refreshStatus(); refreshNav(); refreshMoves(); refreshGraph(); refreshScore(); refreshTimers(); renderPosition(); }

  /* ---------------- gameplay ---------------- */
  function startGame(starter, opts) {
    opts = opts || {};
    var first = starter || (S.first === 'you' ? X : S.first === 'ai' ? O : (Math.random() < .5 ? X : O));
    G = newGame(first);
    cacheClear();
    if (opts.moves) {
      opts.moves.forEach(function (idx, k) {
        G.main.push({ idx: idx, player: (k % 2 === 0) ? first : other(first), evalAfter: null, quality: null });
      });
      var lm = G.main[G.main.length - 1];
      if (lm) {
        var w = E.winningLineAt(boardAt(G.main.length), lm.idx, lm.player);
        if (w) { G.status = 'over'; G.winner = lm.player; G.winCells = w; }
      }
    }
    if (opts.puzzle) G.puzzle = opts.puzzle;
    if (opts.sideOverride) G.sideOverride = opts.sideOverride;
    G.view = G.main.length;
    invalidateBoard();
    refreshAll();
    scheduleAnalysis();
    refreshThreats();
    tickerStart();
    if (atLive() && sideAt(G.view) === O) setTimeout(aiMove, 250);
  }

  function place(idx, player) {
    var b = boardAt(G.view);
    if (b[idx] !== 0) { SND.err(); return false; }
    G.main.push({ idx: idx, player: player, evalAfter: null, quality: null });
    G.view = G.main.length;
    G.hintIdx = null;
    (player === X ? SND.x : SND.o)();
    if (player === X && G.main.length <= 2) recordOpening(idx);
    var nb = boardAt(G.view);
    var w = E.winningLineAt(nb, idx, player);
    renderPosition(idx);
    refreshMoves(); refreshNav(); refreshStatus();
    if (w) { endGame(player, w); return true; }
    if (G.main.length >= LEN) { endGame('draw', null); return true; }
    scheduleAnalysis();
    refreshThreats();
    if (sideAt(G.view) === O) setTimeout(aiMove, 150);
    return true;
  }

  function aiMove() {
    if (!atLive() || sideAt(G.view) !== O) return;
    refreshStatus();
    var t0 = Date.now(), seq = ++analysisSeq;
    ask({ type: 'move', moves: movesUpTo(G.view), player: O, difficulty: S.difficulty, timeMs: S.engineTime },
      function (p) { if (seq === analysisSeq) $('thinkDepth').textContent = 'Depth ' + p.depth; }
    ).then(function (res) {
      $('thinkDepth').textContent = '';
      if (!atLive() || sideAt(G.view) !== O || !res) return;
      G.lastAiMs = Math.max(res.timeMs || 0, Date.now() - t0);
      setEngineStatus('AI move · depth ' + res.depth + ' · ' + (res.timeMs / 1000).toFixed(2) + 's · ' + res.nodes.toLocaleString() + ' nodes');
      place(res.idx, O);
    });
  }

  function endGame(winner, winCells) {
    G.status = 'over'; G.winner = winner; G.winCells = winCells; G.hintIdx = null;
    STATS.played++; STATS.moveTotal += G.main.length;
    if (winner === X) { STATS.wins++; STATS.streak++; STATS.best = Math.max(STATS.best, STATS.streak); SND.win(); }
    else if (winner === O) { STATS.losses++; STATS.streak = 0; SND.lose(); }
    else { STATS.draws++; STATS.streak = 0; }
    store('stats2', STATS);
    checkAchievements(winner);
    renderPosition(); refreshAll();
    scheduleAnalysis();
    setTimeout(showEnd, 500);
  }

  function recordOpening(idx) {
    var d = Math.abs((idx % SIZE) - 7) + Math.abs(((idx / SIZE) | 0) - 7);
    STATS.firstMoves++; STATS.firstDistTotal += d;
    if (d <= 2) STATS.centerFirst++;
    store('stats2', STATS);
  }

  function checkAchievements(winner) {
    var got = [];
    function unlock(id) { if (!ACH[id]) { ACH[id] = Date.now(); got.push(ACH_DEFS.filter(function (a) { return a.id === id; })[0].label); } }
    if (winner === X) {
      unlock('first_win');
      if (S.difficulty === 'hard') unlock('hard_win');
      if (STATS.streak >= 5) unlock('streak5');
      if (G.main.length < 20) unlock('fast_win');
      if (G.worstForX >= 2) unlock('comeback');
      if (G.worstForX < 1) unlock('perfect_defense');
      if (G.sawMateForX) unlock('tactical');
      if (S.difficulty === 'hard' && G.hintsUsed === 0) unlock('clean_hard');
    }
    if (got.length) { store('ach', ACH); toast('Achievement unlocked: ' + got.join(', ')); }
    refreshScore();
  }

  /* ---------------- navigation / analysis mode ---------------- */
  function setView(n) {
    var L = line();
    G.view = Math.max(0, Math.min(L.length, n));
    G.hintIdx = null;
    refreshAll();
    scheduleAnalysis();
    refreshThreats();
  }
  $('navFirst').onclick = function () { stopReplay(); setView(0); };
  $('navPrev').onclick = function () { stopReplay(); setView(G.view - 1); };
  $('navNext').onclick = function () { stopReplay(); setView(G.view + 1); };
  $('navLast').onclick = function () { stopReplay(); setView(line().length); };
  $('mainLineBtn').onclick = function () { G.variation = null; setView(G.main.length); };

  $('analysisBtn').onclick = function () {
    SND.click();
    G.analysis = !G.analysis;
    if (!G.analysis) { G.variation = null; setView(G.main.length); }
    else refreshAll();
    scheduleAnalysis();
    toast(G.analysis ? 'Analysis Mode on — navigate freely, click to try variations' : 'Back to the game');
  };
  $('continueBtn').onclick = function () {
    if (G.editing) { cancelEdit(); return; }
    G.analysis = false; G.variation = null;
    setView(G.main.length);
    if (atLive() && sideAt(G.view) === O) setTimeout(aiMove, 200);
  };

  /* ---------------- replay ---------------- */
  var replayTimer = null, replaySpeed = 1;
  function stopReplay() { if (replayTimer) { clearInterval(replayTimer); replayTimer = null; $('replayBtn').textContent = '⏯'; } }
  $('replayBtn').onclick = function () {
    if (replayTimer) { stopReplay(); return; }
    if (G.view >= line().length) setView(0);
    $('replayBtn').textContent = '⏸';
    replayTimer = setInterval(function () {
      if (G.view >= line().length) { stopReplay(); return; }
      setView(G.view + 1);
    }, 700 / replaySpeed);
  };
  $('speedSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    replaySpeed = +b.dataset.v;
    [].forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    if (replayTimer) { stopReplay(); $('replayBtn').click(); }
  };

  /* ---------------- board interaction ---------------- */
  var editTool = 'x';
  boardEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.cell');
    if (!btn || btn.hasAttribute('disabled')) return;
    var i = +btn.dataset.i;
    setFocus(i);

    if (G.editing) {
      G.editBoard[i] = editTool === 'erase' ? 0 : (editTool === 'x' ? X : O);
      renderPosition(); updateEditCount();
      return;
    }
    if (G.puzzle && G.puzzle.active) { puzzleGuess(i); return; }
    if (humanToMove()) { SND.click(); place(i, X); return; }
    if (G.analysis) {                       // create / extend an analysis variation
      var L = line();
      if (!G.variation) G.variation = { from: G.view, moves: [] };
      else if (G.view < L.length) G.variation.moves = G.variation.moves.slice(0, G.view - G.variation.from);
      G.variation.moves.push({ idx: i, player: sideAt(G.view), evalAfter: null, quality: null });
      SND.click();
      setView(G.view + 1);
    }
  });

  boardEl.addEventListener('keydown', function (e) {
    var map = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (!map[e.key]) return;
    e.preventDefault(); e.stopPropagation();
    var x = Math.max(0, Math.min(SIZE - 1, (focusIdx % SIZE) + map[e.key][0]));
    var y = Math.max(0, Math.min(SIZE - 1, ((focusIdx / SIZE) | 0) + map[e.key][1]));
    setFocus(y * SIZE + x);
    cellEls[focusIdx].focus();
  });

  /* ---------------- controls ---------------- */
  $('newBtn').onclick = async function () {
    SND.click();
    if (G && G.status === 'playing' && G.main.length) {
      if (!(await confirmDialog('Start a new game? Your current progress will be lost.', 'New Game'))) return;
    }
    stopReplay(); startGame(null);
  };
  $('undoBtn').onclick = function () {
    if (!humanToMove() || !G.main.length) return;
    SND.click();
    var steps = (G.main.length >= 2 && G.main[G.main.length - 1].player === O) ? 2 : 1;
    G.main.splice(G.main.length - steps, steps);
    G.status = 'playing'; G.winner = null; G.winCells = null;
    G.view = G.main.length;
    invalidateBoard();
    refreshAll(); scheduleAnalysis(); refreshThreats();
    if (atLive() && sideAt(G.view) === O) setTimeout(aiMove, 200);
  };
  $('hintBtn').onclick = function () {
    if (!S.hints || !humanToMove()) return;
    SND.click();
    G.hintsUsed++;
    $('hintBtn').disabled = true;
    ask({ type: 'analyse', moves: movesUpTo(G.view), player: X, timeMs: Math.max(900, S.engineTime), vct: true })
      .then(function (res) {
        if (!G) return;
        G.hintIdx = res.best;
        renderPosition();
        toast('Best move: ' + nm(res.best));
        refreshNav();
      });
  };

  $('moveList').addEventListener('click', function (e) {
    var b = e.target.closest('.mv'); if (!b) return;
    stopReplay(); setView(+b.dataset.mi);
  });
  $('pvList').addEventListener('click', function (e) {
    var b = e.target.closest('.pvm'); if (!b) return;
    flash(+b.dataset.pv);
  });
  $('candList').addEventListener('click', function (e) {
    var b = e.target.closest('.cand'); if (!b) return;
    flash(+b.dataset.cand);
  });
  $('pvMoreBtn').onclick = function () { pvExpanded = !pvExpanded; showEngineInfo(current); };
  function flash(i) {
    if (cellEls[i]) { cellEls[i].classList.add('flash'); setTimeout(function () { renderPosition(); }, 1100); }
  }

  /* graph interaction */
  var graphEl = $('graph');
  graphEl.addEventListener('mousemove', function (e) {
    if (!graphPts.length) return;
    var r = graphEl.getBoundingClientRect();
    var rel = (e.clientX - r.left) / r.width * 300;
    var best = null, bd = 1e9;
    graphPts.forEach(function (p) { var d = Math.abs(graphEl._xs(p.i) - rel); if (d < bd) { bd = d; best = p; } });
    if (!best) return;
    var tip = $('graphTip');
    tip.innerHTML = 'Move ' + best.i + '<br>Evaluation: ' + (best.v >= 0 ? '+' : '−') + Math.abs(best.v).toFixed(1) +
      '<br>Player: ' + (best.m.player === X ? 'X' : 'O') + '<br>Move: ' + nm(best.m.idx);
    tip.classList.add('show');
    tip.style.left = Math.max(0, Math.min(r.width - 120, (graphEl._xs(best.i) / 300) * r.width - 60)) + 'px';
    tip.style.top = '-4px';
    graphEl._hover = best.i;
  });
  graphEl.addEventListener('mouseleave', function () { $('graphTip').classList.remove('show'); graphEl._hover = null; });
  graphEl.addEventListener('click', function () { if (graphEl._hover) { stopReplay(); setView(graphEl._hover); } });

  /* ---------------- position notation ---------------- */
  function encodePos(b, side) {
    var rows = [];
    for (var y = 0; y < SIZE; y++) {
      var s = '', run = 0;
      for (var x = 0; x < SIZE; x++) {
        var v = b[y * SIZE + x];
        if (v === 0) run++;
        else { if (run) { s += run; run = 0; } s += (v === X ? 'X' : 'O'); }
      }
      if (run) s += run;
      rows.push(s || '15');
    }
    return 'XO15/' + rows.join('/') + ' ' + (side === X ? 'x' : 'o');
  }
  function decodePos(str) {
    try {
      var m = str.trim().match(/^XO15\/(.+)\s+([xo])$/i);
      if (!m) return null;
      var rows = m[1].split('/');
      if (rows.length !== SIZE) return null;
      var b = new Int8Array(LEN);
      for (var y = 0; y < SIZE; y++) {
        var x = 0, tok = rows[y].match(/(\d+|[XO])/gi) || [];
        for (var t = 0; t < tok.length; t++) {
          if (/\d/.test(tok[t])) x += parseInt(tok[t], 10);
          else { if (x >= SIZE) return null; b[y * SIZE + x] = tok[t].toUpperCase() === 'X' ? X : O; x++; }
        }
        if (x !== SIZE) return null;
      }
      return { board: b, side: m[2].toLowerCase() === 'x' ? X : O };
    } catch (e) { return null; }
  }
  function encodeGameText() {
    return line().slice(0, G.view).map(function (m) { return (m.player === X ? 'X:' : 'O:') + nm(m.idx); }).join(' ');
  }
  function parseGameText(txt) {
    var toks = txt.trim().split(/\s+/), out = [];
    for (var i = 0; i < toks.length; i++) {
      var m = toks[i].match(/^([XO]):([A-O])(\d{1,2})$/i);
      if (!m) return null;
      var x = COLS.indexOf(m[2].toUpperCase()), row = parseInt(m[3], 10);
      if (x < 0 || row < 1 || row > 15) return null;
      out.push((SIZE - row) * SIZE + x);
    }
    return out;
  }
  function sanitize(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i] | 0;
      if (typeof arr[i] !== 'number' || v < 0 || v >= LEN || seen[v]) break;
      seen[v] = 1; out.push(v);
    }
    return out;
  }

  /* ---------------- save / load / share / copy ---------------- */
  $('saveBtn').onclick = function () {
    SND.click();
    store('save2', { starter: G.starter, moves: G.main.map(function (m) { return m.idx; }), difficulty: S.difficulty });
    toast('Game saved');
  };
  $('loadBtn').onclick = async function () {
    SND.click();
    var d = load('save2', null);
    if (!d || !Array.isArray(d.moves)) { toast('No saved game'); return; }
    if (G.main.length && G.status === 'playing' && !(await confirmDialog('Load the saved game? Current progress will be lost.', 'Load'))) return;
    if (d.difficulty) setDiff(d.difficulty);
    startGame(d.starter === O ? O : X, { moves: sanitize(d.moves) });
    toast('Game loaded');
  };
  $('clearSaveBtn').onclick = async function () {
    if (await confirmDialog('Delete the saved game?', 'Delete')) { try { localStorage.removeItem('xo5.save2'); } catch (e) {} toast('Saved game cleared'); }
  };
  function encodeShare() {
    var s = String.fromCharCode.apply(null, [G.starter].concat(G.main.map(function (m) { return m.idx; })));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeShare(str) {
    try {
      var b = atob(str.replace(/-/g, '+').replace(/_/g, '/')), nums = [];
      for (var i = 0; i < b.length; i++) nums.push(b.charCodeAt(i));
      var st = nums.shift();
      return { starter: st === O ? O : X, moves: sanitize(nums) };
    } catch (e) { return null; }
  }
  $('shareBtn').onclick = function () {
    SND.click();
    showIO('Share Game', 'Anyone opening this link gets this position.', location.origin + location.pathname + '?g=' + encodeShare(), 'Copy');
  };
  $('copyPosBtn').onclick = function () {
    var b = G.editing ? G.editBoard : boardAt(G.view);
    showIO('Copy Position', 'Compact position notation (reversible).', encodePos(b, sideAt(G.view)), 'Copy');
  };
  $('copyGameBtn').onclick = function () {
    showIO('Copy Game', 'Move list up to the displayed position.', encodeGameText(), 'Copy');
  };
  $('exportBtn').onclick = function () {
    showIO('Export Game', 'JSON you can re-import later.',
      JSON.stringify({ v: 2, starter: G.starter, difficulty: S.difficulty, moves: G.main.map(function (m) { return m.idx; }) }, null, 2), 'Copy');
  };
  $('importBtn').onclick = function () {
    showIO('Import Game', 'Paste exported JSON, a move list (X:H8 O:H9 …) or a position string, then press Load.', '', 'Load');
  };
  function showIO(t, h, v, a) {
    $('ioTitle').textContent = t; $('ioHelp').textContent = h; $('ioText').value = v;
    $('ioAction').textContent = a; $('ioAction').dataset.mode = a;
    openModal('ioOverlay');
  }
  $('ioAction').onclick = async function () {
    var txt = $('ioText').value;
    if (this.dataset.mode === 'Copy') {
      $('ioText').select();
      try { await navigator.clipboard.writeText(txt); } catch (e) { try { document.execCommand('copy'); } catch (e2) {} }
      toast('Copied'); return;
    }
    var mv = null, starter = X, diff = null;
    var pos = decodePos(txt);
    if (pos) {
      closeModal('ioOverlay');
      loadRawPosition(pos.board, pos.side);
      toast('Position loaded'); return;
    }
    try { var j = JSON.parse(txt); if (j && Array.isArray(j.moves)) { mv = sanitize(j.moves); starter = j.starter === O ? O : X; diff = j.difficulty; } } catch (e) {}
    if (!mv) { var p = parseGameText(txt); if (p) mv = sanitize(p); }
    if (!mv || !mv.length) { toast('Could not read that game data'); SND.err(); return; }
    if (diff) setDiff(diff);
    closeModal('ioOverlay');
    startGame(starter, { moves: mv });
    toast('Game imported');
  };

  function loadRawPosition(b, side) {
    // turn a raw board into a synthetic move list so navigation still works
    var xs = [], os = [];
    for (var i = 0; i < LEN; i++) { if (b[i] === X) xs.push(i); else if (b[i] === O) os.push(i); }
    var first = xs.length >= os.length ? X : O;
    var a = first === X ? xs : os, bb = first === X ? os : xs, moves = [];
    for (var k = 0; k < Math.max(a.length, bb.length); k++) {
      if (k < a.length) moves.push(a[k]);
      if (k < bb.length) moves.push(bb[k]);
    }
    startGame(first, { moves: moves, sideOverride: side });
    G.analysis = true;
    refreshAll(); scheduleAnalysis();
  }

  /* ---------------- position editor ---------------- */
  $('editBtn').onclick = function () {
    if (G.editing) { cancelEdit(); return; }
    G.editBoard = Int8Array.from(boardAt(G.view));
    G.editing = true; invalidateBoard();
    stopReplay();
    updateEditCount();
    openModal('editOverlay');
    refreshAll();
  };
  function cancelEdit() { G.editing = false; G.editBoard = null; invalidateBoard(); closeModal('editOverlay'); refreshAll(); scheduleAnalysis(); }
  $('editCancel').onclick = cancelEdit;
  $('editClear').onclick = function () { G.editBoard = new Int8Array(LEN); invalidateBoard(); renderPosition(); updateEditCount(); };
  $('toolSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    editTool = b.dataset.v;
    [].forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    renderPosition();
  };
  var editSide = X;
  $('sideSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    editSide = +b.dataset.v;
    [].forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
  };
  function updateEditCount() {
    var x = 0, o = 0;
    for (var i = 0; i < LEN; i++) { if (G.editBoard[i] === X) x++; else if (G.editBoard[i] === O) o++; }
    $('editCount').textContent = x + ' X stones, ' + o + ' O stones on the board.';
  }
  $('editAnalyze').onclick = async function () {
    if (G.main.length && G.status === 'playing' && !(await confirmDialog('Replace the current game with this position?', 'Analyse'))) return;
    var b = G.editBoard;
    G.editing = false; closeModal('editOverlay');
    loadRawPosition(b, editSide);
    toast('Analysing the edited position');
  };

  /* ---------------- daily challenge ---------------- */
  var PUZZLES = [];
  try { PUZZLES = JSON.parse($('puzzleSrc').textContent) || []; } catch (e) { PUZZLES = []; }
  function todaySeed() {
    var d = new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }
  $('dailyBtn').hidden = !PUZZLES.length;
  $('dailyBtn').onclick = function () {
    if (!PUZZLES.length) return;
    var p = PUZZLES[todaySeed() % PUZZLES.length];
    var st = load('daily', {});
    var done = st.day === todaySeed();
    $('dailyText').textContent = 'X to move. Find the move that forces a win. You have three attempts — the engine verifies your answer by searching for a forcing sequence.';
    $('dailyState').textContent = done ? (st.solved ? 'Solved today in ' + st.tries + ' attempt(s).' : 'Attempted today: ' + st.tries + ' tries.') : '';
    $('dailyStart').textContent = done && st.solved ? 'Replay' : 'Start';
    openModal('dailyOverlay');
  };
  $('dailyStart').onclick = async function () {
    var p = PUZZLES[todaySeed() % PUZZLES.length];
    closeModal('dailyOverlay');
    if (G.main.length && G.status === 'playing' && !(await confirmDialog('Load today’s challenge? The current game will be lost.', 'Load'))) return;
    startGame(X, { moves: p.moves.slice(), puzzle: { active: true, tries: 0, key: p.key } });
    G.analysis = false;
    toast('Daily Challenge — X to move, find the forcing win');
    refreshAll();
  };
  $('dailyGiveUp').onclick = function () {
    var p = PUZZLES[todaySeed() % PUZZLES.length];
    closeModal('dailyOverlay');
    if (!G.puzzle) { startGame(X, { moves: p.moves.slice(), puzzle: { active: false, tries: 0, key: p.key } }); }
    setTimeout(function () { G.hintIdx = p.key; renderPosition(); toast('Solution: ' + nm(p.key)); }, 300);
  };
  function puzzleGuess(i) {
    var pz = G.puzzle;
    if (boardAt(G.view)[i] !== 0) return;
    pz.tries++;
    setEngineStatus('Verifying your move…');
    var moves = movesUpTo(G.view).concat([[i, X]]);
    ask({ type: 'forcing', moves: moves, player: X, maxPly: 10, timeMs: 2500 }).then(function (r) {
      var b = boardAt(G.view);
      var immediate = E.winningLineAt((function () { var t = Int8Array.from(b); t[i] = X; return t; })(), i, X);
      var good = !!(r && r.win) || !!immediate;
      var st = { day: todaySeed(), tries: pz.tries, solved: good };
      store('daily', st);
      if (good) {
        pz.active = false;
        toast('Correct — ' + nm(i) + ' forces the win');
        place(i, X);
      } else if (pz.tries >= 3) {
        pz.active = false;
        toast('Out of attempts. The winning move was ' + nm(pz.key));
        G.hintIdx = pz.key; renderPosition();
      } else {
        SND.err();
        toast('Not a forcing win — ' + (3 - pz.tries) + ' attempt(s) left');
        setEngineStatus('Try again');
      }
    });
  }

  /* ---------------- end screen ---------------- */
  function showEnd() {
    var t = $('endTitle'), sub = $('endSub');
    if (G.winner === X) { t.textContent = 'You Win!'; t.className = 'result-title win'; sub.textContent = 'Five in a row.'; }
    else if (G.winner === O) { t.textContent = 'AI Wins'; t.className = 'result-title lose'; sub.textContent = 'Better luck next time.'; }
    else { t.textContent = 'Draw'; t.className = 'result-title draw'; sub.textContent = 'No winner this time.'; }
    var rows = [
      ['Result', G.winner === X ? 'You win' : G.winner === O ? 'AI wins' : 'Draw'],
      ['Difficulty', cap(S.difficulty)],
      ['Moves', G.main.length],
      ['Duration', Math.round((Date.now() - G.startTime) / 1000) + 's']
    ];
    if (G.winCells && G.winCells.length) rows.push(['Winning Line', nm(G.winCells[0]) + ' – ' + nm(G.winCells[G.winCells.length - 1])]);
    var graded = G.main.filter(function (m) { return m.player === X && m.evalAfter != null; });
    if (graded.length >= 4) {
      var deltas = [];
      for (var i = 0; i < G.main.length; i++) {
        var m = G.main[i];
        if (m.player !== X || m.evalAfter == null) continue;
        var prev = i >= 1 && G.main[i - 1].evalAfter != null ? G.main[i - 1].evalAfter : 0;
        deltas.push({ idx: m.idx, d: dp(m.evalAfter) - dp(prev) });
      }
      if (deltas.length >= 3) {
        deltas.sort(function (a, b) { return a.d - b.d; });
        rows.push(['Best Move', nm(deltas[0].idx)]);
        var worst = deltas[deltas.length - 1];
        if (worst.d > 1.8) rows.push(['Biggest Mistake', nm(worst.idx)]);
      }
    }
    $('endSummary').innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');
    openModal('endOverlay');
  }
  $('againBtn').onclick = function () { closeModal('endOverlay'); startGame(null); };
  $('reviewBtn').onclick = function () {
    closeModal('endOverlay');
    G.analysis = true; setView(G.main.length);
    toast('Analysis Mode — use ← → to step through the game');
  };

  /* ---------------- timer ---------------- */
  var ticker = null, lastTick = 0;
  function tickerStart() {
    clearInterval(ticker); lastTick = Date.now();
    if (!S.timer) return;
    ticker = setInterval(function () {
      var now = Date.now(), d = now - lastTick; lastTick = now;
      if (!atLive()) return;
      var p = sideAt(G.view);
      G.clock[p] -= d;
      if (G.clock[p] <= 0) {
        G.clock[p] = 0; clearInterval(ticker);
        toast(p === X ? "Time's up — AI wins" : "Time's up — you win");
        endGame(other(p), null);
        return;
      }
      refreshTimers();
    }, 250);
  }

  /* ---------------- modals ---------------- */
  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }
  function closeAll() { ['settingsOverlay', 'confirmOverlay', 'endOverlay', 'ioOverlay', 'editOverlay', 'dailyOverlay'].forEach(closeModal); }
  var confRes = null;
  function confirmDialog(text, ok) {
    $('confText').textContent = text; $('confOk').textContent = ok || 'Confirm';
    openModal('confirmOverlay');
    return new Promise(function (r) { confRes = r; });
  }
  $('confCancel').onclick = function () { closeModal('confirmOverlay'); confRes && confRes(false); };
  $('confOk').onclick = function () { closeModal('confirmOverlay'); confRes && confRes(true); };
  [].forEach.call(document.querySelectorAll('[data-close]'), function (b) {
    b.onclick = function () { if (G && G.editing) cancelEdit(); else closeAll(); };
  });
  [].forEach.call(document.querySelectorAll('.overlay'), function (ov) {
    ov.addEventListener('mousedown', function (e) { if (e.target === ov && ov.id !== 'endOverlay' && ov.id !== 'editOverlay') closeModal(ov.id); });
  });
  function toast(m) {
    var t = $('toast'); t.textContent = m; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* ---------------- settings ---------------- */
  function applySettings(rebuild) {
    document.documentElement.dataset.theme = S.theme;
    document.documentElement.style.setProperty('--board-size', S.boardSize + 'px');
    $('frame').classList.toggle('no-coords', !S.coords);
    press('diffSeg', S.difficulty); press('firstSeg', S.first); press('timerSeg', String(S.timer));
    press('themeSeg', S.theme); press('timeSeg', String(S.engineTime));
    sw('swHints', S.hints); sw('swEval', S.evalBar); sw('swBest', S.bestMove); sw('swCand', S.candidates);
    sw('swThreat', S.threatMap); sw('swQuality', S.quality); sw('swExplain', S.explain); sw('swGraph', S.graph);
    sw('swCoords', S.coords); sw('swSound', S.sound); sw('swDetails', S.details);
    $('sizeRange').value = S.boardSize;
    $('diffHint').textContent = { easy: 'Beginner-friendly AI', medium: 'Balanced challenge', hard: 'Strong tactical AI' }[S.difficulty];
    $('engineDetails').hidden = !S.details;
    $('graphCard').hidden = !S.graph;
    store('settings2', S);
    if (G) { refreshAll(); setEvalDisplay(current); showEngineInfo(current); }
  }
  function press(id, v) { [].forEach.call($(id).querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); }); }
  function sw(id, on) { $(id).setAttribute('aria-checked', String(!!on)); }
  function setDiff(d) { if (['easy', 'medium', 'hard'].indexOf(d) >= 0) { S.difficulty = d; applySettings(); } }

  $('settingsBtn').onclick = function () { SND.click(); openModal('settingsOverlay'); };
  $('themeBtn').onclick = function () { S.theme = S.theme === 'light' ? 'dark' : 'light'; applySettings(); };
  $('setTabs').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    [].forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-selected', String(x === b)); });
    [].forEach.call(document.querySelectorAll('.tabpanel'), function (p) { p.hidden = p.dataset.panel !== b.dataset.tab; });
  };
  $('diffSeg').onclick = function (e) { var b = e.target.closest('button'); if (b) { setDiff(b.dataset.v); toast('Difficulty applies from the next game'); } };
  $('firstSeg').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.first = b.dataset.v; applySettings(); } };
  $('timerSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.timer = +b.dataset.v; applySettings();
    if (G) { G.clock = { 1: S.timer * 60000, 2: S.timer * 60000 }; tickerStart(); refreshTimers(); }
  };
  $('timeSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.engineTime = +b.dataset.v; cacheClear(); applySettings(); scheduleAnalysis();
  };
  $('themeSeg').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.theme = b.dataset.v; applySettings(); } };
  function bindSw(id, key, extra) {
    $(id).onclick = function () { S[key] = !S[key]; SND.click(); applySettings(); if (extra) extra(); };
  }
  bindSw('swHints', 'hints'); bindSw('swEval', 'evalBar'); bindSw('swBest', 'bestMove', renderPosition);
  bindSw('swCand', 'candidates', function () { showEngineInfo(current); });
  bindSw('swThreat', 'threatMap', refreshThreats);
  bindSw('swQuality', 'quality', refreshMoves); bindSw('swExplain', 'explain', refreshExplain);
  bindSw('swGraph', 'graph', refreshGraph); bindSw('swCoords', 'coords'); bindSw('swSound', 'sound');
  bindSw('swDetails', 'details', function () { showEngineInfo(current); });
  $('sizeRange').oninput = function () { S.boardSize = +this.value; applySettings(); };
  $('resetStatsBtn').onclick = async function () {
    if (await confirmDialog('Clear all statistics, scores and achievements?', 'Reset')) {
      STATS = { played: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0, moveTotal: 0, firstMoves: 0, centerFirst: 0, firstDistTotal: 0 };
      ACH = {}; store('stats2', STATS); store('ach', ACH); refreshScore(); toast('Statistics reset');
    }
  };
  $('resetSettingsBtn').onclick = async function () {
    if (await confirmDialog('Reset all settings to their defaults?', 'Reset')) { S = Object.assign({}, DEFAULTS); cacheClear(); applySettings(); toast('Settings reset'); }
  };

  /* ---------------- keyboard ---------------- */
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'Escape') { if (G && G.editing) cancelEdit(); else closeAll(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stopReplay(); setView(G.view - 1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); stopReplay(); setView(G.view + 1); return; }
    if (e.key === 'Home') { e.preventDefault(); stopReplay(); setView(0); return; }
    if (e.key === 'End') { e.preventDefault(); stopReplay(); setView(line().length); return; }
    var k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); $('newBtn').click(); }
    else if (k === 'u') { e.preventDefault(); if (!$('undoBtn').disabled) $('undoBtn').click(); }
    else if (k === 'h') { e.preventDefault(); if (!$('hintBtn').disabled) $('hintBtn').click(); }
  });
  window.addEventListener('resize', function () { if (G) setEvalDisplay(current); });

  /* ---------------- boot ---------------- */
  var saved = load('settings2', null);
  if (saved) Object.keys(DEFAULTS).forEach(function (k) { if (saved[k] !== undefined) S[k] = saved[k]; });
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) S.theme = 'dark';
  if (!saved && window.innerWidth < 700) S.coords = false;

  initWorker();
  buildBoard();
  applySettings();

  var shared = new URLSearchParams(location.search).get('g');
  var sg = shared ? decodeShare(shared) : null;
  if (sg && sg.moves.length) { startGame(sg.starter, { moves: sg.moves }); toast('Shared position loaded'); }
  else startGame(null);
})();
