const P = require('../test/load.js');
const idx = +(process.argv[2] || 0), secs = +(process.argv[3] || 60), scale = +(process.argv[4] || 1);
const lv = P.LEVELS[idx];
let t0 = Date.now();
const w = new P.World(lv, { crowdScale: scale });
console.log(lv.name, 'init ms', Date.now() - t0, 'agents', w.crowd.n, 'cars', w.map.cars.length, 'lms', w.map.landmarks.map(l => l.name).join(','));
t0 = Date.now();
let worst = 0;
const bot = process.argv[5] === 'bot';
if (bot && w.side === 'protest') {
  // naive player: march every bloc at the objective landmark (or the nearest one)
  const o = w.objectives[0]; const lm = w.map.landmarks[(o && o.lm) || 0];
  w.blocs.forEach((b) => w.setBlocTarget(b.id, lm.x, lm.y, lm.id));
}
for (let s = 0; s < secs * 30; s++) {
  const a = Date.now();
  w.tick(P.SIM_DT);
  worst = Math.max(worst, Date.now() - a);
  if (s % 300 === 0) console.log('t', w.time.toFixed(0), 'n', w.crowd.n, 'prot', w.protCount, 'pol', w.polCount, 'cass', w.cassCount, 'burned', w.stats.burned, 'arr', w.stats.arrests, 'mom', w.momentum.toFixed(1), 'lm', w.map.landmarks.map(l => l.control.toFixed(2)).join(' '), w.result ? JSON.stringify(w.result) : '');
  if (bot && w.side === 'protest' && s % 900 === 899) { const free = w.map.landmarks.filter(l => l.owner !== 'protest'); if (free.length) w.blocs.forEach((b) => w.setBlocTarget(b.id, free[0].x, free[0].y, free[0].id)); }
  if (w.result) break;
}
console.log('avg tick ms', ((Date.now() - t0) / (w.time * 30)).toFixed(2), 'worst', worst, 'result', JSON.stringify(w.result), JSON.stringify(w.stats));
