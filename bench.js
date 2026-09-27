const fs=require('fs');
eval(fs.readFileSync(__dirname + '/engine2.js','utf8'));
const E=module.exports.XOEngine||global.XOEngine;
const {State,X,O,chooseMove,analyse,winningLineAt}=E;
const idx=(x,y)=>y*15+x;
// play a full hard-vs-hard game at 2s and record depth/time per move
const s=new State(); s.play(idx(7,7),X);
let cur=O, depths=[], times=[], nodes=[];
for(let i=0;i<24;i++){
  const r=chooseMove(s,cur,'hard',2000);
  depths.push(r.depth); times.push(r.timeMs); nodes.push(r.nodes);
  s.play(r.idx,cur);
  if(winningLineAt(s.board,r.idx,cur)) break;
  cur = cur===X?O:X;
}
const avg=a=>(a.reduce((x,y)=>x+y,0)/a.length);
console.log('moves searched:', depths.length);
console.log('depth  min/avg/max:', Math.min(...depths)+' / '+avg(depths).toFixed(1)+' / '+Math.max(...depths));
console.log('time   avg/max ms :', Math.round(avg(times))+' / '+Math.max(...times));
console.log('nodes  avg/max   :', Math.round(avg(nodes)).toLocaleString()+' / '+Math.max(...nodes).toLocaleString());
