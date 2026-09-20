/* build3.js — assembles the CURRENT single-file artifact.
   engine3.js + worker3.js + app3.js + shell3.html + puzzles.json -> index.html
   (build.js is the superseded v2 build: engine2 + app2 + shell2 -> xo5-analysis.html) */
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

let shell = read('shell3.html');
const engine = read('engine3.js');
const worker = read('worker3.js');
const app = read('app3.js');
const puz = read('puzzles.json');

function inject(hay, needle, payload) {
  if (hay.indexOf(needle) < 0) throw new Error('placeholder not found: ' + needle);
  return hay.replace(needle, () => payload);
}

shell = inject(shell, '/* ENGINE_PLACEHOLDER */', engine);
shell = inject(shell, '/* WORKER_PLACEHOLDER */', worker);
shell = inject(shell, '/* APP_PLACEHOLDER */', app);
shell = inject(shell,
  '<script id="puzzleSrc" type="application/json">[]</script>',
  '<script id="puzzleSrc" type="application/json">' + puz.trim() + '</script>');

if (/PLACEHOLDER/.test(shell)) throw new Error('a placeholder was left unreplaced');

fs.writeFileSync(path.join(dir, 'index.html'), shell);
console.log('built index.html —', shell.length, 'bytes');
