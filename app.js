/* ===========================================================
   XO 5-in-a-Row — application layer
   Engine is loaded above as window.XOEngine (also used in a worker).
   =========================================================== */
(function () {
  'use strict';
  var E = window.XOEngine;
  var SIZE = E.SIZE, LEN = E.LEN, X = E.X, O = E.O;
  var MATE_T = E.MATE_THRESHOLD;
  var COLS = 'ABCDEFGHIJKLMNO';

  var $ = function (id) { return document.getElementById(id); };
  function cellName(i) { return COLS[i % SIZE] + (SIZE - ((i / SIZE) | 0)); }

  /* ---------------- settings ---------------- */
  var DEFAULTS = {
    difficulty: 'medium', first: 'you', timer: 0,
    hints: true, quality: true,
    theme: 'light', coords: true, boardSize: 600,
    sound: true, evalBar: true, bestMove: false, graph: true
  };
  var S = Object.assign({}, DEFAULTS);

  function store(key, val) { try { localStorage.setItem('xo5.' + key, JSON.stringify(val)); } catch (e) {} }
  function load(key, fallback) {
    try { var v = localStorage.getItem('xo5.' + key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }

  var STATS = load('stats', { played: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0, moveTotal: 0 });

  /* ---------------- game state ---------------- */
  var G = null;

  function newGameState(starter) {
    return {
      board: new Int8Array(LEN),
      moves: [],            // {idx, player, evalAfter, quality}
      starter: starter,
      status: 'playing',    // playing | over
      winner: null,         // X | O | 'draw'
      winCells: null,
      evalScore: 0,         // O-positive
      evalMate: null,
      evalDepth: 0,
      bestIdx: null,
      hintIdx: null,
      startTime: Date.now(),
      clock: { 1: S.timer * 60000, 2: S.timer * 60000 },
      lastAiMs: null
    };
  }
  function turn() {
    if (!G) return X;
    return (G.moves.length % 2 === 0) ? G.starter : (G.starter === X ? O : X);
  }
  function isHumanTurn() { return G && G.status === 'playing' && turn() === X; }

  /* ---------------- worker ---------------- */
  var worker = null, reqId = 0, pending = {};
  function initWorker() {
    try {
      var src = $('engineSrc').textContent + '\n' +
        'self.onmessage=function(e){var d=e.data;var s=new XOEngine.State();' +
        'for(var i=0;i<d.moves.length;i++){s.play(d.moves[i][0],d.moves[i][1]);}' +
        'var r=(d.type==="move")?XOEngine.chooseMove(s,d.player,d.difficulty):XOEngine.analyse(s,d.player,d.budget);' +
        'self.postMessage({id:d.id,res:r});};';
      var blob = new Blob([src], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
      worker.onmessage = function (e) {
        var p = pending[e.data.id];
        if (p) { delete pending[e.data.id]; p(e.data.res); }
      };
      worker.onerror = function () { worker = null; };
    } catch (err) { worker = null; }
  }

  function engineRequest(payload) {
    return new Promise(function (resolve) {
      if (worker) {
        var id = ++reqId;
        payload.id = id;
        pending[id] = resolve;
        worker.postMessage(payload);
      } else {
        // main-thread fallback, deferred so the UI can paint first
        setTimeout(function () {
          var s = new E.State();
          for (var i = 0; i < payload.moves.length; i++) s.play(payload.moves[i][0], payload.moves[i][1]);
          resolve(payload.type === 'move'
            ? E.chooseMove(s, payload.player, payload.difficulty)
            : E.analyse(s, payload.player, payload.budget));
        }, 20);
      }
    });
  }
  function moveList() { return G.moves.map(function (m) { return [m.idx, m.player]; }); }

  /* ---------------- sound ---------------- */
  var actx = null;
  function beep(freq, dur, type, gain) {
    if (!S.sound) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var osc = actx.createOscillator(), g = actx.createGain();
      osc.type = type || 'sine'; osc.frequency.value = freq;
      g.gain.setValueAtTime(0, actx.currentTime);
      g.gain.linearRampToValueAtTime(gain == null ? 0.05 : gain, actx.currentTime + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      osc.connect(g); g.connect(actx.destination);
      osc.start(); osc.stop(actx.currentTime + dur + 0.02);
    } catch (e) {}
  }
  var SND = {
    x: function () { beep(660, .08, 'triangle', .05); },
    o: function () { beep(440, .08, 'sine', .05); },
    click: function () { beep(320, .04, 'sine', .03); },
    win: function () { beep(523, .12, 'sine', .06); setTimeout(function () { beep(784, .22, 'sine', .06); }, 110); },
    lose: function () { beep(330, .18, 'sine', .05); setTimeout(function () { beep(247, .26, 'sine', .05); }, 140); },
    error: function () { beep(180, .09, 'square', .03); }
  };

  /* ---------------- board rendering ---------------- */
  var boardEl = $('board');
  var cellEls = new Array(LEN);
  var focusIdx = 7 * SIZE + 7;

  function buildBoard() {
    boardEl.classList.toggle('with-coords', !!S.coords);
    var html = '', x, y;
    if (S.coords) {
      html += '<div class="coord" aria-hidden="true"></div>';
      for (x = 0; x < SIZE; x++) html += '<div class="coord" aria-hidden="true">' + COLS[x] + '</div>';
    }
    for (y = 0; y < SIZE; y++) {
      if (S.coords) html += '<div class="coord" aria-hidden="true">' + (SIZE - y) + '</div>';
      for (x = 0; x < SIZE; x++) {
        var i = y * SIZE + x;
        html += '<button class="cell" role="gridcell" data-i="' + i + '" data-occupied="0" tabindex="-1"' +
          ' aria-label="Cell ' + cellName(i) + ', empty"></button>';
      }
    }
    boardEl.innerHTML = html;
    var nodes = boardEl.querySelectorAll('.cell');
    for (var k = 0; k < nodes.length; k++) cellEls[+nodes[k].dataset.i] = nodes[k];
    refreshAllCells();
    setFocusCell(focusIdx);
  }

  var SVG_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><line class="mark-x" x1="5" y1="5" x2="19" y2="19"/><line class="mark-x" x1="19" y1="5" x2="5" y2="19"/></svg>';
  var SVG_O = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="mark-o" cx="12" cy="12" r="7.4"/></svg>';

  function paintCell(i, animate) {
    var el = cellEls[i]; if (!el || !G) return;
    var v = G.board[i];
    el.dataset.occupied = v ? '1' : '0';
    el.innerHTML = v === X ? SVG_X : (v === O ? SVG_O : '');
    el.setAttribute('aria-label', 'Cell ' + cellName(i) + ', ' + (v ? ('occupied by ' + (v === X ? 'X' : 'O')) : 'empty'));
    el.classList.toggle('placed', !!animate);
    if (animate) setTimeout(function () { el.classList.remove('placed'); }, 220);
  }

  function refreshAllCells() {
    if (!G) return;
    for (var i = 0; i < LEN; i++) paintCell(i, false);
    refreshMarkers();
    refreshInteractivity();
  }

  function refreshMarkers() {
    if (!G) return;
    for (var i = 0; i < LEN; i++) {
      var el = cellEls[i]; if (!el) continue;
      el.classList.remove('last', 'win', 'hintcell', 'bestmove');
    }
    var last = G.moves[G.moves.length - 1];
    if (last && !G.winCells) cellEls[last.idx] && cellEls[last.idx].classList.add('last');
    if (G.winCells) G.winCells.forEach(function (i) { cellEls[i] && cellEls[i].classList.add('win'); });
    if (G.hintIdx != null && G.status === 'playing') cellEls[G.hintIdx] && cellEls[G.hintIdx].classList.add('hintcell');
    if (S.bestMove && G.bestIdx != null && G.hintIdx == null && G.status === 'playing' && isHumanTurn())
      cellEls[G.bestIdx] && cellEls[G.bestIdx].classList.add('bestmove');
  }

  function refreshInteractivity() {
    if (!G) return;
    var playable = isHumanTurn();
    boardEl.dataset.turn = playable ? '1' : '0';
    for (var i = 0; i < LEN; i++) {
      var el = cellEls[i]; if (!el) continue;
      if (!playable || G.board[i] !== 0) el.setAttribute('disabled', '');
      else el.removeAttribute('disabled');
    }
  }

  function setFocusCell(i) {
    if (cellEls[focusIdx]) cellEls[focusIdx].tabIndex = -1;
    focusIdx = i;
    if (cellEls[i]) cellEls[i].tabIndex = 0;
  }

  /* ---------------- status / panels ---------------- */
  function setStatus(text, cls) {
    var st = $('statusText');
    st.className = cls || '';
    st.innerHTML = text;
    $('srStatus').textContent = st.textContent;
  }

  function refreshStatus() {
    var chip = $('turnChip');
    if (G.status === 'over') {
      if (G.winner === X) { chip.className = 'turn-chip x'; chip.textContent = 'X'; setStatus('You Win!', 'win'); }
      else if (G.winner === O) { chip.className = 'turn-chip o'; chip.textContent = 'O'; setStatus('AI Wins', 'lose'); }
      else { chip.className = 'turn-chip'; chip.textContent = '='; setStatus('Draw', ''); }
    } else if (turn() === X) {
      chip.className = 'turn-chip x'; chip.textContent = 'X';
      setStatus('Your Turn', '');
    } else {
      chip.className = 'turn-chip o'; chip.textContent = 'O';
      setStatus('AI Thinking<span class="dots"><i></i><i></i><i></i></span>', '');
    }
    $('metaDiff').textContent = S.difficulty.charAt(0).toUpperCase() + S.difficulty.slice(1);
    $('metaMoves').textContent = G.moves.length;
    $('metaEngine').textContent = G.lastAiMs != null ? ('AI move • ' + G.lastAiMs + ' ms') : '';
  }

  function evalToPawns(score) { return Math.max(-25, Math.min(25, score / 10000)); }

  function refreshEval() {
    $('evalCard').hidden = !S.evalBar;
    if (!S.evalBar) return;
    var mate = G.evalMate, score = G.evalScore;
    var pawns = evalToPawns(score);
    var pct;
    if (mate != null) pct = score > 0 ? 97 : 3;
    else pct = 50 + 47 * Math.tanh(pawns / 6);
    $('evalO').style[window.innerWidth <= 980 ? 'width' : 'height'] = pct + '%';
    if (window.innerWidth <= 980) $('evalO').style.height = '100%'; else $('evalO').style.width = '';

    var num, desc;
    if (mate != null) {
      num = (score > 0 ? '+M' : '−M') + mate;
      desc = score > 0 ? 'Winning for O' : 'Winning for X';
    } else {
      var a = Math.abs(pawns);
      num = (pawns >= 0 ? '+' : '−') + a.toFixed(1);
      if (a < 0.4) { num = '0.0'; desc = 'Equal position'; }
      else if (a < 1.5) desc = 'Slight advantage for ' + (pawns > 0 ? 'O' : 'X');
      else if (a < 4) desc = 'Advantage for ' + (pawns > 0 ? 'O' : 'X');
      else if (a < 10) desc = 'Strong advantage for ' + (pawns > 0 ? 'O' : 'X');
      else desc = 'Winning for ' + (pawns > 0 ? 'O' : 'X');
    }
    $('evalNum').textContent = num;
    $('evalNum').style.color = mate != null || Math.abs(pawns) >= 0.4
      ? (score > 0 ? 'var(--o)' : 'var(--x)') : 'var(--text)';
    $('evalDesc').textContent = desc;
    $('evalSub').textContent = G.evalDepth ? ('Depth ' + G.evalDepth) : 'Analysing…';
    var show = S.bestMove && G.bestIdx != null && G.status === 'playing';
    $('bestRow').hidden = !show;
    if (show) $('bestVal').textContent = cellName(G.bestIdx);
  }

  var QUAL = ['Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'];
  function refreshMoves() {
    var list = $('moveList');
    if (!G.moves.length) { list.innerHTML = '<p class="empty-note">No moves yet.</p>'; return; }
    var html = '', n = 1;
    for (var i = 0; i < G.moves.length; i += 2) {
      html += '<div class="move-row"><span class="n">' + n + '.</span>';
      for (var j = 0; j < 2; j++) {
        var m = G.moves[i + j];
        if (!m) { html += '<span></span>'; continue; }
        var isLast = (i + j) === G.moves.length - 1;
        var q = (m.quality && S.quality) ? ' <span class="q ' + m.quality.toLowerCase() + '">' + m.quality + '</span>' : '';
        html += '<button class="mv ' + (m.player === X ? 'x' : 'o') + (isLast ? ' current' : '') +
          '" data-mi="' + (i + j) + '">' + (m.player === X ? 'X' : 'O') + ' ' + cellName(m.idx) + q + '</button>';
      }
      html += '</div>'; n++;
    }
    list.innerHTML = html;
    list.scrollTop = list.scrollHeight;
  }

  function refreshGraph() {
    $('graphCard').hidden = !S.graph;
    if (!S.graph) return;
    var g = $('graph');
    var pts = G.moves.map(function (m, i) { return { i: i + 1, v: m.evalAfter == null ? 0 : evalToPawns(m.evalAfter) }; });
    if (pts.length < 2) { g.innerHTML = '<text x="150" y="52" text-anchor="middle" font-size="11" fill="#98A2B3">Not enough data yet</text>'; return; }
    var W = 300, H = 96, pad = 6;
    var maxAbs = Math.max(2, Math.min(12, pts.reduce(function (a, p) { return Math.max(a, Math.abs(p.v)); }, 0)));
    var xs = function (i) { return pad + (i - 1) / Math.max(1, pts.length - 1) * (W - 2 * pad); };
    var ys = function (v) { return H / 2 - (v / maxAbs) * (H / 2 - pad); };
    var d = pts.map(function (p, k) { return (k ? 'L' : 'M') + xs(p.i).toFixed(1) + ' ' + ys(p.v).toFixed(1); }).join(' ');
    var areaO = d + ' L' + xs(pts[pts.length - 1].i).toFixed(1) + ' ' + (H / 2) + ' L' + xs(1).toFixed(1) + ' ' + (H / 2) + ' Z';
    g.innerHTML =
      '<path d="' + areaO + '" class="graph-area-o"/>' +
      '<line class="graph-zero" x1="0" y1="' + (H / 2) + '" x2="' + W + '" y2="' + (H / 2) + '"/>' +
      '<path class="graph-line" d="' + d + '"/>';
  }

  function refreshScore() {
    $('scWins').textContent = STATS.wins;
    $('scLosses').textContent = STATS.losses;
    $('scDraws').textContent = STATS.draws;
    var rate = STATS.played ? Math.round(STATS.wins / STATS.played * 100) : 0;
    var avg = STATS.played ? Math.round(STATS.moveTotal / STATS.played) : 0;
    $('statGrid').innerHTML =
      row('Games Played', STATS.played) + row('Win Rate', rate + '%') +
      row('Wins', STATS.wins) + row('Losses', STATS.losses) + row('Draws', STATS.draws) +
      row('Current Streak', STATS.streak) + row('Best Streak', STATS.best) +
      row('Avg. Game Length', STATS.played ? avg + ' moves' : '—');
    function row(k, v) { return '<dt>' + k + '</dt><dd>' + v + '</dd>'; }
  }

  function refreshTimers() {
    var wrap = $('timers');
    wrap.hidden = !S.timer;
    if (!S.timer) return;
    fmt($('timerX'), 'You', G.clock[X], turn() === X);
    fmt($('timerO'), 'AI', G.clock[O], turn() === O);
    function fmt(el, label, ms, active) {
      var s = Math.max(0, Math.ceil(ms / 1000));
      el.textContent = label + ' ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      el.classList.toggle('active', active && G.status === 'playing');
      el.classList.toggle('low', s <= 15);
    }
  }

  function refreshAll() {
    refreshStatus(); refreshEval(); refreshMoves(); refreshGraph(); refreshScore(); refreshTimers();
    refreshMarkers(); refreshInteractivity();
    $('undoBtn').disabled = !G.moves.length || G.status !== 'playing' || !isHumanTurn();
    $('hintBtn').disabled = !S.hints || G.status !== 'playing' || !isHumanTurn();
  }

  /* ---------------- gameplay ---------------- */
  function startGame(starter, opts) {
    opts = opts || {};
    var first = starter || (S.first === 'you' ? X : S.first === 'ai' ? O : (Math.random() < .5 ? X : O));
    G = newGameState(first);
    if (opts.moves) {
      opts.moves.forEach(function (idx, k) {
        var p = (k % 2 === 0) ? first : (first === X ? O : X);
        G.board[idx] = p;
        G.moves.push({ idx: idx, player: p, evalAfter: null, quality: null });
      });
      var lastM = G.moves[G.moves.length - 1];
      if (lastM) {
        var w = E.winningLineAt(G.board, lastM.idx, lastM.player);
        if (w) { G.status = 'over'; G.winner = lastM.player; G.winCells = w; }
      }
    }
    refreshAllCells(); refreshAll();
    requestAnalysis();
    if (G.status === 'playing' && turn() === O) setTimeout(aiMove, 260);
    tickerStart();
  }

  function place(idx, player) {
    if (G.board[idx] !== 0 || G.status !== 'playing') { SND.error(); return false; }
    G.board[idx] = player;
    G.moves.push({ idx: idx, player: player, evalAfter: null, quality: null });
    G.hintIdx = null;
    (player === X ? SND.x : SND.o)();
    paintCell(idx, true);
    refreshMarkers();

    var win = E.winningLineAt(G.board, idx, player);
    if (win) { endGame(player, win); return true; }
    if (G.moves.length >= LEN) { endGame('draw', null); return true; }

    refreshAll();
    requestAnalysis(player === X);
    if (turn() === O) setTimeout(aiMove, 180);
    return true;
  }

  var analysisToken = 0;
  function requestAnalysis(scoreHumanMove) {
    if (!G || G.status !== 'playing') return;
    var token = ++analysisToken;
    var prevScore = G.evalScore;
    var side = turn();
    engineRequest({ type: 'analyse', moves: moveList(), player: side, budget: S.difficulty === 'hard' ? 420 : 300 })
      .then(function (res) {
        if (token !== analysisToken || !G) return;
        G.evalScore = res.score;
        G.evalMate = res.mateIn;
        G.evalDepth = res.depth || 0;
        G.bestIdx = res.best;
        var last = G.moves[G.moves.length - 1];
        if (last) last.evalAfter = res.score;
        if (scoreHumanMove && S.quality && last && last.player === X) {
          // eval is O-positive; a rise after X's move means X lost ground
          var drop = (res.score - prevScore) / 10000;
          last.quality = drop <= 0.35 ? 'Excellent' : drop <= 1.2 ? 'Good'
            : drop <= 2.5 ? 'Inaccuracy' : drop <= 6 ? 'Mistake' : 'Blunder';
        }
        refreshEval(); refreshMoves(); refreshGraph(); refreshMarkers();
      });
  }

  function aiMove() {
    if (!G || G.status !== 'playing' || turn() !== O) return;
    refreshStatus(); refreshInteractivity();
    var t0 = Date.now();
    engineRequest({ type: 'move', moves: moveList(), player: O, difficulty: S.difficulty })
      .then(function (res) {
        if (!G || G.status !== 'playing' || turn() !== O) return;
        if (!res) { endGame('draw', null); return; }
        G.lastAiMs = Math.max(res.timeMs || 0, Date.now() - t0);
        place(res.idx, O);
      });
  }

  function endGame(winner, winCells) {
    G.status = 'over';
    G.winner = winner;
    G.winCells = winCells;
    G.hintIdx = null;
    STATS.played++;
    STATS.moveTotal += G.moves.length;
    if (winner === X) { STATS.wins++; STATS.streak = Math.max(0, STATS.streak) + 1; STATS.best = Math.max(STATS.best, STATS.streak); SND.win(); }
    else if (winner === O) { STATS.losses++; STATS.streak = 0; SND.lose(); }
    else { STATS.draws++; STATS.streak = 0; }
    store('stats', STATS);
    refreshAllCells(); refreshAll();
    setTimeout(showEndScreen, 520);
  }

  /* ---------------- end screen ---------------- */
  function showEndScreen() {
    var t = $('endTitle'), sub = $('endSub');
    if (G.winner === X) { t.textContent = 'You Win!'; t.className = 'result-title win'; sub.textContent = 'Five in a row.'; }
    else if (G.winner === O) { t.textContent = 'AI Wins'; t.className = 'result-title lose'; sub.textContent = 'Better luck next time.'; }
    else { t.textContent = 'Draw'; t.className = 'result-title draw'; sub.textContent = 'No winner this time.'; }

    var rows = [
      ['Result', G.winner === X ? 'You win' : G.winner === O ? 'AI wins' : 'Draw'],
      ['Difficulty', S.difficulty.charAt(0).toUpperCase() + S.difficulty.slice(1)],
      ['Moves', G.moves.length],
      ['Duration', Math.round((Date.now() - G.startTime) / 1000) + 's']
    ];
    if (G.winCells && G.winCells.length) {
      rows.push(['Winning Line', cellName(G.winCells[0]) + ' – ' + cellName(G.winCells[G.winCells.length - 1])]);
    }
    var human = G.moves.filter(function (m) { return m.player === X && m.evalAfter != null; });
    if (human.length >= 4) {
      var deltas = [];
      for (var i = 0; i < G.moves.length; i++) {
        var m = G.moves[i];
        if (m.player !== X || m.evalAfter == null) continue;
        var prev = i >= 2 && G.moves[i - 2].evalAfter != null ? G.moves[i - 2].evalAfter : 0;
        deltas.push({ idx: m.idx, delta: m.evalAfter - prev });
      }
      if (deltas.length >= 3) {
        deltas.sort(function (a, b) { return a.delta - b.delta; });
        rows.push(['Best Move', cellName(deltas[0].idx)]);
        var worst = deltas[deltas.length - 1];
        if (worst.delta > 15000) rows.push(['Biggest Mistake', cellName(worst.idx)]);
      }
    }
    $('endSummary').innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');
    openModal('endOverlay');
  }

  /* ---------------- timer ---------------- */
  var ticker = null, lastTick = 0;
  function tickerStart() {
    clearInterval(ticker); lastTick = Date.now();
    if (!S.timer) return;
    ticker = setInterval(function () {
      var now = Date.now(), dt = now - lastTick; lastTick = now;
      if (!G || G.status !== 'playing') return;
      var p = turn();
      G.clock[p] -= dt;
      if (G.clock[p] <= 0) {
        G.clock[p] = 0;
        clearInterval(ticker);
        setStatus(p === X ? "Time's Up — AI Wins" : "Time's Up — You Win", p === X ? 'lose' : 'win');
        endGame(p === X ? O : X, null);
        return;
      }
      refreshTimers();
    }, 250);
  }

  /* ---------------- modals ---------------- */
  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }
  function closeAll() { ['settingsOverlay', 'confirmOverlay', 'endOverlay', 'ioOverlay'].forEach(closeModal); }

  var confirmResolve = null;
  function confirmDialog(text, okLabel) {
    $('confText').textContent = text;
    $('confOk').textContent = okLabel || 'Confirm';
    openModal('confirmOverlay');
    return new Promise(function (res) { confirmResolve = res; });
  }
  $('confCancel').onclick = function () { closeModal('confirmOverlay'); confirmResolve && confirmResolve(false); };
  $('confOk').onclick = function () { closeModal('confirmOverlay'); confirmResolve && confirmResolve(true); };

  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.onclick = function () { closeAll(); };
  });
  document.querySelectorAll('.overlay').forEach(function (ov) {
    ov.addEventListener('mousedown', function (e) { if (e.target === ov && ov.id !== 'endOverlay') closeModal(ov.id); });
  });

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 2000);
  }

  /* ---------------- controls ---------------- */
  boardEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.cell');
    if (!btn || btn.hasAttribute('disabled')) return;
    if (!isHumanTurn()) return;
    SND.click();
    setFocusCell(+btn.dataset.i);
    place(+btn.dataset.i, X);
  });

  boardEl.addEventListener('keydown', function (e) {
    var keys = { ArrowUp: -SIZE, ArrowDown: SIZE, ArrowLeft: -1, ArrowRight: 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    var x = focusIdx % SIZE, y = (focusIdx / SIZE) | 0;
    if (e.key === 'ArrowLeft') x = Math.max(0, x - 1);
    if (e.key === 'ArrowRight') x = Math.min(SIZE - 1, x + 1);
    if (e.key === 'ArrowUp') y = Math.max(0, y - 1);
    if (e.key === 'ArrowDown') y = Math.min(SIZE - 1, y + 1);
    setFocusCell(y * SIZE + x);
    cellEls[focusIdx].focus();
  });

  $('newBtn').onclick = async function () {
    SND.click();
    if (G && G.status === 'playing' && G.moves.length) {
      var ok = await confirmDialog('Start a new game? Your current progress will be lost.', 'New Game');
      if (!ok) return;
    }
    startGame(null);
  };

  $('undoBtn').onclick = function () {
    if (!G || !G.moves.length || !isHumanTurn()) return;
    SND.click();
    var steps = (G.moves.length >= 2 && G.moves[G.moves.length - 1].player === O) ? 2 : 1;
    for (var i = 0; i < steps && G.moves.length; i++) {
      var m = G.moves.pop();
      G.board[m.idx] = 0;
      paintCell(m.idx, false);
    }
    G.status = 'playing'; G.winner = null; G.winCells = null; G.hintIdx = null; G.lastAiMs = null;
    refreshAllCells(); refreshAll(); requestAnalysis();
    if (turn() === O) setTimeout(aiMove, 200);
  };

  $('hintBtn').onclick = function () {
    if (!S.hints || !isHumanTurn()) return;
    SND.click();
    $('hintBtn').disabled = true;
    engineRequest({ type: 'analyse', moves: moveList(), player: X, budget: 900 }).then(function (res) {
      if (!G || G.status !== 'playing') return;
      G.hintIdx = res.best;
      refreshMarkers();
      toast('Best move: ' + cellName(res.best));
      $('hintBtn').disabled = !isHumanTurn();
    });
  };

  $('moveList').addEventListener('click', function (e) {
    var b = e.target.closest('.mv'); if (!b) return;
    var m = G.moves[+b.dataset.mi]; if (!m) return;
    var el = cellEls[m.idx];
    el.classList.add('hintcell');
    setTimeout(function () { refreshMarkers(); }, 1200);
  });

  $('resetScoreBtn').onclick = async function () {
    if (await confirmDialog('Clear all statistics and scores?', 'Reset')) {
      STATS = { played: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0, moveTotal: 0 };
      store('stats', STATS); refreshScore(); toast('Score reset');
    }
  };

  /* ---------- save / load / share ---------- */
  $('saveBtn').onclick = function () {
    SND.click();
    store('save', { starter: G.starter, moves: G.moves.map(function (m) { return m.idx; }), difficulty: S.difficulty, t: Date.now() });
    toast('Game saved');
  };
  $('loadBtn').onclick = async function () {
    SND.click();
    var d = load('save', null);
    if (!d || !Array.isArray(d.moves)) { toast('No saved game'); return; }
    if (G && G.moves.length && G.status === 'playing') {
      if (!(await confirmDialog('Load the saved game? Your current progress will be lost.', 'Load'))) return;
    }
    if (d.difficulty) setDifficulty(d.difficulty);
    startGame(d.starter === O ? O : X, { moves: sanitizeMoves(d.moves) });
    toast('Game loaded');
  };
  $('clearSaveBtn').onclick = async function () {
    if (await confirmDialog('Delete the saved game?', 'Delete')) {
      try { localStorage.removeItem('xo5.save'); } catch (e) {}
      toast('Saved game cleared');
    }
  };

  function sanitizeMoves(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (typeof v !== 'number' || !isFinite(v)) break;
      v = v | 0;
      if (v < 0 || v >= LEN || seen[v]) break;
      seen[v] = 1; out.push(v);
    }
    return out;
  }

  function encodeGame() {
    var s = String.fromCharCode.apply(null, [G.starter].concat(G.moves.map(function (m) { return m.idx; })));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeGame(str) {
    try {
      var b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
      var nums = []; for (var i = 0; i < b.length; i++) nums.push(b.charCodeAt(i));
      var starter = nums.shift() === O ? O : X;
      return { starter: starter, moves: sanitizeMoves(nums) };
    } catch (e) { return null; }
  }

  $('shareBtn').onclick = function () {
    SND.click();
    var url = location.origin + location.pathname + '?g=' + encodeGame();
    showIO('Share Game', 'Anyone opening this link sees the current position.', url, 'Copy');
  };
  $('exportBtn').onclick = function () {
    showIO('Export Game', 'Copy this JSON to save the game elsewhere.',
      JSON.stringify({ v: 1, starter: G.starter, difficulty: S.difficulty, moves: G.moves.map(function (m) { return m.idx; }) }, null, 2), 'Copy');
  };
  $('importBtn').onclick = function () {
    showIO('Import Game', 'Paste exported game JSON, then press Load.', '', 'Load');
  };
  function showIO(title, help, value, action) {
    $('ioTitle').textContent = title; $('ioHelp').textContent = help;
    $('ioText').value = value; $('ioAction').textContent = action;
    $('ioAction').dataset.mode = action;
    openModal('ioOverlay');
  }
  $('ioAction').onclick = async function () {
    if (this.dataset.mode === 'Copy') {
      var ta = $('ioText'); ta.select();
      try { await navigator.clipboard.writeText(ta.value); } catch (e) { try { document.execCommand('copy'); } catch (e2) {} }
      toast('Copied');
      return;
    }
    var data;
    try { data = JSON.parse($('ioText').value); } catch (e) { toast('Invalid JSON'); SND.error(); return; }
    if (!data || !Array.isArray(data.moves)) { toast('Invalid game data'); SND.error(); return; }
    var mv = sanitizeMoves(data.moves);
    if (!mv.length) { toast('No valid moves found'); SND.error(); return; }
    if (data.difficulty) setDifficulty(data.difficulty);
    closeModal('ioOverlay');
    startGame(data.starter === O ? O : X, { moves: mv });
    toast('Game imported');
  };

  /* ---------------- settings wiring ---------------- */
  function applySettings(rebuildBoard) {
    document.documentElement.dataset.theme = S.theme;
    document.documentElement.style.setProperty('--board-size', S.boardSize + 'px');
    setPressed('diffSeg', S.difficulty); setPressed('firstSeg', S.first);
    setPressed('timerSeg', String(S.timer)); setPressed('themeSeg', S.theme);
    setSwitch('swHints', S.hints); setSwitch('swQuality', S.quality);
    setSwitch('swCoords', S.coords); setSwitch('swSound', S.sound);
    setSwitch('swEval', S.evalBar); setSwitch('swBest', S.bestMove); setSwitch('swGraph', S.graph);
    $('sizeRange').value = S.boardSize;
    $('diffHint').textContent = { easy: 'Beginner-friendly AI', medium: 'Balanced challenge', hard: 'Strong tactical AI' }[S.difficulty];
    if (rebuildBoard) buildBoard();
    store('settings', S);
    if (G) refreshAll();
  }
  function setPressed(segId, val) {
    $(segId).querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.v === val));
    });
  }
  function setSwitch(id, on) { $(id).setAttribute('aria-checked', String(!!on)); }
  function setDifficulty(d) { if (['easy', 'medium', 'hard'].indexOf(d) >= 0) { S.difficulty = d; applySettings(false); } }

  $('settingsBtn').onclick = function () { SND.click(); openModal('settingsOverlay'); };
  $('themeBtn').onclick = function () { S.theme = S.theme === 'light' ? 'dark' : 'light'; applySettings(false); };

  $('diffSeg').onclick = function (e) { var b = e.target.closest('button'); if (b) { setDifficulty(b.dataset.v); toast('Difficulty applies from the next game'); } };
  $('firstSeg').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.first = b.dataset.v; applySettings(false); } };
  $('timerSeg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.timer = +b.dataset.v; applySettings(false);
    if (G) { G.clock = { 1: S.timer * 60000, 2: S.timer * 60000 }; tickerStart(); refreshTimers(); }
  };
  $('themeSeg').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.theme = b.dataset.v; applySettings(false); } };

  function bindSwitch(id, key, rebuild) {
    $(id).onclick = function () { S[key] = !S[key]; SND.click(); applySettings(rebuild); };
  }
  bindSwitch('swHints', 'hints'); bindSwitch('swQuality', 'quality');
  bindSwitch('swCoords', 'coords', true); bindSwitch('swSound', 'sound');
  bindSwitch('swEval', 'evalBar'); bindSwitch('swBest', 'bestMove'); bindSwitch('swGraph', 'graph');

  $('sizeRange').oninput = function () { S.boardSize = +this.value; applySettings(false); };
  $('resetStatsBtn').onclick = $('resetScoreBtn').onclick;
  $('resetSettingsBtn').onclick = async function () {
    if (await confirmDialog('Reset all settings to their defaults?', 'Reset')) {
      S = Object.assign({}, DEFAULTS); applySettings(true); toast('Settings reset');
    }
  };

  $('againBtn').onclick = function () { closeModal('endOverlay'); startGame(null); };
  $('reviewBtn').onclick = function () { closeModal('endOverlay'); };

  /* ---------------- keyboard shortcuts ---------------- */
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'Escape') { closeAll(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); $('newBtn').click(); }
    else if (k === 'u') { e.preventDefault(); if (!$('undoBtn').disabled) $('undoBtn').click(); }
    else if (k === 'h') { e.preventDefault(); if (!$('hintBtn').disabled) $('hintBtn').click(); }
  });

  window.addEventListener('resize', function () { if (G) refreshEval(); });

  /* ---------------- boot ---------------- */
  var saved = load('settings', null);
  if (saved) Object.keys(DEFAULTS).forEach(function (k) { if (saved[k] !== undefined) S[k] = saved[k]; });
  if (window.matchMedia && !saved && window.matchMedia('(prefers-color-scheme: dark)').matches) S.theme = 'dark';
  if (window.innerWidth < 700) S.coords = saved && saved.coords !== undefined ? S.coords : false;

  initWorker();
  applySettings(false);
  buildBoard();

  var shared = new URLSearchParams(location.search).get('g');
  var sharedGame = shared ? decodeGame(shared) : null;
  if (sharedGame && sharedGame.moves.length) {
    startGame(sharedGame.starter, { moves: sharedGame.moves });
    toast('Shared position loaded');
  } else {
    startGame(null);
  }
})();
