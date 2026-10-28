// Opponent brains. PoliceAI runs the préfecture when you lead the protest;
// ProtestAI runs the street when you command the CRS.
(function () {
  const P = globalThis.PAVE;

  function densAround(w, grid, x, y, rc) {
    const CW = w.CW, CH = w.CH, cx = (x / P.CS) | 0, cy = (y / P.CS) | 0;
    let s = 0, bx = x, by = y, bv = -1;
    for (let yy = Math.max(0, cy - rc); yy <= Math.min(CH - 1, cy + rc); yy++)
      for (let xx = Math.max(0, cx - rc); xx <= Math.min(CW - 1, cx + rc); xx++) {
        const v = grid[yy * CW + xx];
        s += v;
        if (v > bv) { bv = v; bx = xx * P.CS + 2; by = yy * P.CS + 2; }
      }
    return { sum: s, x: bx, y: by, max: bv };
  }
  P.densAround = densAround;

  // ---------------------------------------------------------------- police
  function PoliceAI(w) {
    this.w = w;
    this.t = 0; this.reinforceT = 0; this.gasCd = 4; this.chargeCd = 0;
    this.burnSeen = new Map();
    w.squads.forEach((sq, i) => { sq.home = i % w.map.landmarks.length; });
  }
  PoliceAI.prototype.update = function (dt) {
    const w = this.w, map = w.map, lv = w.level;
    if (lv.aiPassive) return; // tutorial: the police stand where they are
    this.t += dt; this.reinforceT += dt;
    this.gasCd -= dt; this.chargeCd -= dt;

    // fire brigade: dispatch to fires that have burned a while
    for (const c of map.cars) {
      if (c.state !== 1) continue;
      if (c.burn > (lv.aiTruckDelay || 9) && !w.trucks.some((t) => t.car === c.id) && w.trucksOut < w.trucksMax) {
        if (w.aiAuthority >= 3) { if (w.dispatchTruck(c)) w.aiAuthority -= 3; }
      }
    }

    if (this.t < 2.5) return;
    this.t = 0;
    const lms = map.landmarks;
    const perLm = {};
    for (const sq of w.squads) {
      if (sq.charge > 0) continue;
      const lm = lms[sq.home] || lms[0];
      const bl = w.nearestBloc(lm.x, lm.y);
      const rank = (perLm[lm.id] = (perLm[lm.id] || 0) + 1) - 1;
      // casseurs nearby? charge them
      const cass = densAround(w, w.densC, sq.ax, sq.ay, 4);
      if (cass.sum > 8 && this.chargeCd <= 0 && w.aiAuthority >= 6) {
        w.orderSquad(sq, cass.x, cass.y, true);
        w.aiAuthority -= 6; this.chargeCd = lv.aiChargeCd || 9;
        continue;
      }
      // hold a line between the nearest bloc and the landmark
      let gx = lm.x, gy = lm.y;
      if (bl) {
        let dx = bl.cx - lm.x, dy = bl.cy - lm.y;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d; dy /= d;
        const off = Math.max(2, Math.min(d * 0.6, lm.r + 7 - rank * 5));
        gx = lm.x + dx * off; gy = lm.y + dy * off;
      }
      if (Math.hypot(gx - sq.ax, gy - sq.ay) > 7) w.orderSquad(sq, gx, gy, false, false);
      // gas the crowd pressing the line
      const front = densAround(w, w.densP, sq.ax + sq.nx * 7, sq.ay + sq.ny * 7, 2);
      if (front.sum > (lv.aiGasAt || 70) * w.scale && this.gasCd <= 0 && w.aiAuthority >= 10) {
        w.throwGas(sq.ax, sq.ay, front.x, front.y);
        w.aiAuthority -= 10; this.gasCd = lv.aiGasCd || 7;
      }
    }
    // reinforcements
    if (this.reinforceT > (lv.aiReinforce || 75) && w.squads.length < (lv.maxSquads || 10) && w.aiAuthority >= 30) {
      this.reinforceT = 0; w.aiAuthority -= 30;
      const sq = w.addSquad(w.squadSize);
      if (sq) {
        // reinforce the landmark under most pressure
        let best = lms[0], bp = -1;
        for (const lm of lms) if (lm.prot > bp && lm.owner === 'police') { bp = lm.prot; best = lm; }
        sq.home = best.id;
        w.emit('reinforce', { x: map.policeBase.x, y: map.policeBase.y });
      }
    }
  };
  P.PoliceAI = PoliceAI;

  // ---------------------------------------------------------------- protest
  function ProtestAI(w) {
    this.w = w;
    this.t = 0; this.fwT = 6; this.barT = 20; this.convT = 15;
  }
  ProtestAI.prototype.update = function (dt) {
    const w = this.w, map = w.map, lv = w.level, lms = map.landmarks;
    this.t += dt; this.fwT -= dt; this.barT -= dt; this.convT -= dt;
    if (this.t < 2) return;
    const step = this.t; this.t = 0;
    for (const b of w.blocs) {
      if (b.n < 30) continue;
      const tgt = lms[b.target];
      const d = tgt ? Math.hypot(b.cx - tgt.x, b.cy - tgt.y) : 1e9;
      if (d < b.best - 3) { b.best = d; b.stall = 0; } else b.stall += step;
      if (tgt && tgt.owner === 'protest') b.holdT += step; else b.holdT = 0;
      const blocked = b.stall > (lv.aiStall || 28);
      if (!tgt || b.holdT > 30 || blocked) {
        // choose a different landmark: nearest one not held (random if blocked)
        const cands = lms.filter((l) => l.owner !== 'protest' && l.id !== b.target);
        const pool = cands.length ? cands : lms.filter((l) => l.id !== b.target);
        if (!pool.length) continue;
        let pick;
        if (blocked) pick = pool[Math.floor(w.rng() * pool.length)];
        else pick = pool.reduce((a, l) => (Math.hypot(l.x - b.cx, l.y - b.cy) < Math.hypot(a.x - b.cx, a.y - b.cy) ? l : a));
        w.setBlocTarget(b.id, pick.x, pick.y, pick.id);
        w.emit('aiRoute', { x: pick.x, y: pick.y, name: pick.name, bloc: b.id });
      }
    }
    // fireworks at the closest police line
    if (this.fwT <= 0 && w.momentum > 8) {
      let best = null, bd = 32;
      for (const sq of w.squads) for (const b of w.blocs) {
        if (b.n < 50) continue;
        const d = Math.hypot(sq.ax - b.cx, sq.ay - b.cy);
        if (d < bd) { bd = d; best = { sq, b }; }
      }
      if (best) {
        w.launchFireworks(best.b.cx, best.b.cy, best.sq.ax, best.sq.ay);
        w.addMom('spent', -3);
        this.fwT = lv.aiFireworks || 14;
      } else this.fwT = 3;
    }
    // barricade between a bloc and an approaching squad
    if (this.barT <= 0) {
      this.barT = lv.aiBarricade || 40;
      let best = null, bd = 55;
      for (const sq of w.squads) for (const b of w.blocs) {
        if (b.n < 80) continue;
        const d = Math.hypot(sq.ax - b.cx, sq.ay - b.cy);
        if (d < bd && d > 14) { bd = d; best = { sq, b }; }
      }
      if (best) {
        const mx = (best.sq.ax + best.b.cx) / 2, my = (best.sq.ay + best.b.cy) / 2;
        const o = map.nearestOpen(mx, my, 6);
        if (o) {
          const cl = map.crossLine(o.x, o.y, 14);
          if (cl.span < 28) w.placeBarricade(o.x - cl.ux * cl.a, o.y - cl.uy * cl.a, o.x + cl.ux * cl.b, o.y + cl.uy * cl.b, 1, 28);
        }
      }
    }
    // radicalise: casseurs appear where the crowd is angriest
    if (this.convT <= 0) {
      this.convT = lv.aiConvert || 25;
      const b = w.blocs[Math.floor(w.rng() * w.blocs.length)];
      if (b && b.n > 100) w.convertCasseurs(b.cx, b.cy, 10, lv.aiConvertN || 20);
    }
  };
  P.ProtestAI = ProtestAI;
})();
