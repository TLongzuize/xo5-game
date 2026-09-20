/* ===========================================================
   XO 5-in-a-Row Engine v2   (UI-independent, testable)
   Player 1 = X (human, red).  Player 2 = O (AI, blue).
   Score sign inside search: negamax (side-to-move positive).
   Score sign exposed to UI: positive = good for O.
   =========================================================== */
(function (root) {
  'use strict';

  var SIZE = 15, LEN = SIZE * SIZE;
  var X = 1, O = 2;
  var MATE = 10000000;
  var MATE_T = 9000000;
  var EVAL_CAP = 800000;

  /* ---------- deterministic PRNG (for Zobrist) ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- Zobrist ---------- */
  var ZA = new Int32Array(LEN * 2), ZB = new Int32Array(LEN * 2), Z_SIDE_A, Z_SIDE_B;
  (function () {
    var rnd = mulberry32(0x5EED1234);
    for (var i = 0; i < LEN * 2; i++) {
      ZA[i] = (rnd() * 4294967296) | 0;
      ZB[i] = (rnd() * 4294967296) | 0;
    }
    Z_SIDE_A = (rnd() * 4294967296) | 0;
    Z_SIDE_B = (rnd() * 4294967296) | 0;
  })();
  function hashKey(a, b) {
    // 53-bit safe numeric key: 32 bits of a, 21 bits of b
    return (a >>> 0) * 2097152 + ((b >>> 0) % 2097152);
  }

  /* ---------- line geometry ---------- */
  var lines = [];
  var cellLines = new Int16Array(LEN * 4);
  (function buildLines() {
    function add(cells, dir) {
      var id = lines.length;
      lines.push(Int16Array.from(cells));
      for (var k = 0; k < cells.length; k++) cellLines[cells[k] * 4 + dir] = id;
    }
    var x, y, c;
    for (y = 0; y < SIZE; y++) { c = []; for (x = 0; x < SIZE; x++) c.push(y * SIZE + x); add(c, 0); }
    for (x = 0; x < SIZE; x++) { c = []; for (y = 0; y < SIZE; y++) c.push(y * SIZE + x); add(c, 1); }
    for (var d = -(SIZE - 1); d <= SIZE - 1; d++) {
      c = []; for (y = 0; y < SIZE; y++) { x = y + d; if (x >= 0 && x < SIZE) c.push(y * SIZE + x); } add(c, 2);
    }
    for (var s = 0; s <= 2 * (SIZE - 1); s++) {
      c = []; for (y = 0; y < SIZE; y++) { x = s - y; if (x >= 0 && x < SIZE) c.push(y * SIZE + x); } add(c, 3);
    }
  })();

  /* ---------- pattern table over 6-cell windows ----------
     A window is 6 cells, each 0 (empty) / 1 (self) / 2 (opponent or wall).
     Highest-valued pattern contained in the window defines its score.     */
  var PAT = [
    ['11111', 100000],   // five
    ['011110', 15000],   // open four
    ['011112', 4200], ['211110', 4200],
    ['10111', 4200], ['11011', 4200], ['11101', 4200],
    ['01110', 1600],     // open three
    ['010110', 1400], ['011010', 1400],
    ['001112', 260], ['211100', 260], ['01112', 260], ['21110', 260],
    ['011', 0], // placeholder, replaced below
    ['0110', 180],       // open two
    ['01010', 150],
    ['0112', 22], ['2110', 22],
    ['110', 12], ['011', 12], ['101', 12]
  ].filter(function (p) { return p[1] > 0; });

  var WIN_SCORE = new Int32Array(729);
  (function buildTable() {
    for (var code = 0; code < 729; code++) {
      var c = code, s = '';
      for (var k = 0; k < 6; k++) { s = (c % 3) + s; c = (c / 3) | 0; }
      var val = 0;
      for (var p = 0; p < PAT.length; p++) {
        if (s.indexOf(PAT[p][0]) >= 0) { val = PAT[p][1]; break; }
      }
      WIN_SCORE[code] = val;
    }
  })();

  var digits = new Int8Array(SIZE + 2);
  function scoreLine(lineId, player, board) {
    var cells = lines[lineId], n = cells.length;
    if (n < 5) return 0;
    var i, v, any = false;
    digits[0] = 2;
    for (i = 0; i < n; i++) {
      v = board[cells[i]];
      if (v === 0) digits[i + 1] = 0;
      else if (v === player) { digits[i + 1] = 1; any = true; }
      else digits[i + 1] = 2;
    }
    digits[n + 1] = 2;
    if (!any) return 0;
    var total = 0, len = n + 2;
    var code = 0;
    for (i = 0; i < 6 && i < len; i++) code = code * 3 + digits[i];
    if (len >= 6) {
      total += WIN_SCORE[code];
      for (i = 6; i < len; i++) {
        code = (code % 243) * 3 + digits[i];
        total += WIN_SCORE[code];
      }
    }
    return total;
  }

  /* ---------- state ---------- */
  function State() {
    this.board = new Int8Array(LEN);
    this.lineX = new Int32Array(lines.length);
    this.lineO = new Int32Array(lines.length);
    this.totalX = 0; this.totalO = 0;
    this.moves = [];
    this.neighborCount = new Int8Array(LEN);
    this.stoneCount = 0;
    this.hA = 0; this.hB = 0;
  }

  State.prototype.refreshLines = function (idx) {
    for (var d = 0; d < 4; d++) {
      var id = cellLines[idx * 4 + d];
      this.totalX -= this.lineX[id]; this.totalO -= this.lineO[id];
      this.lineX[id] = scoreLine(id, X, this.board);
      this.lineO[id] = scoreLine(id, O, this.board);
      this.totalX += this.lineX[id]; this.totalO += this.lineO[id];
    }
  };
  State.prototype.bumpNeighbors = function (idx, delta) {
    var cx = idx % SIZE, cy = (idx / SIZE) | 0;
    for (var dy = -2; dy <= 2; dy++) {
      var ny = cy + dy; if (ny < 0 || ny >= SIZE) continue;
      for (var dx = -2; dx <= 2; dx++) {
        var nx = cx + dx; if (nx < 0 || nx >= SIZE) continue;
        if (dx === 0 && dy === 0) continue;
        this.neighborCount[ny * SIZE + nx] += delta;
      }
    }
  };
  State.prototype.play = function (idx, player) {
    this.board[idx] = player;
    this.moves.push(idx);
    this.stoneCount++;
    this.bumpNeighbors(idx, 1);
    this.refreshLines(idx);
    var zi = idx * 2 + (player - 1);
    this.hA ^= ZA[zi]; this.hB ^= ZB[zi];
  };
  State.prototype.undo = function () {
    var idx = this.moves.pop();
    if (idx === undefined) return -1;
    var player = this.board[idx];
    var zi = idx * 2 + (player - 1);
    this.hA ^= ZA[zi]; this.hB ^= ZB[zi];
    this.board[idx] = 0;
    this.stoneCount--;
    this.bumpNeighbors(idx, -1);
    this.refreshLines(idx);
    return idx;
  };
  State.prototype.key = function (sideToMove) {
    var a = this.hA, b = this.hB;
    if (sideToMove === O) { a ^= Z_SIDE_A; b ^= Z_SIDE_B; }
    return hashKey(a, b);
  };
  State.prototype.evaluate = function () {
    var v = this.totalO - this.totalX;
    return v > EVAL_CAP ? EVAL_CAP : (v < -EVAL_CAP ? -EVAL_CAP : v);
  };
  State.prototype.isFull = function () { return this.stoneCount >= LEN; };
  State.prototype.clone = function () {
    var s = new State();
    s.board.set(this.board); s.lineX.set(this.lineX); s.lineO.set(this.lineO);
    s.totalX = this.totalX; s.totalO = this.totalO;
    s.moves = this.moves.slice(); s.neighborCount.set(this.neighborCount);
    s.stoneCount = this.stoneCount; s.hA = this.hA; s.hB = this.hB;
    return s;
  };

  /* ---------- win detection ---------- */
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  function winningLineAt(board, idx, player) {
    var x0 = idx % SIZE, y0 = (idx / SIZE) | 0;
    for (var d = 0; d < 4; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1], f = [], b = [], i, nx, ny;
      for (i = 1; ; i++) {
        nx = x0 + dx * i; ny = y0 + dy * i;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE || board[ny * SIZE + nx] !== player) break;
        f.push(ny * SIZE + nx);
      }
      for (i = 1; ; i++) {
        nx = x0 - dx * i; ny = y0 - dy * i;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE || board[ny * SIZE + nx] !== player) break;
        b.push(ny * SIZE + nx);
      }
      if (b.length + 1 + f.length >= 5) return b.reverse().concat([idx], f);
    }
    return null;
  }

  /* cells (empty) where `player` would immediately make five */
  function winningCells(state, player, nearIdx) {
    var board = state.board, out = [], seen = {};
    function test(i) {
      if (seen[i] || board[i] !== 0) return;
      seen[i] = 1;
      board[i] = player;
      var w = winningLineAt(board, i, player);
      board[i] = 0;
      if (w) out.push(i);
    }
    if (nearIdx != null) {
      var x0 = nearIdx % SIZE, y0 = (nearIdx / SIZE) | 0;
      for (var d = 0; d < 4; d++) {
        for (var k = -5; k <= 5; k++) {
          if (!k) continue;
          var nx = x0 + DIRS[d][0] * k, ny = y0 + DIRS[d][1] * k;
          if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
          test(ny * SIZE + nx);
        }
      }
    } else {
      for (var i = 0; i < LEN; i++) if (board[i] === 0 && state.neighborCount[i] > 0) test(i);
    }
    return out;
  }

  /* ---------- move generation & ordering ---------- */
  function quickScore(state, idx, player, opp) {
    var board = state.board, gs = 0, go = 0;
    for (var d = 0; d < 4; d++) {
      var id = cellLines[idx * 4 + d];
      var bs = player === X ? state.lineX[id] : state.lineO[id];
      var bo = player === X ? state.lineO[id] : state.lineX[id];
      board[idx] = player; gs += scoreLine(id, player, board) - bs;
      board[idx] = opp;    go += scoreLine(id, opp, board) - bo;
      board[idx] = 0;
    }
    var cx = idx % SIZE, cy = (idx / SIZE) | 0;
    return gs + go * 0.95 + (14 - (Math.abs(cx - 7) + Math.abs(cy - 7)));
  }

  function candidates(state, limit, player) {
    if (state.stoneCount === 0) return [{ idx: 7 * SIZE + 7, score: 0 }];
    var board = state.board, opp = player === X ? O : X, out = [];
    for (var i = 0; i < LEN; i++) {
      if (board[i] !== 0 || state.neighborCount[i] === 0) continue;
      out.push({ idx: i, score: quickScore(state, i, player, opp) });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    if (limit && out.length > limit) out.length = limit;
    return out;
  }

  function immediateTactic(state, player) {
    var opp = player === X ? O : X;
    var mine = winningCells(state, player);
    if (mine.length) return { idx: mine[0], kind: 'win' };
    var theirs = winningCells(state, opp);
    if (theirs.length) return { idx: theirs[0], kind: 'block', all: theirs };
    return null;
  }

  /* ---------- VCF / VCT solver ----------
     VCF: only moves that create at least one immediate five-threat (a "four").
     VCT: also allows open threes; opponent replies are restricted to the
     standard defensive set (block points + own counter-fours).            */
  function threatMoves(state, player, includeThrees) {
    var board = state.board, out = [];
    for (var i = 0; i < LEN; i++) {
      if (board[i] !== 0 || state.neighborCount[i] === 0) continue;
      board[i] = player;
      var wins = winningCells(state, player, i);
      var isFour = wins.length > 0;
      var open3 = false;
      if (!isFour && includeThrees) {
        // an open three is a move after which a four with two completion
        // points becomes available next move
        for (var d = 0; d < 4 && !open3; d++) {
          var id = cellLines[i * 4 + d];
          var sc = scoreLine(id, player, board);
          board[i] = 0;
          var before = scoreLine(id, player, board);
          board[i] = player;
          if (sc - before >= 1600) open3 = true;
        }
      }
      board[i] = 0;
      if (isFour || open3) out.push({ idx: i, n: wins.length, three: open3 && !isFour });
    }
    out.sort(function (a, b) { return b.n - a.n; });
    return out;
  }

  function solveForcing(state, player, opts) {
    opts = opts || {};
    var maxPly = opts.maxPly || 8;
    var nodeCap = opts.nodes || 20000;
    var includeThrees = !!opts.vct;
    var deadline = Date.now() + (opts.timeMs || 600);
    var opp = player === X ? O : X;
    var nodes = 0, aborted = false;

    function rec(ply) {
      if (ply > maxPly) return null;
      if (++nodes > nodeCap || Date.now() > deadline) { aborted = true; return null; }
      var moves = threatMoves(state, player, includeThrees);
      for (var m = 0; m < moves.length; m++) {
        var idx = moves[m].idx;
        state.play(idx, player);
        if (winningLineAt(state.board, idx, player)) { state.undo(); return [idx]; }
        var myWins = winningCells(state, player, idx);
        var res = null;
        if (myWins.length >= 2) { state.undo(); return [idx]; }
        if (myWins.length === 1) {
          var blk = myWins[0];
          state.play(blk, opp);
          if (!winningLineAt(state.board, blk, opp)) {
            var oppWins = winningCells(state, opp);
            if (!oppWins.length) {   // defender did not create a winning counter-threat
              var sub = rec(ply + 2);
              if (sub) res = [idx, blk].concat(sub);
            }
          }
          state.undo();
        } else if (includeThrees && moves[m].three) {
          // open three: try each defensive reply; all must lose for us to win
          var defs = defensiveReplies(state, opp, idx);
          if (defs.length && defs.length <= 6) {
            var allLose = true, firstLine = null;
            for (var r = 0; r < defs.length && allLose; r++) {
              state.play(defs[r], opp);
              var oppImmediate = winningLineAt(state.board, defs[r], opp) || winningCells(state, opp).length;
              var sub2 = oppImmediate ? null : rec(ply + 2);
              state.undo();
              if (!sub2) allLose = false; else if (!firstLine) firstLine = [defs[r]].concat(sub2);
            }
            if (allLose && firstLine) res = [idx].concat(firstLine);
          }
        }
        state.undo();
        if (res) return res;
        if (aborted) return null;
      }
      return null;
    }

    var seq = rec(0);
    return { win: !!seq, seq: seq || [], nodes: nodes, aborted: aborted };
  }

  function defensiveReplies(state, defender, threatIdx) {
    var attacker = defender === X ? O : X;
    var board = state.board, out = [], seen = {};
    // squares on the threat lines that reduce the attacker's score, plus own fours
    var x0 = threatIdx % SIZE, y0 = (threatIdx / SIZE) | 0;
    for (var d = 0; d < 4; d++) {
      for (var k = -4; k <= 4; k++) {
        var nx = x0 + DIRS[d][0] * k, ny = y0 + DIRS[d][1] * k;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
        var i = ny * SIZE + nx;
        if (board[i] !== 0 || seen[i]) continue;
        var id = cellLines[i * 4 + d];
        var before = scoreLine(id, attacker, board);
        board[i] = defender;
        var after = scoreLine(id, attacker, board);
        board[i] = 0;
        if (after < before) { seen[i] = 1; out.push(i); }
      }
    }
    var own = threatMoves(state, defender, false);
    for (var m = 0; m < own.length && m < 3; m++) if (!seen[own[m].idx]) { seen[own[m].idx] = 1; out.push(own[m].idx); }
    return out;
  }

  /* ---------- transposition table ---------- */
  var TT_MAX = 180000;
  function TT() { this.map = new Map(); this.hits = 0; this.probes = 0; }
  TT.prototype.get = function (key) {
    this.probes++;
    var e = this.map.get(key);
    if (e) this.hits++;
    return e;
  };
  TT.prototype.set = function (key, entry) {
    if (this.map.size >= TT_MAX) this.map.clear();
    this.map.set(key, entry);
  };

  /* ---------- search ---------- */
  function Search(state, player, opts) {
    this.state = state;
    this.root = player;
    this.opts = opts || {};
    this.tt = opts && opts.tt ? opts.tt : new TT();
    this.deadline = Date.now() + (this.opts.timeMs || 1000);
    this.nodes = 0;
    this.aborted = false;
    this.killers = [];
    this.maxExt = this.opts.maxExt == null ? 4 : this.opts.maxExt;
  }

  Search.prototype.timeUp = function () {
    if (this.aborted) return true;
    if ((this.nodes & 511) === 0 && Date.now() > this.deadline) this.aborted = true;
    return this.aborted;
  };

  Search.prototype.width = function (depth) {
    var base = this.opts.width || 10;
    if (depth >= 6) return base;
    if (depth >= 4) return Math.max(6, base - 2);
    return Math.max(5, base - 4);
  };

  Search.prototype.negamax = function (depth, alpha, beta, player, ply, ext) {
    this.nodes++;
    if (this.timeUp()) return 0;
    var state = this.state, opp = player === X ? O : X;

    var last = state.moves[state.moves.length - 1];
    if (last !== undefined && winningLineAt(state.board, last, state.board[last])) {
      return -(MATE - ply);
    }
    if (state.isFull()) return 0;

    var alphaOrig = alpha;
    var key = state.key(player);
    var e = this.tt.get(key);
    var ttMove = -1;
    if (e) {
      ttMove = e.m;
      if (e.d >= depth) {
        if (e.f === 0) return e.s;
        if (e.f === 1 && e.s > alpha) alpha = e.s;
        else if (e.f === 2 && e.s < beta) beta = e.s;
        if (alpha >= beta) return e.s;
      }
    }

    // forced tactics take precedence and are cheap
    var myWins = winningCells(state, player);
    if (myWins.length) return MATE - ply - 1;
    var oppWins = winningCells(state, opp);

    if (depth <= 0) {
      // tactical extension: keep searching while the position is forcing
      if (oppWins.length && ext < this.maxExt) { depth = 1; ext++; }
      else {
        var ev = state.evaluate();
        return player === O ? ev : -ev;
      }
    }

    var moves;
    if (oppWins.length) {
      moves = oppWins.map(function (i) { return { idx: i, score: 1e9 }; });
      if (oppWins.length > 1) return -(MATE - ply - 2); // cannot block two fives
    } else {
      moves = candidates(state, this.width(depth), player);
      var k = this.killers[ply];
      for (var mi = 0; mi < moves.length; mi++) {
        if (moves[mi].idx === ttMove) moves[mi].score += 1e8;
        else if (k && (moves[mi].idx === k[0] || moves[mi].idx === k[1])) moves[mi].score += 5e5;
      }
      moves.sort(function (a, b) { return b.score - a.score; });
    }
    if (!moves.length) return 0;

    var best = -Infinity, bestMove = moves[0].idx;
    for (var c = 0; c < moves.length; c++) {
      state.play(moves[c].idx, player);
      var v = -this.negamax(depth - 1, -beta, -alpha, opp, ply + 1, ext);
      state.undo();
      if (this.aborted) return 0;
      if (v > best) { best = v; bestMove = moves[c].idx; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (!this.killers[ply]) this.killers[ply] = [];
        var kk = this.killers[ply];
        if (kk[0] !== moves[c].idx) { kk[1] = kk[0]; kk[0] = moves[c].idx; }
        break;
      }
    }

    this.tt.set(key, {
      d: depth, s: best, m: bestMove,
      f: best <= alphaOrig ? 2 : (best >= beta ? 1 : 0)
    });
    return best;
  };

  Search.prototype.extractPV = function (maxLen) {
    var state = this.state, player = this.root, pv = [], played = 0, guard = {};
    for (var i = 0; i < (maxLen || 8); i++) {
      var last = state.moves[state.moves.length - 1];
      if (last !== undefined && winningLineAt(state.board, last, state.board[last])) break;
      var e = this.tt.map.get(state.key(player));
      if (!e || e.m == null || e.m < 0 || state.board[e.m] !== 0 || guard[e.m]) break;
      guard[e.m] = 1;
      pv.push(e.m);
      state.play(e.m, player);
      played++;
      player = player === X ? O : X;
    }
    while (played-- > 0) state.undo();
    return pv;
  };

  /* Root search: iterative deepening, keeps deepest COMPLETED iteration. */
  Search.prototype.run = function () {
    var self = this;
    var state = this.state, player = this.root, opp = player === X ? O : X;
    var t0 = Date.now();

    var mine = winningCells(state, player);
    if (mine.length) {
      return finish({ idx: mine[0], score: MATE - 1, depth: 1, mateIn: 1, pv: [mine[0]], completed: true, kind: 'win' });
    }
    var theirs = winningCells(state, opp);

    // forcing-sequence probe (VCF) — only when the position looks tactical
    var forcing = null;
    if (!theirs.length && this.opts.vcf !== false) {
      var probe = solveForcing(state, player, {
        maxPly: this.opts.vcfPly || 8,
        nodes: this.opts.vcfNodes || 12000,
        timeMs: Math.min(400, (this.opts.timeMs || 1000) * 0.3),
        vct: !!this.opts.vct
      });
      if (probe.win) forcing = probe.seq;
    }
    if (forcing && forcing.length) {
      return finish({
        idx: forcing[0], score: MATE - forcing.length, depth: forcing.length,
        mateIn: Math.ceil(forcing.length / 2), pv: forcing.slice(0, 8),
        completed: true, kind: 'vcf'
      });
    }

    var rootWidth = this.opts.rootWidth || 12;
    var cands = candidates(state, rootWidth, player);
    if (theirs.length) {
      var must = theirs[0];
      cands = cands.filter(function (c) { return c.idx === must; });
      if (!cands.length) cands = [{ idx: must, score: 1e9 }];
    }
    if (!cands.length) return null;

    var bestMove = cands[0].idx, bestScore = 0, reached = 0, bestPV = [bestMove];
    var rootScores = {};
    var maxDepth = this.opts.maxDepth || 6;

    for (var depth = 1; depth <= maxDepth; depth++) {
      var localBest = -Infinity, localMove = bestMove, alpha = -Infinity;
      var ordered = cands.slice().sort(function (a, b) {
        if (a.idx === bestMove) return -1;
        if (b.idx === bestMove) return 1;
        return (rootScores[b.idx] == null ? b.score : rootScores[b.idx]) -
               (rootScores[a.idx] == null ? a.score : rootScores[a.idx]);
      });
      var iterScores = {};
      for (var i = 0; i < ordered.length; i++) {
        state.play(ordered[i].idx, player);
        var v = -this.negamax(depth - 1, -Infinity, -alpha, opp, 1, 0);
        state.undo();
        if (this.aborted) break;
        iterScores[ordered[i].idx] = v;
        if (v > localBest) { localBest = v; localMove = ordered[i].idx; }
        if (v > alpha) alpha = v;
      }
      if (this.aborted) break;                 // discard the incomplete iteration
      bestMove = localMove; bestScore = localBest; reached = depth;
      rootScores = iterScores;
      bestPV = this.extractPV(8);
      if (!bestPV.length || bestPV[0] !== bestMove) bestPV = [bestMove];
      if (this.opts.onProgress) {
        this.opts.onProgress({ depth: depth, score: bestScore, best: bestMove, nodes: this.nodes });
      }
      if (Math.abs(bestScore) >= MATE_T) break;
      if (Date.now() > this.deadline) break;
    }

    var cl = [];
    for (var kk in rootScores) cl.push({ idx: +kk, score: rootScores[kk] });
    cl.sort(function (a, b) { return b.score - a.score; });

    return finish({
      idx: bestMove, score: bestScore, depth: reached, pv: bestPV,
      mateIn: Math.abs(bestScore) >= MATE_T ? Math.max(1, Math.ceil((MATE - Math.abs(bestScore)) / 2)) : null,
      completed: !this.aborted, candidates: cl.slice(0, 5),
      kind: theirs.length ? 'block' : 'search'
    });

    function finish(r) {
      r.nodes = self.nodes;
      r.timeMs = Date.now() - t0;
      r.ttHits = self.tt.hits; r.ttProbes = self.tt.probes;
      r.stoppedByTime = !!self.aborted;
      if (!r.candidates) r.candidates = [];
      if (!r.pv) r.pv = [r.idx];
      return r;
    }
  };
  /* ---------- difficulty ---------- */
  var LEVELS = {
    easy:   { maxDepth: 3,  width: 6,  rootWidth: 8,  timeMs: 250,  noise: 0.35, vcf: false, vct: false, maxExt: 1 },
    medium: { maxDepth: 6,  width: 8,  rootWidth: 10, timeMs: 800,  noise: 0.04, vcf: true,  vct: false, maxExt: 2 },
    hard:   { maxDepth: 12, width: 10, rootWidth: 14, timeMs: 2000, noise: 0,    vcf: true,  vct: true,  maxExt: 4 }
  };

  function withTime(level, timeMs) {
    var o = Object.assign({}, LEVELS[level] || LEVELS.medium);
    if (timeMs) o.timeMs = timeMs;
    return o;
  }

  function chooseMove(state, player, difficulty, timeMs, onProgress) {
    var o = withTime(difficulty, timeMs);
    o.onProgress = onProgress;
    var s = new Search(state, player, o);
    var res = s.run();
    if (!res) return null;
    if (o.noise > 0 && Math.random() < o.noise && !immediateTactic(state, player)) {
      var c = candidates(state, 6, player);
      if (c.length > 1) {
        var pick = c[1 + Math.floor(Math.random() * Math.min(3, c.length - 1))];
        res.idx = pick.idx; res.kind = 'casual'; res.pv = [pick.idx]; res.mateIn = null;
      }
    }
    return res;
  }

  /* Analysis: returns O-positive score plus engine telemetry. */
  function analyse(state, sideToMove, opts) {
    opts = opts || {};
    var o = {
      maxDepth: opts.maxDepth || 12,
      width: opts.width || 10,
      rootWidth: opts.rootWidth || 12,
      timeMs: opts.timeMs || 1000,
      vcf: opts.vcf !== false, vct: !!opts.vct, maxExt: 4,
      onProgress: opts.onProgress
    };
    var s = new Search(state, sideToMove, o);
    var res = s.run();
    if (!res) return { score: 0, best: null, mateIn: null, depth: 0, nodes: 0, timeMs: 0, pv: [], candidates: [] };
    var flip = sideToMove === O ? 1 : -1;
    return {
      score: res.score * flip,
      rawScore: res.score,
      best: res.idx,
      mateIn: res.mateIn,
      mateFor: res.mateIn ? (res.score > 0 ? sideToMove : (sideToMove === X ? O : X)) : null,
      depth: res.depth, nodes: res.nodes, timeMs: res.timeMs,
      ttHits: res.ttHits, ttProbes: res.ttProbes,
      stoppedByTime: res.stoppedByTime,
      pv: res.pv, kind: res.kind,
      candidates: res.candidates.map(function (c) { return { idx: c.idx, score: c.score * flip }; })
    };
  }

  /* ---------- threat map & explanations ---------- */
  function patternLevel(state, idx, player) {
    var board = state.board;
    if (board[idx] !== 0) return 0;
    board[idx] = player;
    var win = !!winningLineAt(board, idx, player);
    var wins = win ? 99 : winningCells(state, player, idx).length;
    var gain = 0;
    for (var d = 0; d < 4; d++) {
      var id = cellLines[idx * 4 + d];
      var after = scoreLine(id, player, board);
      board[idx] = 0;
      var before = scoreLine(id, player, board);
      board[idx] = player;
      gain = Math.max(gain, after - before);
    }
    board[idx] = 0;
    if (win) return 5;            // immediate win
    if (wins >= 2) return 4;      // open four / double four
    if (wins === 1) return 3;     // four threat
    if (gain >= 1600) return 2;   // open three
    if (gain >= 180) return 1;    // developing
    return 0;
  }
  var LEVEL_LABEL = { 5: 'Immediate Win', 4: 'Open Four', 3: 'Four Threat', 2: 'Open Three', 1: 'Potential Threat' };

  function threatMap(state, minLevel) {
    minLevel = minLevel || 2;
    var out = [];
    for (var i = 0; i < LEN; i++) {
      if (state.board[i] !== 0 || state.neighborCount[i] === 0) continue;
      var lx = patternLevel(state, i, X), lo = patternLevel(state, i, O);
      if (lx >= minLevel) out.push({ idx: i, player: X, level: lx, label: LEVEL_LABEL[lx] });
      if (lo >= minLevel) out.push({ idx: i, player: O, level: lo, label: LEVEL_LABEL[lo] });
    }
    return out;
  }

  /* Deterministic, pattern-derived explanation of a move already played. */
  function explainMove(stateBefore, idx, player) {
    var opp = player === X ? O : X;
    var mine = patternLevel(stateBefore, idx, player);
    var denied = patternLevel(stateBefore, idx, opp);
    var parts = [];
    if (mine === 5) parts.push('Completes five in a row.');
    else if (mine === 4) parts.push('Creates an open four.');
    else if (mine === 3) parts.push('Creates a four threat.');
    else if (mine === 2) parts.push('Creates an open three.');

    if (denied === 5) parts.unshift('Blocks an immediate winning threat.');
    else if (denied >= 3) parts.unshift('Blocks a four threat.');
    else if (denied === 2) parts.unshift('Blocks an open three.');

    if (mine >= 3 && denied >= 2) parts.push('Defends and attacks at the same time.');
    if (!parts.length) {
      var cx = idx % SIZE, cy = (idx / SIZE) | 0;
      var dist = Math.abs(cx - 7) + Math.abs(cy - 7);
      parts.push(dist <= 4 ? 'Develops toward the center.' : 'Extends play on the flank.');
    }
    return parts.join(' ');
  }

  /* double-threat (fork) detection for a move */
  function isDoubleThreat(state, idx, player) {
    var board = state.board;
    if (board[idx] !== 0) return false;
    board[idx] = player;
    var threats = 0;
    for (var d = 0; d < 4; d++) {
      var id = cellLines[idx * 4 + d];
      var after = scoreLine(id, player, board);
      board[idx] = 0;
      var before = scoreLine(id, player, board);
      board[idx] = player;
      if (after - before >= 1600) threats++;
    }
    board[idx] = 0;
    return threats >= 2;
  }

  root.XOEngine = {
    SIZE: SIZE, LEN: LEN, X: X, O: O, MATE: MATE, MATE_THRESHOLD: MATE_T,
    State: State, Search: Search, TT: TT,
    candidates: candidates, quickScore: quickScore, immediateTactic: immediateTactic,
    winningLineAt: winningLineAt, winningCells: winningCells,
    chooseMove: chooseMove, analyse: analyse, solveForcing: solveForcing,
    threatMap: threatMap, patternLevel: patternLevel, explainMove: explainMove,
    isDoubleThreat: isDoubleThreat, scoreLine: scoreLine, LEVELS: LEVELS
  };
})(typeof self !== 'undefined' ? self : this);
