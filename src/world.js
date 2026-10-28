// The World: owns the map, crowd, fields, fires, gas, trucks, squads,
// landmarks, economy and objectives. Headless — render.js only reads it.
(function () {
  const P = globalThis.PAVE;
  const K = P.K;

  function World(level, settings) {
    settings = settings || {};
    this.level = level;
    this.side = level.side;
    this.seed = level.seed || 1;
    const sizeMul = settings.crowdScale || 1;
    this.pop = Math.round(level.pop * sizeMul);
    const map = (this.map = P.generateMap({ w: level.w || 320, h: level.h || 320, seed: this.seed,
      landmarks: level.landmarks, names: level.names, carRate: level.carRate, style: level.style }));
    if (level.names) map.landmarks.forEach((lm, i) => { if (level.names[i]) lm.name = level.names[i]; });
    this.cap = Math.max(4000, Math.min(settings.maxAgents || 120000, Math.round(this.pop * 1.6) + 2000));
    this.crowd = new P.Crowd(this.cap, map.W, map.H, this.seed * 7919);
    this.CW = Math.ceil(map.W / P.CS); this.CH = Math.ceil(map.H / P.CS);
    const CN = this.CW * this.CH;
    this.densP = new Float32Array(CN); this.densC = new Float32Array(CN);
    this.densPol = new Float32Array(CN); this.densCharge = new Float32Array(CN);
    this.gas = new Float32Array(CN); this.gasTmp = new Float32Array(CN);
    this.heat = new Float32Array(CN); this.threat = new Float32Array(CN);

    this.time = 0;
    this.timeLimit = level.time || 360;
    this.rng = P.rng(this.seed * 31 + 7);
    this.events = [];       // consumed by UI / audio / chat each frame
    this.stats = { burned: 0, arrests: 0, left: 0, peak: 0, captures: 0, gasUsed: 0, fireworks: 0, extinguished: 0 };
    this.momentum = level.momentum != null ? level.momentum : 50;
    this.authority = level.authority != null ? level.authority : 60;
    this.aiAuthority = 70;
    this.trucks = []; this.trucksMax = level.trucks != null ? level.trucks : 3; this.trucksOut = 0;
    this.canisters = []; this.shots = [];
    this.result = null;
    this.intactCars = map.cars.length;
    this.cooldowns = {};
    this.carDirtyAt = -1;
    this.fieldQueue = [];
    this.night = !!level.night;
    this.wind = { x: 0.35, y: -0.55 };

    // exit field (to the map edges) — used by people who give up and go home
    this.exitField = new P.Field(map);
    const exitSrc = [];
    for (const e of map.entries) for (const s of P.discSources(map, e.x, e.y, 2)) exitSrc.push(s);
    this.exitField.compute(exitSrc);
    this.carField = new P.Field(map);
    this.computeCarField();

    // spawn entries for protesters: away from the police base
    const pb = map.policeBase;
    this.spawnEntries = map.entries.filter((e) => Math.hypot(e.x - pb.x, e.y - pb.y) > 60);
    if (!this.spawnEntries.length) this.spawnEntries = map.entries.slice();
    if (this.side === P.SIDE.PROTEST) {
      // the player's manif starts from one side of the city; they choose where it goes
      let far = this.spawnEntries[0], fd = -1;
      for (const e of this.spawnEntries) { const d = Math.hypot(e.x - pb.x, e.y - pb.y); if (d > fd) { fd = d; far = e; } }
      const near = this.spawnEntries.filter((e) => Math.hypot(e.x - far.x, e.y - far.y) < 95);
      if (near.length) this.spawnEntries = near;
      this.rally = map.nearestOpen(far.x + (map.W / 2 - far.x) * 0.22, far.y + (map.H / 2 - far.y) * 0.22, 20) || far;
    }

    // blocs (protest columns), each with its own goal field
    this.blocs = [];
    const nb = level.blocs || 2;
    for (let b = 0; b < nb; b++) this.blocs.push({ id: b, field: new P.Field(map), tx: 0, ty: 0, arrive: 5, n: 0,
      target: -1, best: 1e9, stall: 0, holdT: 0, cx: 0, cy: 0 });
    const lms = map.landmarks;
    this.blocs.forEach((b, i) => {
      if (this.rally) { this.setBlocTarget(i, this.rally.x, this.rally.y, null); return; }
      const lm = lms[i % lms.length];
      this.setBlocTarget(i, lm.x, lm.y, lm.id);
    });

    // police squads
    this.squads = [];
    // The crowd-density setting must scale BOTH sides (Brain: a setting that tunes a
    // shared rule in an asymmetric game is secretly easy mode for one role).
    this.scale = sizeMul;
    this.squadSize = Math.max(24, Math.min(96, Math.round((level.squadSize || 48) * sizeMul)));
    const nsq = level.squads || 4;
    for (let s = 0; s < nsq; s++) this.addSquad(this.squadSize, true);
    // initial deployment: guard landmarks
    this.squads.forEach((sq, i) => {
      const lm = lms[i % lms.length];
      const ang = (i / Math.max(1, nsq)) * Math.PI * 2;
      const o = map.nearestOpen(lm.x + Math.cos(ang) * (lm.r - 4), lm.y + Math.sin(ang) * (lm.r - 4), 10) || lm;
      this.orderSquad(sq, o.x, o.y, false, true);
    });

    // starting crowd
    this.spawnProtesters(Math.round(this.pop * (level.startFrac || 0.45)), true);
    this.recount();

    this.ai = this.side === P.SIDE.PROTEST ? new P.PoliceAI(this) : new P.ProtestAI(this);
    this.objectives = (level.objectives || []).map((o) => Object.assign({ done: false, failed: false, progress: '' }, o));
    this.landmarkTick = 0; this.spawnTick = 0; this.secTick = 0;
  }

  World.prototype.emit = function (type, data) {
    const e = Object.assign({ type, t: this.time }, data || {});
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, 200);
    return e;
  };

  // ---------------- fields -----------------
  World.prototype.computeCarField = function () {
    const map = this.map, W = map.W, src = [];
    let intact = 0;
    for (const c of map.cars) {
      if (c.state !== 0) continue;
      intact++;
      for (let yy = c.y - 1; yy <= c.y + c.h; yy++) for (let xx = c.x - 1; xx <= c.x + c.w; xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= map.H) continue;
        const k = yy * W + xx;
        if (!map.solid[k]) src.push(k);
      }
    }
    this.intactCars = intact;
    this.carField.compute(src);
    this.carDirtyAt = -1;
  };

  World.prototype.setBlocTarget = function (b, x, y, lmId) {
    const bloc = this.blocs[b];
    if (!bloc) return;
    bloc.tx = x; bloc.ty = y; bloc.target = lmId == null ? -1 : lmId;
    bloc.best = 1e9; bloc.stall = 0;
    bloc.field.compute(P.discSources(this.map, x, y, 3));
  };

  World.prototype.markMapChanged = function () {
    this.map.version++;
    const q = this.fieldQueue;
    const add = (f) => { if (f && !f.dirty) { f.dirty = true; q.push(f); } };
    for (const b of this.blocs) add(b.field);
    for (const s of this.squads) add(s.field);
    add(this.exitField);
    add(this.carField);
    for (const t of this.trucks) add(t.field);
  };

  World.prototype.processFields = function () {
    let budget = 1;
    while (budget-- > 0 && this.fieldQueue.length) {
      const f = this.fieldQueue.shift();
      if (f === this.carField) this.computeCarField();
      else f.compute();
    }
    if (this.carDirtyAt >= 0 && this.time - this.carDirtyAt > 1.5 && !this.carField.dirty) this.computeCarField();
  };

  // ---------------- squads -----------------
  World.prototype.addSquad = function (size, initial) {
    const id = this.squads.length;
    if (id >= 250) return null;
    const names = ['CRS 7', 'CRS 8', 'BRAV-M', 'CRS 21', 'CSI 75', 'CRS 37', 'CRS 14', 'GM 3', 'CRS 52', 'CRS 61', 'CSI 93', 'GM 11'];
    const map = this.map, pb = map.policeBase;
    const sq = { id, name: names[id % names.length] + (id >= names.length ? '-' + Math.floor(id / names.length) : ''),
      size, n: 0, ax: pb.x, ay: pb.y, cx: pb.x, cy: pb.y, charge: 0, field: new P.Field(map),
      slotX: new Float32Array(size), slotY: new Float32Array(size), ux: 1, uy: 0, nx: 0, ny: 1, busy: 0, home: -1 };
    this.squads.push(sq);
    for (let s = 0; s < size; s++) {
      const a = this.rng() * 6.283, r = this.rng() * 4;
      let x = pb.x + Math.cos(a) * r, y = pb.y + Math.sin(a) * r;
      if (initial) { x = pb.x + Math.cos(a) * r; y = pb.y + Math.sin(a) * r; }
      const o = map.nearestOpen(x, y, 8) || pb;
      this.crowd.add(K.POL, o.x, o.y, id, s);
    }
    sq.n = size;
    this.orderSquad(sq, pb.x, pb.y, false, true);
    return sq;
  };

  // Form a line across the street at (x,y), facing the nearest protest mass.
  World.prototype.orderSquad = function (sq, x, y, charge, silent) {
    const map = this.map;
    const o = map.nearestOpen(x, y, 14);
    if (!o) return false;
    x = o.x; y = o.y;
    sq.ax = x; sq.ay = y;
    if (charge) {
      sq.charge = 8; sq.cx = x; sq.cy = y;
    } else sq.charge = 0;
    sq.field.compute(P.discSources(map, x, y, 2.5));
    // orientation: span the narrowest crossing of the street, at whatever angle it runs
    let fx = (this.protCx || map.W / 2) - x, fy = (this.protCy || map.H / 2) - y;
    const bl = this.nearestBloc(x, y);
    if (bl) { fx = bl.cx - x; fy = bl.cy - y; }
    const fm = Math.hypot(fx, fy) || 1; fx /= fm; fy /= fm;
    const cl = map.crossLine(x, y, 30);
    let ux, uy, span, cx = x, cy = y;
    if (cl.span >= 30) { ux = -fy; uy = fx; span = 22; } // open square: face the crowd
    else {
      ux = cl.ux; uy = cl.uy; span = cl.span;
      cx = x + ux * (cl.b - cl.a) / 2; cy = y + uy * (cl.b - cl.a) / 2;
      // face along the street, toward the crowd's side
      let nx = -uy, ny = ux;
      if (nx * fx + ny * fy < 0) { nx = -nx; ny = -ny; }
      fx = nx; fy = ny;
    }
    sq.ux = ux; sq.uy = uy; sq.nx = fx; sq.ny = fy;
    const sp = 0.86;
    const cols = Math.max(4, Math.min(sq.size, Math.floor((span - 0.6) / sp)));
    for (let s = 0; s < sq.size; s++) {
      const c = s % cols, r = Math.floor(s / cols);
      let px = cx + ux * (c - (cols - 1) / 2) * sp - fx * r * sp;
      let py = cy + uy * (c - (cols - 1) / 2) * sp - fy * r * sp;
      if (!map.walkable(px, py)) { const q = map.nearestOpen(px, py, 4); if (q) { px = q.x; py = q.y; } }
      sq.slotX[s] = px; sq.slotY[s] = py;
    }
    if (!silent) this.emit(charge ? 'charge' : 'order', { x, y, squad: sq.id });
    return true;
  };

  World.prototype.nearestBloc = function (x, y) {
    let best = null, bd = 1e9;
    for (const b of this.blocs) {
      if (b.n < 20) continue;
      const d = Math.hypot(b.cx - x, b.cy - y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  };

  // ---------------- spawning -----------------
  World.prototype.spawnProtesters = function (count, scatter, at) {
    const map = this.map, cr = this.crowd;
    const cassFrac = (this.level.cassFrac != null ? this.level.cassFrac : 0.006) / (this.scale || 1); // same casseur count at any density
    let made = 0;
    for (let i = 0; i < count; i++) {
      if (cr.n >= this.cap - 8) break;
      let e = at || this.spawnEntries[Math.floor(this.rng() * this.spawnEntries.length)];
      let x = e.x, y = e.y;
      if (scatter) {
        // start already marching: scatter along the bloc field near entries/plazas
        const bl = this.blocs[i % this.blocs.length];
        const r = 6 + this.rng() * 26, a = this.rng() * 6.283;
        const src = this.spawnEntries[(i + bl.id) % this.spawnEntries.length];
        x = src.x + Math.cos(a) * r; y = src.y + Math.sin(a) * r;
      } else {
        x += (this.rng() - 0.5) * 6; y += (this.rng() - 0.5) * 6;
      }
      const o = map.nearestOpen(x, y, 10);
      if (!o) continue;
      const kind = this.rng() < cassFrac ? K.CASS : K.PROT;
      const id = cr.add(kind, o.x + (this.rng() - 0.5) * 0.8, o.y + (this.rng() - 0.5) * 0.8, this.pickBloc());
      if (kind === K.CASS && id >= 0) cr.act[id] = -this.rng() * 50; // stagger the first attempts
      made++;
    }
    return made;
  };

  World.prototype.pickBloc = function () {
    let best = 0, bn = 1e9;
    for (const b of this.blocs) if (b.n < bn) { bn = b.n; best = b.id; }
    const b = this.blocs[best];
    b.n++;
    return best;
  };

  World.prototype.targetPop = function () {
    return Math.min(this.cap - 400, this.pop * (0.25 + 0.0125 * this.momentum));
  };

  // ---------------- events from the crowd -----------------
  World.prototype.onArrest = function (j) {
    this.stats.arrests++;
    this.momentum = Math.max(0, this.momentum - 0.35);
    if (this.stats.arrests % 10 === 1) this.emit('arrest', { x: this.crowd.x[j], y: this.crowd.y[j] });
  };
  World.prototype.onLeave = function () { this.stats.left++; };

  World.prototype.ignite = function (id, by) {
    const c = this.map.cars[id];
    if (!c || c.state !== 0) return;
    c.state = 1; c.burn = 0; c.inten = 0.15; c.heat = 1;
    this.stats.burned++;
    this.intactCars--;
    this.momentum = Math.min(100, this.momentum + 0.6);
    if (this.carDirtyAt < 0) this.carDirtyAt = this.time;
    this.emit('ignite', { x: c.cx, y: c.cy, car: id, by });
  };

  World.prototype.hitBarricade = function (k, kind, dt) {
    const map = this.map, bk = map.barrKind[k];
    if ((kind === K.POL && bk === 1) || (kind === K.CASS && bk === 2) || (kind === K.PROT && bk === 2 && this.rng() < 0.3)) {
      map.barr[k] -= dt * (kind === K.POL ? 0.45 : 0.25);
      if (map.barr[k] <= 0) this.removeBarricade(k);
    }
  };

  World.prototype.removeBarricade = function (k) {
    const map = this.map;
    map.barr[k] = 0; map.barrKind[k] = 0;
    map.solid[k] = map.carAt[k] >= 0 ? 1 : 0;
    this.markMapChanged();
  };

  // Supercover line of barricade tiles. Returns tiles placed.
  World.prototype.placeBarricade = function (x0, y0, x1, y1, kind, maxTiles) {
    const map = this.map, W = map.W;
    const pts = [];
    let x = Math.floor(x0), y = Math.floor(y0);
    const ex = Math.floor(x1), ey = Math.floor(y1);
    const dx = Math.abs(ex - x), dy = Math.abs(ey - y), sxn = x < ex ? 1 : -1, syn = y < ey ? 1 : -1;
    let err = dx - dy, guard = 0;
    while (guard++ < 400) {
      pts.push(x, y);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 > -dy && e2 < dx) { // diagonal step: add the orthogonal tile too (no leaks)
        pts.push(x + sxn, y);
      }
      if (e2 > -dy) { err -= dy; x += sxn; }
      if (e2 < dx) { err += dx; y += syn; }
    }
    let placed = 0;
    for (let i = 0; i < pts.length && placed < (maxTiles || 999); i += 2) {
      const px = pts[i], py = pts[i + 1];
      if (px < 1 || py < 1 || px >= W - 1 || py >= map.H - 1) continue;
      const k = py * W + px;
      if (map.solid[k]) continue;
      if (map.tile[k] === P.T.MONUMENT) continue;
      map.barr[k] = kind === 1 ? 7 : 12; map.barrKind[k] = kind; map.solid[k] = 1;
      placed++;
    }
    if (placed) { this.markMapChanged(); this.emit('barricade', { x: (x0 + x1) / 2, y: (y0 + y1) / 2, kind, n: placed }); }
    return placed;
  };

  // ---------------- abilities (used by player and AI) -----------------
  World.prototype.throwGas = function (fromX, fromY, x, y) {
    this.canisters.push({ x0: fromX, y0: fromY, x, y, t: 0, dur: 0.9, life: 7, landed: false });
    this.stats.gasUsed++;
    this.emit('gas', { x, y });
  };

  World.prototype.launchFireworks = function (fromX, fromY, x, y) {
    this.shots.push({ x0: fromX, y0: fromY, x, y, t: 0, dur: 1.1 });
    this.stats.fireworks++;
    this.emit('fireworks', { x, y });
  };

  World.prototype.dispatchTruck = function (car) {
    if (this.trucksOut >= this.trucksMax) return false;
    const map = this.map, st = map.station;
    const f = new P.Field(map, { roadOnly: true });
    f.compute(P.discSources(map, car.cx, car.cy, 4));
    if (f.distAt(st.x, st.y) === Infinity) return false;
    this.trucks.push({ x: st.x, y: st.y, a: 0, field: f, state: 'go', car: car.id, spray: 0 });
    this.trucksOut++;
    this.emit('truck', { x: car.cx, y: car.cy });
    return true;
  };

  World.prototype.convertCasseurs = function (x, y, r, maxN) {
    const cr = this.crowd;
    let made = 0;
    for (let i = 0; i < cr.n && made < maxN; i++) {
      if (cr.kind[i] !== K.PROT) continue;
      const dx = cr.x[i] - x, dy = cr.y[i] - y;
      if (dx * dx + dy * dy < r * r) { cr.kind[i] = K.CASS; cr.flags[i] = 0; made++; }
    }
    if (made) this.emit('casseurs', { x, y, n: made });
    return made;
  };

  World.prototype.policePos = function () {
    // centroid of police: where gas canisters are thrown from
    return { x: this.polCx || this.map.policeBase.x, y: this.polCy || this.map.policeBase.y };
  };

  // ---------------- per-tick systems -----------------
  World.prototype.updateGrids = function (dt) {
    const cr = this.crowd, n = cr.n, CW = this.CW;
    const dP = this.densP, dC = this.densC, dPol = this.densPol, dCh = this.densCharge;
    dP.fill(0); dC.fill(0); dPol.fill(0); dCh.fill(0);
    let pc = 0, ccx = 0, ccy = 0, polc = 0, pcx = 0, pcy = 0, cass = 0;
    for (const b of this.blocs) { b.n = 0; b.sx = 0; b.sy = 0; }
    const blocs = this.blocs;
    for (let i = 0; i < n; i++) {
      const xi = cr.x[i], yi = cr.y[i];
      const ci = ((yi | 0) >> 2) * CW + ((xi | 0) >> 2);
      const k = cr.kind[i];
      if (k === K.POL) {
        dPol[ci]++; polc++; pcx += xi; pcy += yi;
        const sq = this.squads[cr.grp[i]];
        if (sq && sq.charge > 0) dCh[ci]++;
      } else {
        dP[ci]++; pc++; ccx += xi; ccy += yi;
        if (k === K.CASS) { dC[ci]++; cass++; }
        const b = blocs[cr.grp[i]];
        if (b) { b.n++; b.sx += xi; b.sy += yi; }
      }
    }
    for (const b of blocs) if (b.n) { b.cx = b.sx / b.n; b.cy = b.sy / b.n; }
    this.protCount = pc; this.polCount = polc; this.cassCount = cass;
    if (pc) { this.protCx = ccx / pc; this.protCy = ccy / pc; }
    if (polc) { this.polCx = pcx / polc; this.polCy = pcy / polc; }
    if (pc > this.stats.peak) this.stats.peak = pc;

    // gas: sources, diffusion, decay
    const gas = this.gas, tmp = this.gasTmp, CH = this.CH;
    for (const c of this.canisters) {
      if (!c.landed) continue;
      c.life -= dt;
      const gx = (c.x / P.CS) | 0, gy = (c.y / P.CS) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = gx + ox, yy = gy + oy;
        if (xx < 0 || yy < 0 || xx >= CW || yy >= CH) continue;
        gas[yy * CW + xx] += dt * (ox === 0 && oy === 0 ? 1.6 : 0.7);
      }
    }
    this.canisters = this.canisters.filter((c) => !c.landed || c.life > 0);
    const a = 0.1, decay = 1 - 0.09 * dt;
    for (let yy = 0; yy < CH; yy++) for (let xx = 0; xx < CW; xx++) {
      const k = yy * CW + xx, g = gas[k];
      const l = xx > 0 ? gas[k - 1] : g, r = xx < CW - 1 ? gas[k + 1] : g;
      const u = yy > 0 ? gas[k - CW] : g, d = yy < CH - 1 ? gas[k + CW] : g;
      let v = (g * (1 - a) + a * 0.25 * (l + r + u + d)) * decay;
      tmp[k] = v < 0.004 ? 0 : v > 3 ? 3 : v;
    }
    gas.set(tmp);

    // heat from fires
    const heat = this.heat;
    heat.fill(0);
    for (const c of this.map.cars) {
      if (c.state !== 1) continue;
      const k = ((c.cy | 0) >> 2) * CW + ((c.cx | 0) >> 2);
      heat[k] += c.inten * 1.2;
    }
    const th = this.threat;
    for (let k = 0; k < th.length; k++) {
      const v = gas[k] * 1.1 + heat[k] * 0.7 + dCh[k] * 0.09;
      th[k] = v > 3 ? 3 : v;
    }
  };

  World.prototype.updateFires = function (dt) {
    const cars = this.map.cars, wind = this.wind;
    for (const c of cars) {
      if (c.state !== 1) { if (c.state === 0 && c.heat > 0) c.heat = Math.max(0, c.heat - dt * 0.012); continue; }
      c.burn += dt;
      if (c.spray > 0) { c.inten -= dt * 0.32; c.spray -= dt; }
      else c.inten = Math.min(1, c.inten + dt * 0.22);
      if (c.inten <= 0 || c.burn > 55) {
        c.state = 2; c.inten = 0;
        if (c.burn <= 55) { this.stats.extinguished++; this.emit('extinguished', { x: c.cx, y: c.cy }); }
        continue;
      }
      const near = c.near;
      for (let q = 0; q < near.length; q += 2) {
        const d = cars[near[q]];
        if (d.state !== 0) continue;
        const dist = near[q + 1];
        const down = 1 + 0.6 * ((d.cx - c.cx) * wind.x + (d.cy - c.cy) * wind.y) / (dist || 1);
        d.heat += dt * c.inten * 0.16 * (1 - dist / 8) * Math.max(0.5, down);
        if (d.heat > 1) this.ignite(d.id, 'spread');
      }
    }
  };

  World.prototype.updateTrucks = function (dt) {
    const map = this.map, cars = map.cars;
    const CW = this.CW;
    for (const tr of this.trucks) {
      const tx = tr.x | 0, ty = tr.y | 0, t = ty * map.W + tx;
      const f = tr.field;
      if (tr.state === 'go' || tr.state === 'back') {
        const d = f.dist[t];
        // arrive by distance to the fire itself (the road can stop short of a car parked on a lane)
        const tc = tr.state === 'go' ? cars[tr.car] : null;
        if (tc && (Math.hypot(tc.cx - tr.x, tc.cy - tr.y) < 8 || d <= 20)) { tr.state = 'spray'; continue; }
        if (tr.state === 'back' && d <= 25) { tr.done = true; continue; }
        if (d === P.INF) { // cut off: re-route
          tr.stuck = (tr.stuck || 0) + dt;
          if (tr.stuck > 4) { tr.state = 'back'; tr.done = true; }
          continue;
        }
        const ci = (ty >> 2) * CW + (tx >> 2);
        const crowded = this.densP[ci] > 14 ? 0.35 : 1;
        const sp = 12 * crowded;
        const dx = f.dx[t], dy = f.dy[t];
        tr.x += dx * sp * dt; tr.y += dy * sp * dt;
        if (dx || dy) {
          const ta = Math.atan2(dy, dx);
          let da = ta - tr.a; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283;
          tr.a += da * Math.min(1, dt * 6);
        }
      } else if (tr.state === 'spray') {
        let any = false;
        for (const c of cars) {
          if (c.state !== 1) continue;
          if (Math.hypot(c.cx - tr.x, c.cy - tr.y) < 12) { c.spray = 0.3; any = true; tr.sprayAt = c; }
        }
        tr.spray = any ? 1 : 0;
        if (!any) {
          // look for the next fire nearby, otherwise go home
          let best = null, bd = 45;
          for (const c of cars) if (c.state === 1) { const d = Math.hypot(c.cx - tr.x, c.cy - tr.y); if (d < bd) { bd = d; best = c; } }
          if (best) { tr.field.compute(P.discSources(map, best.cx, best.cy, 4)); tr.state = 'go'; tr.car = best.id; }
          else { tr.field.compute(P.discSources(map, map.station.x, map.station.y, 2)); tr.state = 'back'; }
        }
      }
    }
    const before = this.trucks.length;
    this.trucks = this.trucks.filter((t) => !t.done);
    this.trucksOut -= before - this.trucks.length;
  };

  World.prototype.updateProjectiles = function (dt) {
    for (const c of this.canisters) {
      if (c.landed) continue;
      c.t += dt;
      if (c.t >= c.dur) { c.landed = true; this.emit('gasLand', { x: c.x, y: c.y }); }
    }
    const cr = this.crowd;
    for (const s of this.shots) {
      s.t += dt;
      if (s.t >= s.dur && !s.done) {
        s.done = true;
        let hit = 0;
        for (let i = 0; i < cr.n; i++) {
          if (cr.kind[i] !== K.POL) continue;
          const dx = cr.x[i] - s.x, dy = cr.y[i] - s.y;
          if (dx * dx + dy * dy < 42) { cr.stun[i] = 2.5 + this.rng() * 2; hit++; }
        }
        if (hit) this.momentum = Math.min(100, this.momentum + 1.5);
        this.emit('burst', { x: s.x, y: s.y, hit });
      }
    }
    this.shots = this.shots.filter((s) => !s.done);
  };

  World.prototype.updateLandmarks = function (dt) {
    const CW = this.CW, CS = P.CS;
    for (const lm of this.map.landmarks) {
      let prot = 0, pol = 0;
      const r = lm.r;
      for (let cy = Math.max(0, ((lm.y - r) / CS) | 0); cy <= Math.min(this.CH - 1, ((lm.y + r) / CS) | 0); cy++)
        for (let cx = Math.max(0, ((lm.x - r) / CS) | 0); cx <= Math.min(CW - 1, ((lm.x + r) / CS) | 0); cx++) {
          const mx = cx * CS + 2, my = cy * CS + 2;
          if ((mx - lm.x) ** 2 + (my - lm.y) ** 2 > r * r) continue;
          prot += this.densP[cy * CW + cx]; pol += this.densPol[cy * CW + cx];
        }
      lm.prot = prot; lm.pol = pol;
      const prev = lm.owner;
      if (prot > 25 && prot > pol * 4) lm.control += dt * 0.006 * (this.level.captureMul || 1) * Math.min(3, prot / (pol * 4 + 25));
      else if (pol > 4 && pol * 4 >= prot) lm.control -= dt * 0.02 * Math.min(3, (pol * 4 + 1) / (prot + 10));
      else lm.control += (lm.owner === 'protest' ? 0.004 : -0.004) * dt;
      lm.control = P.clamp(lm.control, -1, 1);
      if (lm.owner === 'police' && lm.control >= 1) lm.owner = 'protest';
      else if (lm.owner === 'protest' && lm.control <= 0) lm.owner = 'police';
      if (lm.owner !== prev) {
        if (lm.owner === 'protest') { this.stats.captures++; this.momentum = Math.min(100, this.momentum + 12); }
        else this.momentum = Math.max(0, this.momentum - 6);
        this.emit(lm.owner === 'protest' ? 'capture' : 'retake', { x: lm.x, y: lm.y, name: lm.name, id: lm.id });
      }
      if (lm.owner === 'protest') lm.heldFor += dt; else lm.heldFor = 0;
    }
  };

  World.prototype.updateEconomy = function (dt) {
    const held = this.map.landmarks.filter((l) => l.owner === 'protest').length;
    let avgPanic = 0;
    const cr = this.crowd;
    if (cr.n) {
      let s = 0, c = 0;
      for (let i = 0; i < cr.n; i += 7) if (cr.kind[i] !== K.POL) { s += cr.panic[i]; c++; }
      avgPanic = c ? s / c : 0;
    }
    this.avgPanic = avgPanic;
    this.momentum += dt * (0.35 * held + 0.12 - 1.6 * avgPanic - (this.protCount < this.pop * 0.15 ? 0.4 : 0));
    this.momentum = P.clamp(this.momentum, 0, 100);
    this.authority = Math.min(100, this.authority + dt * 0.75);
    this.aiAuthority = Math.min(100, this.aiAuthority + dt * (this.level.aiRegen || 0.7));
    for (const k in this.cooldowns) if (this.cooldowns[k] > 0) this.cooldowns[k] -= dt;

    // inflow / outflow toward the momentum-driven target population
    const target = this.targetPop();
    if (this.protCount < target) {
      const want = Math.min(Math.ceil((target - this.protCount) * dt * 0.08) + 1, Math.ceil(dt * 70));
      this.spawnProtesters(want, false);
    } else if (this.protCount > target * 1.15 && this.momentum < 25) {
      const cr2 = this.crowd;
      const quit = Math.ceil((this.protCount - target) * dt * 0.02);
      for (let q = 0; q < quit; q++) {
        const i = Math.floor(this.rng() * cr2.n);
        if (cr2.kind[i] === K.PROT) cr2.flags[i] |= P.AF.LEAVING;
      }
    }
    for (const sq of this.squads) if (sq.charge > 0) { sq.charge -= dt; if (sq.charge <= 0) this.orderSquad(sq, sq.ax, sq.ay, false, true); }
  };

  World.prototype.recount = function () { this.updateGrids(0); };

  World.prototype.checkObjectives = function () {
    if (this.result) return;
    const st = this.stats, lms = this.map.landmarks;
    let allGoals = true, anyGoal = false;
    for (const o of this.objectives) {
      switch (o.type) {
        case 'burn': o.progress = Math.min(st.burned, o.n) + '/' + o.n; o.done = st.burned >= o.n; break;
        case 'capture': {
          const held = lms.filter((l) => l.owner === 'protest').length;
          o.progress = held + '/' + o.n; o.done = held >= o.n; break;
        }
        case 'captureNamed': {
          const lm = lms[o.lm || 0];
          o.progress = lm.owner === 'protest' ? 'held' : Math.round(Math.max(0, lm.control) * 100) + '%';
          o.done = lm.owner === 'protest'; break;
        }
        case 'arrest': o.progress = Math.min(st.arrests, o.n) + '/' + o.n; o.done = st.arrests >= o.n; break;
        case 'hold': {
          const lm = lms[o.lm || 0];
          o.failed = lm.owner === 'protest';
          o.progress = o.failed ? 'LOST' : Math.round(Math.max(0, lm.control) * 100) + '% pressure';
          o.done = !o.failed && this.time >= this.timeLimit; break;
        }
        case 'limit':
          o.failed = st.burned >= o.n; o.progress = st.burned + '/' + o.n;
          o.done = !o.failed && this.time >= this.timeLimit; break;
        case 'survive':
          o.progress = P.fmtTime(this.timeLimit - this.time); o.done = this.time >= this.timeLimit; break;
      }
      if (o.failed) { this.finish(false, o.failText || 'Objective failed'); return; }
      if (o.type !== 'hold' && o.type !== 'limit' && o.type !== 'survive') { anyGoal = true; if (!o.done) allGoals = false; }
    }
    if (anyGoal && allGoals) { this.finish(true); return; }
    if (this.side === P.SIDE.PROTEST && this.time > 30 && this.momentum <= 0 && this.protCount < this.pop * 0.12) {
      this.finish(false, 'The protest dispersed.'); return;
    }
    if (this.time >= this.timeLimit) {
      const ok = this.objectives.every((o) => o.done);
      this.finish(ok, ok ? null : 'Out of time.');
    }
  };

  World.prototype.finish = function (win, why) {
    if (this.result) return;
    const frac = 1 - this.time / this.timeLimit;
    let stars = 0;
    if (win) {
      stars = 1;
      if (this.side === P.SIDE.PROTEST) stars += frac > 0.25 ? 1 : 0, stars += frac > 0.5 ? 1 : 0;
      else {
        const lim = this.level.starBurn || 20;
        stars += this.stats.burned < lim ? 1 : 0;
        stars += this.stats.burned < lim / 2 ? 1 : 0;
      }
    }
    this.result = { win, why: why || (win ? 'Objectives complete.' : 'Defeat.'), stars, time: this.time };
    this.emit(win ? 'win' : 'lose', {});
  };

  World.prototype.tick = function (dt) {
    if (this.result) return;
    this.time += dt;
    this.processFields();
    this.updateGrids(dt);
    this.crowd.step(this, dt);
    this.updateFires(dt);
    this.updateTrucks(dt);
    this.updateProjectiles(dt);
    this.landmarkTick += dt;
    if (this.landmarkTick >= 0.5) { this.updateLandmarks(this.landmarkTick); this.landmarkTick = 0; }
    this.updateEconomy(dt);
    this.secTick += dt;
    if (this.secTick >= 1) {
      this.secTick = 0;
      for (const b of this.blocs) b.arrive = 5;
    }
    this.ai.update(dt);
    this.checkObjectives();
  };

  P.World = World;
})();
