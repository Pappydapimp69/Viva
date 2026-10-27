// Map diversity metrics (Brain: expressive-range analysis on two LOW-correlation
// metrics + variance-collapse check). Usage: node tools/mapstats.js [n]
const P = require('../test/load.js');
const T = P.T;
function stats(m) {
  const W = m.W, H = m.H, t = m.tile;
  let road = 0, axisRun = 0, walk = 0;
  // grid-ness: share of road tiles inside straight axis-aligned runs >= 24 tiles
  const inRun = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { let s = -1; for (let x = 0; x <= W; x++) { const r = x < W && t[y * W + x] === T.ROAD; if (r && s < 0) s = x; if (!r && s >= 0) { if (x - s >= 24) for (let q = s; q < x; q++) inRun[y * W + q] = 1; s = -1; } } }
  for (let x = 0; x < W; x++) { let s = -1; for (let y = 0; y <= H; y++) { const r = y < H && t[y * W + x] === T.ROAD; if (r && s < 0) s = y; if (!r && s >= 0) { if (y - s >= 24) for (let q = s; q < y; q++) inRun[q * W + x] = 1; s = -1; } } }
  for (let k = 0; k < W * H; k++) { if (t[k] === T.ROAD) { road++; if (inRun[k]) axisRun++; } if (!m.solid[k]) walk++; }
  // block sizes (building components)
  const seen = new Uint8Array(W * H), st = new Int32Array(W * H), sizes = [];
  for (let i = 0; i < W * H; i++) {
    if (t[i] !== T.BUILDING || seen[i]) continue;
    let sp = 0, a = 0; st[sp++] = i; seen[i] = 1;
    while (sp) { const k = st[--sp]; a++; const x = k % W; for (const n of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k - W, k + W]) if (n >= 0 && n < W * H && t[n] === T.BUILDING && !seen[n]) { seen[n] = 1; st[sp++] = n; } }
    sizes.push(a);
  }
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const cv = Math.sqrt(sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / sizes.length) / mean;
  return { grid: axisRun / road, open: walk / (W * H), blocks: sizes.length, blockCV: cv, water: t.filter((v) => v === 6).length / (W * H) };
}
function sim(a, b) { // Jaccard similarity of walkable masks
  let i = 0, u = 0; for (let k = 0; k < a.N; k++) { const x = !a.solid[k], y = !b.solid[k]; if (x && y) i++; if (x || y) u++; } return i / u;
}
module.exports = { stats, sim };
if (require.main === module) {
  const n = +(process.argv[2] || 12), rows = [], maps = [];
  for (let s = 1; s <= n; s++) { const m = P.generateMap({ w: 320, h: 320, seed: s * 7919 }); maps.push(m); rows.push(stats(m)); }
  const col = (k) => rows.map((r) => r[k]);
  const sd = (a) => { const mu = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / a.length); };
  const f = (a) => a.map((v) => v.toFixed(2)).join(' ');
  console.log('grid-ness  ', f(col('grid')), ' sd', sd(col('grid')).toFixed(3));
  console.log('openness   ', f(col('open')), ' sd', sd(col('open')).toFixed(3));
  console.log('block CV   ', f(col('blockCV')), ' sd', sd(col('blockCV')).toFixed(3));
  console.log('water      ', f(col('water')));
  let ss = 0, c = 0; for (let i = 0; i < maps.length; i++) for (let j = i + 1; j < maps.length; j++) { ss += sim(maps[i], maps[j]); c++; }
  console.log('mean pairwise walkable-mask similarity', (ss / c).toFixed(3));
}
