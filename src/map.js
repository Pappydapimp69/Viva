// Procedural Haussmann-ish Paris: a street grid with boulevards, diagonal
// avenues between round plazas (the landmarks), parked cars along the curbs,
// trees on the boulevards. Pure data — rendering lives in render.js.
(function () {
  const P = globalThis.PAVE;
  const T = P.T;

  const LANDMARKS = ['République', 'Bastille', 'Nation', 'Concorde', 'Opéra', 'Châtelet', 'Étoile', 'Trocadéro'];
  const RUES = ['de Malte', 'Oberkampf', 'Saint-Maur', 'de Charonne', 'de la Roquette', 'du Temple', 'de Turbigo',
    'Réaumur', 'de Rivoli', 'Saint-Antoine', 'des Pyrénées', 'de Belleville', 'Amelot', 'de Crussol', 'Popincourt',
    'Jean-Pierre Timbaud', 'du Faubourg Saint-Denis', 'de Bretagne', 'des Archives', 'Vieille du Temple',
    'de Lancry', 'des Vinaigriers', 'de la Folie-Méricourt', 'Keller', 'de Lappe', 'Sedaine'];
  const BLVDS = ['Voltaire', 'Richard-Lenoir', 'Beaumarchais', 'Magenta', 'du Temple', 'Saint-Martin', 'de Sébastopol',
    'Haussmann', 'Diderot', 'de Ménilmontant'];
  const AVES = ['de la République', 'Parmentier', 'Ledru-Rollin', 'Daumesnil', 'Gambetta', 'de l\'Opéra'];
  const CAR_COLORS = ['#e8e8e8', '#cfd3d6', '#1c1f24', '#2b3440', '#5d6670', '#8a1f1f', '#203a6b', '#f0f0f0',
    '#3c3c3c', '#a9a9a9', '#6b4c2a', '#1e4d3b'];

  P.generateMap = function (o) {
    o = o || {};
    const W = o.w || 320, H = o.h || 320;
    const R = P.rng(o.seed || 1);
    const N = W * H;
    const tile = new Uint8Array(N).fill(T.BUILDING);
    const streets = [];
    const rues = R.shuffle(RUES.slice()), blvds = R.shuffle(BLVDS.slice()), aves = R.shuffle(AVES.slice());
    let ri = 0, bi = 0, ai = 0;

    // --- axis-aligned streets ---------------------------------------------
    function axis(len, kind) {
      const out = [];
      let pos = R.int(16, 30);
      let blvdBudget = 2;
      while (pos < len - 16) {
        const blvd = blvdBudget > 0 && R() < 0.38;
        if (blvd) blvdBudget--;
        const w = blvd ? R.int(20, 24) : R.int(10, 13);
        const name = blvd ? 'Boulevard ' + blvds[bi++ % blvds.length] : 'Rue ' + rues[ri++ % rues.length];
        out.push({ kind, c: pos, w, blvd, name, side: blvd ? 3 : 2 });
        pos += Math.ceil(w / 2) + R.int(30, 50) + Math.ceil(w / 2);
      }
      return out;
    }
    const vs = axis(W, 'v'), hs = axis(H, 'h');
    for (const s of vs) streets.push(s);
    for (const s of hs) streets.push(s);

    // --- plazas at intersections (prefer boulevards) ------------------------
    const cands = [];
    for (const v of vs) for (const h of hs) {
      cands.push({ x: v.c, y: h.c, score: (v.blvd ? 2 : 0) + (h.blvd ? 2 : 0) + R() * 2.5 });
    }
    cands.sort((a, b) => b.score - a.score);
    const nPlaza = o.landmarks || P.clamp(Math.round((W * H) / 22000), 3, 6);
    const plazas = [];
    for (const c of cands) {
      if (plazas.length >= nPlaza) break;
      if (c.x < 30 || c.y < 30 || c.x > W - 30 || c.y > H - 30) continue;
      if (plazas.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 75)) continue;
      plazas.push({ x: c.x, y: c.y, r: R.int(16, 20) });
    }
    // --- diagonal avenues between some plaza pairs --------------------------
    const diag = [];
    for (let i = 0; i < plazas.length; i++) {
      let best = -1, bd = 1e9;
      for (let j = 0; j < plazas.length; j++) {
        if (i === j) continue;
        const a = plazas[i], b = plazas[j];
        const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
        if (dx < 25 || dy < 25) continue; // already joined by an axis street
        const d = dx + dy;
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0 && !diag.some((d) => (d.a === best && d.b === i))) diag.push({ a: i, b: best });
      if (diag.length >= 3) break;
    }
    for (const d of diag) {
      const a = plazas[d.a], b = plazas[d.b];
      streets.push({ kind: 'd', x0: a.x, y0: a.y, x1: b.x, y1: b.y, w: 13, blvd: false, side: 2,
        name: 'Avenue ' + aves[ai++ % aves.length] });
    }

    // --- rasterise: outer band = sidewalk, inner band = road -----------------
    function eachBandTile(s, inset, fn) {
      if (s.kind === 'v') {
        const x0 = Math.round(s.c - s.w / 2) + inset, x1 = Math.round(s.c + s.w / 2) - 1 - inset;
        for (let y = 0; y < H; y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) fn(x, y);
      } else if (s.kind === 'h') {
        const y0 = Math.round(s.c - s.w / 2) + inset, y1 = Math.round(s.c + s.w / 2) - 1 - inset;
        for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = 0; x < W; x++) fn(x, y);
      } else {
        const half = s.w / 2 - inset;
        const minx = Math.max(0, Math.floor(Math.min(s.x0, s.x1) - half)), maxx = Math.min(W - 1, Math.ceil(Math.max(s.x0, s.x1) + half));
        const miny = Math.max(0, Math.floor(Math.min(s.y0, s.y1) - half)), maxy = Math.min(H - 1, Math.ceil(Math.max(s.y0, s.y1) + half));
        const dx = s.x1 - s.x0, dy = s.y1 - s.y0, L2 = dx * dx + dy * dy;
        for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
          const px = x + 0.5, py = y + 0.5;
          let t = ((px - s.x0) * dx + (py - s.y0) * dy) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = s.x0 + dx * t - px, qy = s.y0 + dy * t - py;
          if (qx * qx + qy * qy <= half * half) fn(x, y);
        }
      }
    }
    for (const s of streets) eachBandTile(s, 0, (x, y) => { tile[y * W + x] = T.SIDEWALK; });
    for (const s of streets) eachBandTile(s, s.side, (x, y) => { tile[y * W + x] = T.ROAD; });

    // --- parks: a couple of building blocks become squares ------------------
    const comp = new Int32Array(N).fill(-1);
    const blocks = [];
    const stack = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (tile[i] !== T.BUILDING || comp[i] >= 0) continue;
      let sp = 0; stack[sp++] = i; comp[i] = blocks.length;
      let minx = W, miny = H, maxx = 0, maxy = 0, area = 0, edge = false;
      while (sp) {
        const k = stack[--sp]; const x = k % W, y = (k / W) | 0; area++;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
        if (x > 0 && tile[k - 1] === T.BUILDING && comp[k - 1] < 0) { comp[k - 1] = blocks.length; stack[sp++] = k - 1; }
        if (x < W - 1 && tile[k + 1] === T.BUILDING && comp[k + 1] < 0) { comp[k + 1] = blocks.length; stack[sp++] = k + 1; }
        if (y > 0 && tile[k - W] === T.BUILDING && comp[k - W] < 0) { comp[k - W] = blocks.length; stack[sp++] = k - W; }
        if (y < H - 1 && tile[k + W] === T.BUILDING && comp[k + W] < 0) { comp[k + W] = blocks.length; stack[sp++] = k + W; }
      }
      blocks.push({ minx, miny, maxx, maxy, area, edge });
    }
    const parkable = blocks.map((b, i) => ({ b, i })).filter((e) => !e.b.edge && e.b.area > 700 && e.b.area < 2600);
    R.shuffle(parkable);
    const parkIds = new Set(parkable.slice(0, R.int(1, 2)).map((e) => e.i));
    for (let i = 0; i < N; i++) if (comp[i] >= 0 && parkIds.has(comp[i])) tile[i] = T.PARK;

    // --- plazas carved last so they read as open squares --------------------
    const landmarks = [];
    const lmNames = R.shuffle(LANDMARKS.slice());
    plazas.forEach((p, i) => {
      for (let y = p.y - p.r; y <= p.y + p.r; y++) for (let x = p.x - p.r; x <= p.x + p.r; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
        if (d <= p.r) tile[y * W + x] = d <= 2.6 ? T.MONUMENT : T.PLAZA;
      }
      landmarks.push({ id: i, name: lmNames[i % lmNames.length], x: p.x, y: p.y, r: p.r, control: -0.2, owner: 'police', heldFor: 0 });
    });

    // --- solidity --------------------------------------------------------------
    const solid = new Uint8Array(N);
    for (let i = 0; i < N; i++) solid[i] = tile[i] === T.BUILDING || tile[i] === T.MONUMENT ? 1 : 0;
    const carAt = new Int16Array(N).fill(-1);
    const barr = new Float32Array(N);     // barricade hp (>0 = solid)
    const barrKind = new Uint8Array(N);   // 1 protest pallets, 2 police barrier

    // --- parked cars along the curbs ------------------------------------------
    const cars = [];
    function tryCar(x, y, w, h, vert) {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) return;
        const k = yy * W + xx;
        if (tile[k] !== T.ROAD || carAt[k] >= 0) return;
      }
      const id = cars.length;
      cars.push({ id, x, y, w, h, vert, cx: x + w / 2, cy: y + h / 2, color: R.pick(CAR_COLORS),
        state: 0, heat: 0, burn: 0, inten: 0, near: null });
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { carAt[yy * W + xx] = id; solid[yy * W + xx] = 1; }
    }
    const carRate = o.carRate == null ? 0.62 : o.carRate;
    for (const s of streets) {
      if (s.kind === 'd') continue;
      const lo = Math.round(s.c - s.w / 2) + s.side, hi = Math.round(s.c + s.w / 2) - 1 - s.side;
      const len = s.kind === 'v' ? H : W;
      for (const curb of [lo, hi - 1]) {
        const outer = curb === lo ? lo - 1 : hi + 1;
        let p = R.int(2, 6);
        while (p < len - 5) {
          let ok = true;
          for (let q = p - 1; q < p + 5 && ok; q++) {
            const k = s.kind === 'v' ? q * W + outer : outer * W + q;
            if (tile[k] !== T.SIDEWALK) ok = false;
          }
          if (ok && R() < carRate) {
            if (s.kind === 'v') tryCar(curb, p, 2, 4, true); else tryCar(p, curb, 4, 2, false);
            p += 4 + R.int(1, 3);
          } else p += R.int(2, 5);
        }
      }
    }
    // fire-spread neighbour lists (cars within 7 tiles)
    for (const c of cars) {
      c.near = [];
      for (const d of cars) {
        if (d === c) continue;
        const dd = Math.hypot(c.cx - d.cx, c.cy - d.cy);
        if (dd < 7) c.near.push(d.id, dd);
      }
    }

    // --- trees: boulevard sidewalks, plaza rims, parks ----------------------
    const trees = [];
    for (const s of streets) {
      if (!s.blvd) continue;
      const a = Math.round(s.c - s.w / 2) + 1.5, b = Math.round(s.c + s.w / 2) - 1.5;
      const len = s.kind === 'v' ? H : W;
      for (let p = R.int(2, 6); p < len; p += R.int(6, 8)) for (const q of [a, b]) {
        const x = s.kind === 'v' ? q : p, y = s.kind === 'v' ? p : q;
        const k = Math.floor(y) * W + Math.floor(x);
        if (tile[k] === T.SIDEWALK) trees.push({ x, y, r: R.range(1.6, 2.4), s: R() });
      }
    }
    for (const lm of landmarks) for (let a = 0; a < Math.PI * 2; a += 0.42) {
      const x = lm.x + Math.cos(a) * (lm.r - 2.5), y = lm.y + Math.sin(a) * (lm.r - 2.5);
      const k = Math.floor(y) * W + Math.floor(x);
      if (tile[k] === T.PLAZA) trees.push({ x, y, r: R.range(1.5, 2.1), s: R() });
    }
    for (let i = 0; i < 260; i++) {
      const x = R.int(1, W - 2), y = R.int(1, H - 2);
      if (tile[y * W + x] === T.PARK) trees.push({ x: x + 0.5, y: y + 0.5, r: R.range(1.8, 2.8), s: R() });
    }

    // --- entries: runs of open tiles on the map border ----------------------
    const entries = [];
    function scanEdge(get, n, toXY) {
      let run = -1;
      for (let i = 0; i <= n; i++) {
        const open = i < n && !solid[get(i)];
        if (open && run < 0) run = i;
        if (!open && run >= 0) {
          if (i - run >= 4) { const m = (run + i - 1) >> 1; entries.push(toXY(m)); }
          run = -1;
        }
      }
    }
    scanEdge((i) => i, W, (m) => ({ x: m + 0.5, y: 1.5 }));
    scanEdge((i) => (H - 1) * W + i, W, (m) => ({ x: m + 0.5, y: H - 1.5 }));
    scanEdge((i) => i * W, H, (m) => ({ x: 1.5, y: m + 0.5 }));
    scanEdge((i) => i * W + W - 1, H, (m) => ({ x: W - 1.5, y: m + 0.5 }));
    for (const e of entries) e.k = Math.floor(e.y) * W + Math.floor(e.x);

    // police base and fire station: entries far apart
    let best = [0, 1], bd = -1;
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      const d = Math.hypot(entries[i].x - entries[j].x, entries[i].y - entries[j].y);
      if (d > bd) { bd = d; best = [i, j]; }
    }
    const policeBase = entries[best[0]] || { x: W / 2, y: 2 };
    const station = entries[best[1]] || { x: W / 2, y: H - 2 };

    // street lamps (night)
    const lamps = [];
    for (const s of streets) {
      if (s.kind === 'd') continue;
      const q = s.kind === 'v' ? Math.round(s.c - s.w / 2) + 0.8 : Math.round(s.c - s.w / 2) + 0.8;
      const len = s.kind === 'v' ? H : W;
      for (let p = 6; p < len; p += 16) {
        const x = s.kind === 'v' ? q : p, y = s.kind === 'v' ? p : q;
        if (tile[Math.floor(y) * W + Math.floor(x)] === T.SIDEWALK) lamps.push({ x, y });
      }
    }

    const map = { W, H, N, seed: o.seed || 1, tile, solid, carAt, barr, barrKind, cars, trees, streets,
      landmarks, entries, policeBase, station, lamps, version: 0 };

    map.walkable = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      return !solid[(y | 0) * W + (x | 0)];
    };
    map.streetAt = (x, y) => {
      let bestS = null, bdd = 1e9;
      for (const s of streets) {
        let d;
        if (s.kind === 'v') d = Math.abs(x - s.c) - s.w / 2;
        else if (s.kind === 'h') d = Math.abs(y - s.c) - s.w / 2;
        else {
          const dx = s.x1 - s.x0, dy = s.y1 - s.y0, L2 = dx * dx + dy * dy;
          let t = ((x - s.x0) * dx + (y - s.y0) * dy) / L2; t = P.clamp(t, 0, 1);
          d = Math.hypot(s.x0 + dx * t - x, s.y0 + dy * t - y) - s.w / 2;
        }
        if (d < bdd) { bdd = d; bestS = s; }
      }
      for (const lm of landmarks) if (Math.hypot(x - lm.x, y - lm.y) < lm.r + 4) return 'Place de la ' + lm.name;
      return bestS ? bestS.name : 'Paris';
    };
    // Nearest walkable tile to (x,y) within radius rad (spiral-ish scan).
    map.nearestOpen = (x, y, rad) => {
      rad = rad || 12;
      const cx = x | 0, cy = y | 0;
      if (map.walkable(cx, cy)) return { x: cx + 0.5, y: cy + 0.5 };
      for (let r = 1; r <= rad; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (map.walkable(cx + dx, cy + dy)) return { x: cx + dx + 0.5, y: cy + dy + 0.5 };
      }
      return null;
    };
    // Free extent from (x,y) along an axis, used to lay police lines across a street.
    map.extent = (x, y, dx, dy, max) => {
      let a = 0, b = 0;
      while (a < max && map.walkableNoCar(x - dx * (a + 1), y - dy * (a + 1))) a++;
      while (b < max && map.walkableNoCar(x + dx * (b + 1), y + dy * (b + 1))) b++;
      return { a, b };
    };
    map.walkableNoCar = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const k = (y | 0) * W + (x | 0);
      return !(tile[k] === T.BUILDING || tile[k] === T.MONUMENT);
    };
    return map;
  };
})();
