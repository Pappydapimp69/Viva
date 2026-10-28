// Pompiers balance check: auto-dispatch trucks to every fire, count outcomes.
const P = require('../test/load.js');
const run = (need) => {
  P.TRUCK_SURROUND = need;
  const w = new P.World(P.LEVELS[3], {});
  let ab = 0;
  for (let s = 0; s < 30 * (+process.argv[2] || 180); s++) {
    w.tick(P.SIM_DT);
    for (const e of w.events) if (e.type === 'truckAbandoned') ab++;
    w.events.length = 0;
    if (s % 30 === 0) for (const c of w.map.cars) if (c.state === 1 && c.burn > 3 && !w.trucks.some((t) => t.car === c.id)) w.dispatchTruck(c);
    if (w.result) break;
  }
  return { need, burned: w.stats.burned, extinguished: w.stats.extinguished, abandoned: ab, result: w.result && w.result.why };
};
console.log(run(1e9)); console.log(run(16));
