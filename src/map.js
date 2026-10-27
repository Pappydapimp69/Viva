// Procedural Paris. Not one grid: each map mixes districts with their own
// orientation, spacing and street style (Haussmann grids, crooked medieval
// lanes), star plazas with radiating avenues, garden squares, and sometimes the
// Seine with a handful of bridges. Streets are polylines rasterised onto tiles.
// Pure data — rendering lives in render.js.
(function () {
  const P = globalThis.PAVE;
  const T = P.T;
  T.WATER = 6; T.BRIDGE = 7; T.COURT = 8;

  const LANDMARKS = ['République', 'Bastille', 'Nation', 'Concorde', 'Opéra', 'Châtelet', 'Étoile', 'Trocadéro', 'Vosges', 'Italie'];
  const RUES = ['de Malte', 'Oberkampf', 'Saint-Maur', 'de Charonne', 'de la Roquette', 'du Temple', 'de Turbigo',
    'Réaumur', 'de Rivoli', 'Saint-Antoine', 'des Pyrénées', 'de Belleville', 'Amelot', 'de Crussol', 'Popincourt',
    'Jean-Pierre Timbaud', 'du Faubourg Saint-Denis', 'de Bretagne', 'des Archives', 'Vieille du Temple',
    'de Lancry', 'des Vinaigriers', 'de la Folie-Méricourt', 'Keller', 'de Lappe', 'Sedaine', 'des Rosiers',
    'Quincampoix', 'Mouffetard', 'de Buci', 'Saint-Denis', 'Montorgueil', 'du Bac', 'de Grenelle', 'Cler', 'des Martyrs'];
  const BLVDS = ['Voltaire', 'Richard-Lenoir', 'Beaumarchais', 'Magenta', 'du Temple', 'Saint-Martin', 'de Sébastopol',
    'Haussmann', 'Diderot', 'de Ménilmontant', 'Saint-Germain', 'Saint-Michel', 'Raspail', 'de Clichy'];
  const AVES = ['de la République', 'Parmentier', 'Ledru-Rollin', 'Daumesnil', 'Gambetta', 'de l\'Opéra', 'Victor-Hugo',
    'Kléber', 'Foch', 'de Wagram', 'Marceau', 'des Gobelins'];
  const CAR_COLORS = ['#e8e8e8', '#cfd3d6', '#1c1f24', '#2b3440', '#5d6670', '#8a1f1f', '#203a6b', '#f0f0f0',
    '#3c3c3c', '#a9a9a9', '#6b4c2a', '#1e4d3b'];
  P.MAP_STYLES = ['haussmann', 'marais', 'river', 'etoile', 'mixed'];

  // smooth 2D value noise in [0,1]
  function makeNoise(R, cell) {
    const G = 64, v = new Float32Array(G * G);
    for (let i = 0; i < v.length; i++) v[i] = R();
    const s = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      x /= cell; y /= cell;
      const xi = Math.floor(x), yi = Math.floor(y), fx = s(x - xi), fy = s(y - yi);
      const a = v[((yi & 63) * G) + (xi & 63)], b = v[((yi & 63) * G) + ((xi + 1) & 63)];
      const c = v[(((yi + 1) & 63) * G) + (xi & 63)], d = v[(((yi + 1) & 63) * G) + ((xi + 1) & 63)];
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
  }

  function segDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - px, qy = ay + dy * t - py;
    return qx * qx + qy * qy;
  }

  P.generateMap = function (o) {
    o = o || {};
    const W = o.w || 320, H = o.h || 320, N = W * H;
    const R = P.rng(o.seed || 1);
    const style = o.style && o.style !== 'random' ? o.style : R.pick(P.MAP_STYLES);
    const noise = makeNoise(R, 22), noise2 = makeNoise(R, 9);
    const tile = new Uint8Array(N).fill(T.BUILDING);
    const streets = [];
    const rues = R.shuffle(RUES.slice()), blvds = R.shuffle(BLVDS.slice()), aves = R.shuffle(AVES.slice());
    let ri = 0, bi = 0, ai = 0;
    const inMap = (x, y, m) => x >= -m && y >= -m && x < W + m && y < H + m;
    function addStreet(pts, w, kind, extra) {
      if (pts.length < 2) return null;
      const name = kind === 'blvd' ? 'Boulevard ' + blvds[bi++ % blvds.length]
        : kind === 'ave' ? 'Avenue ' + aves[ai++ % aves.length] : 'Rue ' + rues[ri++ % rues.length];
      const s = Object.assign({ id: streets.length, pts, w, kind, blvd: kind === 'blvd' || kind === 'ave', side: w >= 16 ? 3 : w >= 8 ? 2 : 1, name }, extra || {});
      streets.push(s);
      return s;
    }
    // a gently curved polyline from a to b
    function curve(ax, ay, bx, by, bend, step) {
      const pts = [], L = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.ceil(L / (step || 6)));
      const nx = -(by - ay) / (L || 1), ny = (bx - ax) / (L || 1);
      for (let i = 0; i <= n; i++) {
        const t = i / n, b = Math.sin(t * Math.PI) * bend * L;
        pts.push([ax + (bx - ax) * t + nx * b, ay + (by - ay) * t + ny * b]);
      }
      return pts;
    }
    // ray from (x,y) at angle a until it leaves the map (plus margin) or reaches len
    function ray(x, y, a, len) {
      const pts = [];
      for (let d = 0; d <= len; d += 6) {
        const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
        pts.push([px, py]);
        if (!inMap(px, py, 4)) break;
      }
      return pts;
    }

    // ---------------------------------------------------------------- river
    let river = null;
    if (style === 'river' || (style === 'mixed' && R() < 0.55) || (style === 'etoile' && R() < 0.3)) {
      const horiz = R() < 0.5, len = horiz ? W : H, across = horiz ? H : W;
      const base = across * R.range(0.38, 0.62), amp = R.range(10, 34), f = R.range(1.2, 2.4) * Math.PI / len, ph = R() * 6.28;
      const pts = [];
      for (let t = -10; t <= len + 10; t += 5) {
        const c = base + Math.sin(t * f + ph) * amp + (noise(t, 7) - 0.5) * 24;
        pts.push(horiz ? [t, c] : [c, t]);
      }
      river = { pts, w: R.int(16, 24), horiz };
    }
    const riverDist = (x, y) => {
      if (!river) return Infinity;
      let best = Infinity;
      const p = river.pts;
      for (let i = 0; i < p.length - 1; i++) { const d = segDist2(x, y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]); if (d < best) best = d; }
      return Math.sqrt(best);
    };

    // ---------------------------------------------------------------- plazas
    const nPlaza = o.landmarks || P.clamp(Math.round(N / 23000) + (style === 'etoile' ? 1 : 0), 3, 6);
    const plazas = [];
    for (let tries = 0; plazas.length < nPlaza && tries < 4000; tries++) {
      const r = R.int(15, 21);
      const x = R.int(34, W - 34), y = R.int(34, H - 34);
      const minD = tries > 2500 ? 55 : 72;
      if (plazas.some((p) => Math.hypot(p.x - x, p.y - y) < minD)) continue;
      if (river && riverDist(x, y) < river.w / 2 + r + 8) continue;
      let type = R.pick(['round', 'round', 'etoile', 'square']);
      if (style === 'etoile' && plazas.length === 0) type = 'etoile';
      if (style === 'marais' && type === 'etoile') type = R() < 0.5 ? 'square' : 'round';
      plazas.push({ x: x + 0.5, y: y + 0.5, r: type === 'etoile' ? r + 3 : r, type, hw: R.int(13, 18), hh: R.int(10, 14) });
    }

    // ---------------------------------------------------------------- boulevards between plazas (MST + extras)
    const inTree = [0], edges = [];
    while (inTree.length < plazas.length) {
      let best = null, bd = Infinity;
      for (const i of inTree) for (let j = 0; j < plazas.length; j++) {
        if (inTree.includes(j)) continue;
        const d = Math.hypot(plazas[i].x - plazas[j].x, plazas[i].y - plazas[j].y);
        if (d < bd) { bd = d; best = [i, j]; }
      }
      inTree.push(best[1]); edges.push(best);
    }
    if (plazas.length > 3 && R() < 0.7) { const a = R.int(0, plazas.length - 1), b = (a + 2) % plazas.length; edges.push([a, b]); }
    for (const [i, j] of edges) {
      const a = plazas[i], b = plazas[j];
      const bend = style === 'haussmann' ? R.range(-0.04, 0.04) : R.range(-0.14, 0.14);
      addStreet(curve(a.x, a.y, b.x, b.y, bend), R.int(18, 22), R() < 0.5 ? 'blvd' : 'ave', { bridge: true, trees: true });
    }
    // star avenues radiating from étoiles, and one or two exits per plaza toward the edge
    for (const p of plazas) {
      const cx = W / 2, cy = H / 2;
      if (p.type === 'etoile') {
        const k = R.int(5, 8), a0 = R() * 6.28;
        for (let q = 0; q < k; q++) {
          const a = a0 + q * (6.283 / k) + R.range(-0.12, 0.12);
          addStreet(ray(p.x, p.y, a, R.int(60, 160)), R.int(12, 16), 'ave', { bridge: true, trees: R() < 0.6 });
        }
      } else {
        const out = Math.atan2(p.y - cy, p.x - cx) + R.range(-0.6, 0.6);
        addStreet(ray(p.x, p.y, out, 400), R.int(14, 20), 'blvd', { bridge: true, trees: true });
      }
    }

    // ---------------------------------------------------------------- district fabric (Voronoi cells)
    const nd = R.int(3, 6), districts = [];
    for (let d = 0; d < nd; d++) {
      let ds = style === 'mixed' || style === 'river' || style === 'etoile' ? R.pick(['grid', 'grid', 'lanes']) : style === 'marais' ? (R() < 0.75 ? 'lanes' : 'grid') : 'grid';
      const ang = style === 'haussmann' ? R.pick([0, 0, Math.PI / 2, R.range(-0.5, 0.5)]) : R.range(0, Math.PI);
      districts.push({ x: R.int(0, W), y: R.int(0, H), style: ds, ang, sx: ds === 'grid' ? R.int(40, 64) : R.int(24, 36),
        sy: ds === 'grid' ? R.int(42, 72) : R.int(24, 38), w: ds === 'grid' ? R.int(9, 12) : R.int(5, 7), warp: ds === 'grid' ? R.range(0, 5) : R.range(6, 16),
        gap: ds === 'grid' ? R.range(0.1, 0.35) : R.range(0.3, 0.55), roof: d });
    }
    const districtAt = (x, y) => {
      let b = 0, bd = Infinity;
      for (let d = 0; d < districts.length; d++) {
        const D = districts[d], dd = (D.x - x) ** 2 + (D.y - y) ** 2 + (noise(x * 1.7, y * 1.7) - 0.5) * 2600;
        if (dd < bd) { bd = dd; b = d; }
      }
      return b;
    };
    const OVER = 10; // streets run a little past their district so neighbours connect
    const nearDistrict = (x, y, d) => {
      if (districtAt(x, y) === d) return true;
      for (const [ox, oy] of [[OVER, 0], [-OVER, 0], [0, OVER], [0, -OVER]]) if (districtAt(x + ox, y + oy) === d) return true;
      return false;
    };
    districts.forEach((D, d) => {
      const ca = Math.cos(D.ang), sa = Math.sin(D.ang);
      const span = Math.hypot(W, H);
      const warp = (x, y) => [x + (noise(x + 100, y) - 0.5) * D.warp * 2, y + (noise(x, y + 100) - 0.5) * D.warp * 2];
      // two families of lines in the district's rotated frame
      for (let fam = 0; fam < 2; fam++) {
        const sp = fam === 0 ? D.sx : D.sy;
        const off = R() * sp;
        for (let u = -span / 2 + off; u < span / 2; u += sp * R.range(0.8, 1.25)) {
          let cur = [];
          const flush = () => { if (cur.length >= 3) addStreet(cur, D.w + (R() < 0.15 ? 2 : 0), 'rue', { trees: false, bridge: R() < 0.2 }); cur = []; };
          let skip = 0;
          for (let v = -span / 2; v < span / 2; v += 4) {
            const lx = fam === 0 ? u : v, ly = fam === 0 ? v : u;
            let x = W / 2 + lx * ca - ly * sa, y = H / 2 + lx * sa + ly * ca;
            [x, y] = warp(x, y);
            if (D.style === 'lanes') { x += (noise2(x, y) - 0.5) * 6; y += (noise2(y, x) - 0.5) * 6; }
            const ok = inMap(x, y, 6) && nearDistrict(x, y, d);
            // cross streets break into pieces: T-junctions and offset blocks, not a lattice
            if (fam === 1 && ok && skip <= 0 && R() < D.gap * 0.06) { flush(); skip = R.int(10, 30); }
            if (skip > 0) { skip -= 4; continue; }
            if (ok) cur.push([x, y]); else flush();
          }
          flush();
        }
      }
      // medieval districts also get wandering alleys
      if (D.style === 'lanes') for (let k = 0; k < R.int(3, 6); k++) {
        let x = D.x + R.range(-40, 40), y = D.y + R.range(-40, 40), a = R() * 6.28;
        const pts = [];
        for (let s = 0; s < R.int(14, 34); s++) {
          pts.push([x, y]);
          a += (noise2(x * 3, y * 3) - 0.5) * 1.2;
          x += Math.cos(a) * 4; y += Math.sin(a) * 4;
          if (!inMap(x, y, 0)) break;
        }
        addStreet(pts, R.int(4, 6), 'rue', { trees: false });
      }
    });

    // ---------------------------------------------------------------- rasterise streets
    function stamp(s, inset, fn) {
      const half = s.w / 2 - inset;
      if (half <= 0) return;
      const h2 = half * half, p = s.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const ax = p[i][0], ay = p[i][1], bx = p[i + 1][0], by = p[i + 1][1];
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - half)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + half));
        const y0 = Math.max(0, Math.floor(Math.min(ay, by) - half)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + half));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (segDist2(x + 0.5, y + 0.5, ax, ay, bx, by) <= h2) fn(x, y);
      }
    }
    for (const s of streets) stamp(s, 0, (x, y) => { if (tile[y * W + x] === T.BUILDING) tile[y * W + x] = T.SIDEWALK; });
    for (const s of streets) stamp(s, s.side, (x, y) => { tile[y * W + x] = T.ROAD; });

    // ---------------------------------------------------------------- the river, quays and bridges
    if (river) {
      // pick bridges: crossing streets allowed to bridge, spaced along the river
      const crossers = [];
      for (const s of streets) {
        if (!s.bridge) continue;
        for (const pt of s.pts) { if (riverDist(pt[0], pt[1]) < river.w / 2) { crossers.push({ s, at: river.horiz ? pt[0] : pt[1] }); break; } }
      }
      crossers.sort((a, b) => (b.s.w - a.s.w) || (a.at - b.at));
      const keep = [];
      for (const c of crossers) if (keep.every((k) => Math.abs(k.at - c.at) > 34)) keep.push(c);
      const bridged = new Set(keep.map((k) => k.s.id));
      const bridgeMask = new Uint8Array(N);
      for (const s of streets) if (bridged.has(s.id)) stamp(s, 0, (x, y) => { bridgeMask[y * W + x] = 1; });
      const hw = river.w / 2;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = riverDist(x + 0.5, y + 0.5), k = y * W + x;
        if (d <= hw) tile[k] = bridgeMask[k] ? T.BRIDGE : T.WATER;
        else if (d <= hw + 3 && tile[k] === T.BUILDING) tile[k] = T.SIDEWALK; // quays
      }
      river.bridges = keep.length;
    }

    // ---------------------------------------------------------------- plazas and squares
    const landmarks = [];
    const lmNames = R.shuffle(LANDMARKS.slice());
    plazas.forEach((p, i) => {
      if (p.type === 'square') {
        // garden square ringed by a street: Place des Vosges-like
        for (let y = Math.floor(p.y - p.hh - 4); y <= p.y + p.hh + 4; y++) for (let x = Math.floor(p.x - p.hw - 4); x <= p.x + p.hw + 4; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const ex = Math.abs(x + 0.5 - p.x), ey = Math.abs(y + 0.5 - p.y), k = y * W + x;
          if (ex <= p.hw - 4 && ey <= p.hh - 4) tile[k] = (ex < 1.6 && ey < 1.6) ? T.MONUMENT : T.PARK;
          else if (ex <= p.hw - 2 && ey <= p.hh - 2) tile[k] = T.PLAZA;
          else if (ex <= p.hw + 3 && ey <= p.hh + 3) tile[k] = T.ROAD;
          else if (tile[k] === T.BUILDING) tile[k] = T.SIDEWALK;
        }
        p.r = Math.max(p.hw, p.hh) + 2;
      } else {
        for (let y = Math.floor(p.y - p.r - 3); y <= p.y + p.r + 3; y++) for (let x = Math.floor(p.x - p.r - 3); x <= p.x + p.r + 3; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y), k = y * W + x;
          if (d <= p.r) tile[k] = d <= 2.6 ? T.MONUMENT : (p.type === 'etoile' && d > p.r - 5 ? T.ROAD : T.PLAZA);
          else if (d <= p.r + 3 && tile[k] === T.BUILDING) tile[k] = T.SIDEWALK;
        }
      }
      landmarks.push({ id: i, name: lmNames[i % lmNames.length], x: p.x, y: p.y, r: p.r, type: p.type, control: -0.2, owner: 'police', heldFor: 0 });
    });

    // ---------------------------------------------------------------- parks: a few blocks become gardens
    let comp = new Int32Array(N).fill(-1), blocks = [];
    const stack = new Int32Array(N);
    function components(test) {
      comp.fill(-1); blocks = [];
      for (let i = 0; i < N; i++) {
        if (!test(tile[i]) || comp[i] >= 0) continue;
        let sp = 0; stack[sp++] = i; comp[i] = blocks.length;
        let area = 0, edge = false, sx = 0, sy = 0;
        while (sp) {
          const k = stack[--sp], x = k % W, y = (k - x) / W; area++; sx += x; sy += y;
          if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
          if (x > 0 && test(tile[k - 1]) && comp[k - 1] < 0) { comp[k - 1] = blocks.length; stack[sp++] = k - 1; }
          if (x < W - 1 && test(tile[k + 1]) && comp[k + 1] < 0) { comp[k + 1] = blocks.length; stack[sp++] = k + 1; }
          if (y > 0 && test(tile[k - W]) && comp[k - W] < 0) { comp[k - W] = blocks.length; stack[sp++] = k - W; }
          if (y < H - 1 && test(tile[k + W]) && comp[k + W] < 0) { comp[k + W] = blocks.length; stack[sp++] = k + W; }
        }
        blocks.push({ area, edge, cx: sx / area, cy: sy / area });
      }
    }
    components((t) => t === T.BUILDING);
    const parkable = blocks.map((b, i) => ({ b, i })).filter((e) => !e.b.edge && e.b.area > 500 && e.b.area < 2400);
    R.shuffle(parkable);
    const parkIds = new Set(parkable.slice(0, R.int(1, style === 'marais' ? 1 : 3)).map((e) => e.i));
    for (let i = 0; i < N; i++) if (comp[i] >= 0 && parkIds.has(comp[i])) tile[i] = T.PARK;
    // courtyards: big blocks get a hollow centre (visual only, solid)
    for (let i = 0; i < N; i++) {
      if (tile[i] !== T.BUILDING) continue;
      const b = blocks[comp[i]];
      if (!b || b.area < 900) continue;
      const x = i % W, y = (i - x) / W;
      let inner = true;
      for (let q = 1; q <= 6 && inner; q++) {
        if (x - q < 0 || x + q >= W || y - q < 0 || y + q >= H) { inner = false; break; }
        if (tile[i - q] !== T.BUILDING && tile[i - q] !== T.COURT) inner = false;
        if (tile[i + q] !== T.BUILDING && tile[i + q] !== T.COURT) inner = false;
        if (tile[i - q * W] !== T.BUILDING && tile[i - q * W] !== T.COURT) inner = false;
        if (tile[i + q * W] !== T.BUILDING && tile[i + q * W] !== T.COURT) inner = false;
      }
      if (inner && noise2(x * 2, y * 2) > 0.42) tile[i] = T.COURT;
    }

    // ---------------------------------------------------------------- connectivity
    // everything walkable must be reachable from the edge; plazas get a lane cut if not
    const isWalk = (t) => t !== T.BUILDING && t !== T.MONUMENT && t !== T.WATER && t !== T.COURT;
    const reach = new Uint8Array(N);
    function flood() {
      reach.fill(0);
      let sp = 0;
      for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const k = y * W + x; if (isWalk(tile[k]) && !reach[k]) { reach[k] = 1; stack[sp++] = k; } }
      for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const k = y * W + x; if (isWalk(tile[k]) && !reach[k]) { reach[k] = 1; stack[sp++] = k; } }
      while (sp) {
        const k = stack[--sp], x = k % W;
        for (const n of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k >= W ? k - W : -1, k < N - W ? k + W : -1]) {
          if (n >= 0 && !reach[n] && isWalk(tile[n])) { reach[n] = 1; stack[sp++] = n; }
        }
      }
    }
    flood();
    for (const lm of landmarks) {
      const k0 = Math.floor(lm.y) * W + Math.floor(lm.x + lm.r - 3);
      if (reach[k0]) continue;
      // cut a lane to the nearest reachable tile
      let best = null, bd = Infinity;
      for (let k = 0; k < N; k += 3) if (reach[k]) { const x = k % W, y = (k - x) / W, d = (x - lm.x) ** 2 + (y - lm.y) ** 2; if (d < bd) { bd = d; best = [x, y]; } }
      if (best) {
        const s = addStreet([[lm.x, lm.y], [best[0] + 0.5, best[1] + 0.5]], 7, 'rue', {});
        stamp(s, 0, (x, y) => { const k = y * W + x; if (tile[k] === T.BUILDING || tile[k] === T.COURT) tile[k] = T.SIDEWALK; if (tile[k] === T.WATER) tile[k] = T.BRIDGE; });
        stamp(s, s.side, (x, y) => { const k = y * W + x; if (tile[k] === T.SIDEWALK) tile[k] = T.ROAD; });
      }
      flood();
    }
    // unreachable pockets become courtyards (enclosed light wells), never dead walkable space
    for (let k = 0; k < N; k++) if (isWalk(tile[k]) && !reach[k]) tile[k] = T.COURT;

    // ---------------------------------------------------------------- solidity
    const solid = new Uint8Array(N);
    for (let i = 0; i < N; i++) solid[i] = isWalk(tile[i]) ? 0 : 1;
    const carAt = new Int16Array(N).fill(-1);
    const barr = new Float32Array(N), barrKind = new Uint8Array(N);

    // district id per tile (roof palettes) — cheap coarse lookup
    const district = new Uint8Array(N);
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
      const d = districtAt(x + 2, y + 2);
      for (let yy = y; yy < Math.min(H, y + 4); yy++) for (let xx = x; xx < Math.min(W, x + 4); xx++) district[yy * W + xx] = d;
    }

    // ---------------------------------------------------------------- parked cars along any straight curb
    const cars = [];
    const carRate = o.carRate == null ? 0.62 : o.carRate;
    const isRoad = (x, y) => x >= 0 && y >= 0 && x < W && y < H && tile[y * W + x] === T.ROAD && carAt[y * W + x] < 0;
    const isSide = (x, y) => x >= 0 && y >= 0 && x < W && y < H && tile[y * W + x] === T.SIDEWALK;
    function place(x, y, w, h, vert) {
      const id = cars.length;
      cars.push({ id, x, y, w, h, vert, cx: x + w / 2, cy: y + h / 2, color: R.pick(CAR_COLORS), state: 0, heat: 0, burn: 0, inten: 0, near: null });
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { carAt[yy * W + xx] = id; solid[yy * W + xx] = 1; }
    }
    // horizontal curbs (sidewalk above or below), lane two tiles deep, road at least 6 wide
    for (let y = 1; y < H - 1; y++) for (const dir of [1, -1]) {
      let x = 1;
      while (x < W - 6) {
        const ly = dir === 1 ? y : y - 1; // lane rows ly, ly+1
        const curbY = dir === 1 ? y - 1 : y + 1;
        let ok = true;
        for (let q = x - 1; q < x + 5 && ok; q++) if (!isSide(q, curbY)) ok = false;
        for (let q = x; q < x + 4 && ok; q++) for (let r = 0; r < 2 && ok; r++) if (!isRoad(q, ly + r)) ok = false;
        const far = dir === 1 ? ly + 2 : ly - 1;
        for (let q = x; q < x + 4 && ok; q++) if (!isRoad(q, far) || !isRoad(q, far + (dir === 1 ? 1 : -1))) ok = false;
        if (ok && R() < carRate) { place(x, ly, 4, 2, false); x += 4 + R.int(1, 3); } else x += ok ? R.int(2, 4) : 1;
      }
    }
    for (let x = 1; x < W - 1; x++) for (const dir of [1, -1]) {
      let y = 1;
      while (y < H - 6) {
        const lx = dir === 1 ? x : x - 1;
        const curbX = dir === 1 ? x - 1 : x + 1;
        let ok = true;
        for (let q = y - 1; q < y + 5 && ok; q++) if (!isSide(curbX, q)) ok = false;
        for (let q = y; q < y + 4 && ok; q++) for (let r = 0; r < 2 && ok; r++) if (!isRoad(lx + r, q)) ok = false;
        const far = dir === 1 ? lx + 2 : lx - 1;
        for (let q = y; q < y + 4 && ok; q++) if (!isRoad(far, q) || !isRoad(far + (dir === 1 ? 1 : -1), q)) ok = false;
        if (ok && R() < carRate) { place(lx, y, 2, 4, true); y += 4 + R.int(1, 3); } else y += ok ? R.int(2, 4) : 1;
      }
    }
    for (const c of cars) {
      c.near = [];
      for (const d of cars) {
        if (d === c) continue;
        const dd = Math.hypot(c.cx - d.cx, c.cy - d.cy);
        if (dd < 7) c.near.push(d.id, dd);
      }
    }

    // ---------------------------------------------------------------- trees, lamps
    const trees = [], lamps = [];
    function along(s, every, offset, fn) {
      const p = s.pts;
      let carry = 0;
      for (let i = 0; i < p.length - 1; i++) {
        const ax = p[i][0], ay = p[i][1], bx = p[i + 1][0], by = p[i + 1][1], L = Math.hypot(bx - ax, by - ay);
        if (!L) continue;
        const nx = -(by - ay) / L, ny = (bx - ax) / L;
        for (let d = carry; d < L; d += every) {
          const x = ax + (bx - ax) * d / L, y = ay + (by - ay) * d / L;
          fn(x + nx * offset, y + ny * offset); fn(x - nx * offset, y - ny * offset);
        }
        carry = (carry - L) % every; if (carry < 0) carry += every;
      }
    }
    for (const s of streets) {
      if (s.trees) along(s, R.int(6, 8), s.w / 2 - 1.5, (x, y) => {
        if (x >= 0 && y >= 0 && x < W && y < H && tile[(y | 0) * W + (x | 0)] === T.SIDEWALK) trees.push({ x, y, r: R.range(1.6, 2.4), s: R() });
      });
      if (s.w >= 8) along(s, 16, s.w / 2 - 0.8, (x, y) => {
        if (x >= 0 && y >= 0 && x < W && y < H && tile[(y | 0) * W + (x | 0)] === T.SIDEWALK && R() < 0.5) lamps.push({ x, y });
      });
    }
    for (const lm of landmarks) {
      if (lm.type === 'square') continue;
      for (let a = 0; a < Math.PI * 2; a += 0.42) {
        const x = lm.x + Math.cos(a) * (lm.r - 2.5), y = lm.y + Math.sin(a) * (lm.r - 2.5);
        if (tile[Math.floor(y) * W + Math.floor(x)] === T.PLAZA) trees.push({ x, y, r: R.range(1.5, 2.1), s: R() });
      }
    }
    for (let i = 0; i < N / 300; i++) {
      const x = R.int(1, W - 2), y = R.int(1, H - 2);
      if (tile[y * W + x] === T.PARK) trees.push({ x: x + 0.5, y: y + 0.5, r: R.range(1.8, 2.8), s: R() });
    }

    // ---------------------------------------------------------------- entries, bases
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
    let best = [0, 1], bd = -1;
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      const d = Math.hypot(entries[i].x - entries[j].x, entries[i].y - entries[j].y);
      if (d > bd) { bd = d; best = [i, j]; }
    }
    const policeBase = entries[best[0]] || { x: W / 2, y: 2 };
    // the fire station (caserne) sits inside the city, off the plazas, so trucks arrive in time
    let station = null;
    for (let t = 0; t < 400 && !station; t++) {
      const x = W / 2 + R.range(-W * 0.18, W * 0.18), y = H / 2 + R.range(-H * 0.18, H * 0.18);
      const k = Math.floor(y) * W + Math.floor(x);
      if (tile[k] === T.ROAD && !solid[k] && landmarks.every((l) => Math.hypot(l.x - x, l.y - y) > l.r + 8)) station = { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
    }
    station = station || entries[best[1]] || { x: W / 2, y: H - 2 };

    const map = { W, H, N, seed: o.seed || 1, style, tile, solid, carAt, barr, barrKind, cars, trees, streets,
      landmarks, entries, policeBase, station, lamps, district, river, version: 0 };

    map.walkable = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      return !solid[(y | 0) * W + (x | 0)];
    };
    map.streetAt = (x, y) => {
      for (const lm of landmarks) if (Math.hypot(x - lm.x, y - lm.y) < lm.r + 4) return 'Place de la ' + lm.name;
      if (river && riverDist(x, y) < river.w / 2 + 4) return 'Quai de la Seine';
      let bestS = null, bdd = Infinity;
      for (const s of streets) {
        const p = s.pts;
        for (let i = 0; i < p.length - 1; i++) {
          const d = segDist2(x, y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) - (s.w / 2) ** 2;
          if (d < bdd) { bdd = d; bestS = s; }
        }
      }
      return bestS ? bestS.name : 'Paris';
    };
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
    map.walkableNoCar = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      return isWalk(tile[(y | 0) * W + (x | 0)]);
    };
    map.extent = (x, y, dx, dy, max) => {
      let a = 0, b = 0;
      while (a < max && map.walkableNoCar(x - dx * (a + 1), y - dy * (a + 1))) a++;
      while (b < max && map.walkableNoCar(x + dx * (b + 1), y + dy * (b + 1))) b++;
      return { a, b };
    };
    // Narrowest crossing through (x,y) over 8 directions: how a line spans a street
    // that may run at any angle.
    map.crossLine = (x, y, max) => {
      let best = null;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 8, ux = Math.cos(a), uy = Math.sin(a);
        const e = map.extent(x, y, ux, uy, max);
        const span = e.a + e.b + 1;
        if (!best || span < best.span) best = { ux, uy, a: e.a, b: e.b, span };
      }
      return best;
    };
    return map;
  };
})();
