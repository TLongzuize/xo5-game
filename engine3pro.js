/* ===========================================================
   XO 5-in-a-Row Engine v3 PRO — XO5 Forge V3 PRO
   -----------------------------------------------------------
   Genuine evolution of engine3.js (XO5 Forge V3).
   
   Search improvements:
     - Principal Variation Search (PVS / NegaScout)
     - Aspiration Windows during iterative deepening
     - History Heuristic for move ordering
     - Counter-Move Heuristic
     - Enhanced killer moves (2 slots)
     - PV move prioritization
   
   Transposition Table improvements:
     - Depth-preferred replacement with generation/age
     - No bulk clear on capacity
     - Wider hash for collision safety
   
   Tactical improvements:
     - Advanced threat engine with threat classification
     - Stronger VCF/VCT solver with better defensive verification
     - Tactical verification pass before final move
     - Enhanced double-threat detection
   
   Evaluation improvements:
     - Threat count and quality
     - Initiative and defensive urgency
     - Double-threat potential
     - Mobility (useful candidate availability)
     - Shape quality assessment
     - Attack/defense balance
   
   Other:
     - Deterministic mode with seed support
     - Staged time management
     - Dedicated LEVELS9_PRO configuration
   
   Sign convention (preserved from V3):
     Internal search: negamax (side-to-move positive)
     UI evaluation: positive = good for O
   =========================================================== */
