// The crowd: structure-of-arrays agents, a counting-sort spatial grid, and one
// allocation-free step. Neighbour state is read from a snapshot taken before
// anyone moves (Brain: crowd sims must not update positions in place mid-loop,
// or the tick becomes iteration-order dependent).
(function () {
  const P = globalThis.PAVE;
  const K = P.K;

  const F_FLARE = 1, F_LEAVING = 2, F_FLAG = 4;
  P.AF = { FLARE: F_FLARE, LEAVING: F_LEAVING, FLAG: F_FLAG };

  const RAD = 0.42;            // personal radius in tiles
  const RR = (RAD * 2) * (RAD * 2);
  const MASS_POL = 6, MASS_HOLD = 25, MASS_POL_STUN = 1.5;

  function Crowd(cap, W, H, seed) {
    this.cap = cap;
    this.n = 0;
    this.x = new Float32Array(cap); this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap);
    this.sx = new Float32Array(cap); this.sy = new Float32Array(cap);
    this.kind = new Uint8Array(cap); this.grp = new Uint8Array(cap);
    this.slot = new Uint16Array(cap); this.col = new Uint8Array(cap);
    this.flags = new Uint8Array(cap);
    this.panic = new Float32Array(cap); this.stun = new Float32Array(cap);
    this.act = new Float32Array(cap); this.seed = new Float32Array(cap);
    this.W = W; this.H = H;
    this.start = new Int32Array(W * H + 1);
    this.cur = new Int32Array(W * H + 1);
    this.items = new Int32Array(cap);
    this.rs = (seed >>> 0) || 0x9e3779b9;
    this.counts = new Int32Array(3);
  }

  Crowd.prototype.rnd = function () {
    let s = this.rs;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.rs = s >>> 0;
    return this.rs / 4294967296;
  };

  Crowd.prototype.add = function (kind, x, y, grp, slot) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = 0; this.vy[i] = 0;
    this.kind[i] = kind; this.grp[i] = grp || 0; this.slot[i] = slot || 0;
    this.panic[i] = 0; this.stun[i] = 0; this.act[i] = 0;
    const r = this.rnd();
    this.seed[i] = r;
    let f = 0;
    if (kind === K.PROT) {
      if (r < 0.02) f |= F_FLAG;
      else if (r < 0.028) f |= F_FLARE;
      this.col[i] = (this.rnd() * 255) | 0;
    } else this.col[i] = (this.rnd() * 255) | 0;
    this.flags[i] = f;
    return i;
  };

  Crowd.prototype.copy = function (dst, src) {
    this.x[dst] = this.x[src]; this.y[dst] = this.y[src];
    this.vx[dst] = this.vx[src]; this.vy[dst] = this.vy[src];
    this.kind[dst] = this.kind[src]; this.grp[dst] = this.grp[src];
    this.slot[dst] = this.slot[src]; this.col[dst] = this.col[src];
    this.flags[dst] = this.flags[src]; this.panic[dst] = this.panic[src];
    this.stun[dst] = this.stun[src]; this.act[dst] = this.act[src];
    this.seed[dst] = this.seed[src];
  };

  Crowd.prototype.compact = function () {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      while (i < n && this.kind[i] === K.DEAD) {
        n--;
        if (i < n) this.copy(i, n);
      }
    }
    this.n = n;
  };

  Crowd.prototype.buildGrid = function () {
    const n = this.n, W = this.W, start = this.start, cur = this.cur, items = this.items;
    const sx = this.sx, sy = this.sy;
    start.fill(0);
    for (let i = 0; i < n; i++) start[((sy[i] | 0) * W + (sx[i] | 0)) + 1]++;
    for (let c = 1; c < start.length; c++) start[c] += start[c - 1];
    cur.set(start);
    for (let i = 0; i < n; i++) items[cur[(sy[i] | 0) * W + (sx[i] | 0)]++] = i;
  };

  // The whole crowd tick. `w` is the World (fields, squads, grids, trucks, fires).
  Crowd.prototype.step = function (w, dt) {
    const n = this.n;
    if (!n) return;
    const map = w.map, W = map.W, H = map.H, solid = map.solid, carAt = map.carAt, barr = map.barr, barrKind = map.barrKind;
    const x = this.x, y = this.y, vx = this.vx, vy = this.vy, sx = this.sx, sy = this.sy;
    const kind = this.kind, grp = this.grp, slot = this.slot, flags = this.flags;
    const panic = this.panic, stun = this.stun, act = this.act, seed = this.seed;
    const start = this.start, items = this.items;
    const CS = P.CS, CW = w.CW, CH = w.CH;
    const threat = w.threat, densPol = w.densPol;
    const blocs = w.blocs, squads = w.squads, trucks = w.trucks, cars = map.cars;
    const carField = w.carField, exitField = w.exitField;
    const time = w.time;
    const accel = Math.min(1, 5 * dt);

    sx.set(x.subarray(0, n)); sy.set(y.subarray(0, n));
    this.buildGrid();

    for (let i = 0; i < n; i++) {
      const k = kind[i];
      if (k === K.DEAD) continue;
      const xi = sx[i], yi = sy[i];
      const tx = xi | 0, ty = yi | 0, t = ty * W + tx;
      const cx = tx >> 2, cy = ty >> 2, ci = cy * CW + cx;
      let dxd = 0, dyd = 0, speed = 0, mi = 1;
      let charging = false, sq = null;

      if (k === K.POL) {
        sq = squads[grp[i]];
        if (stun[i] > 0) { stun[i] -= dt; mi = MASS_POL_STUN; }
        else if (sq) {
          charging = sq.charge > 0;
          const s = slot[i] < sq.slotX.length ? slot[i] : 0;
          const gx = charging ? sq.cx : sq.slotX[s], gy = charging ? sq.cy : sq.slotY[s];
          const ddx = gx - xi, ddy = gy - yi, d = Math.sqrt(ddx * ddx + ddy * ddy);
          const f = sq.field;
          if (d > 6 && f && f.ready && f.dist[t] !== P.INF) {
            dxd = f.dx[t]; dyd = f.dy[t]; speed = charging ? 3.4 : 2.6;
          } else if (d > 0.25) {
            dxd = ddx / d; dyd = ddy / d; speed = Math.min(charging ? 3.4 : 2.4, d * 2.5);
          }
          mi = d < 1.5 && !charging ? MASS_HOLD : MASS_POL;
        }
      } else {
        // protesters & casseurs
        const th = threat[ci];
        const sens = k === K.CASS ? 0.55 : 1.2;
        let p = panic[i] + (th * sens - 0.35) * dt;
        p = p < 0 ? 0 : p > 2 ? 2 : p;
        panic[i] = p;
        if (flags[i] & F_LEAVING) {
          if (exitField.dist[t] <= 25) { kind[i] = K.DEAD; w.onLeave(i); continue; }
          dxd = exitField.dx[t]; dyd = exitField.dy[t]; speed = 2.3;
        } else if (p > 1) {
          const l = cx > 0 ? threat[ci - 1] : th, r = cx < CW - 1 ? threat[ci + 1] : th;
          const u = cy > 0 ? threat[ci - CW] : th, dn = cy < CH - 1 ? threat[ci + CW] : th;
          let gx = l - r, gy = u - dn;
          const m = Math.sqrt(gx * gx + gy * gy);
          if (m > 0.02) { dxd = gx / m; dyd = gy / m; }
          else { dxd = exitField.dx[t]; dyd = exitField.dy[t]; }
          speed = 3.1;
          if (p > 1.7 && this.rnd() < dt * 0.04) flags[i] |= F_LEAVING;
        } else if (k === K.CASS) {
          const pn = densPol[ci];
          if (pn > 3 && seed[i] > 0.45 && p < 0.6) {
            // harass the police: climb the police-density gradient
            const l = cx > 0 ? densPol[ci - 1] : pn, r = cx < CW - 1 ? densPol[ci + 1] : pn;
            const u = cy > 0 ? densPol[ci - CW] : pn, dn = cy < CH - 1 ? densPol[ci + CW] : pn;
            let gx = r - l, gy = dn - u;
            const m = Math.sqrt(gx * gx + gy * gy);
            if (m > 0.01) { dxd = gx / m; dyd = gy / m; }
            speed = 2.2;
          } else if (act[i] >= 0 && carField.ready && carField.dist[t] !== P.INF && w.intactCars > 0) {
            dxd = carField.dx[t]; dyd = carField.dy[t]; speed = 2.7;
            if (carField.dist[t] <= 14) {
              act[i] += dt;
              if (act[i] > 3.5) {
                // one attempt, then a long cool-down back in the bloc
                act[i] = -(45 + seed[i] * 60);
                if (this.rnd() < 0.45) {
                  let done = false;
                  for (let oy = -1; oy <= 1 && !done; oy++) for (let ox = -1; ox <= 1 && !done; ox++) {
                    const yy = ty + oy, xx = tx + ox;
                    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                    const c = carAt[yy * W + xx];
                    if (c >= 0 && cars[c].state === 0) { w.ignite(c, 'casseur'); done = true; }
                  }
                }
              }
            }
          } else {
            if (act[i] < 0) act[i] += dt;
            const b = blocs[grp[i]] || blocs[0];
            if (b && b.field.ready && b.field.dist[t] > b.arrive * 10) { dxd = b.field.dx[t]; dyd = b.field.dy[t]; speed = 2.2; }
          }
        } else {
          const b = blocs[grp[i]] || blocs[0];
          if (b && b.field.ready) {
            const f = b.field, d = f.dist[t];
            if (d <= b.arrive * 10) {
              const a = seed[i] * 6.283 + time * (0.15 + seed[i] * 0.2);
              dxd = Math.cos(a); dyd = Math.sin(a); speed = 0.35;
            } else if (d !== P.INF) {
              dxd = f.dx[t]; dyd = f.dy[t]; speed = 1.6 + seed[i] * 0.7;
            }
          }
        }
        if (p > 0) speed *= 1 + p * 0.25;
      }

      // --- separation / contact against the snapshot ---
      let fx = 0, fy = 0, cnt = 0;
      const y0 = ty > 0 ? ty - 1 : 0, y1 = ty < H - 1 ? ty + 1 : ty;
      const x0 = tx > 0 ? tx - 1 : 0, x1 = tx < W - 1 ? tx + 1 : tx;
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * W;
        for (let xx = x0; xx <= x1; xx++) {
          const c = row + xx;
          for (let a = start[c], e = start[c + 1]; a < e; a++) {
            const j = items[a];
            if (j === i) continue;
            const kj = kind[j];
            if (kj === K.DEAD) continue;
            const ddx = xi - sx[j], ddy = yi - sy[j];
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 >= RR) continue;
            cnt++;
            if (d2 < 1e-8) { fx += this.rnd() - 0.5; fy += this.rnd() - 0.5; continue; }
            const d = Math.sqrt(d2);
            const mj = kj === K.POL ? (stun[j] > 0 ? MASS_POL_STUN : (vx[j] * vx[j] + vy[j] * vy[j] < 0.3 ? MASS_HOLD : MASS_POL)) : 1;
            const push = ((RAD * 2 - d) / d) * 0.5 * (mj / (mi + mj));
            fx += ddx * push; fy += ddy * push;
            // contact interactions
            if (k === K.POL && kj === K.CASS && stun[i] <= 0) {
              if (this.rnd() < (charging ? 0.09 : 0.012)) { kind[j] = K.DEAD; w.onArrest(j); }
            } else if (k === K.CASS && kj === K.POL) {
              if (this.rnd() < dt * 0.25) stun[j] = 1.2 + this.rnd();
            } else if (k === K.PROT && kj === K.POL) {
              const s2 = squads[grp[j]];
              if (s2 && s2.charge > 0) panic[i] += dt * 1.5;
            }
          }
        }
      }
      // fire trucks shove people aside
      for (let q = 0; q < trucks.length; q++) {
        const tr = trucks[q];
        const ddx = xi - tr.x, ddy = yi - tr.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < 6.25 && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (2.5 - d) / d * 0.25;
          fx += ddx * push; fy += ddy * push;
        }
      }

      if (cnt > 4 && k !== K.POL) speed *= 1 / (1 + 0.18 * (cnt - 4));
      const tvx = dxd * speed, tvy = dyd * speed;
      let nvx = vx[i] + (tvx - vx[i]) * accel, nvy = vy[i] + (tvy - vy[i]) * accel;
      const fm = fx * fx + fy * fy;
      if (fm > 0.09) { const s = 0.3 / Math.sqrt(fm); fx *= s; fy *= s; }
      let nx = xi + nvx * dt + fx, ny = yi + nvy * dt + fy;

      // walls / cars / barricades, one axis at a time so agents slide
      if (nx < 0.05) nx = 0.05; else if (nx > W - 0.05) nx = W - 0.05;
      if (ny < 0.05) ny = 0.05; else if (ny > H - 0.05) ny = H - 0.05;
      let kx = (yi | 0) * W + (nx | 0);
      if (solid[kx]) {
        if (barr[kx] > 0) w.hitBarricade(kx, k, dt);
        nx = xi; nvx *= -0.2;
      }
      let ky = (ny | 0) * W + (nx | 0);
      if (solid[ky]) {
        if (barr[ky] > 0) w.hitBarricade(ky, k, dt);
        ny = yi; nvy *= -0.2;
      }
      if (solid[(ny | 0) * W + (nx | 0)]) {
        // something solid appeared on top of us (a new barricade): pop out
        const o = map.nearestOpen(nx, ny, 6);
        if (o) { nx = o.x; ny = o.y; }
      }
      x[i] = nx; y[i] = ny; vx[i] = nvx; vy[i] = nvy;
    }
    this.compact();
  };

  P.Crowd = Crowd;
})();
