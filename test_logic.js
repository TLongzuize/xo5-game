const N = 15;
function create2D(n){return Array.from({length:n},()=>Array(n).fill(0));}
let board = create2D(N);
const DIRS=[[1,0],[0,1],[1,1],[1,-1]];
function inBounds(x,y){return x>=0&&x<N&&y>=0&&y<N;}

function checkWin(x,y,color){
  for(const [dx,dy] of DIRS){
    let forward=[]; let i=1;
    while(inBounds(x+dx*i,y+dy*i) && board[y+dy*i][x+dx*i]===color){forward.push([x+dx*i,y+dy*i]);i++;}
    let backward=[]; i=1;
    while(inBounds(x-dx*i,y-dy*i) && board[y-dy*i][x-dx*i]===color){backward.push([x-dx*i,y-dy*i]);i++;}
    const total=backward.length+1+forward.length;
    if(total>=5){
      return [...backward.reverse(),[x,y],...forward];
    }
  }
  return null;
}

const SCORE_TABLE={0:0,1:1,2:10,3:100,4:1000,5:100000};
function windowScore(cp){return SCORE_TABLE[cp]||0;}
function evalWindow(cells,color){
  const opp = color===1?2:1;
  let cp=0,co=0;
  for(const [cx,cy] of cells){
    const v=board[cy][cx];
    if(v===color)cp++; else if(v===opp)co++;
  }
  if(co>0) return 0;
  return windowScore(cp);
}
function windowsThrough(x,y){
  let result=[];
  for(const [dx,dy] of DIRS){
    for(let start=-4;start<=0;start++){
      let cells=[]; let valid=true;
      for(let k=0;k<5;k++){
        const cx=x+dx*(start+k), cy=y+dy*(start+k);
        if(!inBounds(cx,cy)){valid=false;break;}
        cells.push([cx,cy]);
      }
      if(valid) result.push(cells);
    }
  }
  return result;
}
function cellScore(x,y,color){
  const windows=windowsThrough(x,y);
  let total=0;
  const prev=board[y][x];
  board[y][x]=color;
  for(const w of windows) total+=evalWindow(w,color);
  board[y][x]=prev;
  return total;
}
function candidateMoves(){
  let set=new Set(); let any=false;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    if(board[y][x]!==0){
      any=true;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        const nx=x+dx, ny=y+dy;
        if(inBounds(nx,ny)&&board[ny][nx]===0) set.add(ny*N+nx);
      }
    }
  }
  if(!any) return [[Math.floor(N/2),Math.floor(N/2)]];
  return Array.from(set).map(v=>[v%N,Math.floor(v/N)]);
}
function findBestMove(color){
  const opp=color===1?2:1;
  const candidates=candidateMoves();
  for(const [x,y] of candidates){
    board[y][x]=color;
    const win=checkWin(x,y,color);
    board[y][x]=0;
    if(win) return {x,y,score:1e9,reason:'win'};
  }
  for(const [x,y] of candidates){
    board[y][x]=opp;
    const win=checkWin(x,y,opp);
    board[y][x]=0;
    if(win) return {x,y,score:5e8,reason:'block'};
  }
  let scored=candidates.map(([x,y])=>{
    const atk=cellScore(x,y,color);
    const def=cellScore(x,y,opp);
    return {x,y,score:atk+def*1.05};
  });
  scored.sort((a,b)=>b.score-a.score);
  const top=scored.slice(0,Math.min(8,scored.length));
  let best=null;
  for(const cand of top){
    board[cand.y][cand.x]=color;
    const oppCandidates=candidateMoves();
    let oppBest=0;
    for(const [ox,oy] of oppCandidates){
      const s=cellScore(ox,oy,opp)+cellScore(ox,oy,color)*1.05;
      if(s>oppBest) oppBest=s;
    }
    board[cand.y][cand.x]=0;
    const finalScore=cand.score-oppBest*0.9;
    if(!best||finalScore>best.finalScore) best={x:cand.x,y:cand.y,finalScore};
  }
  return {x:best.x,y:best.y,score:best.finalScore,reason:'heuristic'};
}

// TEST 1: horizontal open four for black at row 7, cols 4-7 -> black should win by playing col 8 or col 3
board=create2D(N);
[[4,7],[5,7],[6,7],[7,7]].forEach(([x,y])=>board[y][x]=1);
let m1=findBestMove(1);
console.log('Test1 (open four, should complete 5):', m1, 'expect x=3 or x=8, y=7, reason=win');

// TEST 2: black has open four already threatening two ways; white must block one, but should detect "win" for black next turn scenario -> here test white's best move should block (not a true block since two ways open, both cant be blocked - just check it picks one of the ends)
board=create2D(N);
[[4,7],[5,7],[6,7],[7,7]].forEach(([x,y])=>board[y][x]=1);
let m2=findBestMove(2); // white to move, must block black's open four (one end at least)
console.log('Test2 (white blocking open four):', m2, 'expect reason=block, x=3 or x=8,y=7');

// TEST 3: checkWin diagonal
board=create2D(N);
[[2,2],[3,3],[4,4],[5,5],[6,6]].forEach(([x,y])=>board[y][x]=1);
console.log('Test3 diagonal win detect at (6,6):', checkWin(6,6,1)!==null);

// TEST 4: vertical win
board=create2D(N);
for(let y=3;y<8;y++) board[y][5]=2;
console.log('Test4 vertical win detect at (5,7):', checkWin(5,7,2)!==null);

// TEST 5: eval sanity - black has 3 in a row open, white nothing -> eval black should be positive
function evalBoard(){
  let total=0;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    for(const [dx,dy] of DIRS){
      const ex=x+dx*4, ey=y+dy*4;
      if(!inBounds(ex,ey)) continue;
      let cells=[]; for(let k=0;k<5;k++) cells.push([x+dx*k,y+dy*k]);
      total+=evalWindow(cells,1)-evalWindow(cells,2);
    }
  }
  return total;
}
board=create2D(N);
[[5,5],[6,5],[7,5]].forEach(([x,y])=>board[y][x]=1);
console.log('Test5 eval (should be positive, black has open 3):', evalBoard());

// TEST 6: empty board findBestMove should return center
board=create2D(N);
let m6=findBestMove(1);
console.log('Test6 empty board center move:', m6, 'expect x=7,y=7');
