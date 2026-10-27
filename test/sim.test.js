const test = require('node:test');
const assert = require('node:assert');
const P = require('./load.js');

test('map generation is seeded and deterministic', () => {
  const a = P.generateMap({ w: 256, h: 256, seed: 5 }), b = P.generateMap({ w: 256, h: 256, seed: 5 });
  assert.deepStrictEqual(Array.from(a.tile), Array.from(b.tile));
  assert.ok(a.cars.length > 50, 'parked cars');
  assert.ok(a.landmarks.length >= 3, 'landmarks');
  assert.ok(a.entries.length >= 4, 'map entries');
});

test('every landmark is reachable from the map edge', () => {
  const m = P.generateMap({ w: 320, h: 320, seed: 23 });
  const f = new P.Field(m);
  f.compute(m.entries.map((e) => e.k));
  for (const lm of m.landmarks) assert.ok(f.distAt(lm.x + lm.r - 4, lm.y) < Infinity, lm.name);
});

test('a barricade line cuts the flow field and re-routes it', () => {
  const m = P.generateMap({ w: 256, h: 256, seed: 5 });
  const lm = m.landmarks[0];
  const f = new P.Field(m); f.compute(P.discSources(m, lm.x, lm.y, 3));
  // wall the plaza off completely with a ring of barricade
  const w = { map: m };
  let walled = 0;
  for (let a = 0; a < 6.283; a += 0.01) {
    const x = (lm.x + Math.cos(a) * (lm.r + 1)) | 0, y = (lm.y + Math.sin(a) * (lm.r + 1)) | 0, k = y * m.W + x;
    if (!m.solid[k]) { m.solid[k] = 1; walled++; }
  }
  assert.ok(walled > 0);
  f.compute();
  const e = m.entries[0];
  assert.strictEqual(f.distAt(e.x, e.y), Infinity, 'outside cannot reach a sealed plaza');
});

test('crowd step is allocation-light and keeps agents out of walls', () => {
  const w = new P.World(P.LEVELS[0], {});
  for (let i = 0; i < 300; i++) w.tick(P.SIM_DT);
  const cr = w.crowd, m = w.map;
  let inWall = 0;
  for (let i = 0; i < cr.n; i++) if (m.solid[(cr.y[i] | 0) * m.W + (cr.x[i] | 0)]) inWall++;
  assert.ok(inWall / cr.n < 0.002, 'agents inside walls: ' + inWall);
});

test('fire spreads between neighbouring parked cars', () => {
  const w = new P.World(P.LEVELS[1], {});
  const c = w.map.cars.find((c) => c.near.some((v, i) => i % 2 === 1 && v < 5));
  w.ignite(c.id, 'test');
  for (let i = 0; i < 30 * 55; i++) w.updateFires(P.SIM_DT);
  assert.ok(w.stats.burned >= 2, 'burned ' + w.stats.burned);
});

test('a fire truck puts a fire out', () => {
  const w = new P.World(P.LEVELS[3], {});
  const c = w.map.cars.find((c) => c.near.length === 0) || w.map.cars[0];
  w.ignite(c.id, 'test');
  assert.ok(w.dispatchTruck(c));
  for (let i = 0; i < 30 * 60 && c.state === 1; i++) { w.updateTrucks(P.SIM_DT); w.updateFires(P.SIM_DT); }
  assert.strictEqual(c.state, 2);
  assert.ok(c.burn < 55, 'put out before burning out');
});

test('police line forms across the street', () => {
  const w = new P.World(P.LEVELS[2], {});
  const sq = w.squads[0];
  const s = w.map.streets.find((s) => s.kind === 'v' && !s.blvd);
  w.orderSquad(sq, s.c, w.map.H / 2 + 0.5, false, true);
  assert.strictEqual(sq.uy, 0, 'line is horizontal across a vertical street');
});

test('crowd density setting scales both sides, not just one', () => {
  const lo = new P.World(P.LEVELS[2], { crowdScale: 0.5 }), hi = new P.World(P.LEVELS[2], { crowdScale: 2.5 });
  const ratio = (w) => w.pop / (w.squads.length * w.squadSize);
  const r = ratio(hi) / ratio(lo);
  assert.ok(r > 0.6 && r < 1.7, 'protester-per-officer ratio drifted x' + r.toFixed(2));
  const cass = (w) => w.pop * w.level.cassFrac / w.scale;
  assert.ok(Math.abs(cass(hi) / cass(lo) - 1) < 1e-9, 'casseur count should not scale with density');
});
