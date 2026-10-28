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

  const PROTEST = [
    COMMON.zoom, COMMON.camera,
    {
      title: 'This is your bloc', info: true,
      mk: 'All those dots are your people. You never move them one by one: you give the whole <b>bloc</b> a destination and each person finds their own way there, around anything in the way.',
      pad: 'All those dots are your people. You never move them one by one: you give the whole <b>bloc</b> a destination and each person finds their own way there, around anything in the way.',
      hi: '#blc_0', at: (t) => { const b = t.w.blocs[0]; return b.n ? { x: b.cx, y: b.cy, r: 14 } : null; },
    },
    {
      title: 'March on the square',
      mk: 'The <b>March</b> tool is selected. <b>Left-click</b> the pulsing ring: Place de la ' + '{lm0}' + '.',
      pad: 'Move until the cursor snaps onto the pulsing ring (Place de la {lm0}) and turns yellow, then press ' + btn('A') + '.',
      hi: '#tool_march', at: (t) => t.lm0(),
      setup(t) { t.api.pickTool('march'); },
      done: (t) => t.w.blocs[0].target === t.w.map.landmarks[0].id,
    },
    {
      title: 'Take the square',
      mk: 'They\'re on their way. When far more of your people than police stand inside the ring, it fills red and the square is yours. Too slow? ' + kb('Tab') + ' speeds time up.',
      pad: 'They\'re on their way. When far more of your people than police stand inside the ring, it fills red and the square is yours. Too slow? ' + btn('Back') + ' speeds time up.',
      hi: '#btnSpeed', at: (t) => t.lm0(),
      done: (t) => t.w.map.landmarks[0].owner === 'protest',
    },
    {
      title: 'Pick a tool',
      mk: 'Tools cost <b>momentum</b> (the orange bar, top right). Press ' + kb('2') + ' or click the <b>Casseurs</b> button.',
      pad: 'Tools cost <b>momentum</b> (the orange bar, top right). Press ' + btn('LB') + ' / ' + btn('RB') + ' until <b>CASSEURS</b> is selected.',
      hi: '#tool_casseurs',
      setup(t) { t.w.momentum = Math.max(t.w.momentum, 60); },
      done: (t) => t.api.tool === 'casseurs',
    },
    {
      title: 'Radicalise',
      mk: '<b>Left-click</b> inside your crowd. About 20 people pull their hoods up: they\'re <b>casseurs</b> now.',
      pad: 'Point at your crowd (the cursor snaps to the bloc) and press ' + btn('A') + '. About 20 people pull their hoods up: they\'re <b>casseurs</b> now.',
      at: (t) => { const b = t.w.blocs[0]; return { x: b.cx, y: b.cy, r: 10 }; },
      ev: (e) => e.type === 'casseurs',
    },
    {
      title: 'Fire spreads',
      mk: 'Casseurs head for parked cars and set them alight, and flames jump to the next car with the wind. Wait for the first one (' + kb('Tab') + ' to speed up).',
      pad: 'Casseurs head for parked cars and set them alight, and flames jump to the next car with the wind. Wait for the first one (' + btn('Back') + ' to speed up).',
      hi: '#carsBadge',
      setup(t) { t.s.b0 = t.w.stats.burned; },
      done: (t) => t.w.stats.burned > t.s.b0,
    },
    {
      title: 'Fireworks vs shields',
      mk: 'Press ' + kb('3') + ' for <b>Fireworks</b>, then <b>left-click</b> the marked police squad. Hit officers are stunned for a few seconds.',
      pad: 'Press ' + btn('RB') + ' until <b>FIREWORKS</b>, aim at the marked police squad (the cursor snaps) and press ' + btn('A') + '.',
      hi: '#tool_fireworks',
      setup(t) {
        // bring one squad close enough to the crowd to be in range
        const b = t.w.blocs[0], sq = t.w.squads[0], lm1 = t.w.map.landmarks[1] || t.w.map.landmarks[0];
        const dx = lm1.x - b.cx, dy = lm1.y - b.cy, d = Math.hypot(dx, dy) || 1;
        t.w.orderSquad(sq, b.cx + dx / d * 22, b.cy + dy / d * 22, false, true);
        t.w.momentum = Math.max(t.w.momentum, 40);
      },
      at: (t) => { const sq = t.w.squads[0]; return { x: sq.mx != null ? sq.mx : sq.ax, y: sq.my != null ? sq.my : sq.ay, r: 6 }; },
      ev: (e, t) => { const sq = t.w.squads[0]; return e.type === 'fireworks' && Math.min(Math.hypot(e.x - sq.ax, e.y - sq.ay), Math.hypot(e.x - (sq.mx || sq.ax), e.y - (sq.my || sq.ay))) < 14; },
    },
    {
      title: 'Build a barricade',
      mk: 'Press ' + kb('4') + ' for <b>Barricade</b>, then <b>click and drag</b> across a street near your people. Release to build.',
      pad: 'Press ' + btn('RB') + ' until <b>BARRICADE</b>. <b>Hold</b> ' + btn('A') + ', move across a street near your people, then <b>release</b>.',
      hi: '#tool_barricade',
      setup(t) { t.w.momentum = Math.max(t.w.momentum, 40); },
      ev: (e) => e.type === 'barricade' && e.kind === 1,
    },
    {
      title: 'Call for backup',
      mk: 'Short of people? Press ' + kb('5') + ' to <b>Mobilise</b>: the group chat brings 800 more.',
      pad: 'Short of people? Press <b>D-pad up</b> to <b>Mobilise</b>: the group chat brings 800 more.',
      hi: '#tool_mobilise',
      setup(t) { t.w.momentum = Math.max(t.w.momentum, 40); t.w.cooldowns.mobilise = 0; },
      ev: (e) => e.type === 'mobilise',
    },
    {
      title: 'Momentum is everything', info: true,
      mk: 'Burning cars and holding squares raise momentum; tear gas and arrests drain it. If it hits zero and the crowd melts away, you lose. Your other blocs: switch with ' + kb('Q') + '.',
      pad: 'Burning cars and holding squares raise momentum; tear gas and arrests drain it. If it hits zero and the crowd melts away, you lose. Your other blocs: switch with ' + btn('Y') + '.',
      hi: '.resRow',
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
      at: (t) => { const sq = t.w.squads[1]; return { x: sq.mx != null ? sq.mx : sq.ax, y: sq.my != null ? sq.my : sq.ay, r: 6 }; },
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
        const o = t.w.map.nearestOpen(lm.x + dx / d * (lm.r + 12), lm.y + dy / d * (lm.r + 12), 12) || lm;
        t.s.target = { x: o.x, y: o.y };
      },
      at: (t) => ({ x: t.s.target.x, y: t.s.target.y, r: 5 }),
      done: (t) => { const sq = t.w.squads[1]; return Math.hypot(sq.ax - t.s.target.x, sq.ay - t.s.target.y) < 10; },
    },
    {
      title: 'Tear gas',
      mk: 'Press ' + kb('G') + ' for <b>Gas</b>, then <b>left-click</b> the crowd in front of your line. The selected squad throws it, so stay within 40 m.',
      pad: 'Press ' + btn('RB') + ' until <b>GAS</b>, aim at the crowd in front of your line and press ' + btn('A') + '. The selected squad throws it, so stay within 40 m.',
      hi: '#tool_gas',
      setup(t) { t.w.authority = Math.max(t.w.authority, 60); },
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
      mk: 'Press ' + kb('B') + ' for <b>Barrier</b>, then <b>click and drag</b> across a street. The crowd will look for another way round.',
      pad: 'Press ' + btn('RB') + ' until <b>BARRIER</b>. <b>Hold</b> ' + btn('A') + ', move across a street, then <b>release</b>.',
      hi: '#tool_barrier',
      setup(t) { t.w.authority = Math.max(t.w.authority, 60); },
      ev: (e) => e.type === 'barricade' && e.kind === 2,
    },
    {
      title: 'Call the pompiers',
      mk: 'A car is on fire (marked). Press ' + kb('F') + ' for <b>Pompiers</b> and <b>left-click</b> the fire. A truck drives out through the crowd.',
      pad: 'A car is on fire (marked). Press ' + btn('RB') + ' until <b>POMPIERS</b>, aim at the fire (the cursor snaps) and press ' + btn('A') + '.',
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
      mk: 'Everything costs <b>authority</b> (the blue bar); it refills slowly. Step through squads with the number keys or ' + kb('Q') + '. In the campaign you hold squares, stop the fires and arrest casseurs without running dry.',
      pad: 'Everything costs <b>authority</b> (the blue bar); it refills slowly. Step through squads with ' + btn('Y') + ' and jump to one with ' + btn('X') + '. In the campaign you hold squares, stop the fires and arrest casseurs without running dry.',
      hi: '.resRow',
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
  Tutorial.prototype.lm0 = function () { const lm = this.w.map.landmarks[0]; return { x: lm.x, y: lm.y, r: lm.r }; };
  Tutorial.prototype.step = function () { return this.steps[this.i]; };
  Tutorial.prototype.next = function () {
    this.i++; this.s = {}; this.t = 0;
    if (this.i >= this.steps.length) { this.finished = true; this.api.onDone(this.side); return; }
    const st = this.step();
    if (st.setup) st.setup(this);
    this.render(true);
    if (P.audio) P.audio.play('capture');
  };
  Tutorial.prototype.text = function (html) {
    const w = this.w, sq = w.squads[1];
    return html.replace(/\{lm0\}/g, w.map.landmarks[0].name).replace(/\{sq1\}/g, sq ? sq.name : 'CRS 8');
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
    el.querySelector('.tutText').innerHTML = this.text(st[dev]);
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
    if (st.tick) st.tick(this);
    this.render(false);
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
