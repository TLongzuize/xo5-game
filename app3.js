/* ===========================================================================
   XO 5-in-a-Row — application layer v3
   ---------------------------------------------------------------------------
   Written against engine3.js. The two conventions that differ from the v2 app
   and are load-bearing everywhere in this file:

     1. EVALUATION SIGN.  engine3's analyse() returns X-POSITIVE scores:
        score > 0  => X is better,  score < 0 => O is better,  0 => equal.
        Every consumer below (eval bar, eval number, graph, move quality,
        candidate list, end-of-game summary, compare view) derives from that
        single convention. There is no side-dependent sign handling left.

     2. X ALWAYS MOVES FIRST.  Turn order is a pure function of ply index and
        the root side-to-move, and for a real game the root side-to-move is
        always X. Which side the *human* controls (G.humanSide) is a separate,
        independent piece of state. Only the Position Editor may produce a
        root where O is to move, and that root is explicitly an analysis root,
        never a "game".
   =========================================================================== */
(function () {
  'use strict';

  var E = window.XOEngine;
  var SIZE = E.SIZE, LEN = E.LEN, X = E.X, O = E.O;
  var COLS = 'ABCDEFGHIJKLMNO';
  var $ = function (id) { return document.getElementById(id); };
  function nm(i) { return COLS[i % SIZE] + (SIZE - ((i / SIZE) | 0)); }
  function other(p) { return p === X ? O : X; }
  function sName(p) { return p === X ? 'X' : 'O'; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* display scale: calibrated so an open three ~ 2.0 and a four ~ 5.5 */
  var K_SCALE = 9000, MAXP = 6;
  function dp(score) {                       // engine score -> display units, X-positive
    if (score == null) return 0;
    if (Math.abs(score) >= E.MATE_THRESHOLD) return score > 0 ? MAXP : -MAXP;
    return MAXP * Math.tanh(score / K_SCALE);
  }

  /* ---------------- persistence helpers (never throw) ---------------- */
  function store(k, v) { try { localStorage.setItem('xo5.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function load(k, d) { try { var v = localStorage.getItem('xo5.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function drop(k) { try { localStorage.removeItem('xo5.' + k); } catch (e) {} }

  /* ---------------- settings ---------------- */
  var DEFAULTS = {
    level: 5, side: 'x', timeMs: 5000, clock: 0, sound: true,
    auto: true, evalBar: true, bestMove: true, candidates: true,
    threatMap: false, heatmap: false, quality: true, explain: true, cache: true,
    theme: 'light', coords: true, graph: true, details: false, boardSize: 620
  };
  var S = Object.assign({}, DEFAULTS);

  var STATS = load('stats3', {
    played: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0, moveTotal: 0,
    firstMoves: 0, centerFirst: 0, firstDistTotal: 0,
    byLevel: {}, puzzlesSolved: 0, puzzleTries: 0, analyses: 0, deepAnalyses: 0
  });
  var ACH_DEFS = [
    { id: 'first_win', label: 'First Win' },
    { id: 'win_l5', label: 'Beat Level 5' },
    { id: 'win_l7', label: 'Beat Level 7' },
    { id: 'win_l9', label: 'Beat Level 9' },
    { id: 'streak3', label: '3-Win Streak' },
    { id: 'streak5', label: '5-Win Streak' },
    { id: 'fast_win', label: 'Win Under 20 Moves' },
    { id: 'no_hint_win', label: 'Win Without Hints' },
    { id: 'tactical', label: 'Found a Forced Win' },
    { id: 'puzzle1', label: 'First Puzzle Solved' },
    { id: 'puzzle5', label: '5 Puzzles Solved' },
    { id: 'analyst', label: '50 Positions Analysed' },
    { id: 'deep', label: 'Ran a Deep Analysis' },
    { id: 'local_game', label: 'Played a Local Game' }
  ];
  var ACH = load('ach3', {});
  var SESSION = { x: 0, o: 0, d: 0 };

  /* ---------------- error surface ---------------- */
  function showError(msg) {
    var bar = $('errBar'); if (!bar) return;
    $('errText').textContent = msg;
    bar.hidden = false;
  }
  $('errClose').onclick = function () { $('errBar').hidden = true; };
  window.addEventListener('error', function (e) {
    showError('Unexpected error: ' + (e.message || 'unknown') + ' — the app kept running; reload if things look wrong.');
  });

  /* =======================================================================
     GAME STATE  — one authoritative object
     ======================================================================= */
  var G = null;

  function makeGame(mode, opts) {
    opts = opts || {};
    /* INVARIANT: a real game always starts from an empty board with X to move.
       Only an explicit analysis root (position editor / imported position)
       may carry a non-empty root board or a non-X side to move. */
    var root = opts.root || null;
    var rootSide = root ? (opts.rootSide || X) : X;
    return {
      mode: mode,                               // 'ai' | 'local' | 'analysis'
      humanSide: opts.humanSide || X,           // only meaningful for mode 'ai'
      level: S.level,
      root: root,                               // Int8Array or null
      rootSide: rootSide,
      main: [], redo: [],
      status: 'playing', winner: null, winCells: null,
      view: 0, variation: null,
      analysisMode: mode === 'analysis',
      whatIf: null,
      editing: false, editBoard: null,
      hintIdx: null, hintsUsed: 0,
      sawForcedWin: false,
      puzzle: null,
      snapshots: [],
      clock: { 1: S.clock * 60000, 2: S.clock * 60000 },
      startTime: Date.now(), lastAiMs: null,
      rootEval: null
    };
  }

  function line() {
    if (!G) return [];
    return G.variation ? G.main.slice(0, G.variation.from).concat(G.variation.moves) : G.main;
  }
  function rootBoard() {
    var b = new Int8Array(LEN);
    if (G && G.root) b.set(G.root);
    return b;
  }
  function boardAt(n) {
    var b = rootBoard(), L = line();
    for (var i = 0; i < n && i < L.length; i++) b[L[i].idx] = L[i].player;
    return b;
  }
  function displayBoard() {
    if (G.editing) return G.editBoard;
    var b = boardAt(G.view);
    if (G.whatIf && G.view === line().length && !b[G.whatIf.idx]) b[G.whatIf.idx] = G.whatIf.player;
    return b;
  }
  /* Turn order: pure function of ply index and the root side-to-move. */
  function sideAt(n) { return (n % 2 === 0) ? G.rootSide : other(G.rootSide); }
  function sideToMove() {
    var n = line().length;
    if (G.whatIf) n += 1;
    return sideAt(n);
  }
  /* Who controls a given side right now. */
  function controllerOf(p) {
    if (!G) return 'human';
    if (G.mode === 'ai') return p === G.humanSide ? 'human' : 'ai';
    return 'human';                             // local + analysis: human drives both
  }
  function atLive() {
    return G && G.status === 'playing' && !G.analysisMode && !G.variation && !G.editing &&
      !G.whatIf && G.view === G.main.length;
  }
  function humanToMove() {
    if (!atLive()) return false;
    if (G.puzzle && G.puzzle.active) return false;
    return controllerOf(sideAt(G.view)) === 'human';
  }
  function aiToMove() {
    return atLive() && !G.puzzle && controllerOf(sideAt(G.view)) === 'ai';
  }

  /* =======================================================================
     WORKER — search IDs, generation-based cancellation, main-thread fallback
     ======================================================================= */
  var WK = {
    worker: null, pending: Object.create(null), seq: 0, gen: 0,
    mode: 'none', inflight: 0
  };

  function initWorker() {
    if (typeof Worker === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
      WK.mode = 'main'; setEngineBadge(); return;
    }
    try {
      var src = $('engineSrc').textContent + '\n' + $('workerSrc').textContent;
      var blob = new Blob([src], { type: 'application/javascript' });
      WK.worker = new Worker(URL.createObjectURL(blob));
      WK.worker.onmessage = onWorkerMessage;
      WK.worker.onerror = function () {
        // worker died: fall back to the main thread rather than losing the app
        try { WK.worker.terminate(); } catch (e) {}
        WK.worker = null; WK.mode = 'main'; setEngineBadge();
        showError('Engine worker failed — analysis now runs on the main thread (shorter budgets).');
        failAllPending('worker-error');
      };
      WK.mode = 'worker';
    } catch (err) {
      WK.worker = null; WK.mode = 'main';
    }
    setEngineBadge();
  }
  function setEngineBadge() {
    var b = $('engineBadge'); if (b) b.textContent = WK.mode === 'worker' ? 'worker' : 'main thread';
  }
  function onWorkerMessage(e) {
    var d = e.data || {}, p = WK.pending[d.id];
    if (!p) return;                                  // stale: request already superseded
    if (p.gen !== WK.gen) { delete WK.pending[d.id]; return; }
    if (d.kind === 'progress') { if (p.onProgress) { try { p.onProgress(d.p); } catch (er) {} } return; }
    delete WK.pending[d.id]; WK.inflight--;
    if (d.kind === 'error') { p.reject(new Error(d.message || 'engine error')); return; }
    p.resolve(d.res);
  }
  function failAllPending(reason) {
    var keys = Object.keys(WK.pending);
    for (var i = 0; i < keys.length; i++) {
      var p = WK.pending[keys[i]]; delete WK.pending[keys[i]];
      try { p.reject({ cancelled: true, reason: reason }); } catch (e) {}
    }
    WK.inflight = 0;
  }
  /* Simple cancellation: terminate+respawn the worker. Any in-flight promise
     is rejected with {cancelled:true} and the generation counter prevents late
     messages from the dead worker from resolving anything. */
  function cancelAllSearches(reason) {
    WK.gen++;
    aiPending = false;
    failAllPending(reason || 'cancelled');
    if (WK.worker) {
      try { WK.worker.terminate(); } catch (e) {}
      WK.worker = null;
      initWorker();
    }
  }

  function ask(payload, onProgress) {
    var id = ++WK.seq, gen = WK.gen;
    return new Promise(function (resolve, reject) {
      WK.pending[id] = { resolve: resolve, reject: reject, onProgress: onProgress, gen: gen };
      WK.inflight++;
      if (WK.worker) {
        payload.id = id;
        try { WK.worker.postMessage(payload); }
        catch (err) { delete WK.pending[id]; WK.inflight--; reject(err); }
        return;
      }
      /* main-thread fallback: deferred so the UI paints first, and with a
         hard budget cap so the page never locks up for seconds at a time. */
      setTimeout(function () {
        var p = WK.pending[id];
        if (!p || p.gen !== WK.gen) { delete WK.pending[id]; return; }
        delete WK.pending[id]; WK.inflight--;
        try {
          var s = new E.State(), i;
          if (payload.root) for (i = 0; i < LEN; i++) if (payload.root[i]) s.play(i, payload.root[i]);
          (payload.moves || []).forEach(function (m) { s.play(m[0], m[1]); });
          var cap = Math.min(payload.timeMs || 900, 1200), r;
          if (payload.type === 'move') r = E.chooseMove(s, payload.side, payload.level, cap, onProgress);
          else if (payload.type === 'analyse') r = E.analyse(s, payload.side, { timeMs: cap, vct: payload.vct !== false, onProgress: onProgress });
          else if (payload.type === 'threats') r = E.threatMap(s, payload.minLevel || 2);
          else if (payload.type === 'explain') r = E.explainMove(s, payload.idx, payload.side);
          else if (payload.type === 'forcing') r = E.solveForcing(s, payload.side, { maxPly: payload.maxPly || 8, nodes: 40000, timeMs: 1200, vct: true });
          else throw new Error('unknown type');
          resolve(r);
        } catch (err) { reject(err); }
      }, 12);
    });
  }
  function isCancel(err) { return err && err.cancelled === true; }

  /* ---------------- request payload helpers ---------------- */
  function movesUpTo(n) {
    var L = line(), out = [];
    for (var i = 0; i < n && i < L.length; i++) out.push([L[i].idx, L[i].player]);
    return out;
  }
  function rootPayload() { return G && G.root ? Array.prototype.slice.call(G.root) : null; }

  /* time budget: the selected time control IS the search budget. */
  function analysisBudget() {
    /* smart budget: quiet openings do not need the full allowance */
    var stones = countStones();
    if (stones <= 2 && S.timeMs > 2000) return Math.max(600, Math.round(S.timeMs * 0.25));
    return S.timeMs;
  }
  function aiBudget() {
    return S.timeMs;
  }
  function countStones() {
    var n = line().length;
    if (G && G.root) for (var i = 0; i < LEN; i++) if (G.root[i]) n++;
    return n;
  }

  /* ---------------- analysis cache ---------------- */
  var cache = new Map();
  function posKey(n) {
    var r = '';
    if (G.root) for (var i = 0; i < LEN; i++) if (G.root[i]) r += i + ':' + G.root[i] + ';';
    return r + '|' + movesUpTo(n).map(function (m) { return m[0] + '.' + m[1]; }).join(',') +
      '|' + sideAt(n) + '|' + analysisBudget();
  }
  function cacheClear() { cache.clear(); }

  /* ---------------- sound ---------------- */
  var AC = null;
  function beep(f, d, t, g) {
    if (!S.sound) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      AC = AC || new Ctx();
      var o1 = AC.createOscillator(), gn = AC.createGain();
      o1.type = t || 'sine'; o1.frequency.value = f;
      gn.gain.setValueAtTime(g || .05, AC.currentTime);
      gn.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + d);
      o1.connect(gn); gn.connect(AC.destination); o1.start(); o1.stop(AC.currentTime + d);
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

  /* =======================================================================
     BOARD RENDERING
     ======================================================================= */
  var boardEl = $('board'), cellEls = new Array(LEN), focusIdx = 112;
  var SVG_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><line class="mark-x" x1="5" y1="5" x2="19" y2="19"/><line class="mark-x" x1="19" y1="5" x2="5" y2="19"/></svg>';
  var SVG_O = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="mark-o" cx="12" cy="12" r="7.4"/></svg>';

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

  var shownBoard = new Int8Array(LEN);
  function invalidateBoard() { shownBoard.fill(-1); }

  function renderPosition(animateIdx) {
    if (!G) return;
    var b = displayBoard();
    for (var i = 0; i < LEN; i++) {
      var el = cellEls[i]; if (!el) continue;
      if (shownBoard[i] !== b[i]) {
        el.innerHTML = b[i] === X ? SVG_X : (b[i] === O ? SVG_O : '');
        el.dataset.occ = b[i] ? '1' : '0';
        el.setAttribute('aria-label', 'Cell ' + nm(i) + ', ' + (b[i] ? 'occupied by ' + sName(b[i]) : 'empty'));
        shownBoard[i] = b[i];
      }
      el.className = 'cell';
      el.style.removeProperty('--tc'); el.style.removeProperty('--ti'); el.style.removeProperty('--hi');
    }
    if (animateIdx != null && cellEls[animateIdx]) {
      cellEls[animateIdx].classList.add('pop');
      setTimeout(function () { cellEls[animateIdx] && cellEls[animateIdx].classList.remove('pop'); }, 220);
    }
    var L = line();
    var lastMove = G.view > 0 && L[G.view - 1] ? L[G.view - 1].idx : null;
    if (lastMove != null && cellEls[lastMove]) cellEls[lastMove].classList.add('last');
    if (G.whatIf && cellEls[G.whatIf.idx]) cellEls[G.whatIf.idx].classList.add('scratch');
    if (G.hintIdx != null && cellEls[G.hintIdx] && !b[G.hintIdx]) cellEls[G.hintIdx].classList.add('hint');
    var wc = (G.status !== 'playing' && G.view === line().length) ? G.winCells : null;
    if (wc) wc.forEach(function (i) { cellEls[i] && cellEls[i].classList.add('win'); });

    applyHeat(b);
    applyThreatClasses(b);
    updateInteractivity(b);
    drawArrows(lastMove);
  }

  function updateInteractivity(b) {
    var interactive = G.editing || (G.puzzle && G.puzzle.active) || humanToMove() ||
      (G.analysisMode && G.status === 'playing') || G.mode === 'analysis';
    var ghost = G.editing ? editTool : sName(sideToMove()).toLowerCase();
    boardEl.dataset.ghost = (ghost === 'x' || ghost === 'o') ? ghost : 'x';
    for (var i = 0; i < LEN; i++) {
      var el = cellEls[i]; if (!el) continue;
      var can = interactive && (G.editing ? true : !b[i]);
      if (can) el.removeAttribute('disabled'); else el.setAttribute('disabled', '');
    }
  }

  var threats = [], threatToken = 0;
  function applyThreatClasses(b) {
    if (!S.threatMap) return;
    threats.forEach(function (t) {
      var el = cellEls[t.idx]; if (!el || b[t.idx]) return;
      el.classList.add('thr');
      el.style.setProperty('--tc', t.player === X ? 'var(--x)' : 'var(--o)');
      el.style.setProperty('--ti', String(0.25 + t.level * 0.15));
    });
  }
  function refreshThreats() {
    if (!S.threatMap) { threats = []; return; }
    var tok = ++threatToken;
    ask({ type: 'threats', moves: movesUpTo(G.view), root: rootPayload(), minLevel: 2 })
      .then(function (r) { if (tok === threatToken) { threats = r || []; renderPosition(); } })
      .catch(function () {});
  }

  function applyHeat(b) {
    if (!S.heatmap || !current || !current.candidates || !current.candidates.length) return;
    var cs = current.candidates.filter(function (c) { return !b[c.idx]; });
    if (!cs.length) return;
    /* candidates are "best for side to move first"; rank, not raw sign, drives shading */
    for (var i = 0; i < cs.length; i++) {
      var el = cellEls[cs[i].idx]; if (!el) continue;
      el.classList.add('heat');
      el.style.setProperty('--hi', String((0.34 * (cs.length - i) / cs.length).toFixed(3)));
    }
  }

  function drawArrows(lastMove) {
    var svg = $('arrows'); if (!svg) return;
    var parts = '';
    var best = (S.bestMove && current && current.best != null && !displayBoard()[current.best]) ? current.best : null;
    if (best != null) {
      var bx = (best % SIZE) + .5, by = ((best / SIZE) | 0) + .5;
      parts += '<circle cx="' + bx + '" cy="' + by + '" r="0.42" fill="none" stroke="#12B76A" stroke-width="0.12" stroke-dasharray="0.22 0.16"/>';
      if (lastMove != null) {
        var lx = (lastMove % SIZE) + .5, ly = ((lastMove / SIZE) | 0) + .5;
        var dx = bx - lx, dy = by - ly, len = Math.sqrt(dx * dx + dy * dy) || 1;
        var sx = lx + dx / len * .45, sy = ly + dy / len * .45;
        var ex = bx - dx / len * .5, ey = by - dy / len * .5;
        if (len > 1.05) parts += '<line x1="' + sx.toFixed(2) + '" y1="' + sy.toFixed(2) + '" x2="' + ex.toFixed(2) + '" y2="' + ey.toFixed(2) +
          '" stroke="#12B76A" stroke-width="0.09" opacity="0.75"/>';
      }
    }
    svg.innerHTML = parts;
  }

  /* =======================================================================
     EVALUATION DISPLAY — X positive, O negative
     ======================================================================= */
  var current = null;             // last applied analysis result for the viewed position
  var evalShown = 0, evalRaf = null;

  function evalWord(p, res) {
    if (res && res.mateIn != null && res.mateFor) {
      return sName(res.mateFor) + ' has a forced win in ' + res.mateIn + (res.mateIn === 1 ? ' move' : ' moves');
    }
    var a = Math.abs(p);
    if (a < 0.35) return 'Equal position';
    var who = p > 0 ? 'X' : 'O';
    if (a >= 5) return who + ' is winning';
    if (a >= 2.5) return who + ' has a decisive advantage';
    if (a >= 1.2) return who + ' is clearly better';
    return who + ' is slightly better';
  }

  function setEvalDisplay(res) {
    var p = res ? dp(res.score) : 0;
    var forced = res && res.mateIn != null;
    /* bar: O fills from the top. X positive => smaller O share. */
    var oShare = clamp((MAXP - p) / (2 * MAXP), 0, 1);
    var narrow = window.innerWidth <= 760;
    var fill = $('fillO');
    if (narrow) { fill.style.width = (oShare * 100).toFixed(1) + '%'; fill.style.height = '100%'; }
    else { fill.style.height = (oShare * 100).toFixed(1) + '%'; fill.style.width = ''; }
    $('evalBar').parentNode.classList.toggle('no-coords', !S.coords);
    $('evalBar').style.display = S.evalBar ? '' : 'none';
    var label = forced ? ('M' + res.mateIn + ' ' + sName(res.mateFor)) : (p > 0 ? '+' : '') + p.toFixed(1);
    $('barTick').textContent = S.evalBar ? label : '';
    $('evalBar').setAttribute('aria-label', 'Evaluation ' + label + ' (positive favours X)');
    tweenNumber(p, forced ? label : null);
    $('evalDesc').textContent = evalWord(p, res);
    var mb = $('mateBadge');
    if (forced) { mb.hidden = false; mb.textContent = 'M' + res.mateIn + ' for ' + sName(res.mateFor); }
    else mb.hidden = true;
  }
  function tweenNumber(target, fixedLabel) {
    var el = $('evalNum');
    /* Always cancel a tween that is still in flight FIRST: otherwise its next
       frame overwrites whatever we are about to write (this used to clobber
       "M2 X" mate labels back to a stale number). */
    if (evalRaf != null && window.cancelAnimationFrame) { cancelAnimationFrame(evalRaf); evalRaf = null; }
    if (fixedLabel) { el.textContent = fixedLabel; evalShown = target; return; }
    var from = evalShown, t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    function step(now) {
      var k = Math.min(1, ((now || Date.now()) - t0) / 320);
      var v = from + (target - from) * (1 - Math.pow(1 - k, 3));
      evalShown = v;
      el.textContent = (v > 0 ? '+' : '') + v.toFixed(1);
      if (k < 1 && window.requestAnimationFrame) evalRaf = requestAnimationFrame(step); else evalRaf = null;
    }
    if (window.requestAnimationFrame) evalRaf = requestAnimationFrame(step);
    else { evalShown = target; el.textContent = (target > 0 ? '+' : '') + target.toFixed(1); }
  }

  /* ---------------- engine panel ---------------- */
  var searchHistory = [], pvExpanded = false;
  function setEngineStatus(txt) { $('engineStatus').textContent = txt; }

  function showEngineInfo(res, partial) {
    $('depthBadge').textContent = res && res.depth ? 'd' + res.depth : 'd0';
    var kv = $('engineKv'), rows = [];
    if (res) {
      if (res.best != null) rows.push(['Best move', nm(res.best)]);
      rows.push(['Depth', String(res.depth || 0) + (partial ? ' (searching…)' : '')]);
      if (res.mateIn != null) rows.push(['Forced win', 'M' + res.mateIn + ' for ' + sName(res.mateFor)]);
      if (S.details) {
        rows.push(['Nodes', (res.nodes || 0).toLocaleString()]);
        rows.push(['Time', ((res.timeMs || 0) / 1000).toFixed(2) + 's']);
        if (res.timeMs) rows.push(['Rate', Math.round((res.nodes || 0) / Math.max(1, res.timeMs) * 1000).toLocaleString() + ' n/s']);
        if (res.ttProbes) rows.push(['TT hit rate', (100 * res.ttHits / res.ttProbes).toFixed(1) + '%']);
        if (res.kind) rows.push(['Result type', res.kind]);
      }
    }
    kv.innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');

    /* principal variation */
    var pvBox = $('pvBox');
    if (res && res.pv && res.pv.length) {
      pvBox.hidden = false;
      var side = sideAt(G.view), shown = pvExpanded ? res.pv : res.pv.slice(0, 6);
      $('pvList').innerHTML = shown.map(function (m, i) {
        var p = i % 2 === 0 ? side : other(side);
        return '<button class="pvm ' + sName(p).toLowerCase() + '" data-pv="' + m + '">' + sName(p) + ' ' + nm(m) + '</button>';
      }).join('') + (res.pv.length > 6 ? '<button class="pvm" id="pvMoreBtn">' + (pvExpanded ? '−' : '+' + (res.pv.length - 6)) + '</button>' : '');
      var more = $('pvMoreBtn');
      if (more) more.onclick = function () { pvExpanded = !pvExpanded; showEngineInfo(current, partial); };
    } else pvBox.hidden = true;

    /* candidate moves (X-positive scores, ranked best-first for side to move) */
    var cb = $('candBox');
    if (S.candidates && res && res.candidates && res.candidates.length) {
      cb.hidden = false;
      var mx = 0;
      res.candidates.forEach(function (c) { mx = Math.max(mx, Math.abs(dp(c.score))); });
      $('candList').innerHTML = res.candidates.slice(0, 5).map(function (c, i) {
        var v = dp(c.score);
        var w = mx ? Math.round(Math.abs(v) / mx * 100) : 0;
        return '<button class="cand" data-cand="' + c.idx + '"><span>' + (i + 1) + '. <b>' + nm(c.idx) + '</b></span>' +
          '<span class="bar"><i style="width:' + w + '%"></i></span>' +
          '<b>' + (v > 0 ? '+' : '') + v.toFixed(1) + '</b></button>';
      }).join('');
    } else cb.hidden = true;

    /* tactical alerts, derived only from proven engine output */
    var al = $('tacticalAlert'), html = '';
    if (res && res.mateIn != null && res.mateFor) {
      var mine = G.mode === 'ai' ? G.humanSide : null;
      var cls = (mine == null) ? 'good' : (res.mateFor === mine ? 'good' : 'danger');
      html = '<div class="alert ' + cls + '">Forced win for ' + sName(res.mateFor) + ' in ' + res.mateIn +
        (res.mateIn === 1 ? ' move' : ' moves') + (res.pv && res.pv.length ? ' — starting ' + nm(res.pv[0]) : '') + '</div>';
    } else if (res && res.kind === 'block') {
      html = '<div class="alert danger">' + sName(other(sideAt(G.view))) + ' threatens an immediate win — this move is forced.</div>';
    }
    al.innerHTML = html;
    refreshTree();
  }

  /* ---------------- analysis driver ---------------- */
  var analysisToken = 0, analysisTimer = null, searching = false, lastProgress = null;

  function setSearching(on, note) {
    searching = on;
    $('stopBtn').hidden = !on;
    $('searchProg').hidden = !on;
    if (!on) $('searchProgFill').style.width = '0%';
    $('thinkDepth').innerHTML = on ? (note || '<span class="dots"><i></i><i></i><i></i></span>') : '';
  }

  function scheduleAnalysis(force) {
    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = setTimeout(function () { runAnalysis(force); }, 80);
  }

  function runAnalysis(force, overrideMs) {
    if (!G || G.editing) return;
    if (!S.auto && !force) { setEngineStatus('Auto analysis off'); return; }
    var key = posKey(G.view), tok = ++analysisToken;
    var b = boardAt(G.view);
    if (G.status !== 'playing' && G.view === line().length) {
      // terminal position: no search, report the result honestly
      setSearching(false);
      current = null; setEvalDisplay(null);
      setEngineStatus(G.winner ? sName(G.winner) + ' has five in a row — game over.' : 'Draw — board full.');
      showEngineInfo(null); renderPosition();
      return;
    }
    if (S.cache && !overrideMs && cache.has(key)) {
      applyAnalysis(cache.get(key), tok, key, false);
      setEngineStatus('Cached — depth ' + (cache.get(key).depth || 0));
      return;
    }
    var budget = overrideMs || analysisBudget();
    var t0 = Date.now();
    lastProgress = null;
    setSearching(true);
    setEngineStatus('Searching…');
    STATS.analyses++;

    ask({
      type: 'analyse', moves: movesUpTo(G.view), root: rootPayload(),
      side: sideAt(G.view), timeMs: budget, vct: true
    }, function (p) {
      if (tok !== analysisToken) return;                    // stale progress: drop
      lastProgress = p;
      applyIteration(p, budget, t0);
    }).then(function (res) {
      if (tok !== analysisToken) return;                    // stale result: must never apply
      if (S.cache) cache.set(key, res);
      setSearching(false);
      applyAnalysis(res, tok, key, true);
      setEngineStatus('Depth ' + res.depth + ' · ' + (res.nodes || 0).toLocaleString() + ' nodes · ' +
        ((res.timeMs || 0) / 1000).toFixed(2) + 's' + (res.stoppedByTime ? ' (time limit)' : ''));
      searchHistory.unshift({ at: Date.now(), depth: res.depth, score: res.score, nodes: res.nodes, ply: G.view });
      if (searchHistory.length > 8) searchHistory.pop();
      refreshScore();
    }).catch(function (err) {
      if (tok !== analysisToken) return;
      setSearching(false);
      if (isCancel(err)) {
        if (lastProgress) {
          var partial = progressToResult(lastProgress);
          applyAnalysis(partial, tok, null, true);
          setEngineStatus('Stopped — keeping completed depth ' + lastProgress.depth + '.');
        } else setEngineStatus('Search stopped before the first depth completed.');
      } else {
        setEngineStatus('Analysis failed.');
        showError('Analysis failed: ' + ((err && err.message) || err));
      }
    });
  }

  /* A completed iterative-deepening iteration arrives here. Iterations are only
     emitted by engine3 after a depth finishes, so nothing half-computed is ever
     shown as if it were final. */
  var iterationLog = [];
  function applyIteration(p, budget, t0) {
    var res = progressToResult(p);
    iterationLog.push({ depth: p.depth, score: p.score, best: p.best, pvLen: (p.pv || []).length, nodes: p.nodes });
    if (iterationLog.length > 60) iterationLog.shift();
    current = res;
    if (S.evalBar) setEvalDisplay(res);
    showEngineInfo(res, true);
    renderPosition();
    var frac = budget ? clamp((Date.now() - t0) / budget, 0, 1) : ((p.depth % 10) / 10);
    $('searchProgFill').style.width = (frac * 100).toFixed(0) + '%';
    $('thinkDepth').textContent = 'depth ' + p.depth;
    setEngineStatus('Depth ' + p.depth + ' complete · ' + (p.nodes || 0).toLocaleString() + ' nodes — searching deeper…');
  }
  function progressToResult(p) {
    var forced = Math.abs(p.score) >= E.MATE_THRESHOLD;
    return {
      score: p.score, best: p.best, depth: p.depth, nodes: p.nodes, timeMs: p.timeMs,
      pv: p.pv || [], candidates: p.candidates || [],
      mateIn: forced ? Math.max(1, Math.ceil((E.MATE - Math.abs(p.score)) / 2)) : null,
      mateFor: forced ? (p.score > 0 ? X : O) : null,
      kind: 'search', partial: true
    };
  }

  function applyAnalysis(res, tok, key, fresh) {
    if (tok !== analysisToken) return;
    current = res;
    setEvalDisplay(res);
    showEngineInfo(res, false);
    if (res && res.mateIn != null && G.mode === 'ai' && res.mateFor === G.humanSide) G.sawForcedWin = true;
    // record the engine's verdict for the position reached after the last move
    var L = line();
    if (fresh && G.view > 0 && L[G.view - 1] && !G.variation && !G.whatIf) {
      L[G.view - 1].evalAfter = res.score;
      gradeMove(G.view - 1);
      refreshMoves(); refreshGraph();
    }
    if (fresh && G.view === 0 && !G.variation) G.rootEval = res.score;
    // remember the best move at this position so the NEXT move can be graded "Best"
    if (fresh && res && res.best != null) bestAtPly[plyKey(G.view)] = res.best;
    renderPosition();
    refreshExplain();
  }

  var bestAtPly = Object.create(null);
  function plyKey(n) { return posKey(n); }

  /* ---------------- move quality (uniformly X-positive) ---------------- */
  function gradeMove(i) {
    var L = line(), m = L[i];
    if (!m || m.evalAfter == null) return;
    var before = i > 0 ? (L[i - 1] && L[i - 1].evalAfter) : G.rootEval;
    if (before == null) { m.quality = null; return; }
    /* Higher score = better for X, always. The loss suffered by the player who
       just moved is therefore simply the drop (X) or rise (O) in the score. */
    var a = dp(before), b = dp(m.evalAfter);
    var loss = m.player === X ? (a - b) : (b - a);
    if (bestAtPly[plyKey(i)] === m.idx) { m.quality = 'Best'; return; }
    if (loss <= 0.18) m.quality = 'Excellent';
    else if (loss <= 0.55) m.quality = 'Good';
    else if (loss <= 1.3) m.quality = 'Inaccuracy';
    else if (loss <= 2.6) m.quality = 'Mistake';
    else m.quality = 'Blunder';
    m.loss = loss;
  }

  var explainToken = 0;
  function refreshExplain() {
    var box = $('explainBox');
    if (!S.explain || !G || G.view === 0) { box.hidden = true; return; }
    box.hidden = false;
    var L = line(), mv = L[G.view - 1];
    if (!mv) { box.hidden = true; return; }
    var tok = ++explainToken;
    $('explainText').textContent = '…';
    ask({ type: 'explain', moves: movesUpTo(G.view - 1), root: rootPayload(), idx: mv.idx, side: mv.player })
      .then(function (t) {
        if (tok !== explainToken) return;
        $('explainText').textContent = sName(mv.player) + ' ' + nm(mv.idx) + ' — ' + t +
          (mv.quality ? ' (' + mv.quality + ')' : '');
      }).catch(function () {});
  }

  /* =======================================================================
     STATUS / NAV / HISTORY / GRAPH
     ======================================================================= */
  function sideLabel(p) {
    if (G.mode === 'local') return 'Player ' + sName(p);
    if (G.mode === 'analysis') return sName(p);
    return controllerOf(p) === 'human' ? 'You' : ('AI — L' + G.level + ' ' + E.LEVELS9[G.level].label);
  }
  function refreshStatus() {
    $('labelX').textContent = sideLabel(X);
    $('labelO').textContent = sideLabel(O);
    var stm = sideToMove();
    $('plX').classList.toggle('turn', G.status === 'playing' && stm === X);
    $('plO').classList.toggle('turn', G.status === 'playing' && stm === O);
    $('metaMoves').textContent = String(line().length);
    $('histCount').textContent = String(line().length);
    var st = $('statusText'); st.className = '';
    if (G.puzzle && G.puzzle.active) st.textContent = 'Puzzle: find the winning move for X';
    else if (G.status === 'won') {
      var w = G.winner;
      st.textContent = sName(w) + ' wins';
      if (G.mode === 'ai') { st.classList.add(w === G.humanSide ? 'win' : 'lose'); st.textContent = (w === G.humanSide ? 'You win' : 'AI wins') + ' (' + sName(w) + ')'; }
    } else if (G.status === 'draw') st.textContent = 'Draw';
    else if (G.analysisMode) st.textContent = 'Analysis — ' + sName(stm) + ' to move';
    else if (controllerOf(stm) === 'ai') st.textContent = 'AI thinking (' + sName(stm) + ')';
    else if (G.mode === 'local') st.textContent = 'Player ' + sName(stm) + ' to move';
    else st.textContent = 'Your turn (' + sName(stm) + ')';
    $('modeBadge').hidden = !G.analysisMode;
    $('undoBtn').disabled = !G.main.length || !!G.variation;
    $('redoBtn').disabled = !G.redo.length || !!G.variation;
    $('hintBtn').disabled = !(G.status === 'playing' && !G.variation && G.view === G.main.length);
    $('analysisBtn').setAttribute('aria-pressed', String(!!G.analysisMode));
    $('whatIfBtn').setAttribute('aria-pressed', String(!!G.whatIf));
    $('mainLineBtn').hidden = !G.variation;
    $('timers').hidden = !(S.clock > 0 && G.mode !== 'analysis');
  }
  function refreshNav() {
    var L = line().length;
    $('navFirst').disabled = G.view === 0;
    $('navPrev').disabled = G.view === 0;
    $('navNext').disabled = G.view >= L;
    $('navLast').disabled = G.view >= L;
    $('navPos').textContent = 'Move ' + G.view + ' / ' + L + (G.variation ? ' (var)' : '');
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
        html += '<button class="mv ' + sName(m.player).toLowerCase() + (k === G.view - 1 ? ' current' : '') +
          '" data-mi="' + (k + 1) + '">' + sName(m.player) + ' ' + nm(m.idx) + q + '</button>';
      }
      html += '</div>'; n++;
    }
    listEl.innerHTML = html;
    /* MOBILE FIX: the DOM scroll-into-view helper scrolls every scrollable
       ancestor including the document, which is what made the page jump to the
       bottom on every move. Scroll only this container, by arithmetic, and
       never the page. */
    var cur = listEl.querySelector('.mv.current');
    if (cur) {
      var top = cur.offsetTop, h = cur.offsetHeight;
      if (top < listEl.scrollTop) listEl.scrollTop = top;
      else if (top + h > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = top + h - listEl.clientHeight;
    }
  }

  var graphPts = [];
  function refreshGraph() {
    $('graphCard').hidden = !S.graph;
    if (!S.graph || !G) return;
    var g = $('graph'), W = 320, H = 96, pad = 6;
    graphPts = [];
    if (G.rootEval != null) graphPts.push({ i: 0, v: dp(G.rootEval), m: null });
    G.main.forEach(function (m, i) { if (m.evalAfter != null) graphPts.push({ i: i + 1, v: dp(m.evalAfter), m: m }); });
    if (graphPts.length < 2) { g.innerHTML = '<line class="graph-zero" x1="0" y1="48" x2="320" y2="48"/>'; return; }
    var maxI = Math.max(1, G.main.length);
    var xs = function (i) { return pad + i / Math.max(1, maxI) * (W - 2 * pad); };
    var ys = function (v) { return H / 2 - (v / MAXP) * (H / 2 - pad); };      // +X is up
    var d = graphPts.map(function (p, k) { return (k ? 'L' : 'M') + xs(p.i).toFixed(1) + ' ' + ys(p.v).toFixed(1); }).join(' ');
    var area = d + ' L' + xs(graphPts[graphPts.length - 1].i).toFixed(1) + ' ' + (H / 2) + ' L' + xs(graphPts[0].i).toFixed(1) + ' ' + (H / 2) + ' Z';
    var cursor = '';
    if (G.view > 0) cursor = '<line class="graph-cursor" x1="' + xs(G.view).toFixed(1) + '" y1="0" x2="' + xs(G.view).toFixed(1) + '" y2="' + H + '"/>';
    g.innerHTML = '<path class="graph-area" d="' + area + '"/><line class="graph-zero" x1="0" y1="' + (H / 2) + '" x2="' + W + '" y2="' + (H / 2) + '"/>' +
      '<path class="graph-line" d="' + d + '"/>' + cursor;
    g._xs = xs;
  }
  function refreshScore() {
    $('scoreX').textContent = String(SESSION.x);
    $('scoreO').textContent = String(SESSION.o);
    $('scoreD').textContent = String(SESSION.d);
    refreshStatsPage();
  }
  function refreshStatsPage() {
    var rows = [
      ['Games played', STATS.played], ['Wins', STATS.wins], ['Losses', STATS.losses], ['Draws', STATS.draws],
      ['Win rate', STATS.played ? Math.round(STATS.wins / STATS.played * 100) + '%' : '—'],
      ['Current streak', STATS.streak], ['Best streak', STATS.best],
      ['Average game length', STATS.played ? Math.round(STATS.moveTotal / STATS.played) + ' moves' : '—'],
      ['Center opening rate', STATS.firstMoves ? Math.round(STATS.centerFirst / STATS.firstMoves * 100) + '%' : '—'],
      ['Positions analysed', STATS.analyses], ['Deep analyses', STATS.deepAnalyses],
      ['Puzzles solved', STATS.puzzlesSolved + ' / ' + PUZZLES.length]
    ];
    var lv = Object.keys(STATS.byLevel).sort();
    lv.forEach(function (k) {
      var r = STATS.byLevel[k];
      rows.push(['Level ' + k + ' record', r.w + 'W / ' + r.l + 'L / ' + r.d + 'D']);
    });
    var sg = $('statGrid');
    if (sg) sg.innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');
    var al = $('achList');
    if (al) al.innerHTML = ACH_DEFS.map(function (a) {
      return '<span class="' + (ACH[a.id] ? 'got' : '') + '">' + (ACH[a.id] ? '✓ ' : '') + a.label + '</span>';
    }).join('');
  }
  function refreshTimers() {
    if (!(S.clock > 0) || G.mode === 'analysis') return;
    var stm = sideToMove();
    fmt($('timerX'), 'X', G.clock[X], G.status === 'playing' && stm === X);
    fmt($('timerO'), 'O', G.clock[O], G.status === 'playing' && stm === O);
    function fmt(el, lab, ms, act) {
      var s = Math.max(0, Math.round(ms / 1000));
      el.textContent = lab + ' ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      el.classList.toggle('active', !!act); el.classList.toggle('low', s <= 30);
    }
  }
  function refreshTree() {
    var card = $('treeCard');
    var items = [];
    if (G.variation) items.push({ t: 'Variation', d: 'from move ' + G.variation.from + ', ' + G.variation.moves.length + ' move(s)' });
    G.snapshots.forEach(function (s, i) { items.push({ t: 'Snapshot ' + (i + 1), d: s.label, snap: i }); });
    searchHistory.slice(0, 4).forEach(function (h) {
      items.push({ t: 'Search @ply ' + h.ply, d: 'depth ' + h.depth + ', ' + (dp(h.score) > 0 ? '+' : '') + dp(h.score).toFixed(1) });
    });
    if (!items.length) { card.hidden = true; return; }
    card.hidden = false;
    $('treeList').innerHTML = items.map(function (it) {
      return '<div class="tl"><b>' + it.t + '</b><span style="color:var(--text-2)">' + it.d + '</span>' +
        (it.snap != null ? '<button class="btn sm" data-snap="' + it.snap + '" style="margin-left:auto">Load</button>' : '') + '</div>';
    }).join('');
  }

  /* preserve page scroll across wholesale re-renders (mobile jump guard) */
  function preserveScroll(fn) {
    var y = window.scrollY || window.pageYOffset || 0;
    fn();
    if ((window.scrollY || window.pageYOffset || 0) !== y && window.scrollTo) {
      try { window.scrollTo(0, y); } catch (e) {}
    }
  }
  function refreshAll() {
    preserveScroll(function () {
      refreshStatus(); refreshNav(); refreshMoves(); refreshGraph(); refreshScore();
      refreshTimers(); renderPosition();
    });
  }

  /* =======================================================================
     GAME FLOW
     ======================================================================= */
  function startGame(mode, opts) {
    cancelAllSearches('new-game');
    analysisToken++; explainToken++; threatToken++;
    setSearching(false);
    G = makeGame(mode, opts);
    if (opts && opts.moves) {
      opts.moves.forEach(function (idx, k) {
        G.main.push({ idx: idx, player: sideAt(k), evalAfter: null, quality: null });
      });
      G.view = G.main.length;
      recomputeTerminal();
    }
    bestAtPly = Object.create(null);
    cacheClear(); searchHistory = []; current = null; evalShown = 0;
    threats = []; invalidateBoard();
    G.startTime = Date.now();
    setEvalDisplay(null);
    showEngineInfo(null);
    refreshAll();
    setEngineStatus('Ready');
    maybeAiMove();
    scheduleAnalysis();
    refreshThreats();
  }
  function recomputeTerminal() {
    var b = boardAt(G.main.length);
    var lastN = G.main.length;
    if (!lastN) return;
    var lm = G.main[lastN - 1];
    var w = E.winningLineAt(b, lm.idx, lm.player);
    if (w) { G.status = 'won'; G.winner = lm.player; G.winCells = w; return; }
    var full = true; for (var i = 0; i < LEN; i++) if (!b[i]) { full = false; break; }
    if (full) { G.status = 'draw'; }
  }

  function place(idx, player) {
    var b = boardAt(G.view);
    if (b[idx]) return false;
    if (G.variation || G.analysisMode) {
      // variation move: never touches the main line
      var L = line();
      if (!G.variation) G.variation = { from: G.view, moves: [] };
      else if (G.view < L.length) G.variation.moves = G.variation.moves.slice(0, G.view - G.variation.from);
      G.variation.moves.push({ idx: idx, player: player, evalAfter: null, quality: null });
      setView(G.view + 1);
      return true;
    }
    G.main.push({ idx: idx, player: player, evalAfter: null, quality: null });
    G.redo.length = 0;
    G.view = G.main.length;
    G.hintIdx = null;
    if (player === X) SND.x(); else SND.o();
    if (G.main.length === 1) recordOpening(idx);
    var nb = boardAt(G.view);
    var w = E.winningLineAt(nb, idx, player);
    preserveScroll(function () { renderPosition(idx); });
    if (w) { endGame(player, w); refreshAll(); return true; }
    var full = true; for (var i = 0; i < LEN; i++) if (!nb[i]) { full = false; break; }
    if (full) { endGame(null, null); refreshAll(); return true; }
    refreshAll();
    maybeAiMove();
    scheduleAnalysis();
    refreshThreats();
    return true;
  }

  var aiToken = 0, aiPending = false;
  function maybeAiMove() {
    if (!aiToMove()) return;
    if (aiPending) return;
    aiPending = true;
    var tok = ++aiToken;
    var budget = aiBudget();
    var side = sideAt(G.view);
    var moves = movesUpTo(G.view), root = rootPayload();
    lastProgress = null;
    setSearching(true, '<span class="dots"><i></i><i></i><i></i></span>');
    setEngineStatus('AI thinking at level ' + G.level + ' (' + (budget / 1000).toFixed(1) + 's budget)…');
    var t0 = Date.now();
    ask({ type: 'move', moves: moves, root: root, side: side, level: G.level, timeMs: budget },
      function (p) {
        if (tok !== aiToken) return;
        lastProgress = p;
        $('thinkDepth').textContent = 'depth ' + p.depth;
        $('searchProgFill').style.width = (clamp((Date.now() - t0) / budget, 0, 1) * 100).toFixed(0) + '%';
      }


    ).then(function (res) {
      aiPending = false;
      if (tok !== aiToken) return;                    // stale AI result: MUST NOT move
      setSearching(false);
      if (!res || res.idx == null) { setEngineStatus('AI found no move.'); return; }
      if (!aiToMove()) return;                        // position changed underneath us
      G.lastAiMs = Date.now() - t0;
      setEngineStatus('AI played ' + nm(res.idx) + ' — depth ' + res.depth + ', ' + (res.nodes || 0).toLocaleString() + ' nodes');
      place(res.idx, side);
    }).catch(function (err) {
      aiPending = false;
      if (tok !== aiToken) return;
      setSearching(false);
      if (isCancel(err)) {
        // Stop pressed during AI thinking: use the best move from the deepest
        // COMPLETED iteration, else a fast guaranteed-legal engine move.
        if (!aiToMove()) { setEngineStatus('Search stopped.'); return; }
        var pick = lastProgress && lastProgress.best != null ? lastProgress.best : null;
        if (pick == null) {
          try {
            var s = new E.State();
            if (root) for (var i = 0; i < LEN; i++) if (root[i]) s.play(i, root[i]);
            moves.forEach(function (m) { s.play(m[0], m[1]); });
            var q = E.chooseMove(s, side, 3, 200);
            pick = q && q.idx != null ? q.idx : null;
          } catch (e) {}
        }
        if (pick != null && !boardAt(G.view)[pick]) {
          setEngineStatus('Stopped — played best completed-depth move ' + nm(pick) + '.');
          place(pick, side);
        } else setEngineStatus('Search stopped before a move was found.');
      } else {
        setEngineStatus('AI move failed.');
        showError('The engine failed to produce a move: ' + ((err && err.message) || err));
      }
    });
  }

  function endGame(winner, winCells) {
    G.status = winner ? 'won' : 'draw';
    G.winner = winner; G.winCells = winCells;
    if (winner === X) SESSION.x++; else if (winner === O) SESSION.o++; else SESSION.d++;
    STATS.played++; STATS.moveTotal += G.main.length;
    if (!STATS.byLevel[G.level]) STATS.byLevel[G.level] = { w: 0, l: 0, d: 0 };
    if (G.mode === 'ai') {
      if (winner === G.humanSide) { STATS.wins++; STATS.streak++; STATS.best = Math.max(STATS.best, STATS.streak); STATS.byLevel[G.level].w++; }
      else if (winner) { STATS.losses++; STATS.streak = 0; STATS.byLevel[G.level].l++; }
      else { STATS.draws++; STATS.byLevel[G.level].d++; }
      if (winner === G.humanSide) SND.win(); else if (winner) SND.lose();
    } else if (!winner) STATS.draws++;
    store('stats3', STATS);
    checkAchievements(winner);
    refreshScore();
    setTimeout(showEnd, 420);
  }
  function recordOpening(idx) {
    STATS.firstMoves++;
    if (idx === 112) STATS.centerFirst++;
    STATS.firstDistTotal += Math.abs(idx % SIZE - 7) + Math.abs(((idx / SIZE) | 0) - 7);
    store('stats3', STATS);
  }
  function checkAchievements(winner) {
    var got = [];
    function unlock(id) {
      if (!ACH[id]) {
        ACH[id] = Date.now();
        var d = ACH_DEFS.filter(function (a) { return a.id === id; })[0];
        if (d) got.push(d.label);
      }
    }
    if (G.mode === 'local') unlock('local_game');
    if (G.mode === 'ai' && winner === G.humanSide) {
      unlock('first_win');
      if (G.level >= 5) unlock('win_l5');
      if (G.level >= 7) unlock('win_l7');
      if (G.level >= 9) unlock('win_l9');
      if (G.main.length <= 20) unlock('fast_win');
      if (!G.hintsUsed) unlock('no_hint_win');
      if (STATS.streak >= 3) unlock('streak3');
      if (STATS.streak >= 5) unlock('streak5');
    }
    if (G.sawForcedWin) unlock('tactical');
    if (STATS.analyses >= 50) unlock('analyst');
    if (STATS.deepAnalyses >= 1) unlock('deep');
    if (STATS.puzzlesSolved >= 1) unlock('puzzle1');
    if (STATS.puzzlesSolved >= 5) unlock('puzzle5');
    if (got.length) { store('ach3', ACH); toast('Achievement: ' + got.join(', ')); }
    refreshStatsPage();
  }

  function setView(n) {
    var L = line().length;
    G.view = clamp(n, 0, L);
    if (G.whatIf) G.whatIf = null;
    G.hintIdx = null;
    preserveScroll(function () { refreshNav(); refreshMoves(); refreshGraph(); renderPosition(); refreshStatus(); });
    scheduleAnalysis();
    refreshThreats();
  }

  /* =======================================================================
     CONTROLS
     ======================================================================= */
  $('navFirst').onclick = function () { stopReplay(); setView(0); };
  $('navPrev').onclick = function () { stopReplay(); setView(G.view - 1); };
  $('navNext').onclick = function () { stopReplay(); setView(G.view + 1); };
  $('navLast').onclick = function () { stopReplay(); setView(line().length); };
  $('mainLineBtn').onclick = function () { G.variation = null; invalidateBoard(); setView(G.main.length); };

  $('analysisBtn').onclick = function () {
    G.analysisMode = !G.analysisMode;
    if (!G.analysisMode) { G.variation = null; G.whatIf = null; invalidateBoard(); G.view = G.main.length; }
    refreshAll(); scheduleAnalysis();
    toast(G.analysisMode ? 'Analysis mode: click any square to explore a variation' : 'Back to the game');
    maybeAiMove();
  };

  var replayTimer = null, replaySpeed = 900;
  function stopReplay() { if (replayTimer) { clearInterval(replayTimer); replayTimer = null; $('replayBtn').textContent = '⏯'; } }
  $('replayBtn').onclick = function () {
    if (replayTimer) { stopReplay(); return; }
    if (!line().length) return;
    if (G.view >= line().length) setView(0);
    $('replayBtn').textContent = '⏸';
    replayTimer = setInterval(function () {
      if (G.view >= line().length) { stopReplay(); return; }
      setView(G.view + 1);
    }, replaySpeed);
  };
  $('speedSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    replaySpeed = +b.dataset.v;
    [].forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    if (replayTimer) { stopReplay(); $('replayBtn').click(); }
  };

  var editTool = 'x', editSide = X;
  boardEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.cell');
    if (!btn || btn.hasAttribute('disabled')) return;
    var i = +btn.dataset.i;
    setFocus(i);
    if (G.editing) {
      G.editBoard[i] = editTool === 'erase' ? 0 : (editTool === 'x' ? X : O);
      invalidateBoard(); renderPosition(); updateEditCount();
      return;
    }
    if (G.puzzle && G.puzzle.active) { puzzleGuess(i); return; }
    if (whatIfArmed) { armWhatIf(i); return; }
    if (humanToMove()) { SND.click(); place(i, sideAt(G.view)); return; }
    if (G.analysisMode || G.mode === 'analysis') { SND.click(); place(i, sideAt(G.view)); }
  });
  boardEl.addEventListener('keydown', function (e) {
    var map = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (!map[e.key]) return;
    e.preventDefault(); e.stopPropagation();
    var x = clamp((focusIdx % SIZE) + map[e.key][0], 0, SIZE - 1);
    var y = clamp(((focusIdx / SIZE) | 0) + map[e.key][1], 0, SIZE - 1);
    setFocus(y * SIZE + x);
    /* preventScroll keeps focus movement from yanking the page on mobile */
    try { cellEls[focusIdx].focus({ preventScroll: true }); } catch (err) { cellEls[focusIdx].focus(); }
  });

  $('newBtn').onclick = async function () {
    SND.click();
    if (G && G.status === 'playing' && G.main.length) {
      if (!(await confirmDialog('Start a new game? The current game will be lost.', 'New Game'))) return;
    }
    startGame(G.mode, { humanSide: S.side === 'o' ? O : X });
  };
  $('undoBtn').onclick = function () {
    if (!G.main.length || G.variation) return;
    cancelAllSearches('undo'); aiToken++; analysisToken++; aiPending = false; setSearching(false);
    /* undo one full round in AI mode (human + engine reply), one ply otherwise */
    var n = (G.mode === 'ai' && G.main.length >= 2 && controllerOf(G.main[G.main.length - 1].player) === 'ai') ? 2 : 1;
    for (var k = 0; k < n && G.main.length; k++) G.redo.push(G.main.pop());
    G.status = 'playing'; G.winner = null; G.winCells = null;
    G.view = G.main.length; G.hintIdx = null; G.whatIf = null;
    invalidateBoard(); refreshAll(); scheduleAnalysis(); refreshThreats();
  };
  $('redoBtn').onclick = function () {
    if (!G.redo.length || G.variation) return;
    var n = Math.min(G.redo.length, (G.mode === 'ai' ? 2 : 1));
    for (var k = 0; k < n; k++) {
      var m = G.redo.pop();
      if (boardAt(G.main.length)[m.idx]) break;
      G.main.push(m);
    }
    G.view = G.main.length;
    recomputeTerminal();
    invalidateBoard(); refreshAll(); scheduleAnalysis();
  };
  $('hintBtn').onclick = function () {
    if (G.status !== 'playing') return;
    G.hintsUsed++;
    setEngineStatus('Finding a hint…');
    ask({ type: 'move', moves: movesUpTo(G.view), root: rootPayload(), side: sideAt(G.view), level: 8, timeMs: Math.min(2500, analysisBudget()) })
      .then(function (res) {
        if (!res || res.idx == null) return;
        G.hintIdx = res.idx; renderPosition();
        toast('Hint: ' + nm(res.idx));
        setEngineStatus('Hint: ' + nm(res.idx) + ' (depth ' + res.depth + ')');
      }).catch(function (e) { if (!isCancel(e)) setEngineStatus('Hint failed.'); });
  };
  $('stopBtn').onclick = function () {
    cancelAllSearches('stop');
    toast('Search stopped');
  };
  $('deepBtn').onclick = function () {
    STATS.deepAnalyses++; store('stats3', STATS);
    var budget = Math.max(15000, S.timeMs * 2);
    toast('Deep analysis: ' + (budget / 1000) + 's');
    runAnalysis(true, budget);
    checkAchievements(null);
  };

  /* ---- What-If ---- */
  var whatIfArmed = false;
  $('whatIfBtn').onclick = function () {
    if (G.whatIf) { discardWhatIf(); return; }
    whatIfArmed = !whatIfArmed;
    $('whatIfBtn').setAttribute('aria-pressed', String(whatIfArmed));
    toast(whatIfArmed ? 'What-If: click a square to try a move without committing it' : 'What-If cancelled');
  };
  function armWhatIf(i) {
    whatIfArmed = false;
    if (boardAt(G.view)[i]) return;
    G.whatIf = { idx: i, player: sideAt(line().length) };
    invalidateBoard(); refreshAll();
    toast('What-If ' + nm(i) + ' — Apply or Discard from the What-If button');
    var tok = ++analysisToken;
    setSearching(true);
    ask({
      type: 'analyse', root: rootPayload(),
      moves: movesUpTo(line().length).concat([[i, G.whatIf.player]]),
      side: other(G.whatIf.player), timeMs: analysisBudget(), vct: true
    }).then(function (res) {
      if (tok !== analysisToken) return;
      setSearching(false); current = res;
      setEvalDisplay(res); showEngineInfo(res, false);
      setEngineStatus('What-If ' + nm(i) + ': ' + (dp(res.score) > 0 ? '+' : '') + dp(res.score).toFixed(1) + ' at depth ' + res.depth);
    }).catch(function (e) { if (!isCancel(e)) setSearching(false); });
  }
  function discardWhatIf() {
    G.whatIf = null; whatIfArmed = false;
    invalidateBoard(); refreshAll(); scheduleAnalysis();
    toast('What-If discarded');
  }

  $('snapBtn').onclick = function () {
    G.snapshots.push({
      label: 'ply ' + G.view + (current ? ' · ' + (dp(current.score) > 0 ? '+' : '') + dp(current.score).toFixed(1) : ''),
      moves: movesUpTo(G.view), root: rootPayload(), rootSide: G.rootSide, score: current ? current.score : null
    });
    toast('Snapshot saved (' + G.snapshots.length + ')');
    refreshTree();
  };
  $('treeList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-snap]'); if (!b) return;
    var s = G.snapshots[+b.dataset.snap]; if (!s) return;
    startGame('analysis', { root: s.root ? Int8Array.from(s.root) : null, rootSide: s.rootSide, moves: s.moves.map(function (m) { return m[0]; }) });
    toast('Snapshot loaded into the analysis board');
  });

  $('cmpBtn').onclick = function () {
    if (!current || !current.candidates || current.candidates.length < 2) { toast('Need an analysis with candidates first'); return; }
    openModal('cmpOverlay');
    $('cmpBody').innerHTML = '<p class="empty-note">Searching each candidate…</p>';
    var side = sideAt(G.view), base = movesUpTo(G.view), root = rootPayload();
    var top = current.candidates.slice(0, 3);
    var budget = Math.min(Math.max(1200, analysisBudget() / 2), 8000);
    Promise.all(top.map(function (c) {
      return ask({ type: 'analyse', root: root, moves: base.concat([[c.idx, side]]), side: other(side), timeMs: budget, vct: true })
        .then(function (r) { return { idx: c.idx, res: r }; })
        .catch(function () { return { idx: c.idx, res: null }; });
    })).then(function (rows) {
      $('cmpBody').innerHTML = '<dl class="summary-grid">' + rows.map(function (r) {
        if (!r.res) return '<dt>' + nm(r.idx) + '</dt><dd>failed</dd>';
        var v = dp(r.res.score);
        var mate = r.res.mateIn != null ? ' (M' + r.res.mateIn + ' ' + sName(r.res.mateFor) + ')' : '';
        return '<dt>' + nm(r.idx) + ' <span style="color:var(--text-3)">d' + r.res.depth + '</span></dt><dd>' +
          (v > 0 ? '+' : '') + v.toFixed(2) + mate + '</dd>';
      }).join('') + '</dl><p class="hintline">Scores are X-positive: higher is better for X.</p>';
    });
  };

  $('moveList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mi]'); if (b) { stopReplay(); setView(+b.dataset.mi); }
  });
  $('pvList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pv]'); if (b) flash(+b.dataset.pv);
  });
  $('candList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cand]'); if (b) flash(+b.dataset.cand);
  });
  function flash(i) {
    if (cellEls[i]) { cellEls[i].classList.add('flash'); setTimeout(function () { renderPosition(); }, 1100); }
  }

  /* graph interaction */
  var graphEl = $('graph');
  graphEl.addEventListener('mousemove', function (e) {
    if (!graphEl._xs || !graphPts.length) return;
    var r = graphEl.getBoundingClientRect();
    var rel = (e.clientX - r.left) / r.width * 320;
    var best = null, bd = 1e9;
    graphPts.forEach(function (p) { var d = Math.abs(graphEl._xs(p.i) - rel); if (d < bd) { bd = d; best = p; } });
    if (!best) return;
    var tip = $('graphTip');
    tip.textContent = (best.m ? sName(best.m.player) + ' ' + nm(best.m.idx) : 'Start') + ' · ' + (best.v > 0 ? '+' : '') + best.v.toFixed(1) +
      (best.m && best.m.quality ? ' · ' + best.m.quality : '');
    tip.style.left = clamp(e.clientX - r.left - 40, 0, r.width - 90) + 'px';
    tip.style.top = '2px';
    tip.classList.add('show');
    graphEl._hover = best.i;
  });
  graphEl.addEventListener('mouseleave', function () { $('graphTip').classList.remove('show'); graphEl._hover = null; });
  graphEl.addEventListener('click', function () { if (graphEl._hover != null) { stopReplay(); setView(graphEl._hover); } });

  /* =======================================================================
     NOTATION / SAVE / LOAD / SHARE
     ======================================================================= */
  function encodePos(b, side) {
    var s = '', run = 0;
    for (var i = 0; i < LEN; i++) {
      if (!b[i]) { run++; continue; }
      if (run) { s += run; run = 0; }
      s += b[i] === X ? 'x' : 'o';
    }
    if (run) s += run;
    return 'XO15/' + s + '/' + (side === X ? 'x' : 'o');
  }
  function decodePos(str) {
    try {
      var parts = String(str).trim().split('/');
      if (parts[0] !== 'XO15' || parts.length < 3) return null;
      var b = new Int8Array(LEN), body = parts[1], i = 0, num = '';
      for (var k = 0; k < body.length; k++) {
        var c = body[k];
        if (c >= '0' && c <= '9') { num += c; continue; }
        if (num) { i += parseInt(num, 10); num = ''; }
        if (c === 'x') b[i++] = X; else if (c === 'o') b[i++] = O; else return null;
        if (i > LEN) return null;
      }
      if (num) i += parseInt(num, 10);
      if (i > LEN) return null;
      var side = parts[2] === 'o' ? O : X;
      return { board: b, side: side };
    } catch (e) { return null; }
  }
  function encodeGameText() {
    return line().slice(0, G.view).map(function (m) { return sName(m.player) + ':' + nm(m.idx); }).join(' ');
  }
  function parseGameText(txt) {
    var out = [], re = /([XOxo])\s*:?\s*([A-Oa-o])\s*(\d{1,2})/g, m;
    while ((m = re.exec(txt))) {
      var col = COLS.indexOf(m[2].toUpperCase()), row = SIZE - parseInt(m[3], 10);
      if (col < 0 || row < 0 || row >= SIZE) return null;
      out.push(row * SIZE + col);
    }
    return out.length ? out : null;
  }
  function sanitize(arr) {
    if (!Array.isArray(arr)) return null;
    var seen = Object.create(null), out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i] | 0;
      if (!(v >= 0 && v < LEN)) return null;
      if (seen[v]) return null;
      seen[v] = 1; out.push(v);
    }
    return out;
  }

  $('saveBtn').onclick = function () {
    var ok = store('save3', {
      v: 3, mode: G.mode, humanSide: G.humanSide, level: G.level,
      root: rootPayload(), rootSide: G.rootSide, moves: G.main.map(function (m) { return m.idx; })
    });
    toast(ok ? 'Game saved' : 'Could not save — local storage unavailable');
  };
  $('loadBtn').onclick = async function () {
    var d = load('save3', null);
    if (!d) { toast('No saved game found'); return; }
    var mv = sanitize(d.moves || []);
    if (!mv) { toast('Saved game is corrupted — not loaded'); return; }
    if (G.main.length && !(await confirmDialog('Load the saved game? The current game will be lost.', 'Load'))) return;
    S.level = clamp(d.level || S.level, 1, 9); applySettings();
    startGame(d.mode === 'local' || d.mode === 'analysis' ? d.mode : 'ai', {
      humanSide: d.humanSide === O ? O : X, moves: mv,
      root: d.root ? Int8Array.from(d.root) : null, rootSide: d.rootSide === O ? O : X
    });
    toast('Game loaded');
  };
  function encodeShare() {
    try {
      var s = String.fromCharCode.apply(null, [G.rootSide].concat(G.main.map(function (m) { return m.idx; })));
      return location.origin + location.pathname + '?p=' + encodeURIComponent(btoa(s)) + '#/' + routeForMode(G.mode);
    } catch (e) { return location.href; }
  }
  function decodeShare(str) {
    try {
      var s = atob(decodeURIComponent(str)), arr = [];
      for (var i = 1; i < s.length; i++) arr.push(s.charCodeAt(i));
      return { rootSide: s.charCodeAt(0) === O ? O : X, moves: sanitize(arr) };
    } catch (e) { return null; }
  }
  $('shareBtn').onclick = function () { showIO('Share Link', 'Anyone opening this link gets the current game.', encodeShare(), 'Copy'); };
  $('copyPosBtn').onclick = function () {
    showIO('Copy Position', 'Compact, reversible position notation.', encodePos(boardAt(G.view), sideAt(G.view)), 'Copy');
  };
  $('copyGameBtn').onclick = function () { showIO('Copy Game', 'Move list in algebraic form.', encodeGameText(), 'Copy'); };
  $('reportBtn').onclick = function () {
    var L = line(), lines = [];
    lines.push('XO 5-in-a-Row — analysis report');
    lines.push('Mode: ' + G.mode + (G.mode === 'ai' ? ' (level ' + G.level + ', human plays ' + sName(G.humanSide) + ')' : ''));
    lines.push('Position: ' + encodePos(boardAt(G.view), sideAt(G.view)));
    lines.push('Side to move: ' + sName(sideAt(G.view)));
    if (current) {
      lines.push('Evaluation: ' + (dp(current.score) > 0 ? '+' : '') + dp(current.score).toFixed(2) + ' (X-positive), depth ' + current.depth);
      if (current.mateIn != null) lines.push('Forced win: M' + current.mateIn + ' for ' + sName(current.mateFor));
      if (current.best != null) lines.push('Best move: ' + nm(current.best));
      if (current.pv && current.pv.length) lines.push('PV: ' + current.pv.map(nm).join(' '));
      if (current.candidates && current.candidates.length) {
        lines.push('Candidates: ' + current.candidates.slice(0, 5).map(function (c) {
          return nm(c.idx) + ' ' + (dp(c.score) > 0 ? '+' : '') + dp(c.score).toFixed(2);
        }).join(', '));
      }
    } else lines.push('Evaluation: not yet computed');
    lines.push('Moves: ' + L.map(function (m) { return sName(m.player) + ':' + nm(m.idx) + (m.quality ? '(' + m.quality + ')' : ''); }).join(' '));
    showIO('Copy Analysis', 'Plain-text report of the current position and engine output.', lines.join('\n'), 'Copy');
  };
  $('importBtn').onclick = function () { showIO('Import', 'Paste a position (XO15/…), a move list, a share link, or exported JSON.', '', 'Import'); };

  var ioMode = 'copy';
  function showIO(t, h, v, a) {
    ioMode = a === 'Import' ? 'import' : 'copy';
    $('ioTitle').textContent = t; $('ioHint').textContent = h;
    $('ioText').value = v; $('ioAction').textContent = a;
    openModal('ioOverlay');
  }
  $('ioAction').onclick = async function () {
    var txt = $('ioText').value;
    if (ioMode === 'copy') {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt);
        else { $('ioText').select(); document.execCommand && document.execCommand('copy'); }
        toast('Copied');
      } catch (e) { toast('Copy failed — select the text manually'); }
      return;
    }
    txt = String(txt || '').trim();
    if (!txt) { toast('Nothing to import'); return; }
    var pos = decodePos(txt);
    if (pos) { closeModal('ioOverlay'); loadRawPosition(pos.board, pos.side); return; }
    var mQ = txt.match(/[?&]p=([^&#]+)/);
    if (mQ) {
      var sh = decodeShare(mQ[1]);
      if (sh && sh.moves) { closeModal('ioOverlay'); startGame(G.mode, { humanSide: G.humanSide, moves: sh.moves }); toast('Imported ' + sh.moves.length + ' moves'); return; }
    }
    try {
      var j = JSON.parse(txt);
      var mv = sanitize(j.moves);
      if (mv) { closeModal('ioOverlay'); startGame(j.mode || G.mode, { humanSide: j.humanSide === O ? O : X, moves: mv }); toast('Imported game'); return; }
    } catch (e) {}
    var gm = parseGameText(txt);
    if (gm) { var s2 = sanitize(gm); if (s2) { closeModal('ioOverlay'); startGame(G.mode, { humanSide: G.humanSide, moves: s2 }); toast('Imported ' + s2.length + ' moves'); return; } }
    toast('Could not read that — position unchanged'); SND.err();
  };
  function loadRawPosition(b, side) {
    /* An imported/edited board becomes an explicit ANALYSIS ROOT. It is never
       turned into a "game", which is what keeps the X-moves-first invariant
       true for every real game. */
    goRoute('analysis', true);
    startGame('analysis', { root: b, rootSide: side });
    toast('Position loaded as an analysis root (' + sName(side) + ' to move)');
  }

  /* ---- position editor ---- */
  $('editBtn').onclick = function () {
    G.editing = true; G.editBoard = Int8Array.from(boardAt(G.view));
    editSide = sideAt(G.view);
    press('sideToMoveSeg', editSide === X ? 'x' : 'o');
    invalidateBoard(); renderPosition(); updateEditCount(); openModal('editOverlay');
  };
  function cancelEdit() {
    G.editing = false; G.editBoard = null; invalidateBoard();
    closeModal('editOverlay'); refreshAll(); scheduleAnalysis();
  }
  $('editClear').onclick = function () { G.editBoard = new Int8Array(LEN); invalidateBoard(); renderPosition(); updateEditCount(); };
  $('toolSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    editTool = b.dataset.v;
    [].forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    renderPosition();
  };
  $('sideToMoveSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    editSide = b.dataset.v === 'o' ? O : X;
    [].forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
  };
  function updateEditCount() {
    var x = 0, o = 0;
    for (var i = 0; i < LEN; i++) { if (G.editBoard[i] === X) x++; else if (G.editBoard[i] === O) o++; }
    $('editCount').textContent = x + ' X · ' + o + ' O';
  }
  $('editAnalyze').onclick = function () {
    var b = Int8Array.from(G.editBoard), side = editSide;
    G.editing = false; G.editBoard = null;
    closeModal('editOverlay');
    loadRawPosition(b, side);
  };

  /* =======================================================================
     PUZZLES
     ======================================================================= */
  var PUZZLES = [];
  try { PUZZLES = JSON.parse($('puzzleSrc').textContent || '[]') || []; } catch (e) { PUZZLES = []; }
  var PUZ_STATE = load('puz3', {});

  function todayIndex() {
    var d = new Date();
    var seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return PUZZLES.length ? seed % PUZZLES.length : 0;
  }
  function renderPuzzles() {
    var g = $('puzGrid'); if (!g) return;
    if (!PUZZLES.length) { g.innerHTML = '<p class="empty-note">No puzzles bundled with this build.</p>'; return; }
    g.innerHTML = PUZZLES.map(function (p, i) {
      var solved = PUZ_STATE[i] === 'solved';
      return '<button class="puz" data-puz="' + i + '"><h4>Puzzle ' + (i + 1) + '</h4>' +
        '<p>X to move · forced win in ' + Math.ceil(p.len / 2) + '</p>' +
        (solved ? '<span class="solved">✓ Solved</span>' : '<span style="font-size:11px;color:var(--text-3)">Unsolved</span>') + '</button>';
    }).join('');
    var solvedN = Object.keys(PUZ_STATE).filter(function (k) { return PUZ_STATE[k] === 'solved'; }).length;
    $('puzProgress').textContent = solvedN + ' / ' + PUZZLES.length;
    var t = todayIndex();
    $('dailyInfo').textContent = PUZZLES.length
      ? 'Today\'s puzzle is #' + (t + 1) + ' — X to move with a verified forced win in ' + Math.ceil(PUZZLES[t].len / 2) + '.'
      : 'No puzzles available in this build.';
    $('dailyStart').disabled = !PUZZLES.length;
  }
  $('puzGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-puz]'); if (b) startPuzzle(+b.dataset.puz);
  });
  $('dailyStart').onclick = function () { startPuzzle(todayIndex(), true); };

  function startPuzzle(i, daily) {
    var p = PUZZLES[i]; if (!p) return;
    goRoute('play', true);
    startGame('analysis', { moves: p.moves.slice() });
    G.puzzle = { i: i, active: true, tries: 0, daily: !!daily, key: p.key, len: p.len };
    G.analysisMode = false;
    refreshAll();
    toast('Puzzle ' + (i + 1) + ': X to move — find the move that forces a win');
    setEngineStatus('Puzzle mode — engine verifies every guess.');
  }
  function puzzleGuess(i) {
    var b = boardAt(G.view);
    if (b[i]) return;
    G.puzzle.tries++;
    STATS.puzzleTries++;
    var moves = movesUpTo(G.view).concat([[i, X]]);
    setEngineStatus('Verifying your move with the solver…');
    var tok = ++analysisToken;
    /* Verification is done by re-running the engine on the guess, not by
       string-matching the stored key: any move that provably forces a win
       counts, and a move that does not is rejected on engine evidence. */
    var tb = Int8Array.from(b); tb[i] = X;
    var immediate = !!E.winningLineAt(tb, i, X);
    if (immediate) { puzzleSolved(i); return; }
    ask({ type: 'forcing', moves: moves, root: rootPayload(), side: X, maxPly: 10, timeMs: 3000 })
      .then(function (r) {
        if (tok !== analysisToken) return;
        if (r && r.win) puzzleSolved(i);
        else {
          SND.err();
          setEngineStatus('Solver found no forced win after ' + nm(i) + ' — try again.');
          toast('Not a forced win — try another square');
          flash(i);
        }
      }).catch(function (e) { if (!isCancel(e)) setEngineStatus('Verification failed.'); });
  }
  function puzzleSolved(i) {
    var p = G.puzzle;
    p.active = false;
    if (PUZ_STATE[p.i] !== 'solved') {
      PUZ_STATE[p.i] = 'solved'; store('puz3', PUZ_STATE);
      STATS.puzzlesSolved++; store('stats3', STATS);
    }
    SND.win();
    place(i, X);
    toast('Solved in ' + p.tries + ' attempt' + (p.tries === 1 ? '' : 's') + '!');
    setEngineStatus('Puzzle solved — ' + nm(i) + ' forces the win.');
    checkAchievements(null);
    renderPuzzles();
  }

  /* =======================================================================
     END-OF-GAME SUMMARY
     ======================================================================= */
  function showEnd() {
    var t = $('endTitle'), s = $('endSub');
    if (G.status === 'draw') { t.textContent = 'Draw'; t.className = 'result-title draw'; s.textContent = 'The board is full.'; }
    else if (G.mode === 'ai') {
      var youWon = G.winner === G.humanSide;
      t.textContent = youWon ? 'You win' : 'AI wins';
      t.className = 'result-title ' + (youWon ? 'win' : 'lose');
      s.textContent = sName(G.winner) + ' completed five in a row against level ' + G.level + '.';
    } else {
      t.textContent = 'Player ' + sName(G.winner) + ' wins';
      t.className = 'result-title win';
      s.textContent = 'Five in a row.';
    }
    var rows = [
      ['Moves played', G.main.length],
      ['Duration', Math.round((Date.now() - G.startTime) / 1000) + 's'],
      ['Mode', G.mode === 'ai' ? 'vs AI level ' + G.level : (G.mode === 'local' ? 'Local 2 player' : 'Analysis')],
      ['Hints used', G.hintsUsed]
    ];
    /* "Best move" / "Biggest mistake" derived from X-positive deltas. */
    var graded = G.main.filter(function (m) { return m.quality && m.loss != null; });
    if (graded.length) {
      var focus = G.mode === 'ai' ? G.humanSide : null;
      var pool = focus ? graded.filter(function (m) { return m.player === focus; }) : graded;
      if (pool.length) {
        var sorted = pool.slice().sort(function (a, b) { return a.loss - b.loss; });
        rows.push(['Best move', sName(sorted[0].player) + ' ' + nm(sorted[0].idx)]);
        var worst = sorted[sorted.length - 1];
        if (worst.loss > 0.55) rows.push(['Biggest mistake', sName(worst.player) + ' ' + nm(worst.idx) + ' (−' + worst.loss.toFixed(1) + ')']);
      }
    }
    $('endSummary').innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');
    openModal('endOverlay');
  }
  $('againBtn').onclick = function () { closeModal('endOverlay'); startGame(G.mode, { humanSide: S.side === 'o' ? O : X }); };
  $('reviewBtn').onclick = function () {
    closeModal('endOverlay');
    G.analysisMode = true; setView(0); refreshAll();
    toast('Review mode — use ← → to step through the game');
  };

  /* =======================================================================
     CLOCK TICKER
     ======================================================================= */
  var ticker = null, tickLast = Date.now();
  function tickerStart() {
    if (ticker) clearInterval(ticker);
    tickLast = Date.now();
    ticker = setInterval(function () {
      var now = Date.now(), dt = now - tickLast; tickLast = now;
      if (!G || S.clock <= 0 || G.status !== 'playing' || G.mode === 'analysis' || G.analysisMode) { refreshTimers(); return; }
      var stm = sideToMove();
      G.clock[stm] = Math.max(0, G.clock[stm] - dt);
      refreshTimers();
    }, 500);
  }

  /* =======================================================================
     MODALS / TOAST
     ======================================================================= */
  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }
  function closeAll() { ['settingsOverlay', 'confirmOverlay', 'endOverlay', 'ioOverlay', 'editOverlay', 'cmpOverlay'].forEach(closeModal); }
  var confRes = null;
  function confirmDialog(text, title) {
    $('confText').textContent = text; $('confTitle').textContent = title || 'Confirm';
    openModal('confirmOverlay');
    return new Promise(function (r) { confRes = r; });
  }
  $('confCancel').onclick = function () { closeModal('confirmOverlay'); confRes && confRes(false); };
  $('confOk').onclick = function () { closeModal('confirmOverlay'); confRes && confRes(true); };
  [].forEach.call(document.querySelectorAll('[data-close]'), function (b) {
    b.onclick = function () { if (G && G.editing) cancelEdit(); else closeAll(); };
  });
  [].forEach.call(document.querySelectorAll('.overlay'), function (ov) {
    ov.addEventListener('mousedown', function (e) {
      if (e.target === ov && ov.id !== 'endOverlay' && ov.id !== 'editOverlay') closeModal(ov.id);
    });
  });
  function toast(m) {
    var t = $('toast'); t.textContent = m; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* =======================================================================
     SETTINGS
     ======================================================================= */
  function applySettings(rebuild) {
    document.documentElement.setAttribute('data-theme', S.theme);
    document.documentElement.style.setProperty('--board-size', S.boardSize + 'px');
    $('frame').classList.toggle('no-coords', !S.coords);
    press('levelSeg', String(S.level)); press('sideSeg', S.side);
    press('clockSeg', String(S.clock)); press('timeSeg', String(S.timeMs));
    press('themeSeg', S.theme);
    $('levelHint').textContent = 'Level ' + S.level + ' — ' + E.LEVELS9[S.level].label +
      ' (depth ≤ ' + E.LEVELS9[S.level].maxDepth + ', ' + (E.LEVELS9[S.level].vct ? 'VCF+VCT' : E.LEVELS9[S.level].vcf ? 'VCF' : 'no solver') + ')';
    sw('swSound', S.sound); sw('swAuto', S.auto); sw('swEval', S.evalBar); sw('swBest', S.bestMove);
    sw('swCand', S.candidates); sw('swThreat', S.threatMap); sw('swHeat', S.heatmap);
    sw('swQuality', S.quality); sw('swExplain', S.explain); sw('swCache', S.cache);
    sw('swCoords', S.coords); sw('swGraph', S.graph); sw('swDetails', S.details);
    $('sizeRange').value = S.boardSize;
    store('settings3', S);
    if (G) {
      G.level = S.level;
      refreshAll();
      if (rebuild) scheduleAnalysis();
    }
  }
  function press(id, v) {
    var el = $(id); if (!el) return;
    [].forEach.call(el.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); });
  }
  function sw(id, on) { var el = $(id); if (el) el.setAttribute('aria-checked', String(!!on)); }

  $('settingsBtn').onclick = function () { SND.click(); openModal('settingsOverlay'); };
  $('themeBtn').onclick = function () { S.theme = S.theme === 'light' ? 'dark' : 'light'; applySettings(); };
  $('setTabs').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    [].forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-selected', String(x === b)); });
    [].forEach.call(document.querySelectorAll('.tabpanel'), function (p) { p.hidden = p.dataset.panel !== b.dataset.tab; });
  };
  $('levelSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.level = clamp(+b.dataset.v, 1, 9); applySettings();
    toast('AI level ' + S.level + ' — ' + E.LEVELS9[S.level].label);
  };
  $('sideSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.side = b.dataset.v; applySettings();
    toast('You play ' + S.side.toUpperCase() + ' — applies from the next game (X always moves first)');
  };
  $('clockSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.clock = +b.dataset.v; applySettings();
    if (G) { G.clock[X] = S.clock * 60000; G.clock[O] = S.clock * 60000; refreshTimers(); }
  };
  $('timeSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.timeMs = +b.dataset.v; applySettings(); cacheClear();
    toast(S.timeMs === 0 ? 'Infinite search — use Stop to end it' : 'Search budget: ' + (S.timeMs / 1000) + 's');
    scheduleAnalysis();
  };
  $('themeSeg').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.theme = b.dataset.v; applySettings(); } };
  function bindSw(id, key, extra) {
    $(id).onclick = function () { S[key] = !S[key]; SND.click(); applySettings(); if (extra) extra(); };
  }
  bindSw('swSound', 'sound'); bindSw('swAuto', 'auto', function () { if (S.auto) scheduleAnalysis(); });
  bindSw('swEval', 'evalBar', function () { setEvalDisplay(current); });
  bindSw('swBest', 'bestMove', function () { renderPosition(); });
  bindSw('swCand', 'candidates', function () { showEngineInfo(current); });
  bindSw('swThreat', 'threatMap', function () { refreshThreats(); renderPosition(); });
  bindSw('swHeat', 'heatmap', function () { renderPosition(); });
  bindSw('swQuality', 'quality', function () { refreshMoves(); });
  bindSw('swExplain', 'explain', function () { refreshExplain(); });
  bindSw('swCache', 'cache', function () { if (!S.cache) cacheClear(); });
  bindSw('swCoords', 'coords', function () { renderPosition(); });
  bindSw('swGraph', 'graph', function () { refreshGraph(); });
  bindSw('swDetails', 'details', function () { showEngineInfo(current); });
  $('sizeRange').oninput = function () { S.boardSize = +this.value; applySettings(); };
  $('resetStatsBtn').onclick = async function () {
    if (!(await confirmDialog('Reset all statistics and achievements?', 'Reset'))) return;
    STATS = { played: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0, moveTotal: 0, firstMoves: 0, centerFirst: 0, firstDistTotal: 0, byLevel: {}, puzzlesSolved: 0, puzzleTries: 0, analyses: 0, deepAnalyses: 0 };
    ACH = {}; PUZ_STATE = {};
    store('stats3', STATS); store('ach3', ACH); store('puz3', PUZ_STATE);
    refreshScore(); renderPuzzles(); toast('Statistics reset');
  };
  $('resetSettingsBtn').onclick = async function () {
    if (!(await confirmDialog('Reset settings, statistics and achievements?', 'Reset everything'))) return;
    S = Object.assign({}, DEFAULTS);
    drop('settings3'); drop('stats3'); drop('ach3'); drop('puz3'); drop('save3');
    STATS = { played: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0, moveTotal: 0, firstMoves: 0, centerFirst: 0, firstDistTotal: 0, byLevel: {}, puzzlesSolved: 0, puzzleTries: 0, analyses: 0, deepAnalyses: 0 };
    ACH = {}; PUZ_STATE = {};
    applySettings(true); renderPuzzles(); toast('Everything reset');
  };

  /* =======================================================================
     ROUTER
     ======================================================================= */
  var ROUTES = ['home', 'play', 'local', 'analysis', 'puzzles', 'stats'];
  var currentRoute = null;
  function routeForMode(m) { return m === 'local' ? 'local' : m === 'analysis' ? 'analysis' : 'play'; }
  function modeForRoute(r) { return r === 'local' ? 'local' : r === 'analysis' ? 'analysis' : 'ai'; }

  function goRoute(r, silent) {
    if (ROUTES.indexOf(r) < 0) r = 'home';
    if (!silent) { try { location.hash = '#/' + r; } catch (e) {} }
    applyRoute(r);
  }
  function applyRoute(r) {
    currentRoute = r;
    $('viewHome').hidden = r !== 'home';
    $('viewGame').hidden = !(r === 'play' || r === 'local' || r === 'analysis');
    $('viewPuzzles').hidden = r !== 'puzzles';
    $('viewStats').hidden = r !== 'stats';
    [].forEach.call($('navLinks').querySelectorAll('button'), function (b) {
      if (b.dataset.route === r) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (r === 'stats') refreshStatsPage();
    if (r === 'puzzles') renderPuzzles();
    if (r === 'home') updateHomeCard();
    if (r === 'play' || r === 'local' || r === 'analysis') {
      var want = modeForRoute(r);
      if (!G || G.mode !== want) startGame(want, { humanSide: S.side === 'o' ? O : X });
      else refreshAll();
    }
  }
  function updateHomeCard() {
    var el = $('homeContinueText');
    if (!el) return;
    if (G && G.main.length && G.status === 'playing') {
      el.textContent = 'Resume: ' + (G.mode === 'ai' ? 'vs AI level ' + G.level : G.mode === 'local' ? 'local 2 player' : 'analysis') +
        ', ' + G.main.length + ' moves played.';
      $('homeContinue').dataset.route = routeForMode(G.mode);
      $('homeContinue').hidden = false;
    } else $('homeContinue').hidden = true;
  }
  $('navLinks').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-route]'); if (b) goRoute(b.dataset.route);
  });
  [].forEach.call(document.querySelectorAll('.mode[data-route]'), function (b) {
    b.onclick = function () { goRoute(b.dataset.route); };
  });
  $('brandBtn').onclick = function () { goRoute('home'); };
  window.addEventListener('hashchange', function () {
    var r = (location.hash || '').replace(/^#\/?/, '') || 'home';
    if (r !== currentRoute) applyRoute(ROUTES.indexOf(r) >= 0 ? r : 'home');
  });

  /* =======================================================================
     GLOBAL KEYBOARD
     ======================================================================= */
  /* e.target is not always an Element (a keydown dispatched at the document
     level has the document as its target), so .closest() must be guarded. */
  function inBoard(t) { return !!(t && typeof t.closest === 'function' && t.closest('#board')); }
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') { closeAll(); return; }
    if ($('viewGame').hidden) return;
    if (e.key === 'ArrowLeft' && !inBoard(e.target)) { e.preventDefault(); stopReplay(); setView(G.view - 1); }
    else if (e.key === 'ArrowRight' && !inBoard(e.target)) { e.preventDefault(); stopReplay(); setView(G.view + 1); }
    else if (e.key === 'Home') { e.preventDefault(); stopReplay(); setView(0); }
    else if (e.key === 'End') { e.preventDefault(); stopReplay(); setView(line().length); }
    else if (e.key === 'u' || e.key === 'U') $('undoBtn').click();
    else if (e.key === 'h' || e.key === 'H') $('hintBtn').click();
    else if (e.key === 'n' || e.key === 'N') $('newBtn').click();
    else if (e.key === 'a' || e.key === 'A') $('analysisBtn').click();
    else if (e.key === 's' || e.key === 'S') { if (searching) $('stopBtn').click(); }
  });
  window.addEventListener('resize', function () { if (G) setEvalDisplay(current); });

  /* =======================================================================
     BOOT
     ======================================================================= */
  var saved = load('settings3', null);
  if (saved) Object.keys(DEFAULTS).forEach(function (k) { if (saved[k] !== undefined) S[k] = saved[k]; });
  S.level = clamp(S.level | 0 || 5, 1, 9);
  if (S.side !== 'o') S.side = 'x';

  buildBoard();
  initWorker();
  applySettings();
  renderPuzzles();
  tickerStart();

  var initialMoves = null, initialRoute = 'home';
  try {
    var q = location.search.match(/[?&]p=([^&#]+)/);
    if (q) {
      var sh = decodeShare(q[1]);
      if (sh && sh.moves) { initialMoves = sh.moves; initialRoute = 'play'; }
    }
  } catch (e) {}
  var hashRoute = (location.hash || '').replace(/^#\/?/, '');
  if (ROUTES.indexOf(hashRoute) >= 0) initialRoute = hashRoute;

  startGame(modeForRoute(initialRoute === 'home' ? 'play' : initialRoute), {
    humanSide: S.side === 'o' ? O : X, moves: initialMoves
  });
  applyRoute(initialRoute);
  if (initialMoves) toast('Loaded a shared game (' + initialMoves.length + ' moves)');

  /* expose a small, read-only surface for the headless UI test suite */
  window.__XO = {
    get G() { return G; }, get S() { return S; },
    get current() { return current; },
    get worker() { return WK; },
    sideAt: sideAt, boardAt: boardAt, line: line, dp: dp, nm: nm,
    goRoute: goRoute, startGame: startGame, encodePos: encodePos, decodePos: decodePos,
    posKey: posKey, analysisTokenValue: function () { return analysisToken; },
    gradeOf: function (i) { return line()[i] && line()[i].quality; },
    isSearching: function () { return searching; },
    PUZZLES: PUZZLES,
    /* worker/search-cancellation hooks */
    ask: ask, cancelAllSearches: cancelAllSearches,
    workerGen: function () { return WK.gen; },
    pendingCount: function () { return Object.keys(WK.pending).length; },
    runAnalysis: runAnalysis, scheduleAnalysis: scheduleAnalysis,
    iterationLog: function () { return iterationLog.slice(); },
    clearIterationLog: function () { iterationLog.length = 0; },
    setEvalDisplay: function (r) { setEvalDisplay(r); },
    routes: ROUTES, currentRoute: function () { return currentRoute; }
  };
})();
