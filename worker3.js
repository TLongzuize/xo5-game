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
   worker -> main : { id, kind:'progress', p:{depth,score,best,pv,candidates,nodes,timeMs} }
                    { id, kind:'done', res:<result> }
                    { id, kind:'error', message:<string> }
                    { id, kind:'cancelled' }

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

  self.onmessage = function (e) {
    var d = e.data || {};
    var post = function (msg) { msg.id = d.id; self.postMessage(msg); };

    if (d.type === 'ping') { post({ kind: 'done', res: { ok: true } }); return; }

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

      var s = rebuild(d);
      var prog = function (p) { post({ kind: 'progress', p: p }); };
      var r;
      if (d.type === 'move') {
        r = E.chooseMove(s, d.side, d.level, d.timeMs, prog, shouldAbort);
      } else if (d.type === 'analyse') {
        r = E.analyse(s, d.side, {
          timeMs: d.timeMs, vct: d.vct !== false,
          maxDepth: d.maxDepth, onProgress: prog,
          shouldAbort: shouldAbort
        });
      } else if (d.type === 'threats') {
        r = E.threatMap(s, d.minLevel || 2);
      } else if (d.type === 'explain') {
        r = E.explainMove(s, d.idx, d.side);
      } else if (d.type === 'forcing') {
        r = E.solveForcing(s, d.side, {
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
