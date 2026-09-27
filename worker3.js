/* =========================================================================
   worker3.js — Web Worker dispatcher for engine3.js
   -------------------------------------------------------------------------
   This file is concatenated AFTER engine3.js inside the Blob that app3.js
   turns into a Worker, so `XOEngine` is already defined on `self` here.

   Protocol
   --------
   main -> worker : { id, type, moves, side, ... }
       type = 'move'    : chooseMove   (AI move selection)
              'analyse' : analyse      (evaluation / PV / candidates)
              'threats' : threatMap
              'explain' : explainMove
              'forcing' : solveForcing (puzzle verification)
              'cancel'  : cancel the current in-progress search (id = request being cancelled)
              'ping'    : readiness probe
              'generatePuzzle' : start a streaming puzzle-generation session
              'stopGenerate'   : ask a generation session to stop at the next slice boundary
   worker -> main : { id, kind:'progress', p:{depth,score,best,pv,candidates,nodes,timeMs} }
                    { id, kind:'done', res:<result> }
                    { id, kind:'error', message:<string> }
                    { id, kind:'cancelled' }

   Generation protocol (streaming — many replies per request)
   ----------------------------------------------------------
   main -> worker : { type:'generatePuzzle', id, seed, durationMs, targetAccepted,
                      maxAttempts, maxPly, nodeCap, candidateTimeMs }
                    durationMs      — session limit in ms; null/0/Infinity = Unlimited.
                    targetAccepted  — stop once this many puzzles were accepted;
                                      null/0/Infinity = Unlimited.
                    maxAttempts     — STALL GUARD, not a session cap: the number of
                                      CONSECUTIVE rejected candidates tolerated before
                                      the session ends with reason 'exhausted'. A cap on
                                      total attempts would contradict Unlimited mode.
                    maxPly/nodeCap/candidateTimeMs — per-candidate bounds. These always
                                      apply; an Unlimited SESSION never means unlimited
                                      work for a single candidate.
   worker -> main : { id, kind:'progress',  progress:{...} }      throttled, ~every 90ms
                    { id, kind:'candidate', progress:{...} }      live candidate board
                    { id, kind:'accepted',  puzzle:{...}, progress:{...} }  sent IMMEDIATELY
                    { id, kind:'generated-done', reason, progress:{...} }
                    { id, kind:'error', message }

   The worker runs generation in short slices scheduled through setTimeout so that
   'stopGenerate' is actually delivered while a session is running — a synchronous
   loop would starve the worker's own message queue and make Stop a lie.

   Every reply carries the request `id`. The main thread owns the search-ID
   bookkeeping; the worker never guesses which request is current.

   Cooperative cancellation: the worker supports type:'cancel' messages that
   set a flag checked by the engine's shouldAbort() callback between iterations.
   For truly synchronous code (e.g. a single deep negamax call that does not
   yield), the main thread should still terminate+respawn as a safety fallback.
   ========================================================================= */
