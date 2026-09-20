/* ===========================================================
   XO 5-in-a-Row Engine  (UI-independent, testable)
   Player 1 = X (human, red).  Player 2 = O (AI, blue).
   Evaluation sign: positive = good for O, negative = good for X.
   =========================================================== */
(function (root) {
  'use strict';

  var SIZE = 15;
  var LEN = SIZE * SIZE;
  var X = 1, O = 2;
  var MATE = 10000000;          // a real five-in-a-row
  var MATE_THRESHOLD = 9000000; // scores above this are forced wins

  /* ---------- line geometry ---------- */
  // 4 directions: 0 = horizontal, 1 = vertical, 2 = diag ↘, 3 = diag ↗
  var lines = [];                 // lines[id] = Int16Array of cell indices
  var cellLines = new Int16Array(LEN * 4); // cellLines[i*4+dir] = line id
  var cellPos = new Int16Array(LEN * 4);   // position within that line

  function buildLines() {
    function addLine(cells, dir) {
      var id = lines.length;
      lines.push(Int16Array.from(cells));
      for (var k = 0; k < cells.length; k++) {
        cellLines[cells[k] * 4 + dir] = id;
        cellPos[cells[k] * 4 + dir] = k;
      }
      return id;
    }
    var x, y, cells;
    for (y = 0; y < SIZE; y++) {
      cells = [];
      for (x = 0; x < SIZE; x++) cells.push(y * SIZE + x);
      addLine(cells, 0);
    }
    for (x = 0; x < SIZE; x++) {
      cells = [];
      for (y = 0; y < SIZE; y++) cells.push(y * SIZE + x);
      addLine(cells, 1);
    }
    // ↘ : constant (x - y)
    for (var d = -(SIZE - 1); d <= SIZE - 1; d++) {
      cells = [];
      for (y = 0; y < SIZE; y++) { x = y + d; if (x >= 0 && x < SIZE) cells.push(y * SIZE + x); }
      addLine(cells, 2);
    }
    // ↗ : constant (x + y)
    for (var s = 0; s <= 2 * (SIZE - 1); s++) {
      cells = [];
      for (y = 0; y < SIZE; y++) { x = s - y; if (x >= 0 && x < SIZE) cells.push(y * SIZE + x); }
      addLine(cells, 3);
    }
  }
  buildLines();

  /* ---------- pattern table ----------
     Line strings are padded with '2' (a wall behaves like an enemy stone).
     Patterns are matched in priority order; matched regions are masked out
     so that e.g. an open four is not also counted as two simple fours.     */
  var S_FIVE = MATE;
  var PATTERNS = [
    ['11111', S_FIVE],
    ['011110', 500000],   // open four - unstoppable
    ['011112', 60000], ['211110', 60000],
    ['10111', 60000], ['11011', 60000], ['11101', 60000],
    ['01110', 40000],     // open three
    ['010110', 35000], ['011010', 35000], // broken three
    ['00111', 3000], ['11100', 3000],
    ['01112', 3000], ['21110', 3000],
    ['010112', 2800], ['211010', 2800],
    ['0110', 1200],       // open two
    ['01010', 1000],
    ['0112', 120], ['2110', 120],
    ['011', 100], ['110', 100]
  ];

  // reusable buffer to avoid allocations in the hot path
  var lineBuf = new Array(SIZE + 2);

  function scoreLine(lineId, player, board) {
    var cells = lines[lineId];
    var n = cells.length;
    if (n < 5) return 0;
    var str = '2';
    for (var k = 0; k < n; k++) {
      var v = board[cells[k]];
      str += v === 0 ? '0' : (v === player ? '1' : '2');
    }
    str += '2';
    if (str.indexOf('1') < 0) return 0;

    var total = 0;
    for (var p = 0; p < PATTERNS.length; p++) {
      var pat = PATTERNS[p][0], val = PATTERNS[p][1];
      var idx = str.indexOf(pat);
      while (idx !== -1) {
        total += val;
        if (val === S_FIVE) return S_FIVE; // early out
        str = str.slice(0, idx) + '.'.repeat(pat.length) + str.slice(idx + pat.length);
        idx = str.indexOf(pat);
      }
    }
    return total;
  }

  /* ---------- game state ---------- */
  function State() {
    this.board = new Int8Array(LEN);
    this.lineX = new Int32Array(lines.length);
    this.lineO = new Int32Array(lines.length);
    this.totalX = 0;
    this.totalO = 0;
    this.moves = [];          // array of cell indices, in order
    this.neighborCount = new Int8Array(LEN); // how many stones within radius 2
    this.stoneCount = 0;
  }

  State.prototype.clone = function () {
    var s = new State();
    s.board.set(this.board);
    s.lineX.set(this.lineX);
    s.lineO.set(this.lineO);
    s.totalX = this.totalX;
    s.totalO = this.totalO;
    s.moves = this.moves.slice();
    s.neighborCount.set(this.neighborCount);
    s.stoneCount = this.stoneCount;
    return s;
  };

  State.prototype.refreshLines = function (idx) {
    for (var d = 0; d < 4; d++) {
      var id = cellLines[idx * 4 + d];
      this.totalX -= this.lineX[id];
      this.totalO -= this.lineO[id];
      this.lineX[id] = scoreLine(id, X, this.board);
      this.lineO[id] = scoreLine(id, O, this.board);
      this.totalX += this.lineX[id];
      this.totalO += this.lineO[id];
    }
  };

  State.prototype.bumpNeighbors = function (idx, delta) {
    var cx = idx % SIZE, cy = (idx / SIZE) | 0;
    for (var dy = -2; dy <= 2; dy++) {
      var ny = cy + dy;
      if (ny < 0 || ny >= SIZE) continue;
      for (var dx = -2; dx <= 2; dx++) {
        var nx = cx + dx;
        if (nx < 0 || nx >= SIZE) continue;
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
  };

  State.prototype.undo = function () {
    var idx = this.moves.pop();
    if (idx === undefined) return -1;
    this.board[idx] = 0;
    this.stoneCount--;
    this.bumpNeighbors(idx, -1);
    this.refreshLines(idx);
    return idx;
  };

  /* score from O's point of view */
  State.prototype.evaluate = function () {
    return this.totalO - this.totalX;
  };

  /* ---------- win detection ---------- */
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  function winningLineAt(board, idx, player) {
    var x0 = idx % SIZE, y0 = (idx / SIZE) | 0;
    for (var d = 0; d < 4; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      var cellsF = [], cellsB = [], i, nx, ny;
      for (i = 1; ; i++) {
        nx = x0 + dx * i; ny = y0 + dy * i;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) break;
        if (board[ny * SIZE + nx] !== player) break;
        cellsF.push(ny * SIZE + nx);
      }
      for (i = 1; ; i++) {
        nx = x0 - dx * i; ny = y0 - dy * i;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) break;
        if (board[ny * SIZE + nx] !== player) break;
        cellsB.push(ny * SIZE + nx);
      }
      if (cellsB.length + 1 + cellsF.length >= 5) {
        return cellsB.reverse().concat([idx], cellsF);
      }
    }
    return null;
  }

  State.prototype.winningLineFor = function (idx) {
    var p = this.board[idx];
    if (!p) return null;
    return winningLineAt(this.board, idx, p);
  };

  State.prototype.isFull = function () { return this.stoneCount >= LEN; };

  /* ---------- candidate move generation ---------- */
  function candidates(state, limit, player) {
    var board = state.board, out = [];
    if (state.stoneCount === 0) return [{ idx: 7 * SIZE + 7, score: 0 }];
    var opp = player === X ? O : X;
    for (var i = 0; i < LEN; i++) {
      if (board[i] !== 0 || state.neighborCount[i] === 0) continue;
      out.push({ idx: i, score: quickScore(state, i, player, opp) });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    if (limit && out.length > limit) out.length = limit;
    return out;
  }

  /* heuristic value of placing at idx: own gain + threat denied */
  function quickScore(state, idx, player, opp) {
    var board = state.board;
    var gainSelf = 0, gainOpp = 0;
    for (var d = 0; d < 4; d++) {
      var id = cellLines[idx * 4 + d];
      var beforeSelf = player === X ? state.lineX[id] : state.lineO[id];
      var beforeOpp = player === X ? state.lineO[id] : state.lineX[id];
      board[idx] = player;
      gainSelf += scoreLine(id, player, board) - beforeSelf;
      board[idx] = opp;
      gainOpp += scoreLine(id, opp, board) - beforeOpp;
      board[idx] = 0;
    }
    // centre bias, tiny
    var cx = idx % SIZE, cy = (idx / SIZE) | 0;
    var centre = 14 - (Math.abs(cx - 7) + Math.abs(cy - 7));
    return gainSelf + gainOpp * 0.95 + centre;
  }

  /* immediate tactics: returns {idx, kind} or null */
  function immediateTactic(state, player) {
    var opp = player === X ? O : X;
    var board = state.board, i;
    // 1. can I win right now?
    for (i = 0; i < LEN; i++) {
      if (board[i] !== 0 || state.neighborCount[i] === 0) continue;
      board[i] = player;
      var w = winningLineAt(board, i, player);
      board[i] = 0;
      if (w) return { idx: i, kind: 'win' };
    }
    // 2. must I block?
    for (i = 0; i < LEN; i++) {
      if (board[i] !== 0 || state.neighborCount[i] === 0) continue;
      board[i] = opp;
      var w2 = winningLineAt(board, i, opp);
      board[i] = 0;
      if (w2) return { idx: i, kind: 'block' };
    }
    return null;
  }

  /* ---------- alpha-beta search ---------- */
  function Search(state, player, opts) {
    this.state = state;
    this.root = player;
    this.opts = opts || {};
    this.deadline = Date.now() + (this.opts.timeMs || 800);
    this.nodes = 0;
    this.aborted = false;
    this.tt = new Map();
  }

  Search.prototype.timeUp = function () {
    if (this.aborted) return true;
    if ((this.nodes & 255) === 0 && Date.now() > this.deadline) this.aborted = true;
    return this.aborted;
  };

  // negamax; score returned from the point of view of `player`
  Search.prototype.negamax = function (depth, alpha, beta, player) {
    this.nodes++;
    if (this.timeUp()) return 0;

    var state = this.state;
    var last = state.moves[state.moves.length - 1];
    if (last !== undefined) {
      var lastPlayer = state.board[last];
      if (winningLineAt(state.board, last, lastPlayer)) {
        // the side that just moved has won -> bad for `player`
        return -(MATE - (20 - depth));
      }
    }
    if (state.isFull()) return 0;
    if (depth <= 0) {
      var e = state.evaluate();
      return player === O ? e : -e;
    }

    var width = this.opts.width || 10;
    if (depth <= 2) width = Math.max(6, width - 4);
    var cands = candidates(state, width, player);
    if (!cands.length) return 0;

    var best = -Infinity;
    for (var c = 0; c < cands.length; c++) {
      state.play(cands[c].idx, player);
      var v = -this.negamax(depth - 1, -beta, -alpha, player === X ? O : X);
      state.undo();
      if (this.aborted) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  };

  /* Root search with iterative deepening.
     Returns {idx, score, depth, nodes, timeMs, mateIn} */
  Search.prototype.run = function () {
    var state = this.state, player = this.root;
    var t0 = Date.now();
    var opp = player === X ? O : X;

    // hard tactics first — never miss a win or an immediate loss
    var tac = immediateTactic(state, player);
    if (tac && tac.kind === 'win') {
      return { idx: tac.idx, score: MATE, depth: 1, nodes: 1, timeMs: Date.now() - t0, mateIn: 1, kind: 'win' };
    }

    var rootWidth = this.opts.rootWidth || 12;
    var cands = candidates(state, rootWidth, player);
    if (!cands.length) return null;
    if (tac && tac.kind === 'block') {
      // force the blocking move to the front, and keep it as a fallback
      var found = cands.filter(function (c) { return c.idx === tac.idx; });
      if (!found.length) cands.unshift({ idx: tac.idx, score: 1e9 });
    }

    var bestMove = cands[0].idx, bestScore = -Infinity, reachedDepth = 0;
    var maxDepth = this.opts.maxDepth || 4;

    for (var depth = 2; depth <= maxDepth; depth += 2) {
      var localBest = -Infinity, localMove = bestMove;
      var alpha = -Infinity, beta = Infinity;
      var ordered = cands.slice();
      // previous best first
      ordered.sort(function (a, b) {
        if (a.idx === bestMove) return -1;
        if (b.idx === bestMove) return 1;
        return b.score - a.score;
      });
      for (var i = 0; i < ordered.length; i++) {
        state.play(ordered[i].idx, player);
        var v = -this.negamax(depth - 1, -beta, -alpha, opp);
        state.undo();
        if (this.aborted) break;
        if (v > localBest) { localBest = v; localMove = ordered[i].idx; }
        if (v > alpha) alpha = v;
      }
      if (this.aborted) break;
      bestMove = localMove;
      bestScore = localBest;
      reachedDepth = depth;
      if (bestScore >= MATE_THRESHOLD) break; // forced win found
      if (Date.now() > this.deadline) break;
    }

    if (bestScore === -Infinity) { bestScore = 0; }
    var mateIn = null;
    if (Math.abs(bestScore) >= MATE_THRESHOLD) {
      var plies = MATE - Math.abs(bestScore);
      mateIn = Math.max(1, Math.ceil((plies + 1) / 2));
    }
    return {
      idx: bestMove,
      score: bestScore,
      depth: reachedDepth,
      nodes: this.nodes,
      timeMs: Date.now() - t0,
      mateIn: mateIn,
      kind: tac && tac.kind === 'block' && bestMove === tac.idx ? 'block' : 'search'
    };
  };

  /* ---------- difficulty profiles ---------- */
  var LEVELS = {
    easy:   { maxDepth: 2, width: 6,  rootWidth: 8,  timeMs: 120,  noise: 0.35 },
    medium: { maxDepth: 4, width: 8,  rootWidth: 10, timeMs: 550,  noise: 0.05 },
    hard:   { maxDepth: 6, width: 10, rootWidth: 14, timeMs: 1600, noise: 0 }
  };

  /* Public: choose a move for `player` at a difficulty. */
  function chooseMove(state, player, difficulty) {
    var lvl = LEVELS[difficulty] || LEVELS.medium;
    var s = new Search(state, player, lvl);
    var res = s.run();
    if (!res) return null;

    // Easy AI is allowed to slip — but never to miss a win or an obvious block.
    if (lvl.noise > 0 && Math.random() < lvl.noise) {
      var tac = immediateTactic(state, player);
      if (!tac) {
        var cands = candidates(state, 6, player);
        if (cands.length > 1) {
          var pick = cands[1 + Math.floor(Math.random() * Math.min(3, cands.length - 1))];
          res = { idx: pick.idx, score: res.score, depth: 1, nodes: res.nodes, timeMs: res.timeMs, mateIn: null, kind: 'casual' };
        }
      }
    }
    return res;
  }

  /* Public: analyse the position (used by the eval bar / best-move display). */
  function analyse(state, sideToMove, budgetMs) {
    var s = new Search(state, sideToMove, { maxDepth: 4, width: 8, rootWidth: 10, timeMs: budgetMs || 300 });
    var res = s.run();
    if (!res) return { score: 0, best: null, mateIn: null };
    // res.score is from sideToMove's view; convert to O-positive
    var oScore = sideToMove === O ? res.score : -res.score;
    return { score: oScore, best: res.idx, mateIn: res.mateIn, depth: res.depth, forcedFor: res.mateIn ? sideToMove : null };
  }

  root.XOEngine = {
    SIZE: SIZE, LEN: LEN, X: X, O: O, MATE: MATE, MATE_THRESHOLD: MATE_THRESHOLD,
    State: State, Search: Search,
    candidates: candidates, quickScore: quickScore, immediateTactic: immediateTactic,
    winningLineAt: winningLineAt, chooseMove: chooseMove, analyse: analyse,
    scoreLine: scoreLine, lines: lines, LEVELS: LEVELS
  };
})(typeof self !== 'undefined' ? self : this);
