// Step-by-step tutorial. A coach that WATCHES real play: every step is done by
// the game's normal controls and completes on the real world state or event it
// asks for, pinned to a specific target, so there is no separate tutorial mode
// with its own copy of the controls. Text is written per input device and
// switches live between mouse & keyboard and controller.
(function () {
  const P = globalThis.PAVE;
  const K = P.K;

  const kb = (...keys) => keys.map((k) => '<kbd>' + k + '</kbd>').join('');
  const btn = (b) => '<span class="padbtn pb-' + b.toLowerCase() + '">' + b + '</span>';
  const MOUSE_PAN = 'Move the camera with ' + kb('W', 'A', 'S', 'D') + ' or the arrow keys, or hold the <b>middle mouse button</b> and drag.';

  // ------------------------------------------------------------------ steps
  const COMMON = {
    camera: {
      title: 'Look around',
      mk: MOUSE_PAN,
      pad: 'Push the <b>left stick</b> to move the camera. The ring in the middle of the screen is your cursor.',
      setup(t) { t.s.travel = 0; t.s.lx = t.cam.x; t.s.ly = t.cam.y; },
      tick(t) {
        // count only steady player panning: ignore the opening frames and any jump (camera clamps, recentres)
        const d = Math.hypot(t.cam.x - t.s.lx, t.cam.y - t.s.ly);
        if (t.t > 0.3 && d < 40) t.s.travel += d;
        t.s.lx = t.cam.x; t.s.ly = t.cam.y;
      },
      done: (t) => t.s.travel > 30,
    },
    zoom: {
      title: 'Zoom in',
      mk: 'Roll the <b>mouse wheel</b> forward to zoom in on the streets. Roll it back any time to see the whole city.',
      pad: 'Zoom in with ' + btn('RT') + ' (or push the <b>right stick</b> up). ' + btn('LT') + ' zooms back out to see the whole city.',
      setup(t) { t.s.z0 = t.cam.tz; },
      done: (t) => t.cam.tz > t.s.z0 * 1.5,
    },
  };

  const near = (t, x, y, r) => t.w.map.nearestOpen(x, y, r || 12) || { x, y };
  const sqPos = (sq) => ({ x: sq.mx != null ? sq.mx : sq.ax, y: sq.my != null ? sq.my : sq.ay });
  // where the bloc's people actually are: the densest crowd near the first square
  // (a bloc's average position can sit in an empty street between two halves of it)
  const crowdSpot = (t) => {
    const lm = t.w.map.landmarks[0], b = t.w.blocs[0];
    let best = P.densAround(t.w, t.w.densP, lm.x, lm.y, 10);
    if (best.max < 4) best = P.densAround(t.w, t.w.densP, b.cx, b.cy, 12);
    const o = t.w.map.nearestOpen(best.x, best.y, 6) || best;
    return { x: o.x, y: o.y };
  };
  // bring a squad next to the bloc (for the gas and fireworks lessons)
  const squadToBloc = (t) => {
    const c = crowdSpot(t), sq = t.w.squads[0], lm1 = t.w.map.landmarks[1] || t.w.map.landmarks[0];
    const dx = lm1.x - c.x, dy = lm1.y - c.y, d = Math.hypot(dx, dy) || 1;
    const o = near(t, c.x + dx / d * 20, c.y + dy / d * 20);
    t.w.orderSquad(sq, o.x, o.y, false, true);
    // walk them there instantly so the lesson doesn't wait on it
    const cr = t.w.crowd;
    for (let i = 0; i < cr.n; i++) if (cr.kind[i] === K.POL && cr.grp[i] === sq.id) { const s2 = cr.slot[i]; if (s2 < sq.slotX.length) { cr.x[i] = sq.slotX[s2]; cr.y[i] = sq.slotY[s2]; } }
    return sq;
  };
  const SPEED = {
    title: 'Speed up time',
    mk: 'Walking takes a while. Press ' + kb('Tab') + ' to speed time up (2×, then 3×; once more goes back to normal).',
    pad: 'Walking takes a while. Press ' + btn('Back') + ' to speed time up (2×, then 3×; once more goes back to normal).',
    hi: '#btnSpeed',
    done: (t) => t.api.speed > 1,
  };

  const PROTEST = [
    COMMON.zoom, COMMON.camera,
    {
      title: 'This is your bloc', info: true,
      both: 'All those dots are your people. You don\'t move them one by one: you give the whole <b>bloc</b> a destination and each person finds their own way there.',
      hi: '#blc_0', at: (t) => { const b = t.w.blocs[0]; return b.n ? { x: b.cx, y: b.cy, r: 14 } : null; },
    },
    {
      title: 'March on the square',
      mk: 'The <b>March</b> tool is selected. <b>Left-click</b> the pulsing ring: Place de la {lm0}.',
      pad: 'Move until the cursor snaps onto the pulsing ring (Place de la {lm0}) and turns yellow, then press ' + btn('A') + '.',
      hi: '#tool_march', at: (t) => t.lm(0),
      setup(t) { t.api.pickTool('march'); t.api.setSelBloc(0); },
      done: (t) => t.w.blocs[0].target === t.w.map.landmarks[0].id,
    },
    SPEED,
    {
      title: 'Take the square',
      both: 'When far more of your people than police stand inside the ring, it fills red. The more people, the faster.',
      at: (t) => t.lm(0),
      progress: (t) => Math.round(Math.max(0, t.w.map.landmarks[0].control) * 100) + '%',
      done: (t) => t.w.map.landmarks[0].owner === 'protest',
    },
    {
      title: 'Bridges are chokepoints', info: true,
      both: 'Over the river, everyone squeezes across the bridges. The same happens at any narrow street or gap: block one and the whole bloc reroutes to the next.',
      skip: (t) => !t.bridge(),
      at: (t) => { const b = t.bridge(); return b ? { x: b.x, y: b.y, r: 8 } : null; },
    },
    {
      title: 'Pick a tool',
      mk: 'Tools cost <b>energy</b> (the yellow bar, top right), which refills by itself. Press ' + kb('2') + ' or click the <b>Casseurs</b> button.',
      pad: 'Tools cost <b>energy</b> (the yellow bar, top right), which refills by itself. Press ' + btn('LB') + ' / ' + btn('RB') + ' until <b>CASSEURS</b> is selected.',
      hi: '#tool_casseurs',
      setup(t) { t.w.energy = Math.max(t.w.energy, 60); },
      done: (t) => t.api.tool === 'casseurs',
    },
    {
      title: 'Radicalise',
      mk: '<b>Left-click</b> inside your crowd. About 20 people pull their hoods up: they\'re <b>casseurs</b> now, and they go for parked cars.',
      pad: 'Point at your crowd (the cursor snaps to the bloc) and press ' + btn('A') + '. About 20 people pull their hoods up: they\'re <b>casseurs</b> now, and they go for parked cars.',
      setup(t) { t.s.spot = crowdSpot(t); },
      at: (t) => ({ x: t.s.spot.x, y: t.s.spot.y, r: 8 }),
      ev: (e) => e.type === 'casseurs',
    },
    {
      title: 'Fire spreads',
      both: 'Wait for the first car to catch. Flames jump to the next car with the wind.',
      hi: '#carsBadge',
      setup(t) { t.s.b0 = t.w.stats.burned; },
      done: (t) => t.w.stats.burned > t.s.b0,
    },
    {
      title: 'Pin a fire truck',
      mk: 'A fire truck is coming for that fire. Press ' + kb('1') + ' for <b>March</b> and <b>left-click the truck</b>: your bloc packs round it. Pinned for a few seconds, the crew walks away and it stops spraying.',
      pad: 'A fire truck is coming for that fire. Press ' + btn('B') + ' for <b>March</b>, move onto the truck (the cursor snaps to it) and press ' + btn('A') + ': your bloc packs round it. Pinned for a few seconds, the crew walks away.',
      setup(t) { this.sendTruck(t); },
      sendTruck(t) {
        const w = t.w, b = crowdSpot(t), m = w.map;
        let car = null, bd = Infinity;
        for (const c of m.cars) if (c.state === 1) { const d = Math.hypot(c.cx - b.x, c.cy - b.y); if (d < bd) { bd = d; car = c; } }
        if (!car || bd > 40) { car = null; bd = Infinity; for (const c of m.cars) if (c.state === 0) { const d = Math.hypot(c.cx - b.x, c.cy - b.y); if (d < bd) { bd = d; car = c; } } if (car) w.ignite(car.id, 'tutorial'); }
        if (!car) return;
        // a truck arrives from a road a little way off
        const f = new P.Field(m, { roadOnly: true });
        f.compute(P.discSources(m, car.cx, car.cy, 4));
        let best = null, bv = Infinity;
        for (let r = 10; r < 30 && !best; r += 2) for (let a = 0; a < 6.28; a += 0.3) {
          const x = car.cx + Math.cos(a) * r, y = car.cy + Math.sin(a) * r, k = (y | 0) * m.W + (x | 0);
          if (x < 0 || y < 0 || x >= m.W || y >= m.H || m.solid[k] || m.tile[k] !== P.T.ROAD) continue;
          const d = f.dist[k]; if (d < bv) { bv = d; best = { x: (x | 0) + 0.5, y: (y | 0) + 0.5 }; }
        }
        if (!best) return;
        w.trucks.push({ x: best.x, y: best.y, a: 0, field: f, state: 'go', car: car.id, spray: 0 });
        w.trucksOut++;
        t.s.truck = w.trucks[w.trucks.length - 1];
        w.energy = Math.max(w.energy, 30);
      },
      tick(t) {
        // the truck may put the fire out and drive home first: send another to another fire
        const tr = t.s.truck;
        if (tr && (tr.done || tr.state === 'back' || !t.w.trucks.includes(tr))) { t.s.truck = null; t.step().sendTruck(t); }
      },
      skip: (t) => !t.s.truck,
      at: (t) => t.s.truck && t.s.truck.state !== 'abandoned' ? { x: t.s.truck.x, y: t.s.truck.y, r: 6 } : null,
      ev: (e) => e.type === 'truckAbandoned',
    },
    {
      title: 'Tear gas!',
      both: 'The police just gassed your bloc. People in the cloud panic and run, and some give up and go home: watch CROWD drop. <b>Get them out</b>: march the bloc somewhere else.',
      hi: '#topRight .resRow',
      setup(t) {
        const sq = squadToBloc(t), c = crowdSpot(t);
        t.s.gas = { x: c.x, y: c.y };
        t.w.throwGas(sq.ax, sq.ay, c.x, c.y);
        t.w.throwGas(sq.ax, sq.ay, c.x + 4, c.y - 3);
        t.api.pickTool('march');
      },
      at: (t) => ({ x: t.s.gas.x, y: t.s.gas.y, r: 9 }),
      done: (t) => t.t > 2 && Math.hypot(t.w.blocs[0].tx - t.s.gas.x, t.w.blocs[0].ty - t.s.gas.y) > 20,
    },
    {
      title: 'Fireworks vs shields',
      mk: 'Payback. Press ' + kb('3') + ' for <b>Fireworks</b> and <b>left-click</b> the marked squad. Officers in the blast are stunned and hurt; hit the same squad again and the injured are carried off.',
      pad: 'Payback. Press ' + btn('RB') + ' until <b>FIREWORKS</b>, aim at the marked squad (the cursor snaps) and press ' + btn('A') + '. Officers in the blast are stunned and hurt; hit the same squad again and the injured are carried off.',
      hi: '#tool_fireworks',
      setup(t) { t.w.energy = Math.max(t.w.energy, 40); },
      at: (t) => { const p = sqPos(t.w.squads[0]); return { x: p.x, y: p.y, r: 6 }; },
      ev: (e, t) => { const sq = t.w.squads[0], p = sqPos(sq); return e.type === 'fireworks' && Math.min(Math.hypot(e.x - sq.ax, e.y - sq.ay), Math.hypot(e.x - p.x, e.y - p.y)) < 14; },
    },
    {
      title: 'Build a barricade',
      mk: 'Press ' + kb('4') + ' for <b>Barricade</b>, then <b>click and drag</b> across a street near your people. Your people walk through it; police have to beat it down.',
      pad: 'Press ' + btn('RB') + ' until <b>BARRICADE</b>. <b>Hold</b> ' + btn('A') + ', move across a street near your people, then <b>release</b>. Your people walk through it; police have to beat it down.',
      hi: '#tool_barricade',
      setup(t) { t.w.energy = Math.max(t.w.energy, 40); },
      ev: (e) => e.type === 'barricade' && e.kind === 1,
    },
    {
      title: 'Your second bloc',
      mk: 'You have two blocs. Press ' + kb('Q') + ' (or click <b>B</b> on the left) to select bloc B, then <b>left-click</b> Place de la {lm1}.',
      pad: 'You have two blocs. Press ' + btn('Y') + ' to select bloc B and jump to it, then move onto Place de la {lm1} and press ' + btn('A') + '.',
      hi: '#blc_1',
      setup(t) { t.api.pickTool('march'); t.api.setSelBloc(0); },
      at: (t) => t.lm(1),
      done: (t) => t.w.blocs[1] && t.w.blocs[1].target === t.w.map.landmarks[1].id,
    },
    {
      title: 'Call for backup',
      mk: 'Short of people? Press ' + kb('5') + ' to <b>Mobilise</b>: the group chat brings 800 more.',
      pad: 'Short of people? Press <b>D-pad up</b> to <b>Mobilise</b>: the group chat brings 800 more.',
      hi: '#tool_mobilise',
      setup(t) { t.w.energy = Math.max(t.w.energy, 40); t.w.cooldowns.mobilise = 0; },
      ev: (e) => e.type === 'mobilise',
    },
    {
      title: 'CROWD', info: true,
      both: '<b>CROWD</b> (orange) is how many people your movement draws. Squares and fires grow it; gas and arrests shrink it; the line under it says why. If it collapses, you lose.',
      hi: '#topRight .resRow',
    },
    {
      title: 'ENERGY', info: true,
      both: '<b>ENERGY</b> (yellow) is only what tools cost. It refills by itself, and spending it never costs you people.',
      hi: '#energyRow',
    },
    {
      title: 'Final test',
      both: 'The police now defend Place de la {lm2}. Take it however you like: both blocs, fireworks on the lines, barricades behind you.',
      setup(t) {
        const w = t.w, lm = w.map.landmarks[2] || w.map.landmarks[1];
        t.s.lm = lm;
        w.level.aiPassive = false;
        w.squads.forEach((sq) => { sq.home = lm.id; });
        w.energy = Math.max(w.energy, 80);
      },
      at: (t) => ({ x: t.s.lm.x, y: t.s.lm.y, r: t.s.lm.r }),
      progress: (t) => Math.round(Math.max(0, t.s.lm.control) * 100) + '%',
      done: (t) => t.s.lm.owner === 'protest',
    },
  ];

  const POLICE = [
    COMMON.zoom, COMMON.camera,
    {
      title: 'Select a squad',
      mk: 'The blue lines are your CRS companies. <b>Left-click</b> the marked squad, <b>{sq1}</b>, or press ' + kb('2') + '.',
      pad: 'The blue lines are your CRS companies. Move onto the marked squad, <b>{sq1}</b> (the cursor snaps to it), and press ' + btn('A') + '.',
      hi: '#sq_1',
      setup(t) { t.api.pickTool('move'); if (t.api.selSquad === 1) t.api.setSelSquad(0); },
      at: (t) => { const p = sqPos(t.w.squads[1]); return { x: p.x, y: p.y, r: 6 }; },
      done: (t) => t.api.selSquad === 1,
    },
    {
      title: 'Form a line',
      mk: '<b>Right-click</b> the marked street. {sq1} forms a shield line right across it by itself.',
      pad: 'Move to the marked street and press ' + btn('A') + '. {sq1} forms a shield line right across it by itself.',
      setup(t) {
        // a street point between the target square and the nearest crowd
        const lm = t.w.map.landmarks[0], b = t.w.nearestBloc(lm.x, lm.y) || { cx: t.w.map.W / 2, cy: t.w.map.H / 2 };
        const dx = b.cx - lm.x, dy = b.cy - lm.y, d = Math.hypot(dx, dy) || 1;
        const o = near(t, lm.x + dx / d * (lm.r + 12), lm.y + dy / d * (lm.r + 12));
        t.s.target = { x: o.x, y: o.y };
      },
      at: (t) => ({ x: t.s.target.x, y: t.s.target.y, r: 5 }),
      done: (t) => { const sq = t.w.squads[1]; return Math.hypot(sq.ax - t.s.target.x, sq.ay - t.s.target.y) < 10; },
    },
    {
      title: 'Switch squads',
      mk: 'Press ' + kb('Q') + ' to step to the next squad (or a number key ' + kb('1') + '–' + kb('9') + '; press it twice to jump the camera there).',
      pad: 'Press ' + btn('Y') + ' to select the next squad and jump the camera to it. ' + btn('X') + ' jumps back to the one you have selected.',
      hi: '#squadBar',
      setup(t) { t.s.sel0 = t.api.selSquad; },
      done: (t) => t.api.selSquad !== t.s.sel0,
    },
    SPEED,
    {
      title: 'Tear gas',
      mk: 'Press ' + kb('G') + ' for <b>Gas</b>, then <b>left-click</b> the crowd in front of a line. The selected squad throws it, so stay within 40 m. People in the cloud panic and some go home.',
      pad: 'Press ' + btn('RB') + ' until <b>GAS</b>, aim at the crowd in front of a line and press ' + btn('A') + '. The selected squad throws it, so stay within 40 m. People in the cloud panic and some go home.',
      hi: '#tool_gas',
      setup(t) { t.w.authority = Math.max(t.w.authority, 60); },
      // mark the thickest crowd within throwing range of whichever squad is selected
      at: (t) => {
        const sq = t.w.squads[t.api.selSquad] || t.w.squads[0], p = sqPos(sq);
        const h = P.densAround(t.w, t.w.densP, p.x, p.y, 7);
        if (h.max < 1) return null;
        const d = Math.hypot(h.x - p.x, h.y - p.y);
        const k = d > 32 ? 32 / d : 1;
        return { x: p.x + (h.x - p.x) * k, y: p.y + (h.y - p.y) * k, r: 6 };
      },
      ev: (e) => e.type === 'gas',
    },
    {
      title: 'Charge the casseurs',
      mk: 'The black hoods are <b>casseurs</b>: they burn cars. Press ' + kb('C') + ' for <b>Charge</b> and <b>left-click</b> them (marked). Your squad runs in and arrests them.',
      pad: 'The black hoods are <b>casseurs</b>: they burn cars. Press ' + btn('RB') + ' until <b>CHARGE</b>, aim at them (marked, the cursor snaps) and press ' + btn('A') + '.',
      hi: '#tool_charge',
      setup(t) {
        t.w.authority = Math.max(t.w.authority, 60);
        const sq = t.w.squads[t.api.selSquad] || t.w.squads[1], b = t.w.nearestBloc(sq.ax, sq.ay);
        // radicalise a group in the crowd nearest the squad, and mark THAT group
        const m = t.w.map, lm = m.landmarks[0];
        const p = b && Math.hypot(b.cx - sq.ax, b.cy - sq.ay) < 60 ? { x: b.cx, y: b.cy } : { x: sq.ax + sq.nx * 14, y: sq.ay + sq.ny * 14 };
        const o = m.nearestOpen(p.x, p.y, 12) || lm;
        t.s.g = { x: o.x, y: o.y };
        if (!t.w.convertCasseurs(o.x, o.y, 12, 25)) {
          for (let k = 0; k < 25; k++) { const q = m.nearestOpen(o.x + (k % 5) - 2, o.y + ((k / 5) | 0) - 2, 4); if (q) t.w.crowd.add(K.CASS, q.x, q.y, 0); }
        }
      },
      at: (t) => {
        // follow the group as it moves: centroid of casseurs near where it was made
        const cr = t.w.crowd, g = t.s.g;
        let sx = 0, sy = 0, n = 0;
        for (let i = 0; i < cr.n; i++) if (cr.kind[i] === K.CASS) { const d = (cr.x[i] - g.x) ** 2 + (cr.y[i] - g.y) ** 2; if (d < 400) { sx += cr.x[i]; sy += cr.y[i]; n++; } }
        if (n) { g.x = sx / n; g.y = sy / n; }
        return { x: g.x, y: g.y, r: 6 };
      },
      ev: (e) => e.type === 'charge',
    },
    {
      title: 'Close a street',
      mk: 'Press ' + kb('B') + ' for <b>Barrier</b>, then <b>click and drag</b> across a street. The crowd can\'t pass: it reroutes to the next street.',
      pad: 'Press ' + btn('RB') + ' until <b>BARRIER</b>. <b>Hold</b> ' + btn('A') + ', move across a street, then <b>release</b>. The crowd can\'t pass: it reroutes to the next street.',
      hi: '#tool_barrier',
      setup(t) { t.w.authority = Math.max(t.w.authority, 60); },
      ev: (e) => e.type === 'barricade' && e.kind === 2,
    },
    {
      title: 'Call the pompiers',
      mk: 'A car is on fire (marked). Press ' + kb('F') + ' for <b>Pompiers</b> and <b>left-click</b> the fire. If the crowd packs round a truck, its crew abandons it: clear them with a charge.',
      pad: 'A car is on fire (marked). Press ' + btn('RB') + ' until <b>POMPIERS</b>, aim at the fire (the cursor snaps) and press ' + btn('A') + '. If the crowd packs round a truck, its crew abandons it: clear them with a charge.',
      hi: '#tool_truck',
      setup(t) {
        t.w.authority = Math.max(t.w.authority, 60);
        let best = null, bd = Infinity;
        for (const c of t.w.map.cars) if (c.state === 0) { const d = Math.hypot(c.cx - t.cam.x, c.cy - t.cam.y); if (d < bd) { bd = d; best = c; } }
        if (best) { t.w.ignite(best.id, 'tutorial'); t.s.car = best; }
      },
      at: (t) => t.s.car ? { x: t.s.car.cx, y: t.s.car.cy, r: 4 } : null,
      ev: (e, t) => e.type === 'truck' && t.s.car && Math.hypot(e.x - t.s.car.cx, e.y - t.s.car.cy) < 3,
    },
    {
      title: 'Reinforcements',
      mk: 'Press ' + kb('R') + ' to <b>Reinforce</b>: a fresh company arrives from the police base.',
      pad: 'Press <b>D-pad up</b> to <b>Reinforce</b>: a fresh company arrives from the police base.',
      hi: '#tool_reinforce',
      setup(t) { t.w.authority = Math.max(t.w.authority, 60); t.w.cooldowns.reinforce = 0; t.s.n0 = t.w.squads.length; },
      done: (t) => t.w.squads.length > t.s.n0,
    },
    {
      title: 'Authority', info: true,
      both: 'Every order costs <b>authority</b> (the blue bar). It refills slowly, so don\'t spend it all at once.',
      hi: '#topRight .resRow',
    },
    {
      title: 'Final test',
      both: 'The whole crowd is heading for Place de la {lm0}. Hold it for 45 seconds: lines on the streets in, gas, charges, barriers. Lose it and the clock restarts.',
      setup(t) {
        const w = t.w, lm = w.map.landmarks[0];
        w.blocs.forEach((b) => w.setBlocTarget(b.id, lm.x, lm.y, lm.id));
        w.authority = Math.max(w.authority, 90);
        t.s.held = 0;
      },
      tick(t) { const lm = t.w.map.landmarks[0]; t.s.held = lm.owner === 'police' ? t.s.held + t.dt : 0; },
      at: (t) => t.lm(0),
      progress: (t) => Math.floor(t.s.held) + ' / 45 s',
      done: (t) => t.s.held >= 45,
    },
  ];

  P.TUTORIAL_STEPS = { protest: PROTEST, police: POLICE };

  // ------------------------------------------------------------------ coach
  function Tutorial(side, api) {
    this.side = side; this.api = api; this.cam = api.cam;
    this.steps = side === P.SIDE.PROTEST ? PROTEST : POLICE;
    this.i = -1; this.s = {}; this.finished = false; this.hiEl = null; this.t = 0;
    this.next();
  }
  Object.defineProperty(Tutorial.prototype, 'w', { get() { return this.api.world; } });
  Tutorial.prototype.lm0 = function () { return this.lm(0); };
  Tutorial.prototype.lm = function (i) { const ls = this.w.map.landmarks, lm = ls[i] || ls[0]; return { x: lm.x, y: lm.y, r: lm.r }; };
  // nearest bridge tile to the bloc (river maps), or null
  Tutorial.prototype.bridge = function () {
    if (this.s.bridge !== undefined) return this.s.bridge;
    const m = this.w.map, b = this.w.blocs[0];
    let best = null, bd = Infinity;
    for (let k = 0; k < m.N; k += 2) if (m.tile[k] === P.T.BRIDGE) { const x = k % m.W, y = (k / m.W) | 0, d = (x - b.cx) ** 2 + (y - b.cy) ** 2; if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; } }
    return (this.s.bridge = best);
  };
  Tutorial.prototype.step = function () { return this.steps[this.i]; };
  Tutorial.prototype.next = function () {
    this.i++; this.s = {}; this.t = 0;
    if (this.i >= this.steps.length) { this.finished = true; this.api.onDone(this.side); return; }
    const st = this.step();
    if (st.setup) st.setup(this);
    if (st.skip && st.skip(this)) { this.next(); return; }
    this.render(true);
    if (P.audio) P.audio.play('capture');
  };
  Tutorial.prototype.text = function (html) {
    const w = this.w, sq = w.squads[1];
    const L = w.map.landmarks, nm = (i) => (L[i] || L[0]).name;
    return html.replace(/\{lm0\}/g, nm(0)).replace(/\{lm1\}/g, nm(1)).replace(/\{lm2\}/g, nm(2)).replace(/\{sq1\}/g, sq ? sq.name : 'CRS 8');
  };
  Tutorial.prototype.device = function () { return this.api.lastInput === 'pad' ? 'pad' : 'mk'; };
  Tutorial.prototype.render = function (force) {
    const dev = this.device();
    if (!force && dev === this.lastDev && this.i === this.lastI) return;
    this.lastDev = dev; this.lastI = this.i;
    const el = this.api.el;
    if (this.finished) return;
    const st = this.step();
    el.querySelector('.tutStep').textContent = 'STEP ' + (this.i + 1) + ' / ' + this.steps.length;
    el.querySelector('.tutDev').textContent = dev === 'pad' ? '🎮 Controller' : '🖱 Mouse & keyboard';
    el.querySelector('.tutTitle').textContent = st.title;
    el.querySelector('.tutText').innerHTML = this.text(st[dev] || st.both);
    const cont = el.querySelector('.tutContinue');
    cont.classList.toggle('hidden', !st.info);
    cont.innerHTML = dev === 'pad' ? 'Continue ' + btn('A') : 'Continue ' + kb('Enter');
    el.querySelector('.tutDots').innerHTML = this.steps.map((_, k) => '<i class="' + (k < this.i ? 'd' : k === this.i ? 'c' : '') + '"></i>').join('');
    // highlight the HUD element the step is about
    if (this.hiEl) this.hiEl.classList.remove('tutHi');
    this.hiEl = st.hi ? document.querySelector(st.hi) : null;
    if (this.hiEl) this.hiEl.classList.add('tutHi');
  };
  Tutorial.prototype.update = function (dt) {
    if (this.finished || !this.w) return;
    const st = this.step();
    this.t += dt;
    this.dt = dt;
    if (st.tick) st.tick(this);
    this.render(false);
    if (st.progress) { const pr = st.title + ' — ' + st.progress(this); if (pr !== this.lastPr) { this.lastPr = pr; this.api.el.querySelector('.tutTitle').textContent = pr; } }
    if (st.hi && (!this.hiEl || !this.hiEl.isConnected)) { this.hiEl = document.querySelector(st.hi); if (this.hiEl) this.hiEl.classList.add('tutHi'); }
    if (st.done && this.t > 0.4 && st.done(this)) this.next();
  };
  Tutorial.prototype.onEvent = function (e) {
    if (this.finished) return;
    const st = this.step();
    if (st.ev && st.ev(e, this)) this.next();
  };
  // Enter / Space / A on an info step
  Tutorial.prototype.confirm = function () {
    if (this.finished) return false;
    const st = this.step();
    if (!st.info || this.t < 0.3) return false;
    this.next();
    return true;
  };
  Tutorial.prototype.target = function () {
    if (this.finished) return null;
    const st = this.step();
    return st.at ? st.at(this) : null;
  };
  Tutorial.prototype.destroy = function () { if (this.hiEl) this.hiEl.classList.remove('tutHi'); };

  P.Tutorial = Tutorial;
})();
