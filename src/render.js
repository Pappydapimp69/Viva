// Renderer: pre-baked rooftop map, an ImageData crowd layer (tens of thousands
// of agents for the price of one putImageData), tree canopy over the crowd,
// fire / smoke / gas / fireworks particles, and a night pass with real lights.
(function () {
  const P = globalThis.PAVE;
  const T = P.T, K = P.K;

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function abgr(r, g, b) { return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; }
  function hash(x, y, s) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  // ------------------------------------------------------------ palettes
  const PROT_COLS = [];
  (function () {
    const dark = ['#26272b', '#2f3136', '#3a3c42', '#433d38', '#2b3340', '#352a26', '#4b4b50', '#1f2226', '#55504a', '#3e4652'];
    const mid = ['#6d6f75', '#7a6f62', '#5f6b78', '#8b8b8b', '#6e5b4b'];
    const bright = ['#d9d9d9', '#9b2d2d', '#c9b02a', '#2d6a9b', '#c76a2a', '#e8e2d0', '#6a3d8a'];
    for (let i = 0; i < 256; i++) {
      const r = hash(i, 7, 3);
      const h = r < 0.72 ? dark[i % dark.length] : r < 0.9 ? mid[i % mid.length] : bright[i % bright.length];
      const c = hexToRgb(h);
      PROT_COLS.push(abgr(c[0], c[1], c[2]));
    }
  })();
  const FLAG_COLS = ['#e0302f', '#2ea05a', '#8b3fc0', '#1f63e0', '#f0c419'].map((h) => { const c = hexToRgb(h); return abgr(c[0], c[1], c[2]); });
  const CASS_COL = abgr(14, 14, 16), CASS_HI = abgr(40, 40, 44);
  const POL_COL = abgr(28, 40, 74), POL_HI = abgr(92, 112, 158), POL_STUN = abgr(160, 150, 90);
  const LEAVE_COL = abgr(110, 110, 110);

  // ------------------------------------------------------------ sprites
  const sprites = {};
  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function soft(color, size, hard) {
    const key = color + size + (hard || 0);
    if (sprites[key]) return sprites[key];
    const c = makeCanvas(size, size), g = c.getContext('2d');
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const [r, gg, b] = hexToRgb(color);
    grd.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    grd.addColorStop(hard || 0.35, `rgba(${r},${gg},${b},0.65)`);
    grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
    return (sprites[key] = c);
  }

  // ------------------------------------------------------------ particles
  const PT = { SMOKE: 0, FLAME: 1, GAS: 2, FLARE: 3, SPARK: 4, WATER: 5, EMBER: 6 };
  P.PT = PT;
  function Particles(cap) {
    this.cap = cap; this.n = 0;
    this.x = new Float32Array(cap); this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.size = new Float32Array(cap); this.grow = new Float32Array(cap);
    this.type = new Uint8Array(cap); this.col = new Uint8Array(cap);
  }
  Particles.prototype.add = function (type, x, y, vx, vy, life, size, grow, col) {
    let i = this.n;
    if (i >= this.cap) i = (Math.random() * this.cap) | 0; else this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.grow[i] = grow || 0;
    this.type[i] = type; this.col[i] = col || 0;
  };
  Particles.prototype.update = function (dt, wind) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        if (i < l) {
          this.x[i] = this.x[l]; this.y[i] = this.y[l]; this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l];
          this.life[i] = this.life[l]; this.max[i] = this.max[l]; this.size[i] = this.size[l];
          this.grow[i] = this.grow[l]; this.type[i] = this.type[l]; this.col[i] = this.col[l];
          i--;
        }
        continue;
      }
      const t = this.type[i];
      if (t === PT.SMOKE || t === PT.FLARE || t === PT.GAS) { this.vx[i] += wind.x * dt * 0.6; this.vy[i] += wind.y * dt * 0.6; }
      if (t === PT.SPARK) { this.vx[i] *= 1 - dt * 1.5; this.vy[i] *= 1 - dt * 1.5; }
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt;
      this.size[i] += this.grow[i] * dt;
    }
  };
  P.Particles = Particles;

  // ------------------------------------------------------------ map texture
  P.bakeMap = function (map) {
    const TS = P.TS, W = map.W, H = map.H;
    const cv = makeCanvas(W * TS, H * TS), g = cv.getContext('2d');
    const img = g.createImageData(W * TS, H * TS), d = new Uint32Array(img.data.buffer);
    const tile = map.tile;

    // lots: each building block is split on its own bounds (not one global grid),
    // and every district has its own roof palette and building height
    const lot = new Int32Array(W * H).fill(-1);
    let lotN = 0;
    const PALETTES = [
      ['#8b929a', '#7d848c', '#979da4', '#8f949c', '#6f757d', '#858c95'],   // zinc
      ['#a39a8a', '#b0a796', '#988f80', '#a8a08f', '#8f877a', '#b8b0a0'],   // Haussmann stone
      ['#5f646b', '#6a6f77', '#575c63', '#70757c', '#62666c', '#4e5359'],   // dark slate
      ['#a7735a', '#9a6b55', '#b07f63', '#8e6450', '#a87a62', '#97705c'],   // tile roofs
      ['#b8bcbf', '#c4c7c9', '#aeb2b5', '#bfc3c5', '#a5a9ac', '#cdd0d2'],   // modern flat
    ];
    const R = P.rng(map.seed * 13 + 5);
    // mostly zinc and stone, like Paris; slate sometimes, tile and modern roofs rarely
    const WEIGHTED = [0, 0, 0, 1, 1, 1, 2, 2, 4, 3];
    const distPal = [];
    for (let d = 0; d < 16; d++) distPal.push(PALETTES[WEIGHTED[Math.floor(hash(d, map.seed, 7) * WEIGHTED.length)]]);
    const palOf = (k) => distPal[(map.district ? map.district[k] : 0) % 16];
    const lotH = [], lotCol = [];
    {
      const seen = new Uint8Array(W * H), st = new Int32Array(W * H);
      const split = (x0, y0, x1, y1, depth, pal) => {
        const w = x1 - x0, h = y1 - y0, lim = R.int(7, 15);
        if ((w <= lim && h <= lim) || depth > 9) {
          const id = lotN++;
          lotH.push(R() < 0.18 ? 2 : R() < 0.1 ? 0.6 : 1);
          let col = null;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const k = y * W + x;
            if (tile[k] === T.BUILDING && lot[k] < 0) { lot[k] = id; if (!col) col = hexToRgb(R.pick(palOf(k))); }
          }
          lotCol[id] = col || [130, 135, 140];
          return;
        }
        if (w > h) { const m = x0 + Math.max(4, Math.min(w - 4, Math.round(w * R.range(0.3, 0.7)))); split(x0, y0, m, y1, depth + 1); split(m, y0, x1, y1, depth + 1); }
        else { const m = y0 + Math.max(4, Math.min(h - 4, Math.round(h * R.range(0.3, 0.7)))); split(x0, y0, x1, m, depth + 1); split(x0, m, x1, y1, depth + 1); }
      };
      for (let i = 0; i < W * H; i++) {
        if (tile[i] !== T.BUILDING || seen[i]) continue;
        let sp = 0, x0 = W, y0 = H, x1 = 0, y1 = 0; st[sp++] = i; seen[i] = 1;
        while (sp) {
          const k = st[--sp], x = k % W, y = (k - x) / W;
          if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
          if (x > 0 && tile[k - 1] === T.BUILDING && !seen[k - 1]) { seen[k - 1] = 1; st[sp++] = k - 1; }
          if (x < W - 1 && tile[k + 1] === T.BUILDING && !seen[k + 1]) { seen[k + 1] = 1; st[sp++] = k + 1; }
          if (y > 0 && tile[k - W] === T.BUILDING && !seen[k - W]) { seen[k - W] = 1; st[sp++] = k - W; }
          if (y < H - 1 && tile[k + W] === T.BUILDING && !seen[k + W]) { seen[k + W] = 1; st[sp++] = k + W; }
        }
        split(x0, y0, x1 + 1, y1 + 1, 0);
      }
      for (let k = 0; k < W * H; k++) if (tile[k] === T.BUILDING && lot[k] < 0) { lot[k] = lotN++; lotCol.push(hexToRgb(palOf(k)[0])); lotH.push(1); }
    }

    const base = {}; base[T.ROAD] = [86, 90, 95]; base[T.SIDEWALK] = [158, 153, 145]; base[T.PLAZA] = [178, 170, 156];
    base[T.PARK] = [92, 104, 62]; base[T.MONUMENT] = [200, 192, 176]; base[T.WATER] = [58, 86, 92]; base[T.BRIDGE] = [150, 143, 130];
    base[T.COURT] = [122, 118, 110];
    const PW = W * TS;
    const isB = (t) => t === T.BUILDING;
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      const k = ty * W + tx, tt = tile[k];
      let c = tt === T.BUILDING ? lotCol[lot[k]] || [130, 135, 140] : base[tt] || [120, 120, 120];
      let edge = false, rim = false;
      if (tt === T.BUILDING) {
        const l = tx > 0 ? lot[k - 1] : -2, u = ty > 0 ? lot[k - W] : -2;
        edge = l !== lot[k] || u !== lot[k];
        rim = (tx > 0 && !isB(tile[k - 1])) || (ty > 0 && !isB(tile[k - W])) || (tx < W - 1 && !isB(tile[k + 1])) || (ty < H - 1 && !isB(tile[k + W]));
      }
      const nearWater = tt !== T.WATER && ((tx > 0 && tile[k - 1] === T.WATER) || (tx < W - 1 && tile[k + 1] === T.WATER) || (ty > 0 && tile[k - W] === T.WATER) || (ty < H - 1 && tile[k + W] === T.WATER));
      for (let py = 0; py < TS; py++) for (let px = 0; px < TS; px++) {
        const X = tx * TS + px, Y = ty * TS + py;
        const n = (hash(X, Y, 1) - 0.5) * (tt === T.ROAD ? 10 : tt === T.PARK ? 18 : tt === T.WATER ? 6 : 8);
        let r = c[0] + n, gg = c[1] + n, b = c[2] + n;
        if (tt === T.PLAZA && ((X >> 2) + (Y >> 2)) % 2 === 0) { r -= 6; gg -= 6; b -= 6; }
        if (tt === T.WATER) { const w = Math.sin(X * 0.18 + Math.sin(Y * 0.07) * 3) * 6; r += w; gg += w; b += w * 1.3; }
        if (tt === T.COURT) { r -= 10; gg -= 10; b -= 8; }
        if (nearWater) { r = 196 + n; gg = 188 + n; b = 170 + n; } // quay / bridge parapet
        if (tt === T.BUILDING) {
          if (edge && ((px === 0 && tx > 0 && lot[k - 1] !== lot[k]) || (py === 0 && ty > 0 && lot[k - W] !== lot[k]))) { r -= 28; gg -= 28; b -= 26; }
          if (rim) {
            const out = (px === 0 && tx > 0 && !isB(tile[k - 1])) || (py === 0 && ty > 0 && !isB(tile[k - W])) ||
              (px === TS - 1 && tx < W - 1 && !isB(tile[k + 1])) || (py === TS - 1 && ty < H - 1 && !isB(tile[k + W]));
            if (out) { r += 45; gg += 45; b += 45; }
          }
        }
        d[Y * PW + X] = abgr(P.clamp(r | 0, 0, 255), P.clamp(gg | 0, 0, 255), P.clamp(b | 0, 0, 255));
      }
    }
    g.putImageData(img, 0, 0);

    // shadows: taller lots cast longer shadows, so skylines read as uneven
    for (const hClass of [0.6, 1, 2]) {
      const mask = makeCanvas(W * TS, H * TS), mg = mask.getContext('2d');
      mg.fillStyle = '#000';
      let any = false;
      for (let ty = 0; ty < H; ty++) {
        let run = -1;
        for (let tx = 0; tx <= W; tx++) {
          const k = ty * W + tx;
          const b = tx < W && tile[k] === T.BUILDING && lotH[lot[k]] === hClass;
          if (b && run < 0) run = tx;
          if (!b && run >= 0) { mg.fillRect(run * TS, ty * TS, (tx - run) * TS, TS); run = -1; any = true; }
        }
      }
      if (!any) continue;
      const shadow = makeCanvas(W * TS, H * TS), sg = shadow.getContext('2d');
      sg.drawImage(mask, TS * 1.4 * hClass, TS * 2.0 * hClass);
      sg.globalCompositeOperation = 'destination-out';
      // shadows never fall on roofs of equal-or-taller neighbours: cut every building out
      const all = makeCanvas(W * TS, H * TS), ag = all.getContext('2d');
      ag.fillStyle = '#000';
      for (let ty = 0; ty < H; ty++) { let run = -1; for (let tx = 0; tx <= W; tx++) { const b = tx < W && tile[ty * W + tx] === T.BUILDING; if (b && run < 0) run = tx; if (!b && run >= 0) { ag.fillRect(run * TS, ty * TS, (tx - run) * TS, TS); run = -1; } } }
      sg.drawImage(all, 0, 0);
      g.globalAlpha = 0.36;
      g.drawImage(shadow, 0, 0);
      g.globalAlpha = 1;
    }

    // roof furniture: chimney stacks, skylights, rooftop gardens
    for (let i = 0; i < W * H / 14; i++) {
      const tx = R.int(1, W - 2), ty = R.int(1, H - 2), k = ty * W + tx;
      if (tile[k] !== T.BUILDING || tile[k - 1] !== T.BUILDING || tile[k + 1] !== T.BUILDING || tile[k - W] !== T.BUILDING || tile[k + W] !== T.BUILDING) continue;
      const q = R();
      if (q < 0.55) { g.fillStyle = 'rgba(60,55,52,0.85)'; g.fillRect(tx * TS + 1, ty * TS + 1, TS * R.range(0.5, 1.4), TS * 0.6); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(tx * TS + 2, ty * TS + 1 + TS * 0.6, TS * 1.2, 2); }
      else if (q < 0.9) { g.fillStyle = 'rgba(190,205,215,0.5)'; g.fillRect(tx * TS, ty * TS, TS * R.range(1, 2.5), TS * R.range(0.6, 1.2)); }
      else { g.fillStyle = 'rgba(80,110,60,0.7)'; g.fillRect(tx * TS, ty * TS, TS * 2, TS * 2); }
    }

    // road markings follow each street's own polyline, only where it is open road
    const isRoadT = (x, y) => x >= 0 && y >= 0 && x < W && y < H && tile[(y | 0) * W + (x | 0)] === T.ROAD;
    g.strokeStyle = 'rgba(235,235,230,0.75)'; g.lineWidth = 1.1; g.lineCap = 'butt';
    for (const s of map.streets) {
      if (s.w < 8) continue;
      const offs = s.w >= 16 ? [-0.17, 0.17] : [0];
      const p = s.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const ax = p[i][0], ay = p[i][1], bx = p[i + 1][0], by = p[i + 1][1], L = Math.hypot(bx - ax, by - ay);
        if (!L) continue;
        const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
        for (const o of offs) for (let t = 0; t < L; t += 4) {
          const x = ax + ux * t + nx * o * s.w, y = ay + uy * t + ny * o * s.w;
          const x2 = x + ux * 2, y2 = y + uy * 2;
          if (!isRoadT(x, y) || !isRoadT(x2, y2)) continue;
          g.beginPath(); g.moveTo(x * TS, y * TS); g.lineTo(x2 * TS, y2 * TS); g.stroke();
        }
        // zebra crossing where a side street opens off this one
        for (let t = 6; t < L - 2; t += 3) {
          const x = ax + ux * t, y = ay + uy * t, hw = s.w / 2 + 0.6;
          const openNow = isRoadT(x + nx * hw, y + ny * hw) || isRoadT(x - nx * hw, y - ny * hw);
          const xb = x - ux * 4, yb = y - uy * 4;
          const closedBefore = !isRoadT(xb + nx * hw, yb + ny * hw) && !isRoadT(xb - nx * hw, yb - ny * hw);
          if (!openNow || !closedBefore || !isRoadT(xb, yb)) continue;
          g.save(); g.translate(xb * TS, yb * TS); g.rotate(Math.atan2(uy, ux));
          g.fillStyle = 'rgba(240,240,236,0.85)';
          const inner = s.w / 2 - s.side;
          for (let v = -inner + 0.5; v < inner - 0.5; v += 2) g.fillRect(-1.5 * TS, v * TS, 3 * TS, 0.9 * TS);
          g.restore();
          t += 12;
        }
      }
    }
    // monuments by landmark type
    for (const lm of map.landmarks) {
      const x = lm.x * TS, y = lm.y * TS;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.arc(x + 0.8 * TS, y + 1.2 * TS, 3 * TS, 0, 6.283); g.fill();
      if (lm.type === 'etoile') { // a triumphal arch seen from above
        g.fillStyle = '#d8cfbd'; g.fillRect(x - 2.6 * TS, y - 1.6 * TS, 5.2 * TS, 3.2 * TS);
        g.fillStyle = '#a99f8c'; g.fillRect(x - 0.7 * TS, y - 1.6 * TS, 1.4 * TS, 3.2 * TS);
      } else if (lm.type === 'square') {
        g.fillStyle = '#cfc6b4'; g.beginPath(); g.arc(x, y, 1.6 * TS, 0, 6.283); g.fill();
        g.strokeStyle = 'rgba(220,214,196,0.6)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x - 9 * TS, y); g.lineTo(x + 9 * TS, y); g.moveTo(x, y - 7 * TS); g.lineTo(x, y + 7 * TS); g.stroke();
      } else {
        g.fillStyle = '#cfc6b4'; g.beginPath(); g.arc(x, y, 2.8 * TS, 0, 6.283); g.fill();
        g.fillStyle = '#5f7d6a'; g.beginPath(); g.arc(x, y, 1.4 * TS, 0, 6.283); g.fill();
        g.strokeStyle = 'rgba(80,72,60,0.35)'; g.lineWidth = 1;
        for (let r = 6; r < lm.r; r += 3) { g.beginPath(); g.arc(x, y, r * TS, 0, 6.283); g.stroke(); }
      }
    }

    // tree canopy layer (drawn over the crowd): bare winter plane trees
    const tc = makeCanvas(W * TS, H * TS), tg = tc.getContext('2d');
    for (const t of map.trees) {
      const cx = t.x * TS, cy = t.y * TS, r = t.r * TS * 1.5;
      tg.fillStyle = 'rgba(0,0,0,0.12)';
      tg.beginPath(); tg.arc(cx + TS * 1.2, cy + TS * 1.6, r * 0.8, 0, 6.283); tg.fill();
      const rr = P.rng(((t.x * 73856093) ^ (t.y * 19349663)) >>> 0);
      tg.lineCap = 'round';
      for (let b = 0; b < 9; b++) {
        const a = rr() * 6.283, len = r * rr.range(0.55, 1);
        tg.strokeStyle = `rgba(${70 + rr.int(0, 30)},${60 + rr.int(0, 20)},${50 + rr.int(0, 15)},0.85)`;
        tg.lineWidth = 1.4;
        tg.beginPath(); tg.moveTo(cx, cy);
        const mx = cx + Math.cos(a) * len * 0.5, my = cy + Math.sin(a) * len * 0.5;
        tg.lineTo(mx, my);
        tg.lineTo(cx + Math.cos(a + 0.3) * len, cy + Math.sin(a + 0.3) * len);
        tg.moveTo(mx, my);
        tg.lineTo(cx + Math.cos(a - 0.35) * len * 0.9, cy + Math.sin(a - 0.35) * len * 0.9);
        tg.stroke();
      }
      tg.fillStyle = 'rgba(85,75,62,0.9)';
      tg.beginPath(); tg.arc(cx, cy, 1.4, 0, 6.283); tg.fill();
    }

    // minimap
    const mm = makeCanvas(W, H), mmg = mm.getContext('2d');
    const mi = mmg.createImageData(W, H), md = new Uint32Array(mi.data.buffer);
    for (let k = 0; k < W * H; k++) {
      const tt = tile[k];
      md[k] = tt === T.BUILDING || tt === T.COURT ? abgr(70, 74, 80) : tt === T.PARK ? abgr(70, 86, 50) : tt === T.PLAZA ? abgr(150, 144, 132) : tt === T.WATER ? abgr(50, 80, 95) : abgr(120, 122, 125);
    }
    mmg.putImageData(mi, 0, 0);
    return { map: cv, trees: tc, mini: mm };
  };

  // ------------------------------------------------------------ renderer
  function Renderer(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.agentCanvas = makeCanvas(4, 4);
    this.ag = this.agentCanvas.getContext('2d');
    this.img = null; this.buf = null;
    this.parts = new Particles(6000);
    this.time = 0;
    this.discCache = { r: -1, off: null };
  }

  Renderer.prototype.setWorld = function (w) {
    this.w = w;
    this.tex = P.bakeMap(w.map);
    this.parts.n = 0;
  };

  Renderer.prototype.resize = function (cw, ch) {
    this.cw = cw; this.ch = ch;
    this.agentCanvas.width = cw; this.agentCanvas.height = ch;
    this.img = this.ag.createImageData(cw, ch);
    this.buf = new Uint32Array(this.img.data.buffer);
  };

  Renderer.prototype.toScreen = function (cam, x, y) {
    return { x: (x - cam.x) * cam.zoom + this.cw / 2, y: (y - cam.y) * cam.zoom + this.ch / 2 };
  };

  // world events -> visual effects
  Renderer.prototype.fxEvent = function (e) {
    const p = this.parts;
    if (e.type === 'burst') {
      const cols = [4, 5, 6, 7];
      for (let i = 0; i < 70; i++) {
        const a = (i / 70) * 6.283, s = 7 + Math.random() * 2;
        p.add(PT.SPARK, e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 1.1 + Math.random() * 0.5, 0.7, 0, cols[i % 2 === 0 ? 0 : (Math.random() * 4) | 0]);
      }
      for (let i = 0; i < 6; i++) p.add(PT.SMOKE, e.x, e.y, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 3, 3, 2, 1);
    } else if (e.type === 'gasLand') {
      for (let i = 0; i < 10; i++) p.add(PT.GAS, e.x, e.y, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 5 + Math.random() * 3, 3, 1.8);
    } else if (e.type === 'ignite') {
      for (let i = 0; i < 14; i++) p.add(PT.EMBER, e.x, e.y, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 0.8, 0.6, 0);
    }
  };

  Renderer.prototype.draw = function (cam, dt, ui) {
    const w = this.w, g = this.g, map = w.map, TS = P.TS, z = cam.zoom;
    const cw = this.cw, ch = this.ch;
    this.time += dt;
    const parts = this.parts;
    parts.update(dt, w.wind);

    // visible tile bounds
    const vx0 = cam.x - cw / 2 / z, vy0 = cam.y - ch / 2 / z, vx1 = cam.x + cw / 2 / z, vy1 = cam.y + ch / 2 / z;
    const ox = cw / 2 - cam.x * z, oy = ch / 2 - cam.y * z;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#2a2c30';
    g.fillRect(0, 0, cw, ch);
    g.imageSmoothingEnabled = z < TS * 1.2;
    g.drawImage(this.tex.map, ox, oy, map.W * z, map.H * z);

    g.setTransform(z, 0, 0, z, ox, oy); // world units from here

    // scorch marks under burnt / burning cars
    for (const c of map.cars) {
      if (c.state === 0 || c.cx < vx0 - 4 || c.cx > vx1 + 4 || c.cy < vy0 - 4 || c.cy > vy1 + 4) continue;
      g.fillStyle = 'rgba(15,12,10,0.35)';
      g.beginPath(); g.ellipse(c.cx, c.cy, c.w * 0.9 + 0.6, c.h * 0.9 + 0.6, 0, 0, 6.283); g.fill();
    }
    // barricades
    const bx0 = Math.max(0, vx0 | 0), by0 = Math.max(0, vy0 | 0), bx1 = Math.min(map.W - 1, vx1 | 0), by1 = Math.min(map.H - 1, vy1 | 0);
    if (w.barrCount === undefined || w.map.version !== this.barrVer) {
      this.barrVer = w.map.version;
      this.barrList = [];
      for (let k = 0; k < map.N; k++) if (map.barr[k] > 0) this.barrList.push(k);
    }
    for (const k of this.barrList) {
      if (map.barr[k] <= 0) continue;
      const x = k % map.W, y = (k / map.W) | 0;
      if (x < bx0 - 1 || x > bx1 + 1 || y < by0 - 1 || y > by1 + 1) continue;
      if (map.barrKind[k] === 2) {
        g.fillStyle = '#c8ccd2'; g.fillRect(x + 0.1, y + 0.3, 0.8, 0.4);
        g.fillStyle = '#5b6470'; g.fillRect(x + 0.1, y + 0.45, 0.8, 0.1);
      } else {
        g.fillStyle = '#6b4a2b'; g.fillRect(x, y + 0.1, 1, 0.8);
        g.fillStyle = '#8c6a44'; g.fillRect(x + 0.1, y + 0.2, 0.35, 0.6);
        g.fillStyle = '#3e2c1d'; g.fillRect(x + 0.55, y + 0.15, 0.35, 0.7);
      }
    }
    // cars
    for (const c of map.cars) {
      if (c.cx < vx0 - 4 || c.cx > vx1 + 4 || c.cy < vy0 - 4 || c.cy > vy1 + 4) continue;
      const x = c.x + 0.15, y = c.y + 0.15, cwid = c.w - 0.3, chei = c.h - 0.3;
      if (c.state === 0) {
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 0.25, y + 0.35, cwid, chei);
        g.fillStyle = c.color; g.fillRect(x, y, cwid, chei);
        g.fillStyle = 'rgba(30,40,55,0.75)';
        if (c.vert) { g.fillRect(x + 0.2, y + chei * 0.28, cwid - 0.4, chei * 0.16); g.fillRect(x + 0.2, y + chei * 0.68, cwid - 0.4, chei * 0.1); }
        else { g.fillRect(x + cwid * 0.28, y + 0.2, cwid * 0.16, chei - 0.4); g.fillRect(x + cwid * 0.68, y + 0.2, cwid * 0.1, chei - 0.4); }
        if (c.heat > 0.3) { g.fillStyle = `rgba(255,120,30,${Math.min(0.5, c.heat * 0.4)})`; g.fillRect(x, y, cwid, chei); }
      } else {
        g.fillStyle = c.state === 1 ? '#2a1a12' : '#181615'; g.fillRect(x, y, cwid, chei);
        g.fillStyle = '#3a3633'; g.fillRect(x + 0.3, y + 0.3, cwid - 0.6, chei - 0.6);
      }
    }

    // ---- agents (ImageData layer, screen space) ----
    this.drawAgents(cam, ox, oy);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.agentCanvas, 0, 0);
    g.setTransform(z, 0, 0, z, ox, oy);

    // fire trucks
    for (const tr of w.trucks) {
      g.save(); g.translate(tr.x, tr.y); g.rotate(tr.a);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-3.2 + 0.4, -1.3 + 0.5, 6.4, 2.6);
      g.fillStyle = '#c4161c'; g.fillRect(-3.2, -1.3, 6.4, 2.6);
      g.fillStyle = '#e8e8e8'; g.fillRect(-1.6, -0.35, 4.4, 0.7);
      g.fillStyle = '#7a0c10'; g.fillRect(2.1, -1.3, 1.1, 2.6);
      const blink = (this.time * 4 | 0) % 2;
      g.fillStyle = blink ? '#4fa3ff' : '#1a3c70'; g.fillRect(2.2, -1.2, 0.5, 0.5);
      g.fillStyle = blink ? '#1a3c70' : '#4fa3ff'; g.fillRect(2.2, 0.7, 0.5, 0.5);
      g.restore();
      if (tr.spray && tr.sprayAt) {
        for (let i = 0; i < 3; i++) {
          const tx = tr.sprayAt.cx + (Math.random() - 0.5) * 2, ty = tr.sprayAt.cy + (Math.random() - 0.5) * 2;
          const dx = tx - tr.x, dy = ty - tr.y, d = Math.hypot(dx, dy) || 1;
          parts.add(PT.WATER, tr.x, tr.y, dx / d * 14, dy / d * 14, d / 14, 0.5, 0.6);
        }
      }
    }

    // tree canopy over the crowd
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.tex.trees, ox, oy, map.W * z, map.H * z);
    g.setTransform(z, 0, 0, z, ox, oy);

    // spawn fire / flare particles
    for (const c of map.cars) {
      if (c.state !== 1) continue;
      const near = c.cx > vx0 - 20 && c.cx < vx1 + 20 && c.cy > vy0 - 20 && c.cy < vy1 + 20;
      if (!near) continue;
      if (Math.random() < c.inten * dt * 9) parts.add(PT.SMOKE, c.cx + (Math.random() - 0.5) * 2, c.cy + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.5, -0.5 - Math.random(), 5 + Math.random() * 4, 2.5, 2.2, Math.random() < 0.5 ? 0 : 1);
      if (Math.random() < c.inten * dt * 14) parts.add(PT.FLAME, c.cx + (Math.random() - 0.5) * c.w, c.cy + (Math.random() - 0.5) * c.h, (Math.random() - 0.5) * 1.2, -1.2 - Math.random() * 1.5, 0.5 + Math.random() * 0.4, 1.6, -1.6);
    }
    // flares carried in the crowd
    const cr = w.crowd;
    if (cr.n) for (let s = 0; s < 40; s++) {
      const i = (Math.random() * cr.n) | 0;
      if (!(cr.flags[i] & P.AF.FLARE)) continue;
      const x = cr.x[i], y = cr.y[i];
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      parts.add(PT.FLARE, x, y, (Math.random() - 0.5), (Math.random() - 0.5), 2.5 + Math.random() * 2, 1.2, 1.4);
    }
    // gas grid
    const CS = P.CS, CW = w.CW, gas = w.gas, gasSp = soft('#eef0ea', 64);
    for (let cy = Math.max(0, (vy0 / CS | 0) - 1); cy <= Math.min(w.CH - 1, (vy1 / CS | 0) + 1); cy++)
      for (let cx = Math.max(0, (vx0 / CS | 0) - 1); cx <= Math.min(CW - 1, (vx1 / CS | 0) + 1); cx++) {
        const v = gas[cy * CW + cx];
        if (v < 0.04) continue;
        g.globalAlpha = Math.min(0.6, v * 0.3);
        const s = CS * 2.6 + Math.sin(this.time + cx * 3.1 + cy) * 0.6;
        g.drawImage(gasSp, cx * CS + 2 - s / 2, cy * CS + 2 - s / 2, s, s);
      }
    g.globalAlpha = 1;

    // particles
    const smokeA = soft('#3b3b3b', 64), smokeB = soft('#7d7b78', 64), flame = soft('#ff8a1e', 32, 0.2), flare = soft('#ff4d6d', 64),
      water = soft('#cfe9ff', 16, 0.5), ember = soft('#ffcc55', 16, 0.5);
    const fwc = [soft('#ff3b3b', 16, 0.5), soft('#ffd23b', 16, 0.5), soft('#5cff7a', 16, 0.5), soft('#ff7af0', 16, 0.5)];
    for (let pass = 0; pass < 2; pass++) {
      g.globalCompositeOperation = pass === 0 ? 'source-over' : 'lighter';
      for (let i = 0; i < parts.n; i++) {
        const t = parts.type[i];
        const additive = t === PT.FLAME || t === PT.SPARK || t === PT.EMBER;
        if ((pass === 1) !== additive) continue;
        const x = parts.x[i], y = parts.y[i], s = parts.size[i];
        if (x < vx0 - s || x > vx1 + s || y < vy0 - s || y > vy1 + s) continue;
        const lf = parts.life[i] / parts.max[i];
        let sp;
        switch (t) {
          case PT.SMOKE: sp = parts.col[i] ? smokeB : smokeA; g.globalAlpha = Math.min(0.55, lf * 0.7); break;
          case PT.GAS: sp = gasSp; g.globalAlpha = lf * 0.5; break;
          case PT.FLARE: sp = flare; g.globalAlpha = lf * 0.55; break;
          case PT.FLAME: sp = flame; g.globalAlpha = Math.min(1, lf * 1.4); break;
          case PT.SPARK: sp = fwc[parts.col[i] - 4] || fwc[0]; g.globalAlpha = lf; break;
          case PT.WATER: sp = water; g.globalAlpha = 0.7 * lf; break;
          default: sp = ember; g.globalAlpha = lf;
        }
        g.drawImage(sp, x - s / 2, y - s / 2, s, s);
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    // projectiles in flight
    for (const c of w.canisters) if (!c.landed) {
      const t = c.t / c.dur, x = P.lerp(c.x0, c.x, t), y = P.lerp(c.y0, c.y, t) - Math.sin(t * Math.PI) * 4;
      g.fillStyle = '#ddd'; g.beginPath(); g.arc(x, y, 0.35, 0, 6.283); g.fill();
      parts.add(PT.GAS, x, y, 0, 0, 0.8, 0.8, 1);
    }
    for (const s of w.shots) {
      const t = s.t / s.dur, x = P.lerp(s.x0, s.x, t), y = P.lerp(s.y0, s.y, t) - Math.sin(t * Math.PI) * 6;
      parts.add(PT.EMBER, x, y, 0, 0, 0.4, 0.7, 0);
    }

    // landmarks: capture rings
    for (const lm of map.landmarks) {
      if (lm.x < vx0 - lm.r || lm.x > vx1 + lm.r || lm.y < vy0 - lm.r || lm.y > vy1 + lm.r) continue;
      const c = lm.control, prot = lm.owner === 'protest';
      g.lineWidth = Math.max(0.35, 2.2 / z);
      g.strokeStyle = prot ? 'rgba(255,70,60,0.85)' : 'rgba(70,130,255,0.75)';
      g.setLineDash([1.2, 0.8]);
      g.beginPath(); g.arc(lm.x, lm.y, lm.r, 0, 6.283); g.stroke();
      g.setLineDash([]);
      // progress arc
      g.lineWidth = Math.max(0.7, 4 / z);
      g.strokeStyle = c >= 0 ? 'rgba(255,90,50,0.95)' : 'rgba(80,140,255,0.95)';
      g.beginPath(); g.arc(lm.x, lm.y, lm.r + 1.2, -Math.PI / 2, -Math.PI / 2 + Math.abs(c) * 6.283 * (c >= 0 ? 1 : -1), c < 0); g.stroke();
    }

    // night pass
    if (w.night) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = 'rgba(6,10,28,0.74)';
      g.fillRect(0, 0, cw, ch);
      g.setTransform(z, 0, 0, z, ox, oy);
      g.globalCompositeOperation = 'lighter';
      const lamp = soft('#ffb35c', 64), glow = soft('#ff7a1e', 64), blue = soft('#3d7bff', 64);
      g.globalAlpha = 0.22;
      for (const l of map.lamps) {
        if (l.x < vx0 - 8 || l.x > vx1 + 8 || l.y < vy0 - 8 || l.y > vy1 + 8) continue;
        g.drawImage(lamp, l.x - 7, l.y - 7, 14, 14);
      }
      for (const c of map.cars) {
        if (c.state !== 1) continue;
        if (c.cx < vx0 - 30 || c.cx > vx1 + 30 || c.cy < vy0 - 30 || c.cy > vy1 + 30) continue;
        const f = 0.85 + Math.sin(this.time * 13 + c.id) * 0.1 + Math.random() * 0.08;
        g.globalAlpha = Math.min(1, c.inten * 0.75 * f);
        const s = 30 * f;
        g.drawImage(glow, c.cx - s / 2, c.cy - s / 2, s, s);
        g.globalAlpha = Math.min(1, c.inten * 0.9);
        g.drawImage(lamp, c.cx - 5, c.cy - 5, 10, 10);
      }
      for (const tr of w.trucks) { g.globalAlpha = 0.35 + ((this.time * 4 | 0) % 2) * 0.3; g.drawImage(blue, tr.x - 8, tr.y - 8, 16, 16); }
      g.globalAlpha = 0.5;
      for (let i = 0; i < parts.n; i++) {
        const t = parts.type[i];
        if (t !== PT.SPARK && t !== PT.FLARE) continue;
        const x = parts.x[i], y = parts.y[i];
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
        const s = t === PT.SPARK ? 3 : 5;
        g.drawImage(t === PT.SPARK ? lamp : soft('#ff4d6d', 64), x - s / 2, y - s / 2, s, s);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    // landmark labels (screen space, crisp)
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.textAlign = 'center';
    for (const lm of map.landmarks) {
      const s = this.toScreen(cam, lm.x, lm.y - lm.r - 2.5);
      if (s.x < -100 || s.x > cw + 100 || s.y < -40 || s.y > ch + 40) continue;
      g.font = '900 13px "Arial Black", "Segoe UI", sans-serif';
      const txt = (lm.owner === 'protest' ? '✊ ' : '🛡 ') + 'PLACE DE LA ' + lm.name.toUpperCase();
      const tw = g.measureText(txt).width + 16;
      g.fillStyle = lm.owner === 'protest' ? 'rgba(200,40,30,0.85)' : 'rgba(25,45,95,0.85)';
      g.fillRect(s.x - tw / 2, s.y - 11, tw, 20);
      g.fillStyle = '#fff';
      g.fillText(txt, s.x, s.y + 4);
    }

    if (ui && ui.overlay) { g.setTransform(z, 0, 0, z, ox, oy); ui.overlay(g, z); g.setTransform(1, 0, 0, 1, 0, 0); }
  };

  Renderer.prototype.drawAgents = function (cam, ox, oy) {
    const w = this.w, cr = w.crowd, buf = this.buf, cw = this.cw, ch = this.ch, z = cam.zoom;
    buf.fill(0);
    const n = cr.n, X = cr.x, Y = cr.y, kind = cr.kind, col = cr.col, flags = cr.flags, stun = cr.stun;
    const r = z * 0.4;
    if (r < 1.1) {
      // 1–2 px dots
      const big = r >= 0.7;
      for (let i = 0; i < n; i++) {
        const sx = (X[i] * z + ox) | 0, sy = (Y[i] * z + oy) | 0;
        if (sx < 0 || sy < 0 || sx >= cw - 1 || sy >= ch - 1) continue;
        const k = kind[i];
        let c;
        if (k === K.POL) c = stun[i] > 0 ? POL_STUN : POL_COL;
        else if (k === K.CASS) c = CASS_COL;
        else c = flags[i] & P.AF.FLAG ? FLAG_COLS[col[i] % 5] : flags[i] & P.AF.LEAVING ? LEAVE_COL : PROT_COLS[col[i]];
        const o = sy * cw + sx;
        buf[o] = c;
        if (big) { buf[o + 1] = c; buf[o + cw] = c; buf[o + cw + 1] = c; }
      }
    } else {
      if (this.discCache.r !== Math.round(r * 4)) {
        const rr = Math.round(r * 4) / 4, off = [], hi = [];
        const R2 = rr * rr;
        for (let dy = -Math.ceil(rr); dy <= Math.ceil(rr); dy++) for (let dx = -Math.ceil(rr); dx <= Math.ceil(rr); dx++) {
          const d2 = (dx + 0.5) * (dx + 0.5) + (dy + 0.5) * (dy + 0.5);
          if (d2 <= R2) { off.push(dx, dy); hi.push(d2 < R2 * 0.3 && dx <= 0 && dy <= 0 ? 1 : 0); }
        }
        this.discCache = { r: Math.round(r * 4), off, hi, ext: Math.ceil(rr) + 1 };
      }
      const off = this.discCache.off, hi = this.discCache.hi, ext = this.discCache.ext, m = off.length;
      for (let i = 0; i < n; i++) {
        const sx = (X[i] * z + ox) | 0, sy = (Y[i] * z + oy) | 0;
        if (sx < ext || sy < ext || sx >= cw - ext || sy >= ch - ext) continue;
        const k = kind[i];
        let c, h;
        if (k === K.POL) { c = stun[i] > 0 ? POL_STUN : POL_COL; h = POL_HI; }
        else if (k === K.CASS) { c = CASS_COL; h = CASS_HI; }
        else { c = flags[i] & P.AF.FLAG ? FLAG_COLS[col[i] % 5] : flags[i] & P.AF.LEAVING ? LEAVE_COL : PROT_COLS[col[i]]; h = c; }
        const o = sy * cw + sx;
        for (let q = 0; q < m; q++) buf[o + off[2 * q + 1] * cw + off[2 * q]] = hi[q] ? h : c;
      }
    }
    this.ag.putImageData(this.img, 0, 0);
  };

  P.Renderer = Renderer;
})();
