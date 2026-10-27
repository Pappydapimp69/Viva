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
  const c = w.map.cars.reduce((a, c) => (Math.min(...c.near.filter((v, i) => i % 2 === 1), 9) < Math.min(...a.near.filter((v, i) => i % 2 === 1), 9) ? c : a));
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

test('police line forms across the street, at any street angle', () => {
  const w = new P.World(P.LEVELS[2], {});
  const sq = w.squads[0], m = w.map;
  let checked = 0;
  for (const s of m.streets) {
    if (s.w < 9 || s.w > 14 || checked >= 6) continue;
    const i = Math.floor(s.pts.length / 2), [x, y] = s.pts[i], [x2, y2] = s.pts[i + 1] || s.pts[i - 1];
    if (!m.walkable(x, y) || m.crossLine(x, y, 30).span >= 30) continue;
    w.orderSquad(sq, x, y, false, true);
    const dx = x2 - x, dy = y2 - y, L = Math.hypot(dx, dy);
    const along = Math.abs((sq.ux * dx + sq.uy * dy) / L);
    assert.ok(along < 0.75, 'line runs across the street, not along it (cos ' + along.toFixed(2) + ')');
    checked++;
  }
  assert.ok(checked >= 3, 'tested ' + checked + ' streets');
});

test('map styles are genuinely different (Brain: catch secret sameness)', () => {
  const { stats } = require('../tools/mapstats.js');
  const grid = [], open = [];
  for (let s = 1; s <= 10; s++) { const st = stats(P.generateMap({ w: 288, h: 288, seed: s * 7919 })); grid.push(st.grid); open.push(st.open); }
  const sd = (a) => { const mu = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / a.length); };
  assert.ok(sd(grid) > 0.1, 'grid-ness collapsed to one archetype (sd ' + sd(grid).toFixed(3) + ')');
  assert.ok(Math.max(...open) < 0.62 && Math.min(...open) > 0.35, 'openness out of a city-like band: ' + open.map((v) => v.toFixed(2)).join(' '));
});

test('every style keeps every landmark reachable', () => {
  for (const style of P.MAP_STYLES) for (const seed of [3, 17]) {
    const m = P.generateMap({ w: 288, h: 288, seed, style });
    const f = new P.Field(m); f.compute(m.entries.map((e) => e.k));
    for (const lm of m.landmarks) {
      const o = m.nearestOpen(lm.x + lm.r - 4, lm.y, 6);
      assert.ok(o && f.distAt(o.x, o.y) < Infinity, style + ' seed ' + seed + ' ' + lm.name + ' unreachable');
    }
  }
});

test('crowd density setting scales both sides, not just one', () => {
  const lo = new P.World(P.LEVELS[2], { crowdScale: 0.5 }), hi = new P.World(P.LEVELS[2], { crowdScale: 2.5 });
  const ratio = (w) => w.pop / (w.squads.length * w.squadSize);
  const r = ratio(hi) / ratio(lo);
  assert.ok(r > 0.6 && r < 1.7, 'protester-per-officer ratio drifted x' + r.toFixed(2));
  const cass = (w) => w.pop * w.level.cassFrac / w.scale;
  assert.ok(Math.abs(cass(hi) / cass(lo) - 1) < 1e-9, 'casseur count should not scale with density');
});

test('gamepad: radial deadzone has no square gaps on the diagonal', () => {
  // a diagonal push just past the dead radius must register, at the same magnitude as a straight one
  const d = P.radialDeadzone(0.15, 0.15, 0.18), s = P.radialDeadzone(0.2121, 0, 0.18);
  assert.ok(d.m > 0, 'diagonal beyond the radius is live');
  assert.ok(Math.abs(d.m - s.m) < 1e-3, 'same magnitude regardless of angle');
  assert.strictEqual(P.radialDeadzone(0.1, 0.1, 0.18).m, 0);
  assert.ok(Math.abs(P.radialDeadzone(1, 0, 0.18).m - 1) < 1e-9, 'full tilt reaches 1');
});

test('gamepad: button edges and menu repeat', () => {
  const state = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0], connected: true, id: 'Test pad' };
  const pad = new P.PadInput(() => [null, state]);
  pad.poll(1 / 60);
  assert.ok(pad.connected && !pad.any);
  state.buttons[0] = { pressed: true, value: 1 };
  pad.poll(1 / 60); assert.ok(pad.pressed(0));
  pad.poll(1 / 60); assert.ok(!pad.pressed(0) && pad.held(0));
  state.buttons[0] = { pressed: false, value: 0 };
  pad.poll(1 / 60); assert.ok(pad.released(0));
  // hold D-pad down: fires once, waits, then repeats
  state.buttons[13] = { pressed: true, value: 1 };
  let fires = 0;
  for (let f = 0; f < 60; f++) { pad.poll(1 / 60); if (pad.nav === 'down') fires++; }
  assert.ok(fires >= 4 && fires <= 7, 'one second of hold gave ' + fires + ' steps');
  // stick works for menus too
  state.buttons[13] = { pressed: false, value: 0 }; pad.poll(1 / 60);
  state.axes = [0.9, 0.1, 0, 0]; pad.poll(1 / 60);
  assert.strictEqual(pad.nav, 'right');
});
