/* =========================================================================
   worker3pro.js — Web Worker dispatcher for engine3pro.js
   -------------------------------------------------------------------------
   This file is concatenated AFTER engine3pro.js inside the Blob that app3.js
   turns into a Worker, so `XOEnginePro` is already defined on `self` here.

   Protocol is identical to worker3.js so the main thread can use the same
   askPool() plumbing. The only difference is the engine symbol:
   self.XOEnginePro instead of self.XOEngine.

   Puzzle generation reuses the same protocol and solver; we use the PRO
   engine's solveForcing for verification.
   ========================================================================= */
(function (self) {
  'use strict';
  var E = self.XOEnginePro || self.XOEngine;

  /* Active search state for cooperative cancellation */
  var activeId = null;
  var cancelled = false;

  function shouldAbort() {
    return cancelled;
  }

  function rebuild(d, eng) {
    var Eng = eng || E;
    var s = new Eng.State();
    var i;
    if (d.root && d.root.length) {
      for (i = 0; i < d.root.length; i++) if (d.root[i]) s.play(i, d.root[i]);
    }
    var ms = d.moves || [];
    for (i = 0; i < ms.length; i++) s.play(ms[i][0], ms[i][1]);
    return s;
  }

  /* =====================================================================
     PUZZLE GENERATOR  (identical logic to worker3.js but uses PRO engine)
     ===================================================================== */
  var GEN_SOLVER_VERSION = 'engine3pro.solveForcing/1';

  var SIZE = (E && E.SIZE) || 15, LEN = (E && E.LEN) || 225, X = 1, O = 2;

  function genRandom(seed) {
    var a = (seed | 0) || 0x5EED1234;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function genCanonKey(moves, side) {
    var parts = [], i;
    for (i = 0; i < moves.length; i++) parts.push(moves[i] + (i % 2 === 0 ? 'x' : 'o'));
    parts.sort();
    return parts.join('.') + '#' + (side === X ? 'X' : 'O');
  }

  function genCandidate(rnd, wantSide) {
    var stones = 6 + ((rnd() * 9) | 0);
    if (wantSide === X) { if (stones % 2) stones++; }
    else { if (stones % 2 === 0) stones++; }
    if (stones > 14) stones -= 2;

    var s = new E.State(), placed = [], guard = 0;
    while (placed.length < stones && guard++ < 400) {
      var player = (placed.length % 2 === 0) ? X : O, idx, nx, ny;
      if (!placed.length) {
        nx = 7 + ((rnd() * 3) | 0) - 1;
        ny = 7 + ((rnd() * 3) | 0) - 1;
      } else {
        var anchor = placed[(rnd() * placed.length) | 0];
        nx = (anchor % SIZE) + ((rnd() * 5) | 0) - 2;
        ny = ((anchor / SIZE) | 0) + ((rnd() * 5) | 0) - 2;
      }
      if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
      idx = ny * SIZE + nx;
      if (s.board[idx]) continue;
      s.play(idx, player);
      if (E.winningLineAt(s.board, idx, player)) { s.undo(); continue; }
      placed.push(idx);
    }
    if (placed.length !== stones) return null;
    return { state: s, moves: placed, side: wantSide };
  }

  var GEN = null;

  function genSnapshot(extra) {
    if (!GEN) return null;
    var p = {
      phase: GEN.phase,
      attempts: GEN.attempts,
      accepted: GEN.accepted,
      rejected: GEN.rejected,
      duplicates: GEN.duplicates,
      elapsedMs: Date.now() - GEN.t0,
      moves: GEN.lastMoves,
      side: GEN.lastSide === X ? 'X' : (GEN.lastSide === O ? 'O' : null),
      key: GEN.lastKey,
      len: GEN.lastLen,
      nodes: GEN.nodes,
      solverDepth: GEN.solverDepth,
      reason: GEN.reason
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) p[k] = extra[k];
    return p;
  }

  function genPost(kind, extra, payload) {
    if (!GEN) return;
    var msg = { id: GEN.id, kind: kind, progress: genSnapshot(extra) };
    if (payload) msg.puzzle = payload;
    self.postMessage(msg);
  }

  function genFinish(reason) {
    if (!GEN) return;
    GEN.phase = reason === 'stopped' ? 'Stopped' : 'Completed';
    GEN.reason = reason;
    var msg = { id: GEN.id, kind: 'generated-done', reason: reason, progress: genSnapshot() };
    GEN = null;
    self.postMessage(msg);
  }

  var GEN_SLICE_MS = self.GEN_SLICE_MS || 45;

  function genStep() {
    if (!GEN || GEN.stopping) { if (GEN) genFinish('stopped'); return; }

    var sliceStart = Date.now();
    while (Date.now() - sliceStart < GEN_SLICE_MS) {
      if (GEN.stopping) { genFinish('stopped'); return; }
      if (GEN.deadline !== null && Date.now() >= GEN.deadline) { genFinish('timeout'); return; }
      if (GEN.target !== null && GEN.accepted >= GEN.target) { genFinish('target'); return; }
      if (GEN.consecutiveRejects >= GEN.maxAttempts) { genFinish('exhausted'); return; }

      GEN.attempts++;
      GEN.phase = 'Generating position';

      var wantSide = rndSide();
      var c = genCandidate(GEN.rnd, wantSide);
      if (!c) { genReject('could not build a legal position'); continue; }

      GEN.lastMoves = c.moves.slice();
      GEN.lastSide = wantSide;

      var opp = wantSide === X ? O : X;
      if (E.winningCells(c.state, opp).length) { genReject('opponent already threatens five'); continue; }
      if (E.winningCells(c.state, wantSide).length > 1) { genReject('position already decided'); continue; }

      var key = genCanonKey(c.moves, wantSide);
      if (GEN.seen[key]) { GEN.duplicates++; GEN.consecutiveRejects++; GEN.reason = 'duplicate'; GEN.phase = 'Rejected'; maybeProgress(); continue; }

      GEN.phase = 'Verifying forced win';
      maybeProgress(true);

      var r;
      try {
        r = E.solveForcing(c.state, wantSide, {
          maxPly: GEN.maxPly, nodes: GEN.nodeCap, timeMs: GEN.candidateTimeMs, vct: true
        });
      } catch (err) {
        genReject('solver error: ' + ((err && err.message) || err));
        continue;
      }

      GEN.nodes += (r && r.nodes) || 0;
      GEN.solverDepth = r && r.seq ? r.seq.length : 0;

      if (!r || !r.win) { genReject('no forced win'); continue; }
      if (r.aborted) { genReject('search timeout'); continue; }
      if (r.seq.length !== 1 && r.seq.length !== 3) { genReject('sequence too long (' + r.seq.length + ')'); continue; }

      GEN.seen[key] = 1;
      GEN.accepted++;
      GEN.consecutiveRejects = 0;
      GEN.lastKey = r.seq[0];
      GEN.lastLen = r.seq.length;
      GEN.phase = 'Accepted';
      GEN.reason = r.seq.length === 1 ? 'Accepted — Forced win in 1' : 'Accepted — Forced win in 2';

      genPost('accepted', null, {
        moves: c.moves.slice(),
        key: r.seq[0],
        len: r.seq.length,
        seq: r.seq.slice(),
        sideToMove: wantSide === X ? 'X' : 'O',
        canon: key,
        source: 'generated-local',
        generatedAt: new Date().toISOString(),
        elapsedMs: Date.now() - GEN.t0,
        nodes: (r && r.nodes) || 0,
        maxPly: GEN.maxPly,
        solverVersion: GEN_SOLVER_VERSION
      });
      GEN.lastProgressAt = Date.now();
    }

    maybeProgress(true);
    GEN.timer = setTimeout(genStep, 0);
  }

  function rndSide() { return GEN.rnd() < 0.5 ? X : O; }

  function genReject(reason) {
    GEN.rejected++;
    GEN.consecutiveRejects++;
    GEN.reason = 'Rejected — ' + reason;
    GEN.phase = 'Rejected';
    GEN.lastLen = null;
    GEN.lastKey = null;
    maybeProgress();
  }

  var GEN_PROGRESS_MS = 90;
  function maybeProgress(force) {
    if (!GEN) return;
    var now = Date.now();
    if (!force && now - GEN.lastProgressAt < GEN_PROGRESS_MS) return;
    GEN.lastProgressAt = now;
    genPost('progress');
  }

  function genStart(d) {
    genStop(true);
    var dur = d.durationMs;
    var unlimitedTime = dur === null || dur === undefined || dur === 0 || dur === Infinity;
    var tgt = d.targetAccepted;
    var unlimitedTarget = tgt === null || tgt === undefined || tgt === 0 || tgt === Infinity;
    GEN = {
      id: d.id,
      rnd: genRandom(d.seed),
      t0: Date.now(),
      deadline: unlimitedTime ? null : Date.now() + dur,
      target: unlimitedTarget ? null : tgt,
      maxAttempts: d.maxAttempts || 300,
      maxPly: d.maxPly || 3,
      nodeCap: d.nodeCap || 15000,
      candidateTimeMs: d.candidateTimeMs || 400,
      attempts: 0, accepted: 0, rejected: 0, duplicates: 0,
      consecutiveRejects: 0, nodes: 0, solverDepth: 0,
      phase: 'Generating position', reason: null,
      lastMoves: null, lastSide: null, lastKey: null, lastLen: null,
      lastProgressAt: 0, stopping: false, timer: null, seen: Object.create(null)
    };
    genPost('progress');
    GEN.timer = setTimeout(genStep, 0);
  }

  function genStop(silent) {
    if (!GEN) return;
    if (GEN.timer) { clearTimeout(GEN.timer); GEN.timer = null; }
    if (silent) { GEN = null; return; }
    GEN.stopping = true;
    genFinish('stopped');
  }

  self.onmessage = function (e) {
    var d = e.data || {};
    var post = function (msg) { msg.id = d.id; self.postMessage(msg); };

    if (d.type === 'ping') { post({ kind: 'done', res: { ok: true } }); return; }

    if (d.type === 'generatePuzzle') {
      try { genStart(d); }
      catch (err) { GEN = null; post({ kind: 'error', message: 'generator failed to start: ' + ((err && err.message) || err) }); }
      return;
    }
    if (d.type === 'stopGenerate') {
      if (d.id != null && GEN && GEN.id !== d.id) return;
      genStop(false);
      return;
    }

    if (d.type === 'cancel') {
      cancelled = true;
      return;
    }

    try {
      activeId = d.id;
      cancelled = false;

      var engineToUse = (d.engine === 'forge_v3' || d.engineObj === 'XOEngine')
        ? (self.XOEngine || self.XOEnginePro || E)
        : (self.XOEnginePro || self.XOEngine || E);
      var s = rebuild(d, engineToUse);
      var prog = function (p) { post({ kind: 'progress', p: p }); };
      var r;
      if (d.type === 'move') {
        r = engineToUse.chooseMove(s, d.side, d.level, d.timeMs, prog, shouldAbort);
      } else if (d.type === 'analyse') {
        r = engineToUse.analyse(s, d.side, {
          timeMs: d.timeMs, vct: d.vct !== false,
          maxDepth: d.maxDepth, onProgress: prog,
          shouldAbort: shouldAbort
        });
      } else if (d.type === 'threats') {
        r = engineToUse.threatMap(s, d.minLevel || 2);
      } else if (d.type === 'explain') {
        r = engineToUse.explainMove(s, d.idx, d.side);
      } else if (d.type === 'forcing') {
        r = engineToUse.solveForcing(s, d.side, {
          maxPly: d.maxPly || 10, nodes: d.nodes || 80000,
          timeMs: d.timeMs || 2500, vct: true,
          shouldAbort: shouldAbort
        });
      } else {
        throw new Error('unknown request type: ' + d.type);
      }
      activeId = null;
      post({ kind: 'done', res: r });
    } catch (err) {
      activeId = null;
      post({ kind: 'error', message: (err && err.message) || String(err) });
    }
  };
})(typeof self !== 'undefined' ? self : this);