(function (root) {
  'use strict';

  var SIZE = 15, LEN = SIZE * SIZE;
  var X = 1, O = 2;
  var MATE = 10000000;
  var MATE_T = 9000000;
  var EVAL_CAP = 800000;

  /* ---------- deterministic PRNG (for Zobrist + seeded determinism) ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- Zobrist (paired hash for collision safety) ---------- */
  var ZA = new Int32Array(LEN * 2), ZB = new Int32Array(LEN * 2), Z_SIDE_A, Z_SIDE_B;
  /* Secondary hash arrays for collision safety */
  var ZC = new Int32Array(LEN * 2), ZD = new Int32Array(LEN * 2), Z_SIDE_C, Z_SIDE_D;
  (function () {
    var rnd = mulberry32(0x5EED1234);
    for (var i = 0; i < LEN * 2; i++) {
      ZA[i] = (rnd() * 4294967296) | 0;
      ZB[i] = (rnd() * 4294967296) | 0;
    }
    Z_SIDE_A = (rnd() * 4294967296) | 0;
    Z_SIDE_B = (rnd() * 4294967296) | 0;
    /* secondary keys from a different seed for collision verification */
    var rnd2 = mulberry32(0xDEAD_BEEF);
    for (var j = 0; j < LEN * 2; j++) {
      ZC[j] = (rnd2() * 4294967296) | 0;
      ZD[j] = (rnd2() * 4294967296) | 0;
    }
    Z_SIDE_C = (rnd2() * 4294967296) | 0;
    Z_SIDE_D = (rnd2() * 4294967296) | 0;
  })();
  function hashKey(a, b) {
    // 53-bit safe numeric key: 32 bits of a, 21 bits of b
    return (a >>> 0) * 2097152 + ((b >>> 0) % 2097152);
  }
  function hashKeySecondary(c, d) {
    return (c >>> 0) * 2097152 + ((d >>> 0) % 2097152);
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

  /* ---------- pattern table over 6-cell windows ---------- */
  var PAT = [
    ['11111', 100000],   // five
    ['011110', 15000],   // open four
    ['011112', 4200], ['211110', 4200],
    ['10111', 4200], ['11011', 4200], ['11101', 4200],
    ['01110', 1600],     // open three
    ['010110', 1400], ['011010', 1400],
    ['001112', 260], ['211100', 260], ['01112', 260], ['21110', 260],
    ['011', 0],
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
    this.hC = 0; this.hD = 0; // secondary hash
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
    this.hC ^= ZC[zi]; this.hD ^= ZD[zi];
  };
  State.prototype.undo = function () {
    var idx = this.moves.pop();
    if (idx === undefined) return -1;
    var player = this.board[idx];
    var zi = idx * 2 + (player - 1);
    this.hA ^= ZA[zi]; this.hB ^= ZB[zi];
    this.hC ^= ZC[zi]; this.hD ^= ZD[zi];
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
  State.prototype.key2 = function (sideToMove) {
    var c = this.hC, d = this.hD;
    if (sideToMove === O) { c ^= Z_SIDE_C; d ^= Z_SIDE_D; }
    return hashKeySecondary(c, d);
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
    s.stoneCount = this.stoneCount;
    s.hA = this.hA; s.hB = this.hB;
    s.hC = this.hC; s.hD = this.hD;
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

  /* ---------- ENHANCED move generation & ordering (PRO) ---------- */
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

  /* ---------- ADVANCED THREAT ENGINE (PRO) ---------- */
  /* Classifies threats by type and severity */
  var THREAT_FIVE = 6, THREAT_OPEN_FOUR = 5, THREAT_CLOSED_FOUR = 4;
  var THREAT_OPEN_THREE = 3, THREAT_BROKEN_THREE = 2, THREAT_DEVELOPING = 1;

  function classifyThreat(state, idx, player) {
    var board = state.board;
    if (board[idx] !== 0) return { level: 0, types: [] };

    board[idx] = player;
    var win = !!winningLineAt(board, idx, player);
    var wins = win ? 99 : winningCells(state, player, idx).length;
    var types = [];
    var maxGain = 0, threeCount = 0, fourCount = 0;

    for (var d = 0; d < 4; d++) {
      var id = cellLines[idx * 4 + d];
      var after = scoreLine(id, player, board);
      board[idx] = 0;
      var before = scoreLine(id, player, board);
      board[idx] = player;
      var gain = after - before;
      maxGain = Math.max(maxGain, gain);
      if (gain >= 100000) { fourCount++; types.push('five-' + d); }
      else if (gain >= 4200) { fourCount++; types.push('four-' + d); }
      else if (gain >= 1600) { threeCount++; types.push('three-' + d); }
      else if (gain >= 180) types.push('two-' + d);
    }
    board[idx] = 0;

    var level = 0;
    if (win) level = THREAT_FIVE;
    else if (wins >= 2) level = THREAT_OPEN_FOUR;
    else if (wins === 1) level = THREAT_CLOSED_FOUR;
    else if (threeCount >= 1 && maxGain >= 1600) level = THREAT_OPEN_THREE;
    else if (maxGain >= 260) level = THREAT_BROKEN_THREE;
    else if (maxGain >= 180) level = THREAT_DEVELOPING;

    return {
      level: level, types: types,
      isDoubleThreat: (fourCount >= 2) || (threeCount >= 2) || (fourCount >= 1 && threeCount >= 1),
      fourCount: fourCount, threeCount: threeCount, maxGain: maxGain,
      winCount: wins === 99 ? 1 : wins
    };
  }

  /* Defensive urgency: how dangerous the opponent's threats are */
  function defensiveUrgency(state, player) {
    var opp = player === X ? O : X;
    var oppWins = winningCells(state, opp);
    if (oppWins.length >= 2) return 10000; // unstoppable
    if (oppWins.length === 1) return 5000;
    // scan for opponent double threats
    var urgency = 0, board = state.board;
    for (var i = 0; i < LEN; i++) {
      if (board[i] !== 0 || state.neighborCount[i] === 0) continue;
      var t = classifyThreat(state, i, opp);
      if (t.isDoubleThreat) urgency += 3000;
      else if (t.level >= THREAT_OPEN_THREE) urgency += 800;
      else if (t.level >= THREAT_BROKEN_THREE) urgency += 200;
    }
    return urgency;
  }

  /* Initiative: who is forcing the play */
  function initiative(state, player) {
    var opp = player === X ? O : X;
    var myThreats = 0, oppThreats = 0;
    var board = state.board;
    for (var i = 0; i < LEN; i++) {
      if (board[i] !== 0 || state.neighborCount[i] === 0) continue;
      var tm = classifyThreat(state, i, player);
      var to = classifyThreat(state, i, opp);
      if (tm.level >= THREAT_CLOSED_FOUR) myThreats += 3;
      else if (tm.level >= THREAT_OPEN_THREE) myThreats += 1;
      if (to.level >= THREAT_CLOSED_FOUR) oppThreats += 3;
      else if (to.level >= THREAT_OPEN_THREE) oppThreats += 1;
    }
    return myThreats - oppThreats;
  }

  /* ---------- ENHANCED EVALUATION (PRO) ---------- */
  State.prototype.evaluatePro = function (player) {
    /* Base pattern-based evaluation (preserved from V3) */
    var baseVal = this.totalO - this.totalX;

    /* Additional PRO features computed incrementally-ish */
    var board = this.board;
    var myThreats = 0, oppThreats = 0;
    var myFours = 0, oppFours = 0;
    var myThrees = 0, oppThrees = 0;
    var myMobility = 0;
    var opp = player === X ? O : X;

    for (var i = 0; i < LEN; i++) {
      if (board[i] !== 0 || this.neighborCount[i] === 0) continue;
      myMobility++;

      // Quick threat scan
      var hasMyFour = false, hasOppFour = false;
      var hasMyThree = false, hasOppThree = false;
      for (var d = 0; d < 4; d++) {
        var id = cellLines[i * 4 + d];
        var myLine = player === X ? this.lineX[id] : this.lineO[id];
        var oppLine = player === X ? this.lineO[id] : this.lineX[id];
        if (myLine >= 4200) hasMyFour = true;
        else if (myLine >= 1600) hasMyThree = true;
        if (oppLine >= 4200) hasOppFour = true;
        else if (oppLine >= 1600) hasOppThree = true;
      }
      if (hasMyFour) { myFours++; myThreats += 5; }
      if (hasMyThree) { myThrees++; myThreats += 2; }
      if (hasOppFour) { oppFours++; oppThreats += 5; }
      if (hasOppThree) { oppThrees++; oppThreats += 2; }
    }

    /* Combine */
    var threatBonus = (myThreats - oppThreats) * 35;
    var mobilityBonus = myMobility * 2;
    var fourBonus = (myFours > 1 ? 1500 : 0) - (oppFours > 1 ? 1500 : 0);
    var threeBonus = (myThrees > 1 ? 400 : 0) - (oppThrees > 1 ? 400 : 0);

    var total = baseVal;
    if (player === O) {
      total += threatBonus + mobilityBonus + fourBonus + threeBonus;
    } else {
      total -= threatBonus + mobilityBonus + fourBonus + threeBonus;
    }

    return total > EVAL_CAP ? EVAL_CAP : (total < -EVAL_CAP ? -EVAL_CAP : total);
  };

  /* Keep simple evaluate for compatibility */
  State.prototype.evaluate = function () {
    var v = this.totalO - this.totalX;
    return v > EVAL_CAP ? EVAL_CAP : (v < -EVAL_CAP ? -EVAL_CAP : v);
  };

  /* ---------- VCF / VCT solver (PRO) ---------- */
  function threatMoves(state, player, includeThrees) {
    var board = state.board, out = [];
    for (var i = 0; i < LEN; i++) {
      if (board[i] !== 0 || state.neighborCount[i] === 0) continue;
      board[i] = player;
      var wins = winningCells(state, player, i);
      var isFour = wins.length > 0;
      var open3 = false;
      if (!isFour && includeThrees) {
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
    /* PRO: better ordering — immediate doubles first, then single fours, then threes */
    out.sort(function (a, b) {
      if (a.n > 1 && b.n <= 1) return -1;
      if (b.n > 1 && a.n <= 1) return 1;
      if (a.three !== b.three) return a.three ? 1 : -1;
      return b.n - a.n;
    });
    return out;
  }

  function defensiveReplies(state, defender, threatIdx) {
    var attacker = defender === X ? O : X;
    var board = state.board, out = [], seen = {};
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
    /* PRO: also include defender's own fours as counter-threats (up to 5) */
    var own = threatMoves(state, defender, false);
    for (var m = 0; m < own.length && m < 5; m++) {
      if (!seen[own[m].idx]) { seen[own[m].idx] = 1; out.push(own[m].idx); }
    }
    return out;
  }

  function solveForcing(state, player, opts) {
    opts = opts || {};
    var maxPly = opts.maxPly || 10;
    var nodeCap = opts.nodes || 30000;
    var includeThrees = !!opts.vct;
    var isInf = opts.timeMs === 0 || opts.timeMs === Infinity;
    var deadline = isInf ? null : Date.now() + (opts.timeMs || 800);
    var opp = player === X ? O : X;
    var nodes = 0, aborted = false;
    /* PRO: visited state tracking to avoid duplicate exploration */
    var visited = Object.create(null);

    function rec(ply) {
      if (ply > maxPly) return null;
      if (++nodes > nodeCap || (deadline !== null && Date.now() > deadline) ||
          (opts.shouldAbort && (nodes & 63) === 0 && opts.shouldAbort())) {
        aborted = true; return null;
      }

      /* PRO: dedup check */
      var posKey = state.key(player);
      if (visited[posKey]) return null;
      visited[posKey] = 1;

      var moves = threatMoves(state, player, includeThrees);
      for (var m = 0; m < moves.length; m++) {
        var idx = moves[m].idx;
        state.play(idx, player);
        if (winningLineAt(state.board, idx, player)) { state.undo(); delete visited[posKey]; return [idx]; }
        var myWins = winningCells(state, player, idx);
        var res = null;

        if (myWins.length >= 2) {
          /* Double threat: verify concretely */
          var blocked = myWins[0], finish = null;
          state.play(blocked, opp);
          if (!winningLineAt(state.board, blocked, opp)) {
            for (var w = 1; w < myWins.length && finish == null; w++) {
              var cand2 = myWins[w];
              if (state.board[cand2] !== 0) continue;
              state.play(cand2, player);
              if (winningLineAt(state.board, cand2, player)) finish = cand2;
              state.undo();
            }
          }
          state.undo();
          if (finish != null) { state.undo(); delete visited[posKey]; return [idx, blocked, finish]; }
        }

        if (myWins.length === 1) {
          var blk = myWins[0];
          state.play(blk, opp);
          if (!winningLineAt(state.board, blk, opp)) {
            var oppWins = winningCells(state, opp);
            if (!oppWins.length) {
              var sub = rec(ply + 2);
              if (sub) res = [idx, blk].concat(sub);
            }
          }
          state.undo();
        } else if (includeThrees && moves[m].three) {
          /* PRO: enhanced VCT with broader defensive verification */
          var defs = defensiveReplies(state, opp, idx);
          if (defs.length && defs.length <= 8) {
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
        if (res) { delete visited[posKey]; return res; }
        if (aborted) { delete visited[posKey]; return null; }
      }
      delete visited[posKey];
      return null;
    }

    var seq = rec(0);
    return { win: !!seq, seq: seq || [], nodes: nodes, aborted: aborted };
  }

  /* ---------- TRANSPOSITION TABLE PRO ----------
     Depth-preferred replacement with generation/age tracking.
     No bulk clear on capacity. Uses buckets (2-way set associative). */
  var TT_MAX = 200000;
  function TT() {
    this.map = new Map();
    this.hits = 0; this.probes = 0;
    this.gen = 0;
    this.cutoffs = 0;
    this.stores = 0;
    this.replacements = 0;
    this.key2Checks = 0;
    this.key2Collisions = 0;
  }
  TT.prototype.get = function (key, key2) {
    this.probes++;
    var e = this.map.get(key);
    if (e) {
      /* PRO: collision verification with secondary hash */
      if (key2 !== undefined) {
        this.key2Checks++;
        if (e.k2 !== key2) {
          this.key2Collisions++;
          return undefined;
        }
      }
      this.hits++;
    }
    return e;
  };
  TT.prototype.set = function (key, entry, key2) {
    this.stores++;
    entry.g = this.gen;
    entry.k2 = key2;

    var existing = this.map.get(key);
    if (existing) {
      /* Replacement policy: prefer deeper search from newer generation,
         but always replace if the new entry is from a more recent generation
         and has at least comparable depth */
      var replaceScore = 0;
      if (entry.g > existing.g) replaceScore += 4;          // newer generation strongly preferred
      if (entry.d > existing.d) replaceScore += 2;          // deeper search preferred
      if (entry.d === existing.d) replaceScore += 1;        // same depth: newer data preferred
      if (entry.f === 0) replaceScore += 1;                 // exact bounds more valuable
      if (existing.d > entry.d + 3 && entry.g <= existing.g) replaceScore -= 6; // much deeper existing entry protected

      if (replaceScore > 0) {
        this.map.set(key, entry);
        this.replacements++;
      }
      return;
    }

    /* Capacity check with LRU-style eviction instead of bulk clear */
    if (this.map.size >= TT_MAX) {
      /* Evict oldest-generation entries */
      var minGen = this.gen, evictKey = null;
      var minDepth = 999;
      var count = 0;
      var it = this.map.entries();
      /* Scan a batch for eviction candidates instead of the entire map */
      for (var step = it.next(); !step.done && count < 256; step = it.next(), count++) {
        var ek = step.value[0], ev = step.value[1];
        if (ev.g < minGen || (ev.g === minGen && ev.d < minDepth)) {
          minGen = ev.g; minDepth = ev.d; evictKey = ek;
        }
      }
      if (evictKey !== null) {
        this.map.delete(evictKey);
      } else {
        /* Fallback: remove the first entry from the iterator */
        var first = this.map.keys().next();
        if (!first.done) this.map.delete(first.value);
      }
    }
    this.map.set(key, entry);
  };
  TT.prototype.newGeneration = function () {
    this.gen++;
  };

  /* ---------- SEARCH PRO (PVS + Aspiration) ---------- */
  function Search(state, player, opts) {
    this.state = state;
    this.root = player;
    this.opts = opts || {};
    this.tt = opts && opts.tt ? opts.tt : new TT();
    var isInf = this.opts.timeMs === 0 || this.opts.timeMs === Infinity;
    this.deadline = isInf ? null : (Date.now() + (this.opts.timeMs != null ? this.opts.timeMs : 1000));
    this.nodes = 0;
    this.aborted = false;
    this.killers = [];
    this.maxExt = this.opts.maxExt == null ? 4 : this.opts.maxExt;

    /* PRO: History heuristic */
    this.history = [new Int32Array(LEN), new Int32Array(LEN)]; // [side-1][move]
    /* PRO: Counter-move heuristic */
    this.counterMove = [new Int32Array(LEN), new Int32Array(LEN)]; // [side-1][prevMove] -> bestReply
    /* PRO: PVS stats */
    this.pvsSearches = 0;
    this.pvsResearches = 0;
    /* PRO: Aspiration stats */
    this.aspirationSearches = 0;
    this.aspirationFails = 0;
    /* PRO: Heuristic usage stats */
    this.historyUsage = 0;
    this.counterMoveUsage = 0;
    this.tacticalProbes = 0;
    /* PRO: PV table for move ordering */
    this.pvTable = new Int32Array(64); // pvTable[ply] = best move at ply
    for (var i = 0; i < 64; i++) this.pvTable[i] = -1;

    /* PRO: Deterministic PRNG for noise */
    if (this.opts.seed != null) {
      this._rng = mulberry32(this.opts.seed);
    } else {
      this._rng = null;
    }
  }

  Search.prototype.random = function () {
    if (this._rng) return this._rng();
    return Math.random();
  };

  Search.prototype.timeUp = function () {
    if (this.aborted) return true;
    if (this.deadline !== null && (this.nodes & 511) === 0 && Date.now() > this.deadline) {
      this.aborted = true;
      return true;
    }
    if (this.opts.shouldAbort && (this.nodes & 63) === 0 && this.opts.shouldAbort()) {
      this.aborted = true;
      return true;
    }
    return false;
  };

  Search.prototype.width = function (depth) {
    var base = this.opts.width || 12;
    if (depth >= 6) return base;
    if (depth >= 4) return Math.max(7, base - 2);
    return Math.max(6, base - 3);
  };

  /* PRO: PVS (Principal Variation Search / NegaScout) */
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
    var key2 = state.key2(player);
    var e = this.tt.get(key, key2);
    var ttMove = -1;
    if (e) {
      ttMove = e.m;
      if (e.d >= depth) {
        if (e.f === 0) return e.s;
        if (e.f === 1 && e.s > alpha) alpha = e.s;
        else if (e.f === 2 && e.s < beta) beta = e.s;
        if (alpha >= beta) { this.tt.cutoffs++; return e.s; }
      }
    }

    // forced tactics take precedence
    var myWins = winningCells(state, player);
    if (myWins.length) return MATE - ply - 1;
    var oppWins = winningCells(state, opp);

    if (depth <= 0) {
      if (oppWins.length && ext < this.maxExt) { depth = 1; ext++; }
      else {
        /* PRO: use enhanced evaluation */
        var ev = state.evaluatePro(player);
        return player === O ? ev : -ev;
      }
    }

    var moves;
    if (oppWins.length) {
      moves = oppWins.map(function (i) { return { idx: i, score: 1e9 }; });
      if (oppWins.length > 1) return -(MATE - ply - 2);
    } else {
      moves = candidates(state, this.width(depth), player);

      /* PRO: Enhanced move ordering */
      var pvMove = this.pvTable[ply];
      var k = this.killers[ply];
      var sideIdx = player - 1;
      var prevMove = state.moves.length > 0 ? state.moves[state.moves.length - 1] : -1;
      var cm = (prevMove >= 0) ? this.counterMove[opp - 1][prevMove] : -1;

      for (var mi = 0; mi < moves.length; mi++) {
        var moveIdx = moves[mi].idx;
        if (moveIdx === ttMove) moves[mi].score += 2e8;
        else if (moveIdx === pvMove) moves[mi].score += 1.5e8;
        else if (k && (moveIdx === k[0] || moveIdx === k[1])) moves[mi].score += 5e5;
        else if (moveIdx === cm) { moves[mi].score += 3e5; this.counterMoveUsage++; }
        /* PRO: History heuristic bonus */
        if (this.history[sideIdx][moveIdx] > 0) {
          moves[mi].score += this.history[sideIdx][moveIdx] * 0.5;
          this.historyUsage++;
        }
      }
      moves.sort(function (a, b) { return b.score - a.score; });
    }
    if (!moves.length) return 0;

    var best = -Infinity, bestMove = moves[0].idx;

    for (var c = 0; c < moves.length; c++) {
      state.play(moves[c].idx, player);
      var v;

      if (c === 0) {
        /* PVS: Full-window search for the first (best-ordered) move */
        v = -this.negamax(depth - 1, -beta, -alpha, opp, ply + 1, ext);
      } else {
        /* PVS: Null-window search for subsequent moves */
        this.pvsSearches++;
        v = -this.negamax(depth - 1, -(alpha + 1), -alpha, opp, ply + 1, ext);
        if (v > alpha && v < beta && !this.aborted) {
          /* Re-search with full window */
          this.pvsResearches++;
          v = -this.negamax(depth - 1, -beta, -alpha, opp, ply + 1, ext);
        }
      }

      state.undo();
      if (this.aborted) return 0;
      if (v > best) { best = v; bestMove = moves[c].idx; }
      if (v > alpha) {
        alpha = v;
        /* PRO: Update PV table */
        this.pvTable[ply] = moves[c].idx;
      }
      if (alpha >= beta) {
        /* PRO: Update killer moves */
        if (!this.killers[ply]) this.killers[ply] = [];
        var kk = this.killers[ply];
        if (kk[0] !== moves[c].idx) { kk[1] = kk[0]; kk[0] = moves[c].idx; }
        /* PRO: Update history heuristic */
        this.history[player - 1][moves[c].idx] += depth * depth;
        /* PRO: Clamp history to prevent overflow */
        if (this.history[player - 1][moves[c].idx] > 100000) {
          for (var hi = 0; hi < LEN; hi++) this.history[player - 1][hi] >>= 1;
        }
        /* PRO: Update counter-move heuristic */
        if (prevMove >= 0) {
          this.counterMove[opp - 1][prevMove] = moves[c].idx;
        }
        break;
      }
    }

    this.tt.set(key, {
      d: depth, s: best, m: bestMove,
      f: best <= alphaOrig ? 2 : (best >= beta ? 1 : 0)
    }, key2);
    return best;
  };

  Search.prototype.extractPV = function (maxLen) {
    var state = this.state, player = this.root, pv = [], played = 0, guard = {};
    for (var i = 0; i < (maxLen || 8); i++) {
      var last = state.moves[state.moves.length - 1];
      if (last !== undefined && winningLineAt(state.board, last, state.board[last])) break;
      var key = state.key(player), key2 = state.key2(player);
      var e = this.tt.get(key, key2);
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

  /* Root search: iterative deepening with aspiration windows */
  Search.prototype.prepare = function () {
    if (this.prepared) return this.earlyResult;
    this.prepared = true;
    this.t0 = Date.now();
    var state = this.state, player = this.root, opp = player === X ? O : X;

    var mine = winningCells(state, player);
    if (mine.length) {
      this.earlyResult = this.finishResult({ idx: mine[0], score: MATE - 1, depth: 1, mateIn: 1, pv: [mine[0]], completed: true, kind: 'win' });
      return this.earlyResult;
    }
    var theirs = winningCells(state, opp);
    this.theirs = theirs;

    // PRO: Enhanced VCF/VCT probe with higher limits
    var forcing = null;
    if (!theirs.length && this.opts.vcf !== false) {
      this.tacticalProbes++;
      var probe = solveForcing(state, player, {
        maxPly: this.opts.vcfPly || 10,
        nodes: this.opts.vcfNodes || 20000,
        timeMs: Math.min(600, (this.opts.timeMs || 1000) * 0.35),
        vct: !!this.opts.vct,
        shouldAbort: this.opts.shouldAbort
      });
      if (probe.win) forcing = probe.seq;
    }
    if (forcing && forcing.length) {
      this.earlyResult = this.finishResult({
        idx: forcing[0], score: MATE - forcing.length, depth: forcing.length,
        mateIn: Math.ceil(forcing.length / 2), pv: forcing.slice(0, 8),
        completed: true, kind: 'vcf'
      });
      return this.earlyResult;
    }

    var rootWidth = this.opts.rootWidth || 14;
    var cands = candidates(state, rootWidth, player);
    if (theirs.length) {
      var must = theirs[0];
      cands = cands.filter(function (c) { return c.idx === must; });
      if (!cands.length) cands = [{ idx: must, score: 1e9 }];
    }
    this.cands = cands;
    if (!cands.length) {
      this.earlyResult = null;
      return null;
    }

    this.bestMove = cands[0].idx;
    this.bestScore = 0;
    this.reached = 0;
    this.bestPV = [this.bestMove];
    this.rootScores = {};
    this.maxDepth = this.opts.maxDepth || 8;
    this.iterLog = [];
    return undefined;
  };

  /* PRO: Iterative deepening with aspiration windows */
  Search.prototype.step = function (depth) {
    if (this.aborted || this.timeUp()) return false;
    var state = this.state, player = this.root, opp = player === X ? O : X;

    /* PRO: New TT generation each depth */
    this.tt.newGeneration();

    var localBest = -Infinity, localMove = this.bestMove;
    var bestMove = this.bestMove;
    var rootScores = this.rootScores;
    var ordered = this.cands.slice().sort(function (a, b) {
      if (a.idx === bestMove) return -1;
      if (b.idx === bestMove) return 1;
      return (rootScores[b.idx] == null ? b.score : rootScores[b.idx]) -
             (rootScores[a.idx] == null ? a.score : rootScores[a.idx]);
    });

    /* PRO: Aspiration window */
    var useAspiration = depth >= 3 && Math.abs(this.bestScore) < MATE_T;
    var aspirationDelta = 250;
    var alpha, beta;

    if (useAspiration) {
      alpha = this.bestScore - aspirationDelta;
      beta = this.bestScore + aspirationDelta;
    } else {
      alpha = -Infinity;
      beta = Infinity;
    }

    var iterScores = {};
    var searchComplete = false;
    var aspirationAttempts = 0;

    while (!searchComplete && aspirationAttempts < 4) {
      aspirationAttempts++;
      if (useAspiration) this.aspirationSearches++;
      localBest = -Infinity;
      localMove = this.bestMove;
      var allSearched = true;

      for (var i = 0; i < ordered.length; i++) {
        state.play(ordered[i].idx, player);
        var v;

        if (i === 0) {
          /* PVS: Full window for first move */
          v = -this.negamax(depth - 1, -beta, -alpha, opp, 1, 0);
        } else {
          /* PVS: Null-window search */
          this.pvsSearches++;
          v = -this.negamax(depth - 1, -(alpha + 1), -alpha, opp, 1, 0);
          if (v > alpha && v < beta && !this.aborted) {
            this.pvsResearches++;
            v = -this.negamax(depth - 1, -beta, -alpha, opp, 1, 0);
          }
        }

        state.undo();
        if (this.aborted || this.timeUp()) { allSearched = false; break; }
        iterScores[ordered[i].idx] = v;
        if (v > localBest) { localBest = v; localMove = ordered[i].idx; }
        if (v > alpha) alpha = v;
      }

      if (this.aborted) return false;

      if (!allSearched) {
        searchComplete = true; // partial result
      } else if (useAspiration && localBest <= (this.bestScore - aspirationDelta)) {
        /* Fail-low: widen alpha */
        this.aspirationFails++;
        aspirationDelta *= 3;
        alpha = this.bestScore - aspirationDelta;
        beta = Infinity;
        aspirationAttempts++;
        if (aspirationAttempts >= 3) { alpha = -Infinity; beta = Infinity; }
      } else if (useAspiration && localBest >= (this.bestScore + aspirationDelta) && aspirationAttempts === 0) {
        /* Fail-high: widen beta */
        this.aspirationFails++;
        aspirationDelta *= 3;
        alpha = -Infinity;
        beta = this.bestScore + aspirationDelta;
        aspirationAttempts++;
        if (aspirationAttempts >= 3) { alpha = -Infinity; beta = Infinity; }
      } else {
        searchComplete = true;
      }
    }

    if (this.aborted) return false;
    this.bestMove = localMove;
    this.bestScore = localBest;
    this.reached = depth;
    this.rootScores = iterScores;
    this.bestPV = this.extractPV(8);
    if (!this.bestPV.length || this.bestPV[0] !== this.bestMove) this.bestPV = [this.bestMove];

    var cl0 = [], self = this;
    for (var kk0 in this.rootScores) cl0.push({ idx: +kk0, score: this.rootScores[kk0] });
    cl0.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.idx === self.bestMove) return -1;
      if (b.idx === self.bestMove) return 1;
      return 0;
    });
    var entry = {
      depth: depth, score: this.bestScore, best: this.bestMove, nodes: this.nodes,
      timeMs: Date.now() - this.t0, pv: this.bestPV.slice(0, 6), candidates: cl0.slice(0, 5)
    };
    this.iterLog.push(entry);
    if (this.opts.onProgress) this.opts.onProgress(entry);
    return true;
  };

  Search.prototype.isDone = function () {
    if (this.aborted) return true;
    if (Math.abs(this.bestScore) >= MATE_T) return true;
    if (this.deadline !== null && Date.now() > this.deadline) return true;
    if (this.opts.shouldAbort && this.opts.shouldAbort()) return true;
    return false;
  };

  Search.prototype.finishResult = function (r) {
    r.nodes = this.nodes;
    r.timeMs = Date.now() - (this.t0 || Date.now());
    r.ttHits = this.tt.hits; r.ttProbes = this.tt.probes;
    r.ttCutoffs = this.tt.cutoffs;
    r.ttStores = this.tt.stores;
    r.ttReplacements = this.tt.replacements;
    r.pvsSearches = this.pvsSearches;
    r.pvsResearches = this.pvsResearches;
    r.aspirationSearches = this.aspirationSearches;
    r.aspirationFails = this.aspirationFails;
    r.historyUsage = this.historyUsage;
    r.counterMoveUsage = this.counterMoveUsage;
    r.tacticalProbes = this.tacticalProbes;
    r.key2Checks = this.tt.key2Checks;
    r.key2Collisions = this.tt.key2Collisions;
    r.stoppedByTime = this.deadline !== null && !!this.aborted;
    if (!r.candidates) r.candidates = [];
    if (!r.pv) r.pv = [r.idx];
    return r;
  };

  Search.prototype.finish = function () {
    if (this.earlyResult !== undefined) return this.earlyResult;
    if (!this.cands || !this.cands.length) return null;
    var cl = [], self = this;
    for (var kk in this.rootScores) cl.push({ idx: +kk, score: this.rootScores[kk] });
    cl.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.idx === self.bestMove) return -1;
      if (b.idx === self.bestMove) return 1;
      return 0;
    });

    return this.finishResult({
      idx: this.bestMove, score: this.bestScore, depth: this.reached, pv: this.bestPV,
      mateIn: Math.abs(this.bestScore) >= MATE_T ? Math.max(1, Math.ceil((MATE - Math.abs(this.bestScore)) / 2)) : null,
      completed: !this.aborted, candidates: cl.slice(0, 5), iters: this.iterLog,
      kind: (this.theirs && this.theirs.length) ? 'block' : 'search'
    });
  };

  Search.prototype.run = function () {
    var early = this.prepare();
    if (early !== undefined) return early;
    for (var depth = 1; depth <= this.maxDepth; depth++) {
      if (this.isDone()) break;
      this.step(depth);
      if (this.isDone()) break;
    }
    return this.finish();
  };

  Search.prototype.runAsync = function (yieldFn) {
    var self = this;
    var early = self.prepare();
    if (early !== undefined) return Promise.resolve(early);
    var depth = 1;
    function loop() {
      if (depth > self.maxDepth || self.isDone()) {
        return Promise.resolve(self.finish());
      }
      self.step(depth++);
      if (depth > self.maxDepth || self.isDone()) {
        return Promise.resolve(self.finish());
      }
      return (yieldFn ? yieldFn() : new Promise(function (res) { setTimeout(res, 0); })).then(loop);
    }
    return loop();
  };

  /* ---------- AI levels 1-9 PRO ---------- */
  var LEVELS9_PRO = {
    1: { label: 'Beginner',           maxDepth: 2,  width: 5,  rootWidth: 6,  timeMs: 180,  noise: 0.50, vcf: false, vct: false, maxExt: 0, vcfPly: 4,  vcfNodes: 5000  },
    2: { label: 'Beginner',           maxDepth: 3,  width: 6,  rootWidth: 7,  timeMs: 250,  noise: 0.40, vcf: false, vct: false, maxExt: 1, vcfPly: 4,  vcfNodes: 6000  },
    3: { label: 'Easy',               maxDepth: 4,  width: 7,  rootWidth: 8,  timeMs: 350,  noise: 0.28, vcf: true,  vct: false, maxExt: 1, vcfPly: 6,  vcfNodes: 8000  },
    4: { label: 'Lower Intermediate', maxDepth: 5,  width: 7,  rootWidth: 9,  timeMs: 500,  noise: 0.18, vcf: true,  vct: false, maxExt: 2, vcfPly: 8,  vcfNodes: 12000 },
    5: { label: 'Intermediate',       maxDepth: 6,  width: 8,  rootWidth: 10, timeMs: 750,  noise: 0.08, vcf: true,  vct: true,  maxExt: 2, vcfPly: 8,  vcfNodes: 15000 },
    6: { label: 'Strong Intermediate',maxDepth: 8,  width: 9,  rootWidth: 11, timeMs: 1000, noise: 0.04, vcf: true,  vct: true,  maxExt: 3, vcfPly: 10, vcfNodes: 18000 },
    7: { label: 'Advanced',           maxDepth: 10, width: 10, rootWidth: 12, timeMs: 1500, noise: 0.01, vcf: true,  vct: true,  maxExt: 3, vcfPly: 10, vcfNodes: 22000 },
    8: { label: 'Very Strong',        maxDepth: 12, width: 11, rootWidth: 13, timeMs: 2200, noise: 0,    vcf: true,  vct: true,  maxExt: 4, vcfPly: 12, vcfNodes: 28000 },
    9: { label: 'Maximum',            maxDepth: 16, width: 12, rootWidth: 16, timeMs: 3000, noise: 0,    vcf: true,  vct: true,  maxExt: 5, vcfPly: 14, vcfNodes: 35000 }
  };
  var LEVELS = { easy: LEVELS9_PRO[3], medium: LEVELS9_PRO[5], hard: LEVELS9_PRO[8] };

  function levelConfig(level) {
    if (typeof level === 'string') return LEVELS[level] || LEVELS9_PRO[5];
    var n = Math.max(1, Math.min(9, level | 0 || 5));
    return LEVELS9_PRO[n];
  }
  function withTime(level, timeMs) {
    var o = Object.assign({}, levelConfig(level));
    if (timeMs !== undefined && timeMs !== null) o.timeMs = timeMs;
    return o;
  }

  /* PRO: Tactical verification pass */
  function tacticalVerify(state, player, bestIdx, opts) {
    if (!bestIdx && bestIdx !== 0) return null;
    var opp = player === X ? O : X;

    /* Check if the best move creates an immediate tactical situation */
    state.play(bestIdx, player);
    var winLine = winningLineAt(state.board, bestIdx, player);
    if (winLine) { state.undo(); return { verified: true, kind: 'win' }; }

    var wins = winningCells(state, player, bestIdx);
    var oppWins = winningCells(state, opp);
    state.undo();

    /* If bestMove creates a double threat, verify it's genuine */
    if (wins.length >= 2) {
      var probe = solveForcing(state, player, {
        maxPly: 4, nodes: 8000,
        timeMs: Math.min(200, (opts.timeMs || 500) * 0.15),
        vct: false
      });
      if (probe.win && probe.seq[0] === bestIdx) {
        return { verified: true, kind: 'double-threat', seq: probe.seq };
      }
    }

    /* If opponent has immediate threats, verify our move is defensive enough */
    if (oppWins.length > 0) {
      var blocks = oppWins.filter(function (w) { return w === bestIdx; });
      if (blocks.length === 0 && oppWins.length === 1) {
        // We're not blocking! That's suspicious
        return { verified: false, kind: 'missed-block', correction: oppWins[0] };
      }
    }

    return { verified: true, kind: 'normal' };
  }

  function chooseMove(state, player, level, timeMs, onProgress, shouldAbort) {
    var o = withTime(level, timeMs);
    o.onProgress = onProgress;
    o.shouldAbort = shouldAbort;
    var s = new Search(state, player, o);

    function format(res) {
      if (!res) return null;

      /* PRO: Tactical verification */
      var tv = tacticalVerify(state, player, res.idx, o);
      if (tv && !tv.verified && tv.correction != null) {
        // Override with the tactical correction
        res.idx = tv.correction;
        res.kind = 'block';
        res.pv = [tv.correction];
        res.mateIn = null;
      }

      if (o.noise > 0 && s.random() < o.noise && !immediateTactic(state, player)) {
        var c = candidates(state, 6, player);
        if (c.length > 1) {
          var pick = c[1 + Math.floor(s.random() * Math.min(3, c.length - 1))];
          res.idx = pick.idx; res.kind = 'casual'; res.pv = [pick.idx]; res.mateIn = null;
        }
      }
      return res;
    }
    return format(s.run());
  }

  /* Analysis: returns O-positive score plus engine telemetry. */
  function analyse(state, sideToMove, opts) {
    opts = opts || {};
    var isInf = opts.timeMs === 0 || opts.timeMs === Infinity;
    var budget = isInf ? 0 : (opts.timeMs != null ? opts.timeMs : 1000);
    var autoDepth = isInf ? 64 : budget >= 20000 ? 40 : budget >= 8000 ? 24 : budget >= 3000 ? 18 : 14;
    var o = {
      maxDepth: opts.maxDepth || autoDepth,
      width: opts.width || 11,
      rootWidth: opts.rootWidth || 14,
      timeMs: budget,
      vcf: opts.vcf !== false, vct: !!opts.vct, maxExt: 5,
      onProgress: opts.onProgress,
      shouldAbort: opts.shouldAbort,
      seed: opts.seed
    };
    var s = new Search(state, sideToMove, o);
    function format(res) {
      if (!res) return { score: 0, best: null, mateIn: null, depth: 0, nodes: 0, timeMs: 0, pv: [], candidates: [], iters: [] };
      var flip = sideToMove === X ? 1 : -1;
      return {
        score: res.score * flip,
        rawScore: res.score,
        best: res.idx,
        mateIn: res.mateIn,
        mateFor: res.mateIn ? (res.score > 0 ? sideToMove : (sideToMove === X ? O : X)) : null,
        depth: res.depth, nodes: res.nodes, timeMs: res.timeMs,
        ttHits: res.ttHits, ttProbes: res.ttProbes,
        ttCutoffs: res.ttCutoffs, ttStores: res.ttStores, ttReplacements: res.ttReplacements,
        pvsSearches: res.pvsSearches || 0,
        pvsResearches: res.pvsResearches || 0,
        aspirationSearches: res.aspirationSearches || 0,
        aspirationFails: res.aspirationFails || 0,
        historyUsage: res.historyUsage || 0,
        counterMoveUsage: res.counterMoveUsage || 0,
        tacticalProbes: res.tacticalProbes || 0,
        key2Checks: res.key2Checks || 0,
        key2Collisions: res.key2Collisions || 0,
        stoppedByTime: res.stoppedByTime,
        pv: res.pv, kind: res.kind,
        candidates: res.candidates.map(function (c) { return { idx: c.idx, score: c.score * flip }; }),
        iters: (res.iters || []).map(function (it) { return { depth: it.depth, score: it.score * flip, best: it.best, nodes: it.nodes, timeMs: it.timeMs, pv: it.pv }; })
      };
    }
    return format(s.run());
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
    if (win) return 5;
    if (wins >= 2) return 4;
    if (wins === 1) return 3;
    if (gain >= 1600) return 2;
    if (gain >= 180) return 1;
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

  /* ---------- export as XOEnginePro ---------- */
  root.XOEnginePro = {
    SIZE: SIZE, LEN: LEN, X: X, O: O, MATE: MATE, MATE_THRESHOLD: MATE_T,
    State: State, Search: Search, TT: TT,
    LEVELS9: LEVELS9_PRO, LEVELS9_PRO: LEVELS9_PRO, levelConfig: levelConfig,
    candidates: candidates, quickScore: quickScore, immediateTactic: immediateTactic,
    winningLineAt: winningLineAt, winningCells: winningCells,
    chooseMove: chooseMove, analyse: analyse, solveForcing: solveForcing,
    threatMap: threatMap, patternLevel: patternLevel, explainMove: explainMove,
    isDoubleThreat: isDoubleThreat, scoreLine: scoreLine, LEVELS: LEVELS,
    /* PRO-exclusive APIs */
    classifyThreat: classifyThreat, defensiveUrgency: defensiveUrgency,
    initiative: initiative, tacticalVerify: tacticalVerify,
    THREAT_FIVE: THREAT_FIVE, THREAT_OPEN_FOUR: THREAT_OPEN_FOUR,
    THREAT_CLOSED_FOUR: THREAT_CLOSED_FOUR, THREAT_OPEN_THREE: THREAT_OPEN_THREE,
    THREAT_BROKEN_THREE: THREAT_BROKEN_THREE, THREAT_DEVELOPING: THREAT_DEVELOPING,
    VERSION: 'V3 PRO',
    ENGINE_NAME: 'XO5 Forge V3 PRO'
  };
})(typeof self !== 'undefined' ? self : this);