(function (self) {
  'use strict';
  var E = self.XOEngine;

  /* Active search state for cooperative cancellation */
  var activeId = null;
  var cancelled = false;

  function shouldAbort() {
    return cancelled;
  }

  function rebuild(d) {
    var s = new E.State();
    var i;
    if (d.root && d.root.length) {
      /* An edited/analysis root: stones are laid down directly. State.play()
         keeps every incremental structure in sync, so laying out a root this
         way is safe even when the stone counts are uneven. */
      for (i = 0; i < d.root.length; i++) if (d.root[i]) s.play(i, d.root[i]);
    }
    var ms = d.moves || [];
    for (i = 0; i < ms.length; i++) s.play(ms[i][0], ms[i][1]);
    return s;
  }

  /* =====================================================================
     PUZZLE GENERATOR
     ---------------------------------------------------------------------
     Produces Gomoku positions in which the side to move has a forced win
     that engine3's own solveForcing() can PROVE. Nothing here evaluates,
     guesses or scores a position: a candidate is accepted only when the
     real solver returns win === true, aborted === false and a sequence of
     length 1 or 3. Anything else is a rejection with a stated reason.

     Both X and O are supported as the puzzle side. Stone parity is what
     decides it: a `moves` array is replayed alternately starting with X,
     so an even-length array leaves X to move and an odd-length array
     leaves O to move. That is exactly the app's own turn-order rule, so a
     generated puzzle needs no side field to replay correctly — the field
     is stored anyway, for display and for deduplication.
     ===================================================================== */
  var GEN_SOLVER_VERSION = 'engine3.solveForcing/1';

  var SIZE = E.SIZE, LEN = E.LEN, X = E.X, O = E.O;

  /* Local seeded PRNG. engine3 keeps its own private copy for Zobrist keys;
     duplicating six lines here is far cheaper than widening the engine's
     public surface for a feature the engine does not need to know about. */
  function genRandom(seed) {
    var a = (seed | 0) || 0x5EED1234;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* Canonical dedupe key. Sorted "cell+owner" pairs plus the side to move,
     so the SAME board with the opposite side to move is a DIFFERENT puzzle
     (it is: the two positions have different solutions, or none). The main
     thread recomputes this independently and does not trust the worker's. */
  function genCanonKey(moves, side) {
    var parts = [], i;
    for (i = 0; i < moves.length; i++) parts.push(moves[i] + (i % 2 === 0 ? 'x' : 'o'));
    parts.sort();
    return parts.join('.') + '#' + (side === X ? 'X' : 'O');
  }

  /* Build one legal candidate position with `wantSide` to move.
     Stones alternate X,O,X,O… from an empty board, are grown around the
     centre, never overwrite an occupied cell, and never complete a five —
     so the position can never be already won when the puzzle begins. */
  function genCandidate(rnd, wantSide) {
    var stones = 6 + ((rnd() * 9) | 0);                   // 6..14 initial stones
    if (wantSide === X) { if (stones % 2) stones++; }      // even  -> X to move
    else { if (stones % 2 === 0) stones++; }               // odd   -> O to move
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
      if (s.board[idx]) continue;                          // never overwrite
      s.play(idx, player);
      if (E.winningLineAt(s.board, idx, player)) { s.undo(); continue; }  // never already won
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

  /* One generation slice. Runs candidates for at most SLICE_MS, then yields
     to the worker's message loop so a 'stopGenerate' can actually land.
     The host may lower this: when there is no real Worker, app3 runs this
     very same source on the main thread and wants shorter slices so the
     page keeps painting. */
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
      /* The side NOT to move must not already be threatening five: that is a
         lost position, not a puzzle. */
      if (E.winningCells(c.state, opp).length) { genReject('opponent already threatens five'); continue; }
      /* More than one immediate five for the attacker means the game is over
         regardless of what anyone plays — nothing to solve. */
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

      /* ACCEPTED. Post it now — not at the end of the session. */
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
    genStop(true);                                   // never run two sessions at once
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
      /* Only stop the session this message names. Without the id check a
         stop meant for a session that has already ended would arrive after
         its successor started and kill the wrong one — messages are queued,
         so a stop and the next start can cross. */
      if (d.id != null && GEN && GEN.id !== d.id) return;
      genStop(false);
      return;
    }

    /* Cooperative cancel: set the flag so the current search's shouldAbort()
       returns true. The search will finish its current depth cleanly, then
       return the best result found so far. The 'done' message posted after the
       search completes will carry the partially-completed result; the main
       thread's generation counter is what determines whether to use it or not. */
    if (d.type === 'cancel') {
      cancelled = true;
      /* No reply needed — the 'done' reply for the active search serves as ACK */
      return;
    }

    try {
      /* Start a new search: reset cancel flag and record active id */
      activeId = d.id;
      cancelled = false;

      var engineToUse = (d.engine === 'forge_v3_pro' || d.engineObj === 'XOEnginePro')
        ? (self.XOEnginePro || self.XOEngine || E)
        : (self.XOEngine || self.XOEnginePro || E);
      var s = rebuild(d);
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
