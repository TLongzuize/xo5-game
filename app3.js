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
    analysisEngine: true, auto: true, evalBar: true, bestMove: true, candidates: true,
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

  /* ---------------- dev notice & error surface ---------------- */
  var devNotice = $('devNotice');
  var devDismiss = $('devDismiss');
  if (devDismiss && devNotice) {
    devDismiss.onclick = function () {
      devNotice.hidden = true;
      devNotice.style.display = 'none';
    };
  }

  function showError(msg) {
    var bar = $('errBar'); if (!bar) return;
    $('errText').textContent = msg;
    bar.hidden = false;
    bar.style.display = 'flex';
  }
  var errClose = $('errClose');
  if (errClose) {
    errClose.onclick = function () {
      var bar = $('errBar');
      if (bar) {
        bar.hidden = true;
        bar.style.display = 'none';
      }
    };
  }
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
      rootEval: root ? null : 0
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
     WORKER POOLS — independent AI move worker and Analysis worker
     ======================================================================= */
  var workerBlobUrl = null;
  function getWorkerBlobUrl() {
    if (workerBlobUrl) return workerBlobUrl;
    if (typeof Worker === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
    try {
      var engEl = $('engineSrc'), wrkEl = $('workerSrc');
      if (!engEl || !wrkEl) return null;
      var src = engEl.textContent + '\n' + wrkEl.textContent;
      var blob = new Blob([src], { type: 'application/javascript' });
      workerBlobUrl = URL.createObjectURL(blob);
      return workerBlobUrl;
    } catch (e) {
      return null;
    }
  }

  function createPool(name) {
    return {
      name: name,
      worker: null,
      pending: Object.create(null),
      seq: 0,
      gen: 0,
      mode: 'none',
      inflight: 0
    };
  }

  var WK = createPool('AI');        // Dedicated AI move worker
  var AW = createPool('Analysis');  // Dedicated Analysis worker

  function initPool(pool) {
    var url = getWorkerBlobUrl();
    if (!url) {
      pool.mode = 'main';
      setEngineBadge();
      return;
    }
    try {
      pool.worker = new Worker(url);
      pool.worker.onmessage = function (e) { onPoolMessage(pool, e); };
      pool.worker.onerror = function () {
        try { pool.worker.terminate(); } catch (e) {}
        pool.worker = null;
        pool.mode = 'main';
        setEngineBadge();
        showError(pool.name + ' engine worker failed — running on main thread.');
        failPoolPending(pool, 'worker-error');
      };
      pool.mode = 'worker';
    } catch (err) {
      pool.worker = null;
      pool.mode = 'main';
    }
    setEngineBadge();
  }

  function initWorker() {
    initPool(WK);
    initPool(AW);
  }

  function setEngineBadge() {
    var b = $('engineBadge');
    if (!b) return;
    var mode = (WK.mode === 'worker' && AW.mode === 'worker') ? 'worker (dual)' :
               (WK.mode === 'worker' || AW.mode === 'worker') ? 'worker' : 'main thread';
    b.textContent = mode;
  }

  function onPoolMessage(pool, e) {
    var d = e.data || {}, p = pool.pending[d.id];
    if (!p) return;
    if (p.gen !== pool.gen) { delete pool.pending[d.id]; return; }
    if (d.kind === 'progress') {
      if (p.onProgress) { try { p.onProgress(d.p); } catch (er) {} }
      return;
    }
    delete pool.pending[d.id];
    pool.inflight--;
    if (d.kind === 'error') {
      p.reject(new Error(d.message || 'engine error'));
      return;
    }
    p.resolve(d.res);
  }

  function failPoolPending(pool, reason) {
    var keys = Object.keys(pool.pending);
    for (var i = 0; i < keys.length; i++) {
      var p = pool.pending[keys[i]];
      delete pool.pending[keys[i]];
      try { p.reject({ cancelled: true, reason: reason }); } catch (e) {}
    }
    pool.inflight = 0;
  }

  function cancelPool(pool, reason, force) {
    var wasInflight = pool.inflight > 0;
    pool.gen++;
    failPoolPending(pool, reason || 'cancelled');
    if (pool.worker && (force || wasInflight)) {
      try { pool.worker.terminate(); } catch (e) {}
      pool.worker = null;
      initPool(pool);
    }
  }

  function cancelAI(reason) {
    aiPending = false;
    setAiSearching(false);
    cancelPool(WK, reason || 'cancelled', false);
  }

  function cancelAnalysis(reason) {
    setSearching(false);
    cancelPool(AW, reason || 'cancelled', false);
  }

  function cancelAllSearches(reason) {
    cancelAI(reason);
    cancelAnalysis(reason);
  }

  function askPool(pool, payload, onProgress) {
    var id = ++pool.seq, gen = pool.gen;
    return new Promise(function (resolve, reject) {
      pool.pending[id] = { resolve: resolve, reject: reject, onProgress: onProgress, gen: gen };
      pool.inflight++;
      if (pool.worker) {
        payload.id = id;
        try { pool.worker.postMessage(payload); }
        catch (err) { delete pool.pending[id]; pool.inflight--; reject(err); }
        return;
      }
      /* main-thread fallback: deferred so the UI paints first, and with a
         hard budget cap so the page never locks up for seconds at a time. */
      setTimeout(function () {
        var p = pool.pending[id];
        if (!p || p.gen !== pool.gen) { delete pool.pending[id]; return; }
        delete pool.pending[id]; pool.inflight--;
        try {
          var s = new E.State(), i;
          if (payload.root) for (i = 0; i < LEN; i++) if (payload.root[i]) s.play(i, payload.root[i]);
          (payload.moves || []).forEach(function (m) { s.play(m[0], m[1]); });
          var isInf = payload.timeMs === 0 || payload.timeMs === Infinity;
          var cap = isInf ? 1200 : Math.min(payload.timeMs || 900, 1200), r;
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

  function askAI(payload, onProgress) {
    return askPool(WK, payload, onProgress);
  }

  function ask(payload, onProgress) {
    return askPool(AW, payload, onProgress);
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
  var INFINITE_MS = 3600000;
  function isInfinite() { return S.timeMs === 0; }

  function analysisBudget() {
    if (S.timeMs === 0) return 0; // 0 = infinite to engine
    /* smart budget: quiet openings do not need the full allowance */
    var stones = countStones();
    if (stones <= 2 && S.timeMs > 2000) return Math.max(600, Math.round(S.timeMs * 0.25));
    return S.timeMs;
  }
  function aiBudget() {
    if (S.timeMs === 0) return 30000; // AI must produce a move: 30s max
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
      (G.puzzle ? false : ((G.analysisMode && G.status === 'playing') || G.mode === 'analysis'));
    var ghost = G.editing ? editTool
      : (G.puzzle ? sName(G.puzzle.side).toLowerCase() : sName(sideToMove()).toLowerCase());
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
    if (!S.threatMap || (G && G.puzzle)) { threats = []; return; }
    var tok = ++threatToken;
    ask({ type: 'threats', moves: movesUpTo(G.view), root: rootPayload(), minLevel: 2 })
      .then(function (r) { if (tok === threatToken) { threats = r || []; renderPosition(); } })
      .catch(function () {});
  }

  function applyHeat(b) {
    if (G && G.puzzle) return;
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
    if (G && G.puzzle) { svg.innerHTML = ''; return; }   // no best-move arrow in puzzle mode
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
    if (G && G.puzzle) { $('mateBadge').hidden = true; return; }   // 24: nothing to show
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
    $('evalCard').hidden = !S.evalBar;
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
  var analysisToken = 0, analysisTimer = null;
  var searching = false, aiSearching = false, analysisSearching = false;
  var lastProgress = null, analysisLastProgress = null, aiLastProgress = null;

  function updateSearchingUI(note) {
    searching = aiSearching || analysisSearching;
    $('stopBtn').hidden = !searching;
    $('searchProg').hidden = !searching;
    if (!searching) $('searchProgFill').style.width = '0%';
    if (searching) {
      if (note) $('thinkDepth').innerHTML = note;
    } else {
      $('thinkDepth').innerHTML = '';
    }
  }

  function setSearching(on, note) {
    analysisSearching = !!on;
    updateSearchingUI(note);
  }

  function setAiSearching(on, note) {
    aiSearching = !!on;
    updateSearchingUI(note);
  }

  function scheduleAnalysis(force) {
    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = setTimeout(function () { runAnalysis(force); }, 80);
  }

  function runAnalysis(force, overrideMs) {
    if (!G || G.editing) return;
    /* 24: no analysis of any kind while a puzzle is open. The engine is still
       used to CHECK a move (puzzleGuess asks it directly), but the automatic
       analysis pipeline — which feeds the eval bar, graph, best move, PV and
       candidate list — is switched off entirely rather than merely hidden. */
    if (G.puzzle) { cancelAnalysis('puzzle-mode'); setSearching(false); return; }
    if (!S.auto && !force) { setEngineStatus('Auto analysis off'); return; }
    var key = posKey(G.view), tok = ++analysisToken;
    var b = boardAt(G.view);
    if (G.status !== 'playing' && G.view === line().length) {
      // terminal position: no search, report the result honestly
      cancelAnalysis('game-over');
      setSearching(false);
      current = null; setEvalDisplay(null);
      setEngineStatus(G.winner ? sName(G.winner) + ' has five in a row — game over.' : 'Draw — board full.');
      showEngineInfo(null); renderPosition();
      return;
    }
    if (S.cache && !isInfinite() && overrideMs === undefined && cache.has(key)) {
      cancelAnalysis('cached');
      applyAnalysis(cache.get(key), tok, key, false);
      setEngineStatus('Cached — depth ' + (cache.get(key).depth || 0));
      return;
    }
    var budget = overrideMs !== undefined ? overrideMs : analysisBudget();
    var t0 = Date.now();
    cancelAnalysis('new-analysis');
    analysisLastProgress = null;
    lastProgress = null;
    setSearching(true);
    if (!aiSearching) setEngineStatus('Searching…');
    STATS.analyses++;

    ask({
      type: 'analyse', moves: movesUpTo(G.view), root: rootPayload(),
      side: sideAt(G.view), timeMs: budget, vct: true
    }, function (p) {
      if (tok !== analysisToken) return;                    // stale progress: drop
      analysisLastProgress = p;
      lastProgress = p;
      applyIteration(p, budget, t0);
    }).then(function (res) {
      if (tok !== analysisToken) return;                    // stale result: must never apply
      if (S.cache && !isInfinite()) cache.set(key, res);
      setSearching(false);
      applyAnalysis(res, tok, key, true);
      if (!aiSearching) {
        var extra = res.stoppedByTime ? ' (time limit)' : (res.mateIn != null ? ' (mate found)' : '');
        setEngineStatus('Depth ' + res.depth + ' · ' + (res.nodes || 0).toLocaleString() + ' nodes · ' +
          ((res.timeMs || 0) / 1000).toFixed(2) + 's' + extra);
      }
      searchHistory.unshift({ at: Date.now(), depth: res.depth, score: res.score, nodes: res.nodes, ply: G.view });
      if (searchHistory.length > 8) searchHistory.pop();
      refreshScore();
    }).catch(function (err) {
      if (tok !== analysisToken) return;
      setSearching(false);
      if (isCancel(err)) {
        if (analysisLastProgress) {
          var partial = progressToResult(analysisLastProgress);
          applyAnalysis(partial, tok, null, true);
          if (!aiSearching) setEngineStatus('Stopped — keeping completed depth ' + analysisLastProgress.depth + '.');
        } else if (!aiSearching) setEngineStatus('Search stopped before the first depth completed.');
      } else {
        if (!aiSearching) setEngineStatus('Analysis failed.');
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
    if (S.graph) refreshGraph();
    if (!aiSearching) {
      var frac = budget ? clamp((Date.now() - t0) / budget, 0, 1) : ((p.depth % 10) / 10);
      $('searchProgFill').style.width = (frac * 100).toFixed(0) + '%';
      $('thinkDepth').textContent = 'depth ' + p.depth;
      setEngineStatus('Depth ' + p.depth + ' complete · ' + (p.nodes || 0).toLocaleString() + ' nodes — searching deeper…');
    }
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
    var before = i > 0 ? (L[i - 1] && L[i - 1].evalAfter) : (G.rootEval != null ? G.rootEval : (!G.root ? 0 : null));
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
    if (G.puzzle && G.puzzle.active) st.textContent = 'Puzzle — find the forced win for ' + sName(G.puzzle.side);
    else if (G.puzzle) st.textContent = 'Puzzle — ' + (G.puzzle.solved ? 'solved' : 'solution shown');
    else if (G.status === 'won') {
      var w = G.winner;
      st.textContent = sName(w) + ' wins';
      if (G.mode === 'ai') { st.classList.add(w === G.humanSide ? 'win' : 'lose'); st.textContent = (w === G.humanSide ? 'You win' : 'AI wins') + ' (' + sName(w) + ')'; }
    } else if (G.status === 'draw') st.textContent = 'Draw';
    else if (G.analysisMode) st.textContent = 'Analysis — ' + sName(stm) + ' to move';
    else if (controllerOf(stm) === 'ai') st.textContent = 'AI thinking (' + sName(stm) + ')';
    else if (G.mode === 'local') st.textContent = 'Player ' + sName(stm) + ' to move';
    else st.textContent = 'Your turn (' + sName(stm) + ')';
    $('modeBadge').hidden = !G.analysisMode || !!G.puzzle;
    /* 24: the controls that would reveal engine judgement are disabled, not
       merely hidden, so they cannot be reached by keyboard either. */
    var puz = !!G.puzzle;
    ['hintBtn', 'analysisBtn', 'deepBtn', 'cmpBtn', 'reportBtn', 'whatIfBtn'].forEach(function (id) {
      var el = $(id); if (el) el.disabled = puz;
    });
    if (puz) { $('newBtn').disabled = false; }
    $('undoBtn').disabled = !G.main.length || !!G.variation;
    $('redoBtn').disabled = !G.redo.length || !!G.variation;
    $('hintBtn').disabled = !!G.puzzle || !(G.status === 'playing' && !G.variation && G.view === G.main.length);
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
    $('graphCard').hidden = !S.evalBar || !S.graph || !!(G && G.puzzle);
    if (!S.evalBar || !S.graph || !G || G.puzzle) return;
    var g = $('graph'), W = 320, H = 96, pad = 6;
    graphPts = [];
    var rootV = G.rootEval != null ? G.rootEval : (!G.root ? 0 : null);
    if (rootV != null) graphPts.push({ i: 0, v: dp(rootV), m: null });
    G.main.forEach(function (m, i) {
      if (m.evalAfter != null) {
        graphPts.push({ i: i + 1, v: dp(m.evalAfter), m: m });
      } else if (i + 1 === G.view && current && current.score != null) {
        graphPts.push({ i: i + 1, v: dp(current.score), m: m });
      }
    });
    if (!G.root && (graphPts.length === 0 || graphPts[0].i !== 0)) {
      graphPts.unshift({ i: 0, v: 0, m: null });
    }
    var maxI = Math.max(1, G.main.length);
    var xs = function (i) { return pad + i / Math.max(1, maxI) * (W - 2 * pad); };
    var ys = function (v) { return H / 2 - (v / MAXP) * (H / 2 - pad); };      // +X is up
    if (graphPts.length < 2) {
      var dot = '';
      if (graphPts.length === 1 && graphPts[0].i > 0) {
        var x0 = pad, x1 = W - pad;
        var y1 = ys(graphPts[0].v);
        dot = '<line class="graph-line" x1="' + x0 + '" y1="' + (H / 2) + '" x2="' + x1 + '" y2="' + y1.toFixed(1) + '"/>' +
              '<circle cx="' + x1 + '" cy="' + y1.toFixed(1) + '" r="3" fill="var(--accent)"/>';
      }
      g.innerHTML = '<line class="graph-zero" x1="0" y1="' + (H / 2) + '" x2="' + W + '" y2="' + (H / 2) + '"/>' + dot;
      g._xs = xs;
      return;
    }
    var d = graphPts.map(function (p, k) { return (k ? 'L' : 'M') + xs(p.i).toFixed(1) + ' ' + ys(p.v).toFixed(1); }).join(' ');
    var area = d + ' L' + xs(graphPts[graphPts.length - 1].i).toFixed(1) + ' ' + (H / 2) + ' L' + xs(graphPts[0].i).toFixed(1) + ' ' + (H / 2) + ' Z';
    var cursor = '<line class="graph-cursor" x1="' + xs(G.view).toFixed(1) + '" y1="0" x2="' + xs(G.view).toFixed(1) + '" y2="' + H + '"/>';
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
    exitPuzzleChrome();
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
    aiLastProgress = null;
    setAiSearching(true, '<span class="dots"><i></i><i></i><i></i></span>');
    setEngineStatus('AI thinking at level ' + G.level + ' (' + (budget / 1000).toFixed(1) + 's budget)…');
    var t0 = Date.now();
    askAI({ type: 'move', moves: moves, root: root, side: side, level: G.level, timeMs: budget },
      function (p) {
        if (tok !== aiToken) return;
        aiLastProgress = p;
        $('thinkDepth').textContent = 'depth ' + p.depth;
        $('searchProgFill').style.width = (clamp((Date.now() - t0) / budget, 0, 1) * 100).toFixed(0) + '%';
      }
    ).then(function (res) {
      aiPending = false;
      setAiSearching(false);
      if (tok !== aiToken) return;                    // stale AI result: MUST NOT move
      if (!res || res.idx == null) { setEngineStatus('AI found no move.'); return; }
      if (!aiToMove()) return;                        // position changed underneath us
      G.lastAiMs = Date.now() - t0;
      setEngineStatus('AI played ' + nm(res.idx) + ' — depth ' + res.depth + ', ' + (res.nodes || 0).toLocaleString() + ' nodes');
      place(res.idx, side);
    }).catch(function (err) {
      aiPending = false;
      setAiSearching(false);
      if (tok !== aiToken) return;
      if (isCancel(err)) {
        // Stop pressed during AI thinking: use the best move from the deepest
        // COMPLETED iteration, else a fast guaranteed-legal engine move.
        if (!aiToMove()) { setEngineStatus('Search stopped.'); return; }
        var pick = aiLastProgress && aiLastProgress.best != null ? aiLastProgress.best : null;
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
    var hintBudget = S.timeMs === 0 ? 2500 : Math.min(2500, analysisBudget() || 2500);
    ask({ type: 'move', moves: movesUpTo(G.view), root: rootPayload(), side: sideAt(G.view), level: 8, timeMs: hintBudget })
      .then(function (res) {
        if (!res || res.idx == null) return;
        G.hintIdx = res.idx; renderPosition();
        toast('Hint: ' + nm(res.idx));
        setEngineStatus('Hint: ' + nm(res.idx) + ' (depth ' + res.depth + ')');
      }).catch(function (e) { if (!isCancel(e)) setEngineStatus('Hint failed.'); });
  };
  $('stopBtn').onclick = function () {
    if (aiPending) {
      cancelAllSearches('stop');
      toast('AI and search stopped');
    } else {
      cancelAnalysis('stop');
      toast('Search stopped');
    }
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
     PUZZLE BANK
     -----------------------------------------------------------------------
     Three independent sources are merged into one list:

       BUILTIN_PUZZLES      shipped inside the build (puzzles.json)
       CONTRIBUTED_PUZZLES  imported / shared banks (empty until one is loaded)
       GENERATED_PUZZLES    produced locally by the generator, persisted to
                            localStorage under xo5.generatedPuzzles3

     MERGED_PUZZLES is the deduplicated union, builtins first so that the
     index of a bundled puzzle never shifts when the local bank grows.

     Backward compatibility: a bundled puzzle is the old three-field shape
     { moves, key, len }. Everything below treats the extra fields as
     optional and DERIVES what it can — the side to move is a pure function
     of stone parity, because `moves` is replayed alternately starting with
     X. Old puzzle objects therefore keep working untouched.
     ======================================================================= */
  var GEN_BANK_KEY = 'generatedPuzzles3';        // -> localStorage "xo5.generatedPuzzles3"

  var BUILTIN_PUZZLES = [];
  try { BUILTIN_PUZZLES = JSON.parse($('puzzleSrc').textContent || '[]') || []; } catch (e) { BUILTIN_PUZZLES = []; }
  var CONTRIBUTED_PUZZLES = [];
  var GENERATED_PUZZLES = [];
  var MERGED_PUZZLES = [];
  /* PUZZLES is an ALIAS for MERGED_PUZZLES, never a copy: the merged list is
     rebuilt in place so every existing holder of this reference stays live. */
  var PUZZLES = MERGED_PUZZLES;
  var PUZ_STATE = load('puz3', {});

  /* Side to move, derived from parity. Works for old and new puzzle objects. */
  function puzzleSide(p) {
    if (!p || !p.moves) return X;
    if (p.sideToMove === 'O') return O;
    if (p.sideToMove === 'X') return X;
    return p.moves.length % 2 === 0 ? X : O;
  }
  function puzzleSideName(p) { return puzzleSide(p) === X ? 'X' : 'O'; }

  /* Canonical dedupe key — MUST stay identical to genCanonKey() in worker3.js.
     Sorted cell+owner pairs plus the side to move, so the same board with the
     opposite side to move is correctly treated as a DIFFERENT puzzle. */
  function canonKeyOf(p) {
    if (!p || !p.moves) return null;
    var parts = [], i;
    for (i = 0; i < p.moves.length; i++) parts.push(p.moves[i] + (i % 2 === 0 ? 'x' : 'o'));
    parts.sort();
    return parts.join('.') + '#' + puzzleSideName(p);
  }

  /* Rebuild MERGED_PUZZLES in place (identity-preserving). */
  function rebuildMergedPuzzles() {
    var seen = Object.create(null), out = [];
    function add(list) {
      for (var i = 0; i < list.length; i++) {
        var p = list[i]; if (!p || !p.moves) continue;
        var k = canonKeyOf(p);
        if (k && seen[k]) continue;
        if (k) seen[k] = 1;
        out.push(p);
      }
    }
    add(BUILTIN_PUZZLES); add(CONTRIBUTED_PUZZLES); add(GENERATED_PUZZLES);
    MERGED_PUZZLES.length = 0;
    Array.prototype.push.apply(MERGED_PUZZLES, out);
    return MERGED_PUZZLES;
  }

  /* ---------------- generated-bank persistence ---------------- */
  /* persistOk === false means localStorage refused us. Accepted puzzles are
     STILL kept in memory and still playable; the UI says so plainly rather
     than claiming a save that did not happen. */
  var persistOk = true, persistError = null, persistedN = 0;

  function loadGeneratedBank() {
    var raw = load(GEN_BANK_KEY, null);
    if (!Array.isArray(raw)) { persistedN = 0; return []; }
    var out = [], i;
    for (i = 0; i < raw.length; i++) {
      var v = validateGeneratedPuzzle(raw[i]);
      if (v.ok) out.push(v.puzzle);              // a corrupt entry is dropped, never fatal
    }
    persistedN = out.length;
    return out;
  }

  function writeGeneratedBank() {
    var ok = store(GEN_BANK_KEY, GENERATED_PUZZLES);
    if (!ok) {
      persistOk = false;
      persistError = 'Local storage is unavailable or full.';
      return false;
    }
    /* The write succeeded, so the number on disk is exactly what we sent. */
    persistOk = true; persistError = null;
    persistedN = GENERATED_PUZZLES.length;
    return true;
  }

  /* ---------------- validation ----------------
     Structural + legality checks, cheap enough for the main thread.
     The forced-win PROOF comes from the worker's solveForcing() run, but
     where a claim can be re-proved without a search we re-prove it here
     rather than taking the worker's word for it. */
  function validateGeneratedPuzzle(p) {
    if (!p || typeof p !== 'object') return { ok: false, reason: 'not an object' };
    if (!Array.isArray(p.moves) || !p.moves.length) return { ok: false, reason: 'no moves' };
    if (p.moves.length >= LEN) return { ok: false, reason: 'too many stones' };
    if (p.len !== 1 && p.len !== 3) return { ok: false, reason: 'unsupported solution length' };
    if (typeof p.key !== 'number' || p.key < 0 || p.key >= LEN || (p.key | 0) !== p.key) return { ok: false, reason: 'bad key' };

    var b = new Int8Array(LEN), i, idx, player;
    for (i = 0; i < p.moves.length; i++) {
      idx = p.moves[i];
      if (typeof idx !== 'number' || (idx | 0) !== idx || idx < 0 || idx >= LEN) return { ok: false, reason: 'illegal cell' };
      if (b[idx]) return { ok: false, reason: 'overwritten cell' };
      player = i % 2 === 0 ? X : O;
      b[idx] = player;
      if (E.winningLineAt(b, idx, player)) return { ok: false, reason: 'position already won' };
    }
    if (b[p.key]) return { ok: false, reason: 'solution square is occupied' };

    var side = puzzleSide(p);
    var declared = p.moves.length % 2 === 0 ? X : O;
    if (side !== declared) return { ok: false, reason: 'side to move contradicts stone parity' };

    /* Re-prove what can be proved without a search. */
    var st = new E.State();
    for (i = 0; i < p.moves.length; i++) st.play(p.moves[i], i % 2 === 0 ? X : O);
    var opp = side === X ? O : X;
    var proof = 'worker-verified';

    if (p.len === 1) {
      st.play(p.key, side);
      var five = E.winningLineAt(st.board, p.key, side);
      st.undo();
      if (!five) return { ok: false, reason: 'claimed win in 1 does not make five' };
      proof = 'reproved';
    } else if (Array.isArray(p.seq) && p.seq.length === 3 && p.seq[0] === p.key) {
      /* Forced win in 2. The defender's reply is forced exactly when the
         attacker already threatens five after the first move: they must block
         it, and if there are two such squares they cannot block both. */
      st.play(p.seq[0], side);
      var wins = E.winningCells(st, side);
      if (wins.length >= 1 && st.board[p.seq[1]] === 0) {
        st.play(p.seq[1], opp);
        if (!E.winningLineAt(st.board, p.seq[1], opp) && st.board[p.seq[2]] === 0) {
          st.play(p.seq[2], side);
          if (E.winningLineAt(st.board, p.seq[2], side)) {
            /* forced iff the defender could not cover every threat */
            if (wins.length >= 2 || p.seq[1] === wins[0]) proof = 'reproved';
          }
          st.undo();
        }
        st.undo();
      }
      st.undo();
    }

    var norm = {
      moves: p.moves.slice(),
      key: p.key,
      len: p.len,
      sideToMove: side === X ? 'X' : 'O',
      source: p.source || 'generated-local',
      generatedAt: p.generatedAt || new Date().toISOString(),
      elapsedMs: typeof p.elapsedMs === 'number' ? p.elapsedMs : null,
      nodes: typeof p.nodes === 'number' ? p.nodes : null,
      maxPly: typeof p.maxPly === 'number' ? p.maxPly : 3,
      solverVersion: p.solverVersion || 'engine3.solveForcing/1',
      proof: proof
    };
    if (Array.isArray(p.seq)) norm.seq = p.seq.slice();
    norm.canon = canonKeyOf(norm);
    return { ok: true, puzzle: norm };
  }

  /* =======================================================================
     DURABLE SAVE PIPELINE
     -----------------------------------------------------------------------
        worker -> accepted -> validate -> canonical dedupe -> PERSIST NOW
                           -> bank update -> UI update -> keep generating

     This runs once per accepted puzzle and is completely independent of the
     generation-completion event. There is no end-of-session flush, because
     there is nothing left to flush: by the time a session ends, every puzzle
     it produced is already on disk. A crash, a Stop, a timeout or a dead
     Worker therefore cannot cost more than the single candidate in flight.
     ======================================================================= */
  function saveGeneratedPuzzle(p) {
    var v = validateGeneratedPuzzle(p);
    if (!v.ok) return { ok: false, stage: 'invalid', reason: v.reason };

    var key = v.puzzle.canon, i;
    for (i = 0; i < GENERATED_PUZZLES.length; i++) {
      if (canonKeyOf(GENERATED_PUZZLES[i]) === key) return { ok: false, stage: 'duplicate', reason: 'already in the local bank' };
    }
    for (i = 0; i < BUILTIN_PUZZLES.length; i++) {
      if (canonKeyOf(BUILTIN_PUZZLES[i]) === key) return { ok: false, stage: 'duplicate', reason: 'already bundled with the build' };
    }
    for (i = 0; i < CONTRIBUTED_PUZZLES.length; i++) {
      if (canonKeyOf(CONTRIBUTED_PUZZLES[i]) === key) return { ok: false, stage: 'duplicate', reason: 'already contributed' };
    }

    /* In memory FIRST. If the write then fails the puzzle is still accepted,
       still merged, still playable and still exportable — it is only the disk
       copy that is missing, and the UI is told to say exactly that. */
    GENERATED_PUZZLES.push(v.puzzle);
    var persisted = writeGeneratedBank();
    if (!persisted) {
      /* A failed write must never truncate what was already on disk, so the
         previously stored entries are left exactly as they were. */
      rebuildMergedPuzzles();
      return { ok: true, stage: 'accepted', persisted: false, reason: persistError, puzzle: v.puzzle };
    }
    rebuildMergedPuzzles();
    return { ok: true, stage: 'persisted', persisted: true, puzzle: v.puzzle };
  }

  /* How many generated puzzles are genuinely on disk right now. Updated only
     by a write that actually succeeded, so it can never overstate. */
  function persistedCount() { return persistedN; }

  GENERATED_PUZZLES = loadGeneratedBank();
  rebuildMergedPuzzles();

  /* =======================================================================
     GENERATOR CHANNEL
     -----------------------------------------------------------------------
     A THIRD worker, independent of the AI and Analysis pools, so that a long
     generation session never competes with the board for engine time and can
     be terminated on its own without disturbing a game in progress.

     Where no real Worker exists (older browsers, and the headless test
     suite), the very same worker3.js source is executed on the main thread
     against a stand-in `self`. That is not a reimplementation: it is the
     identical generator, driven through the identical message protocol, just
     with shorter slices so the page keeps painting between them.
     ======================================================================= */
  var PG = { worker: null, mode: 'none', inline: false, dead: false };

  function makeInlineGenerator(onMessage) {
    var wrkEl = $('workerSrc'); if (!wrkEl) return null;
    var host = {
      XOEngine: E,
      GEN_SLICE_MS: 12,                       // short slices: this is the UI thread
      postMessage: function (m) { onMessage({ data: m }); }
    };
    try { (new Function('self', wrkEl.textContent))(host); }
    catch (e) { return null; }
    if (typeof host.onmessage !== 'function') return null;
    var dead = false;
    return {
      inline: true,
      postMessage: function (msg) {
        if (dead) return;
        setTimeout(function () { if (!dead) try { host.onmessage({ data: msg }); } catch (e) {} }, 0);
      },
      terminate: function () {
        if (dead) return;
        try { host.onmessage({ data: { type: 'stopGenerate' } }); } catch (e) {}
        dead = true;
      }
    };
  }

  function initGenWorker() {
    if (PG.worker && !PG.dead) return PG.worker;
    PG.dead = false;
    var url = getWorkerBlobUrl();
    if (url) {
      try {
        var w = new Worker(url);
        w.onmessage = onGenMessage;
        w.onerror = function () { onGenWorkerFailure('the generator worker crashed'); };
        PG.worker = w; PG.mode = 'worker'; PG.inline = false;
        return w;
      } catch (e) { /* fall through to the inline generator */ }
    }
    var inline = makeInlineGenerator(onGenMessage);
    if (!inline) { PG.worker = null; PG.mode = 'none'; return null; }
    PG.worker = inline; PG.mode = 'main'; PG.inline = true;
    return inline;
  }

  function killGenWorker() {
    if (PG.worker) { try { PG.worker.terminate(); } catch (e) {} }
    PG.worker = null; PG.mode = 'none'; PG.dead = true;
  }

  function genPost(msg) {
    var w = initGenWorker();
    if (!w) return false;
    try { w.postMessage(msg); return true; }
    catch (e) { return false; }
  }

  /* =======================================================================
     GENERATION SESSION
     -----------------------------------------------------------------------
     GEN_TOKEN is the generation identity. Every session gets a fresh one and
     every inbound worker message is checked against it, so a message that
     was already in flight when Stop was pressed is dropped instead of being
     counted, saved or drawn. Stop increments the token BEFORE it asks the
     worker to stop, which is what makes "late results are ignored" true
     rather than merely likely.
     ======================================================================= */
  var GEN_TOKEN = 0;
  var GS = null;                     // active session, or null

  var GEN_TIME_OPTIONS = [
    { v: 30000, label: '30 sec' },
    { v: 60000, label: '1 min' },
    { v: 300000, label: '5 min' },
    { v: 600000, label: '10 min' },
    { v: 1800000, label: '30 min' },
    { v: 0, label: 'Unlimited' }
  ];
  var GEN_TARGET_OPTIONS = [
    { v: 5, label: '5' }, { v: 10, label: '10' }, { v: 25, label: '25' },
    { v: 50, label: '50' }, { v: 100, label: '100' }, { v: 0, label: 'Unlimited' }
  ];
  var genSettings = load('genSettings3', { durationMs: 60000, target: 10 });
  if (!GEN_TIME_OPTIONS.some(function (o) { return o.v === genSettings.durationMs; })) genSettings.durationMs = 60000;
  if (!GEN_TARGET_OPTIONS.some(function (o) { return o.v === genSettings.target; })) genSettings.target = 10;

  function newSession() {
    return {
      token: ++GEN_TOKEN,
      running: true,
      startedAt: Date.now(),
      durationMs: genSettings.durationMs,      // 0 = unlimited
      target: genSettings.target,              // 0 = unlimited
      attempts: 0, accepted: 0, rejected: 0, duplicates: 0,
      nodes: 0, solverDepth: 0, len: null,
      savedThisSession: 0, sideCount: { X: 0, O: 0 }, lenCount: {},
      phase: 'Ready', reason: null,
      candidateMoves: null, candidateSide: null,
      elapsedMs: 0, endReason: null, ticker: null
    };
  }

  function startGeneration() {
    stopGeneration('restart', true);           // never two sessions at once
    GS = newSession();
    PG.dead = false;
    /* any outstanding stop belongs to a session that is now history */
    stopPending = null;
    var ok = genPost({
      type: 'generatePuzzle',
      id: GS.token,
      seed: (Date.now() ^ (Math.random() * 0x7FFFFFFF)) | 0,
      durationMs: GS.durationMs || null,
      /* The TARGET is enforced here, not in the worker, and deliberately so:
         the target counts puzzles that were accepted AND successfully
         persisted, and only the main thread knows which of the worker's
         acceptances survived validation, deduplication and the disk write.
         Delegating it would let the session stop one or two puzzles short
         whenever a candidate turned out to duplicate the existing bank. */
      targetAccepted: null,
      maxAttempts: 300,
      maxPly: 3,
      nodeCap: 15000,
      candidateTimeMs: 400
    });
    if (!ok) {
      GS.running = false; GS.phase = 'Stopped';
      GS.reason = 'The generator could not be started in this browser.';
      GS.endReason = 'error';
      renderGenerator();
      return false;
    }
    GS.phase = 'Generating position';
    GS.ticker = setInterval(function () {
      if (!GS || !GS.running) return;
      GS.elapsedMs = Date.now() - GS.startedAt;
      renderGenClock();
    }, 200);
    renderGenerator();
    return true;
  }

  /* Outstanding graceful-stop request. Tracked OUTSIDE the generation token,
     because the token is bumped the moment Stop is pressed and would
     otherwise cause us to discard the worker's own acknowledgement and
     terminate a worker that had in fact stopped politely. */
  var stopPending = null;

  function stopGeneration(reason, silent) {
    if (!GS) return;
    var s = GS;
    /* A session that has already finished has nothing to stop. Sending it the
       graceful-stop handshake anyway is actively harmful: the worker has no
       such session left, so it never acknowledges, and the termination
       deadline then fires during whatever session started in the meantime and
       kills a perfectly healthy worker. */
    if (!s.running) {
      if (!s.endReason) s.endReason = reason || 'stopped';
      if (silent) { GS = null; return; }
      renderGenerator();
      return;
    }
    /* 1 & 2: mark cancelled and move the token on BEFORE talking to the
       worker, so anything already in flight is stale by definition. */
    GEN_TOKEN++;
    s.running = false;
    if (s.ticker) { clearInterval(s.ticker); s.ticker = null; }   // 4: timers cancelled
    s.elapsedMs = Date.now() - s.startedAt;
    if (!s.endReason) s.endReason = reason || 'stopped';
    s.phase = s.endReason === 'target' ? 'Completed' : 'Stopped';

    /* 3: ask the worker to stop, then hold it to a deadline. A worker that
       does not acknowledge is terminated outright — a generation that cannot
       be stopped must never be left running invisibly. It is recreated
       lazily by initGenWorker() the next time one is needed. */
    var asked = genPost({ type: 'stopGenerate', id: s.token });
    if (asked) {
      stopPending = { token: s.token };
      setTimeout(function () {
        if (stopPending && stopPending.token === s.token) { stopPending = null; killGenWorker(); }
      }, 1200);
    } else {
      killGenWorker();
    }
    if (silent) { GS = null; return; }
    renderGenerator();
  }

  function onGenWorkerFailure(msg) {
    killGenWorker();
    /* 7 & 33: everything already persisted stays persisted. A dead worker
       ends the session, it does not roll anything back. */
    if (GS) {
      GEN_TOKEN++;
      GS.running = false;
      if (GS.ticker) { clearInterval(GS.ticker); GS.ticker = null; }
      GS.phase = 'Stopped';
      GS.endReason = 'worker-error';
      GS.reason = msg;
      renderGenerator();
    }
    showError(msg + ' — puzzles already saved are safe.');
  }

  function onGenMessage(e) {
    var d = (e && e.data) || {};
    /* A graceful stop was acknowledged: the worker is alive and idle, so it
       is kept rather than terminated. Checked before the token test because
       Stop has already invalidated the token by this point. */
    if (d.kind === 'generated-done' && stopPending && d.id === stopPending.token) stopPending = null;

    /* 5: a message from a cancelled generation is dropped outright.
       Two conditions, and BOTH are needed. The first says the message belongs
       to this session; the second says this session is still the live one.
       A session's own token never changes, so testing only the first would
       happily accept results that arrived after Stop — which is exactly the
       bug this guard exists to prevent. Stop bumps GEN_TOKEN, so from that
       instant GS.token !== GEN_TOKEN and everything still in flight is
       dropped, counted nowhere and saved nowhere. */
    if (!GS || d.id !== GS.token || GS.token !== GEN_TOKEN) return;
    if (d.kind === 'error') { onGenWorkerFailure(d.message || 'generator error'); return; }

    var pr = d.progress || {};
    GS.attempts = pr.attempts || 0;
    GS.rejected = pr.rejected || 0;
    GS.duplicates = (pr.duplicates || 0) + (GS.localDupes || 0);
    GS.nodes = pr.nodes || 0;
    GS.solverDepth = pr.solverDepth || 0;
    GS.len = pr.len == null ? null : pr.len;
    GS.elapsedMs = pr.elapsedMs || (Date.now() - GS.startedAt);
    if (pr.phase) GS.phase = pr.phase;
    if (pr.reason !== undefined) GS.reason = pr.reason;
    if (pr.moves) { GS.candidateMoves = pr.moves; GS.candidateSide = pr.side; }

    if (d.kind === 'accepted') {
      /* 6 (§6): persist RIGHT NOW, before anything else happens. */
      var res = saveGeneratedPuzzle(d.puzzle);
      if (res.ok) {
        GS.accepted++;
        GS.savedThisSession++;
        var sn = res.puzzle.sideToMove;
        GS.sideCount[sn] = (GS.sideCount[sn] || 0) + 1;
        GS.lenCount[res.puzzle.len] = (GS.lenCount[res.puzzle.len] || 0) + 1;
        GS.phase = 'Accepted';
        GS.reason = (res.persisted ? 'Accepted — ' : 'Accepted (not saved) — ') +
          (res.puzzle.len === 1 ? 'Forced win in 1' : 'Forced win in 2') + ' for ' + sn;
        GS.lastAccepted = res.puzzle;
        renderPuzzles();
        /* Target reached — counted in persisted puzzles, not in worker
           acceptances. Render the accepted state first so the last puzzle is
           visibly credited before the session closes. */
        if (GS.target && GS.accepted >= GS.target) {
          renderGenerator();
          stopGeneration('target');
          return;
        }
      } else if (res.stage === 'duplicate') {
        GS.localDupes = (GS.localDupes || 0) + 1;
        GS.duplicates = (pr.duplicates || 0) + GS.localDupes;
        GS.phase = 'Rejected';
        GS.reason = 'Rejected — duplicate';
      } else {
        GS.rejected++;
        GS.phase = 'Rejected';
        GS.reason = 'Rejected — ' + (res.reason || 'invalid puzzle');
      }
      renderGenerator();
      return;
    }

    if (d.kind === 'generated-done') {
      GEN_TOKEN++;                                  // no further message is ours
      GS.running = false;
      if (GS.ticker) { clearInterval(GS.ticker); GS.ticker = null; }
      GS.endReason = d.reason;
      GS.phase = d.reason === 'stopped' ? 'Stopped' : 'Completed';
      renderGenerator();
      renderPuzzles();
      return;
    }

    renderGenerator();
  }

  function todayIndex() {
    var d = new Date();
    var seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return PUZZLES.length ? seed % PUZZLES.length : 0;
  }
  /* TWO `len` CONVENTIONS LIVE IN THE BANK, and they are not the same.
     Generated puzzles store the length of the sequence solveForcing() actually
     returned, which alternates attacker/defender: 1 means the first move makes
     five, 3 means a forced win in two attacker moves.
     The bundled puzzles predate that encoding. Re-solving all ten with the
     current engine gives a sequence exactly two plies longer than the stored
     value in every case (1->3, 3->5, 5->7), so their `len` is translated
     rather than trusted. Without this, puzzle 1 would keep being advertised as
     a "forced win in 1" when the engine proves it is a win in 2 — which is
     what the old label claimed, and it was wrong. */
  function puzzleSeqLen(p) {
    if (!p) return 1;
    if (p.seq && p.seq.length) return p.seq.length;          // verified sequence wins
    if (p.source === 'generated-local') return p.len || 1;
    return (p.len || 1) + 2;                                  // legacy bundled encoding
  }
  function puzzleWinIn(p) { return Math.ceil(puzzleSeqLen(p) / 2); }
  /* G.puzzle.len is ALREADY a true sequence length (startPuzzle translates it
     once, on the way in), so the active puzzle must not be translated again. */
  function activeWinIn(p) { return Math.ceil(((p.seq && p.seq.length) ? p.seq.length : p.len) / 2); }
  function puzzleLabel(p) { return 'Forced win in ' + puzzleWinIn(p); }
  function renderPuzzles() {
    var g = $('puzGrid'); if (!g) return;
    renderGenBankLine();
    if (!PUZZLES.length) { g.innerHTML = '<p class="empty-note">No puzzles bundled with this build.</p>'; return; }
    g.innerHTML = PUZZLES.map(function (p, i) {
      var solved = PUZ_STATE[i] === 'solved';
      var side = puzzleSideName(p);
      var gen = p.source === 'generated-local';
      return '<button class="puz" data-puz="' + i + '"><h4>Puzzle ' + (i + 1) + '</h4>' +
        '<p>' + side + ' to move · ' + puzzleLabel(p) + '</p>' +
        '<span class="tag ' + side.toLowerCase() + '">' + side + '</span>' +
        (gen ? ' <span class="tag gen">Generated</span>' : '') +
        (solved ? '<br><span class="solved">✓ Solved</span>'
                : '<br><span style="font-size:11px;color:var(--text-3)">Unsolved</span>') + '</button>';
    }).join('');
    var solvedN = Object.keys(PUZ_STATE).filter(function (k) { return PUZ_STATE[k] === 'solved'; }).length;
    $('puzProgress').textContent = solvedN + ' / ' + PUZZLES.length;
    var t = todayIndex();
    $('dailyInfo').textContent = PUZZLES.length
      ? 'Today\'s puzzle is #' + (t + 1) + ' — ' + puzzleSideName(PUZZLES[t]) +
        ' to move with a verified forced win in ' + puzzleWinIn(PUZZLES[t]) + '.'
      : 'No puzzles available in this build.';
    $('dailyStart').disabled = !PUZZLES.length;
  }
  $('puzGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-puz]'); if (b) startPuzzle(+b.dataset.puz);
  });
  $('dailyStart').onclick = function () { startPuzzle(todayIndex(), true); };

  /* =======================================================================
     PUZZLE PLAY MODE
     -----------------------------------------------------------------------
     A puzzle is a position plus an objective, and nothing else is on screen.
     While a puzzle is active the body carries `puzzle-mode`, which removes
     every analysis surface: eval bar and number, evaluation graph, best-move
     arrow, candidate list, threat map, heatmap, move quality, explanation,
     principal variation, engine details, search progress and the whole
     secondary control row (Hint, Deep Analyze, Compare Moves, …). The engine
     still runs — it is what checks the player's move — but it reports only
     "that forces a win" or "that does not". Nothing it knows leaks out.

     Both X and O puzzles are supported. The objective text, the ghost stone,
     the verification side and the solution replay all read the side from the
     puzzle rather than assuming X.
     ======================================================================= */
  var puzTimerHandle = null;

  function puzzleActive() { return !!(G && G.puzzle && G.puzzle.active); }
  function puzzleOpen() { return !!(G && G.puzzle); }

  function startPuzzle(i, daily) {
    var p = PUZZLES[i]; if (!p) return;
    var side = puzzleSide(p);
    goRoute('play', true);
    startGame('analysis', { moves: p.moves.slice() });
    G.puzzle = {
      i: i, active: true, tries: 0, daily: !!daily,
      key: p.key, len: puzzleSeqLen(p), side: side,
      seq: Array.isArray(p.seq) ? p.seq.slice() : null,
      source: p.source || 'builtin',
      startedAt: Date.now(), solved: false,
      solutionShown: false, replaying: false, status: '', statusKind: ''
    };
    /* Not analysis mode: a puzzle is a puzzle, and analysisMode would turn the
       secondary panels back on. */
    G.analysisMode = false;
    G.hintIdx = null;
    /* a fresh puzzle (including Reset) always starts with the solution hidden */
    var solBox = $('puzHudSolution');
    if (solBox) { solBox.hidden = true; solBox.innerHTML = ''; }
    enterPuzzleChrome();
    refreshAll();
    renderPuzzleHud();
    toast('Puzzle ' + (i + 1) + ': ' + sName(side) + ' to move — find the forced win');
    setEngineStatus('Puzzle mode — analysis is hidden; the engine only checks your move.');
  }

  function enterPuzzleChrome() {
    document.body.classList.add('puzzle-mode');
    $('puzHud').hidden = false;
    /* Cancel anything the analysis engine had in flight and make sure no
       stale result can be applied to the puzzle position. */
    analysisToken++; explainToken++; threatToken++;
    cancelAnalysis('puzzle-mode');
    setSearching(false);
    current = null;
    threats = [];
    showEngineInfo(null);
    if (puzTimerHandle) clearInterval(puzTimerHandle);
    puzTimerHandle = setInterval(function () {
      if (!puzzleOpen()) { clearInterval(puzTimerHandle); puzTimerHandle = null; return; }
      var el = $('puzHudTimer');
      if (el && G.puzzle.active) el.textContent = fmtClock(Date.now() - G.puzzle.startedAt);
    }, 500);
  }

  function exitPuzzleChrome() {
    document.body.classList.remove('puzzle-mode');
    var hud = $('puzHud'); if (hud) hud.hidden = true;
    if (puzTimerHandle) { clearInterval(puzTimerHandle); puzTimerHandle = null; }
  }

  function exitPuzzle() {
    if (!puzzleOpen()) return;
    G.puzzle = null;
    exitPuzzleChrome();
    goRoute('puzzles');
    refreshAll();
    scheduleAnalysis();
    setEngineStatus('Ready');
  }

  function resetPuzzle() {
    if (!puzzleOpen()) return;
    var i = G.puzzle.i, daily = G.puzzle.daily;
    startPuzzle(i, daily);
    toast('Puzzle reset');
  }

  function renderPuzzleHud() {
    if (!puzzleOpen() || !$('puzHud')) return;
    var p = G.puzzle, side = sName(p.side);
    $('puzHudTitle').textContent = (p.daily ? 'Daily Challenge — ' : '') + 'Puzzle ' + (p.i + 1);
    /* The LENGTH of the win is itself a hint, so it is withheld until the
       puzzle is solved or the solution is explicitly requested. */
    $('puzHudKind').textContent = (p.solutionShown || p.solved)
      ? 'Forced win in ' + activeWinIn(p)
      : 'Forced win';
    $('puzHudObj').innerHTML = 'Find the forced win for <b class="' + side.toLowerCase() + '">' + side + '</b>.';
    $('puzHudTries').textContent = String(p.tries);
    $('puzHudTimer').textContent = fmtClock((p.solved ? p.solvedAt : Date.now()) - p.startedAt);
    $('puzHudSource').textContent = p.source === 'generated-local' ? 'Generated on this device' : '';
    var st = $('puzHudStatus');
    st.textContent = p.status || '';
    st.className = 'st' + (p.statusKind ? ' ' + p.statusKind : '');
    $('puzShowSol').disabled = !!p.replaying;
    $('puzReplaySol').hidden = !p.solutionShown;
    $('puzReplaySol').disabled = !!p.replaying;
  }

  /* ---- user moves ------------------------------------------------------

     Verifying the player's move needs care, because solveForcing(state, side)
     always assumes `side` is the one to move. Handing it the position AFTER
     the player has already moved and asking "can side force a win?" quietly
     grants the player a second move in a row — under which essentially every
     square looks winning, since the original threat is still standing. The
     check below instead reasons about the position with the OPPONENT to move,
     using only facts the engine can establish:

       immediate five                -> win, no search needed
       two or more five-threats      -> win: the opponent can block at most one
       exactly one five-threat       -> the opponent's block is FORCED, so play
                                        it and hand the solver a position where
                                        `side` really is to move
       no five-threat (a quiet move) -> not provable this way; accepted only if
                                        it is the puzzle's own solver-verified
                                        first move

     The last branch is sound but not complete: a quiet winning move that is
     not the stored one is rejected. That costs nothing for the puzzles this
     build produces — every generated solution is an immediate five or a
     threat-carrying move, so the intended answer always lands in one of the
     first three branches — and it is the conservative direction to be wrong in.
     ---------------------------------------------------------------------- */
  function puzzleStateAfter(i, side) {
    var s = new E.State(), k;
    if (G.root) for (k = 0; k < LEN; k++) if (G.root[k]) s.play(k, G.root[k]);
    movesUpTo(G.view).forEach(function (m) { s.play(m[0], m[1]); });
    s.play(i, side);
    return s;
  }

  function puzzleGuess(i) {
    var p = G.puzzle;
    if (!p || !p.active || p.replaying) return;
    var b = boardAt(G.view);
    if (b[i]) return;
    var side = p.side, opp = other(side);
    p.tries++;
    STATS.puzzleTries++;
    p.status = 'Checking\u2026'; p.statusKind = '';
    renderPuzzleHud();
    setEngineStatus('Checking your move\u2026');

    function wrong() {
      if (!puzzleActive()) return;
      SND.err();
      /* 26: clear and restrained, and it does NOT give the answer away. */
      p.status = nm(i) + ' does not force a win. Try another square.';
      p.statusKind = 'bad';
      renderPuzzleHud();
      setEngineStatus('Puzzle mode \u2014 that move does not force a win.');
      flash(i);
    }

    var s = puzzleStateAfter(i, side);

    if (E.winningLineAt(s.board, i, side)) { puzzleSolved(i); return; }

    var wins = E.winningCells(s, side);
    if (wins.length >= 2) { puzzleSolved(i); return; }      // unstoppable double threat

    if (wins.length === 1) {
      var blk = wins[0];
      s.play(blk, opp);
      if (E.winningLineAt(s.board, blk, opp)) { wrong(); return; }   // the block wins for them
      var tok = ++analysisToken;
      var moves = movesUpTo(G.view).concat([[i, side], [blk, opp]]);
      ask({ type: 'forcing', moves: moves, root: rootPayload(), side: side, maxPly: 8, timeMs: 3000 })
        .then(function (r) {
          if (tok !== analysisToken || !puzzleActive()) return;
          if (r && r.win && !r.aborted) puzzleSolved(i); else wrong();
        })
        .catch(function (e) {
          if (tok !== analysisToken || !puzzleActive()) return;
          if (isCancel(e)) return;
          p.status = 'Could not check that move \u2014 try again.';
          p.statusKind = 'bad';
          renderPuzzleHud();
        });
      return;
    }

    /* Quiet move: no immediate threat to hang a proof on. */
    if (i === p.key) { puzzleSolved(i); return; }
    wrong();
  }

  function puzzleSolved(i) {
    var p = G.puzzle;
    p.active = false;
    p.solved = true;
    p.solvedAt = Date.now();
    if (PUZ_STATE[p.i] !== 'solved') {
      PUZ_STATE[p.i] = 'solved'; store('puz3', PUZ_STATE);
      STATS.puzzlesSolved++; store('stats3', STATS);
    }
    SND.win();
    place(i, p.side);
    p.status = 'Solved \u2014 ' + nm(i) + ' forces the win in ' + activeWinIn(p) + '. Solved in ' + p.tries +
      ' attempt' + (p.tries === 1 ? '' : 's') + '.';
    p.statusKind = 'good';
    renderPuzzleHud();
    toast('Solved in ' + p.tries + ' attempt' + (p.tries === 1 ? '' : 's') + '!');
    setEngineStatus('Puzzle solved.');
    checkAchievements(null);
    renderPuzzles();
  }

  /* ---- show solution / replay ------------------------------------------
     The solution stays hidden until it is explicitly asked for. It then works
     whether or not the player solved the puzzle, and the animation shows the
     verified sequence and nothing else — no evaluation, no alternatives. */
  function puzzleSolutionSeq() {
    var p = G.puzzle;
    if (p.seq && p.seq.length) return p.seq.slice();
    return [p.key];                        // old puzzle objects store only the first move
  }

  function showPuzzleSolution() {
    if (!puzzleOpen()) return;
    var p = G.puzzle;
    /* Bundled puzzles store only the first move, so the rest of the line is
       resolved from the solver on demand. Doing it here rather than at load
       time keeps it off the boot path and out of the player's way until they
       have actually asked to see the answer. */
    if (!p.seq || !p.seq.length) {
      p.status = 'Working out the line\u2026'; p.statusKind = '';
      renderPuzzleHud();
      var tok = ++analysisToken, pz = p;
      ask({ type: 'forcing', moves: movesUpTo(G.view), root: rootPayload(),
            side: p.side, maxPly: 10, timeMs: 3000 })
        .then(function (r) {
          if (tok !== analysisToken || G.puzzle !== pz) return;
          if (r && r.win && r.seq && r.seq.length) pz.seq = r.seq.slice();
          revealPuzzleSolution();
        })
        .catch(function (e) { if (!isCancel(e) && G.puzzle === pz) revealPuzzleSolution(); });
      return;
    }
    revealPuzzleSolution();
  }

  function revealPuzzleSolution() {
    if (!puzzleOpen()) return;
    var p = G.puzzle;
    p.solutionShown = true;
    p.active = false;
    var seq = puzzleSolutionSeq(), side = sName(p.side), opp = sName(other(p.side));
    var box = $('puzHudSolution');
    var text = '<b>Forced win in ' + activeWinIn(p) + ' for ' + side + '.</b> ';
    if (seq.length === 1) {
      text += side + ' plays <b>' + nm(seq[0]) + '</b>, completing five in a row.';
    } else if (seq.length === 3) {
      text += side + ' plays <b>' + nm(seq[0]) + '</b>, creating a threat ' + opp +
        ' cannot cover. After ' + opp + ' ' + nm(seq[1]) + ', ' + side + ' finishes with <b>' +
        nm(seq[2]) + '</b>.';
    } else if (seq.length > 3) {
      var line = [];
      for (var k = 0; k < seq.length; k++) line.push((k % 2 === 0 ? side : opp) + ' ' + nm(seq[k]));
      text += 'The forcing line is <b>' + line.join(' &middot; ') + '</b>; every reply in between is forced.';
    } else {
      text += side + ' starts with <b>' + nm(seq[0]) + '</b>; the threats that follow cannot all be answered.';
    }
    box.innerHTML = text;
    box.hidden = false;
    p.status = 'Solution shown.';
    p.statusKind = '';
    renderPuzzleHud();
    setEngineStatus('Solution shown.');
    replayPuzzleSolution();
  }

  function replayPuzzleSolution() {
    if (!puzzleOpen()) return;
    var p = G.puzzle;
    if (p.replaying) return;
    var seq = puzzleSolutionSeq();

    /* Always replay from the puzzle position itself, discarding whatever the
       player tried, so the animation shows the verified line and only that. */
    var base = PUZZLES[p.i];
    G.main.length = 0;
    base.moves.forEach(function (idx, k) {
      G.main.push({ idx: idx, player: sideAt(k), evalAfter: null, quality: null });
    });
    G.variation = null; G.redo.length = 0;
    G.view = G.main.length;
    G.status = 'playing'; G.winner = null; G.winCells = null;
    invalidateBoard(); refreshAll();

    p.replaying = true;
    renderPuzzleHud();
    var step = 0, side = p.side;
    var delay = reduceMotion ? 0 : 620;

    function playNext() {
      if (!puzzleOpen() || G.puzzle !== p) return;               // puzzle left mid-replay
      if (step >= seq.length) {
        p.replaying = false;
        highlightSolutionFirstMove(seq[0]);
        renderPuzzleHud();
        return;
      }
      var idx = seq[step];
      var player = (step % 2 === 0) ? side : other(side);
      if (!boardAt(G.view)[idx]) place(idx, player);
      step++;
      if (delay) setTimeout(playNext, delay); else playNext();
    }
    /* Reduced motion: lay the whole line down at once, no timed animation.
       The information is identical — only the choreography is dropped. */
    playNext();
  }

  function highlightSolutionFirstMove(idx) {
    if (cellEls[idx]) {
      cellEls[idx].classList.add('hint');
      /* `hint` is normally an analysis class; here it marks the solution the
         player explicitly asked to see, which is not leaked information. */
    }
  }

  if ($('puzShowSol')) $('puzShowSol').onclick = function () { SND.click(); showPuzzleSolution(); };
  if ($('puzReplaySol')) $('puzReplaySol').onclick = function () { SND.click(); replayPuzzleSolution(); };
  if ($('puzResetBtn')) $('puzResetBtn').onclick = function () { SND.click(); resetPuzzle(); };
  if ($('puzExitBtn')) $('puzExitBtn').onclick = function () { SND.click(); exitPuzzle(); };

  /* =======================================================================
     GENERATOR UI
     ======================================================================= */
  var reduceMotion = false;
  try { reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

  function fmtClock(ms) {
    var s = Math.max(0, Math.floor((ms || 0) / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function fmtNum(n) { return (n || 0).toLocaleString(); }

  /* ---- live candidate mini-board ---------------------------------------
     Draws the ACTUAL candidate the worker last reported. There is no
     decorative placeholder here: with no candidate in hand the board is
     drawn empty and dimmed rather than showing stones that mean nothing. */
  var genShownSig = '';
  function renderGenBoard(moves, solution) {
    var g = $('genBoardG'); if (!g) return;
    var wrap = $('genBoard');
    var movesSig = moves ? moves.join(',') : '';
    var sig = movesSig + '|' + (solution == null ? '' : solution);
    if (sig === genShownSig) return;
    var prevMoves = genShownSig.split('|')[0];
    var prevLen = prevMoves ? prevMoves.split(',').length : 0;
    /* only animate stones that are genuinely NEW on top of what is shown */
    var isGrowth = !!moves && moves.length >= prevLen && prevMoves === moves.slice(0, prevLen).join(',');
    genShownSig = sig;

    var s = '', i;
    /* XO preview: lines are cell boundaries, pieces sit at cell centres.
       This deliberately differs from Gomoku's intersection-based board. */
    for (i = 0; i <= SIZE; i++) {
      s += '<line class="gl" x1="' + i + '" y1="0" x2="' + i + '" y2="' + SIZE + '"/>';
      s += '<line class="gl" x1="0" y1="' + i + '" x2="' + SIZE + '" y2="' + i + '"/>';
    }
    if (moves && moves.length) {
      for (i = 0; i < moves.length; i++) {
        var idx = moves[i], cx = (idx % SIZE) + .5, cy = ((idx / SIZE) | 0) + .5;
        var fresh = (!reduceMotion && isGrowth && i >= prevLen) ? ' fresh' : '';
        if (i % 2 === 0) {
          s += '<g class="gx' + fresh + '"><line x1="' + (cx - .28) + '" y1="' + (cy - .28) + '" x2="' + (cx + .28) + '" y2="' + (cy + .28) + '"/>' +
            '<line x1="' + (cx + .28) + '" y1="' + (cy - .28) + '" x2="' + (cx - .28) + '" y2="' + (cy + .28) + '"/></g>';
        } else {
          s += '<circle class="go' + fresh + '" cx="' + cx + '" cy="' + cy + '" r="0.3"/>';
        }
      }
    }
    if (solution != null) {
      s += '<circle class="sol" cx="' + ((solution % SIZE) + .5) + '" cy="' + (((solution / SIZE) | 0) + .5) + '" r="0.42"/>';
    }
    g.innerHTML = s;
    if (wrap) wrap.classList.toggle('idle', !(moves && moves.length));
  }

  var PHASE_CLASS = {
    'Ready': '', 'Generating position': 'run', 'Verifying forced win': 'run',
    'Accepted': 'acc', 'Rejected': 'rej', 'Stopped': '', 'Completed': 'acc'
  };

  function setStat(id, text) {
    var el = $(id); if (!el) return;
    if (el.textContent === text) return;
    el.textContent = text;
    if (reduceMotion) return;
    el.classList.remove('tick');
    void el.offsetWidth;                       // restart the animation
    el.classList.add('tick');
  }

  function renderGenClock() {
    if (!GS) return;
    setStat('genElapsed', fmtClock(GS.elapsedMs));
  }

  var genSavedShown = -1;
  function renderGenerator() {
    if (!$('genOverlay')) return;
    var running = !!(GS && GS.running);
    $('genOverlay').classList.toggle('is-running', running);
    var live = $('genLive');
    if (live) live.querySelector('b').textContent = running ? 'Worker active' : (GS && GS.accepted ? 'Session complete' : 'Worker ready');

    /* settings are locked while a session is in flight */
    [].forEach.call($('genTimeSeg').querySelectorAll('button'), function (b) { b.disabled = running; });
    [].forEach.call($('genTargetSeg').querySelectorAll('button'), function (b) { b.disabled = running; });
    press('genTimeSeg', String(genSettings.durationMs));
    press('genTargetSeg', String(genSettings.target));

    var startBtn = $('genStartBtn'), stopBtn = $('genStopBtn');
    startBtn.hidden = running;
    stopBtn.hidden = !running;
    startBtn.textContent = (GS && !GS.running) ? 'Resume' : 'Start';

    var phase = GS ? GS.phase : 'Ready';
    $('genPhaseText').textContent = phase;
    $('genPhase').className = 'gen-phase ' +
      ((GS && (GS.endReason === 'worker-error' || GS.endReason === 'error')) ? 'err' : (PHASE_CLASS[phase] || ''));
    var steps = $('genSteps');
    if (steps) {
      var step = phase === 'Accepted' || phase === 'Completed' ? 3 : phase === 'Verifying forced win' || phase === 'Rejected' ? 2 : phase === 'Generating position' ? 1 : 0;
      [].forEach.call(steps.children, function (el, i) {
        el.classList.toggle('active', i === step - 1);
        el.classList.toggle('done', i < step - 1);
      });
    }

    setStat('genAttempts', fmtNum(GS ? GS.attempts : 0));
    setStat('genAccepted', fmtNum(GS ? GS.accepted : 0));
    setStat('genRejected', fmtNum(GS ? GS.rejected : 0));
    setStat('genDuplicates', fmtNum(GS ? GS.duplicates : 0));
    setStat('genElapsed', fmtClock(GS ? GS.elapsedMs : 0));
    setStat('genNodes', fmtNum(GS ? GS.nodes : 0));
    setStat('genDepth', String(GS ? GS.solverDepth : 0));
    setStat('genSeqLen', (GS && GS.len != null) ? String(GS.len) : '—');

    var reason = GS ? GS.reason : null;
    if (!GS) reason = 'Choose a time and a target, then press Start.';
    else if (!GS.running) {
      var tail = {
        target: 'Target reached.', timeout: 'Session time limit reached.',
        stopped: 'Stopped.',
        exhausted: 'No candidate passed verification for a long stretch — stopped.',
        'worker-error': GS.reason || 'The generator stopped unexpectedly.',
        error: GS.reason || 'The generator could not start.'
      }[GS.endReason] || 'Stopped.';
      reason = tail + ' ' + GS.accepted + ' puzzle' + (GS.accepted === 1 ? '' : 's') + ' from ' +
        GS.attempts + ' attempt' + (GS.attempts === 1 ? '' : 's') + '.';
    }
    $('genReason').textContent = reason || '';

    renderGenBoard(GS ? GS.candidateMoves : null,
      (GS && GS.phase === 'Accepted' && GS.lastAccepted) ? GS.lastAccepted.key : null);

    /* Persistence status. "Accepted" and "saved locally" are reported as the
       separate facts they are: if the disk write failed, this says so. */
    var saved = persistedCount(), box = $('genSaved'), txt = $('genSavedText');
    var held = GENERATED_PUZZLES.length;
    box.className = 'gen-saved' + (!persistOk ? ' warn' : (saved ? '' : ' none'));
    if (!persistOk) {
      txt.textContent = held + ' accepted, ' + saved + ' saved locally';
      $('genNote').hidden = false;
      $('genNote').textContent = (persistError || 'Local storage is unavailable.') +
        ' Accepted puzzles stay in memory for this session and can still be played and exported, but they will not survive a reload.';
    } else {
      txt.textContent = saved ? '\u2713 ' + saved + ' puzzle' + (saved === 1 ? '' : 's') + ' saved locally'
        : 'No puzzles saved yet';
      $('genNote').hidden = true;
    }
    if (!reduceMotion && genSavedShown >= 0 && saved > genSavedShown) {
      box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump');
    }
    genSavedShown = saved;

    renderGenBankLine();
  }

  function renderGenBankLine() {
    var el = $('genBankLine'); if (!el) return;
    var n = GENERATED_PUZZLES.length, saved = persistedCount();
    var xN = 0, oN = 0, l1 = 0, l3 = 0, i;
    for (i = 0; i < n; i++) {
      if (GENERATED_PUZZLES[i].sideToMove === 'O') oN++; else xN++;
      if (GENERATED_PUZZLES[i].len === 1) l1++; else l3++;
    }
    el.textContent = !n ? 'No generated puzzles yet.'
      : n + ' generated puzzle' + (n === 1 ? '' : 's') + ' in the local bank — ' +
        xN + ' for X, ' + oN + ' for O · ' + l1 + ' forced win in 1, ' + l3 + ' forced win in 2' +
        (saved === n ? '' : ' · only ' + saved + ' saved to disk');
    var cl = $('genClearBtn'); if (cl) cl.disabled = !n;
  }

  /* ---- modal control ---------------------------------------------------- */
  function openGenerator() {
    if (!GS) { genShownSig = ''; genSavedShown = -1; }
    renderGenerator();
    openModal('genOverlay');
  }
  function closeGenerator(force) {
    /* 29: never silently destroy a running generation. */
    if (GS && GS.running && !force) {
      confirmDialog('Stop generating and close? Every puzzle already saved stays in your bank.',
        'Generation is running')
        .then(function (yes) {
          if (!yes) return;
          stopGeneration('stopped');
          closeModal('genOverlay');
        });
      return;
    }
    closeModal('genOverlay');
  }

  if ($('genOpenBtn')) $('genOpenBtn').onclick = function () { SND.click(); openGenerator(); };
  if ($('genCloseBtn')) $('genCloseBtn').onclick = function () { closeGenerator(); };
  if ($('genCloseX')) $('genCloseX').onclick = function () { closeGenerator(); };
  if ($('genStartBtn')) $('genStartBtn').onclick = function () {
    /* 19: Resume always starts a FRESH session against the existing bank. It
       never reuses worker state from the previous one. */
    GS = null;
    startGeneration();
  };
  if ($('genStopBtn')) $('genStopBtn').onclick = function () { stopGeneration('stopped'); };
  if ($('genTimeSeg')) $('genTimeSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    genSettings.durationMs = +b.dataset.v; store('genSettings3', genSettings); renderGenerator();
  };
  if ($('genTargetSeg')) $('genTargetSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    genSettings.target = +b.dataset.v; store('genSettings3', genSettings); renderGenerator();
  };

  /* =======================================================================
     EXPORT
     -----------------------------------------------------------------------
     Exports the locally generated bank and nothing else: no worker internals,
     no session bookkeeping, no bundled puzzles. Works with zero puzzles, works
     mid-session, works after Stop — it reads the bank, which is always current
     precisely because every accepted puzzle was written to it immediately.
     ======================================================================= */
  function exportGeneratedJSON() {
    var out = GENERATED_PUZZLES.map(function (p) {
      var o = {
        moves: p.moves.slice(), key: p.key, len: p.len,
        sideToMove: p.sideToMove, source: p.source,
        generatedAt: p.generatedAt, elapsedMs: p.elapsedMs, nodes: p.nodes,
        maxPly: p.maxPly, solverVersion: p.solverVersion
      };
      if (p.seq) o.seq = p.seq.slice();
      return o;
    });
    return JSON.stringify(out, null, 2);
  }
  function doExport() {
    var n = GENERATED_PUZZLES.length;
    showIO('Generated puzzles',
      n ? n + ' generated puzzle' + (n === 1 ? '' : 's') + '. Copy this JSON to keep or share them.'
        : 'No puzzles have been generated yet — this is an empty but valid JSON array.',
      exportGeneratedJSON(), 'Copy');
  }
  if ($('genExportBtn')) $('genExportBtn').onclick = function () { doExport(); };
  if ($('genExportBtn2')) $('genExportBtn2').onclick = function () { closeModal('genOverlay'); doExport(); };
  if ($('genClearBtn')) $('genClearBtn').onclick = function () {
    if (!GENERATED_PUZZLES.length) return;
    confirmDialog('Delete all ' + GENERATED_PUZZLES.length +
      ' locally generated puzzles? Bundled puzzles are not affected.', 'Clear generated puzzles')
      .then(function (yes) {
        if (!yes) return;
        GENERATED_PUZZLES.length = 0;
        writeGeneratedBank();
        rebuildMergedPuzzles();
        renderPuzzles(); renderGenerator();
        toast('Generated puzzles cleared');
      });
  };

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
  function closeAll() { ['settingsOverlay', 'confirmOverlay', 'endOverlay', 'ioOverlay', 'editOverlay', 'cmpOverlay', 'aboutOverlay', 'genOverlay'].forEach(closeModal); }
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
  var aboutBtnEl = $('aboutBtn');
  if (aboutBtnEl) aboutBtnEl.onclick = function () { openModal('aboutOverlay'); };
  var footAboutEl = $('footAboutBtn');
  if (footAboutEl) footAboutEl.onclick = function () { openModal('aboutOverlay'); };
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
    sw('swSound', S.sound);
    sw('swAnalysisEngine', S.analysisEngine);
    sw('swAuto', S.auto, !S.analysisEngine); sw('swEval', S.evalBar, !S.analysisEngine); sw('swBest', S.bestMove, !S.analysisEngine);
    sw('swCand', S.candidates, !S.analysisEngine); sw('swThreat', S.threatMap, !S.analysisEngine); sw('swHeat', S.heatmap, !S.analysisEngine);
    sw('swQuality', S.quality, !S.analysisEngine); sw('swExplain', S.explain, !S.analysisEngine); sw('swCache', S.cache, !S.analysisEngine);
    sw('swCoords', S.coords); sw('swGraph', S.graph, !S.analysisEngine); sw('swDetails', S.details, !S.analysisEngine);
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
  function sw(id, on, disabled) {
    var el = $(id); if (!el) return;
    el.setAttribute('aria-checked', String(!!on));
    el.disabled = !!disabled;
  }

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
  var analysisKeys = ['auto', 'evalBar', 'bestMove', 'candidates', 'threatMap', 'heatmap', 'quality', 'explain', 'cache', 'graph', 'details'];
  var analysisBackup = null;
  $('swAnalysisEngine').onclick = function () {
    S.analysisEngine = !S.analysisEngine;
    if (!S.analysisEngine) {
      analysisBackup = {};
      analysisKeys.forEach(function (key) { analysisBackup[key] = S[key]; S[key] = false; });
      cancelAllSearches('analysis-engine-off');
    } else {
      analysisKeys.forEach(function (key) { S[key] = analysisBackup ? analysisBackup[key] : true; });
      analysisBackup = null;
    }
    SND.click(); applySettings();
    setEvalDisplay(current); refreshGraph(); renderPosition(); refreshExplain();
    if (S.analysisEngine && S.auto) scheduleAnalysis();
  };
  bindSw('swSound', 'sound'); bindSw('swAuto', 'auto', function () { if (S.auto) scheduleAnalysis(); });
  bindSw('swEval', 'evalBar', function () { setEvalDisplay(current); refreshGraph(); });
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
    analysisBackup = null;
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
    closeNav();
    if (!(r === 'play' || r === 'local' || r === 'analysis') && G && G.puzzle) {
      G.puzzle = null;
      exitPuzzleChrome();
      refreshAll();
    }
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
  /* Landing-page / footer / header call-to-action buttons. They use data-go
     rather than data-route so they never collide with the nav or mode-card
     wiring above, and so the nav-link test keeps seeing exactly six routes. */
  [].forEach.call(document.querySelectorAll('[data-go]'), function (b) {
    b.onclick = function () { goRoute(b.getAttribute('data-go')); };
  });
  $('brandBtn').onclick = function () { goRoute('home'); };

  /* ---------------- mobile navigation drawer ---------------- */
  var topBar = $('topBar') || document.querySelector('header.top');
  var navToggle = $('navToggle');
  function closeNav() {
    if (!topBar) return;
    topBar.classList.remove('nav-open');
    if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
  }
  if (navToggle && topBar) {
    navToggle.onclick = function () {
      var open = topBar.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    document.addEventListener('click', function (e) {
      if (!topBar.classList.contains('nav-open')) return;
      if (e.target && typeof e.target.closest === 'function' && e.target.closest('header.top')) return;
      closeNav();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
  }

  /* ---------------- sticky header hairline ---------------- */
  if (topBar && typeof window.addEventListener === 'function') {
    var stuckTick = false;
    window.addEventListener('scroll', function () {
      if (stuckTick) return;
      stuckTick = true;
      var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
      raf(function () {
        stuckTick = false;
        if ((window.pageYOffset || 0) > 4) topBar.classList.add('stuck');
        else topBar.classList.remove('stuck');
      });
    }, { passive: true });
  }

  /* ---------------- scroll-reveal for the home page ----------------
     Decorative only. When IntersectionObserver is unavailable (jsdom, very
     old browsers) or the visitor prefers reduced motion, everything is
     revealed immediately instead — content is never left hidden. */
  function initReveal() {
    var targets = [].slice.call(document.querySelectorAll('[data-reveal]'));
    if (!targets.length) return;
    function revealAll() { targets.forEach(function (el) { el.classList.add('in'); }); }
    var reduced = false;
    try {
      reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { reduced = false; }
    if (reduced || typeof IntersectionObserver !== 'function') { revealAll(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    targets.forEach(function (el) { io.observe(el); });
  }
  try { initReveal(); } catch (e) { /* never let decoration break the app */ }
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
    get worker() { return AW; },
    get aiWorker() { return WK; },
    get analysisWorker() { return AW; },
    sideAt: sideAt, boardAt: boardAt, line: line, dp: dp, nm: nm,
    goRoute: goRoute, startGame: startGame, encodePos: encodePos, decodePos: decodePos,
    posKey: posKey, analysisTokenValue: function () { return analysisToken; },
    gradeOf: function (i) { return line()[i] && line()[i].quality; },
    isSearching: function () { return searching; },
    PUZZLES: PUZZLES,
    /* ---- puzzle bank ---- */
    BUILTIN_PUZZLES: BUILTIN_PUZZLES, CONTRIBUTED_PUZZLES: CONTRIBUTED_PUZZLES,
    get GENERATED_PUZZLES() { return GENERATED_PUZZLES; },
    MERGED_PUZZLES: MERGED_PUZZLES,
    canonKeyOf: canonKeyOf, puzzleSide: puzzleSide,
    validateGeneratedPuzzle: validateGeneratedPuzzle,
    saveGeneratedPuzzle: saveGeneratedPuzzle,
    loadGeneratedBank: function () { GENERATED_PUZZLES = loadGeneratedBank(); rebuildMergedPuzzles(); return GENERATED_PUZZLES; },
    rebuildMergedPuzzles: rebuildMergedPuzzles,
    persistedCount: persistedCount,
    persistOk: function () { return persistOk; },
    exportGeneratedJSON: exportGeneratedJSON,
    GEN_BANK_KEY: GEN_BANK_KEY,
    /* ---- generator ---- */
    get GS() { return GS; },
    genSettings: genSettings,
    genToken: function () { return GEN_TOKEN; },
    genMode: function () { return PG.mode; },
    startGeneration: startGeneration, stopGeneration: stopGeneration,
    openGenerator: openGenerator, closeGenerator: closeGenerator,
    onGenMessage: onGenMessage,
    killGenWorker: killGenWorker,
    GEN_TIME_OPTIONS: GEN_TIME_OPTIONS, GEN_TARGET_OPTIONS: GEN_TARGET_OPTIONS,
    /* ---- puzzle play ---- */
    startPuzzle: startPuzzle, exitPuzzle: exitPuzzle, resetPuzzle: resetPuzzle,
    showPuzzleSolution: showPuzzleSolution, replayPuzzleSolution: replayPuzzleSolution,
    puzzleGuess: function (i) { return puzzleGuess(i); },
    /* worker/search-cancellation hooks */
    ask: ask, askAI: askAI, cancelAllSearches: cancelAllSearches, cancelAnalysis: cancelAnalysis, cancelAI: cancelAI,
    workerGen: function () { return AW.gen; },
    pendingCount: function () { return Object.keys(WK.pending).length + Object.keys(AW.pending).length; },
    runAnalysis: runAnalysis, scheduleAnalysis: scheduleAnalysis,
    iterationLog: function () { return iterationLog.slice(); },
    clearIterationLog: function () { iterationLog.length = 0; },
    setEvalDisplay: function (r) { setEvalDisplay(r); },
    routes: ROUTES, currentRoute: function () { return currentRoute; }
  };
})();
