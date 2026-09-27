const fs=require('fs'); const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync(__dirname + '/xo5-analysis.html','utf8'),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.com/a.html',
  beforeParse(w){w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});w.Worker=undefined;w.URL.createObjectURL=()=>'blob:x';}});
const win=dom.window,doc=win.document;
const $=id=>doc.getElementById(id);
const cells=()=>[...doc.querySelectorAll('.cell')];
const click=el=>el.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const occ=()=>cells().filter(c=>c.dataset.occ==='1').length;
(async()=>{
  await sleep(800);
  click(cells()[112]); await sleep(4000);
  console.log('after 1 move, occupied:', occ(), 'moves:', $('metaMoves').textContent);
  click($('editBtn')); await sleep(200);
  console.log('edit modal open:', $('editOverlay').classList.contains('open'), 'status:', $('statusText').textContent);
  console.log('occupied in editor:', occ());
  click($('editClear')); await sleep(300);
  console.log('after clear, occupied:', occ());
  click($('toolSeg').querySelector('[data-v="x"]'));
  click(cells()[80]); await sleep(150);
  console.log('after placing 1 X:', occ(), 'cell80 html has mark-x:', cells()[80].innerHTML.includes('mark-x'));
  console.log('disabled?', cells()[80].hasAttribute('disabled'));
})();
