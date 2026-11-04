// Measurement bots for Viva: one policy per objective type, on both sides.
// Deterministic (no Math.random; reads only world state), headless, Node-only tooling.
//   const bot = createBot(P, world, 'strong');   // 'idle' | 'naive' | 'strong' | 'far'
//   each tick: bot.pre(s); world.tick(P.SIM_DT); bot.post(s);
// 'naive'  = tools/bench.js's protest bot verbatim (march every bloc at the objective square, every 30 s
//            retarget every bloc to the first unowned square; no tools). On police levels bench does
//            nothing; here 'naive' is the police analogue: every 30 s every squad goes at the objective
//            point (hold: a line on the square; arrest/limit: a charge at the crowd centroid), no other tool.
// 'strong' = per-objective policy using the side's tools (see each policy below).
// 'far'    = capture levels only: every bloc marches at the square farthest from the objective, never retargets.
(function () {
  function createBot(P, w, policy) {
    const K = P.K, lms = w.map.landmarks, obj = w.objectives[0] || { type: 'survive' };
    const protest = w.side === P.SIDE.PROTEST;
    const dist = (a, b, x, y) => Math.hypot(a - x, b - y);
    const cd = {};
    const ready = (k) => !(cd[k] > w.time);
    const arm = (k, s) => { cd[k] = w.time + s; };
    const log = { fireworks: 0, casseurs: 0, mobilise: 0, trucks: 0, charges: 0, gas: 0, reinforce: 0, lines: 0 };

    // ---- shared helpers ----
    // top-k cells of a density grid summed over (2r+1)^2 cells, non-max suppressed by sep tiles
    function topCells(grid, k, r, sep, min) {
      const CW = w.CW, CH = w.CH, out = [];
      const sums = [];
      for (let cy = r; cy < CH - r; cy += 1) for (let cx = r; cx < CW - r; cx += 1) {
        let s = 0;
        for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) s += grid[yy * CW + xx];
        if (s >= min) sums.push([s, cx * P.CS + 2, cy * P.CS + 2]);
      }
      sums.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
      for (const c of sums) {
        if (out.length >= k) break;
        if (out.every((o) => dist(o.x, o.y, c[1], c[2]) > sep)) out.push({ n: c[0], x: c[1], y: c[2] });
      }
      return out;
    }
    function nearestNonPol(x, y, maxD) {
      const cr = w.crowd; let bi = -1, bd = maxD * maxD;
      for (let i = 0; i < cr.n; i++) {
        const k = cr.kind[i]; if (k === K.POL || k === K.DEAD) continue;
        const d = (cr.x[i] - x) ** 2 + (cr.y[i] - y) ** 2; if (d < bd) { bd = d; bi = i; }
      }
      return bi;
    }
    function target(b, x, y, lmId) {
      const bl = w.blocs[b];
      if (bl.tx === x && bl.ty === y && bl.target === (lmId == null ? -1 : lmId) && !bl.truck) return;
      w.setBlocTarget(b, x, y, lmId);
    }
    function lmTarget(b, lm) { target(b, lm.x, lm.y, lm.id); }
    const owned = () => lms.filter((l) => l.owner === 'protest');

    // ---------------- protest: capture / captureNamed ----------------
    let goal = null, goalT = 0;
    function strongCapture() {
      const need = obj.type === 'captureNamed' ? null : obj.n;
      const named = obj.type === 'captureNamed' ? lms[obj.lm || 0] : null;
      const blocs = w.blocs.filter((b) => b.n >= 1);
      // pick the attack goal: the named square, else the nearest unowned square to the crowd (sticky; switch if stalled 60 s)
      if (named) goal = named;
      else {
        const free = lms.filter((l) => l.owner !== 'protest');
        if (!goal || goal.owner === 'protest' || (w.time - goalT > 60 && goal.control < 0.2)) {
          const cx = w.protCx || lms[0].x, cy = w.protCy || lms[0].y;
          const cands = free.filter((l) => l !== goal || free.length === 1);
          const pool = cands.length ? cands : free;
          goal = pool.length ? pool.reduce((a, l) => (dist(l.x, l.y, cx, cy) + l.pol * 2 < dist(a.x, a.y, cx, cy) + a.pol * 2 ? l : a)) : null;
          goalT = w.time;
        }
      }
      // guards: owned squares under police pressure keep the nearest bloc (never all blocs)
      const assigned = new Set();
      if (!named) {
        const threatened = owned().map((l) => ({ l, th: P.densAround(w, w.densPol, l.x, l.y, Math.ceil((l.r + 10) / P.CS)).sum }))
          .filter((o) => o.th > 4 || o.l.control < 0.8).sort((a, b) => b.th - a.th || a.l.id - b.l.id);
        for (const o of threatened) {
          if (assigned.size >= blocs.length - 1) break;
          let best = null;
          for (const b of blocs) if (!assigned.has(b.id) && (!best || dist(b.cx, b.cy, o.l.x, o.l.y) < dist(best.cx, best.cy, o.l.x, o.l.y))) best = b;
          if (best) { assigned.add(best.id); lmTarget(best.id, o.l); }
        }
      }
      if (goal) for (const b of blocs) if (!assigned.has(b.id)) lmTarget(b.id, goal);
      // fireworks on the police at the goal once a bloc is close; mobilise with spare energy
      if (goal && ready('fw') && w.energy >= 6) {
        const pol = P.densAround(w, w.densPol, goal.x, goal.y, Math.ceil((goal.r + 14) / P.CS));
        const close = blocs.some((b) => dist(b.cx, b.cy, goal.x, goal.y) < goal.r + 35);
        if (pol.sum > 6 && close) {
          const i = nearestNonPol(pol.x, pol.y, 40);
          if (i >= 0) { w.launchFireworks(w.crowd.x[i], w.crowd.y[i], pol.x, pol.y); w.energy -= 6; arm('fw', 5); log.fireworks++; }
        }
      }
      if (ready('mob') && w.energy >= 30) { w.spawnProtesters(800, false); w.energy -= 15; arm('mob', 30); log.mobilise++; }
    }

    // ---------------- protest: burn ----------------
    let clusters = [], clT = -99;
    function carClusters(k) {
      const cars = w.map.cars, out = [];
      const intact = cars.filter((c) => c.state === 0);
      const sc = intact.map((c) => {
        let n = 0; for (const d of intact) if (Math.abs(d.cx - c.cx) < 14 && Math.abs(d.cy - c.cy) < 14) n++;
        const pol = P.densAround(w, w.densPol, c.cx, c.cy, 3).sum;
        return [n - pol * 0.15, c];
      }).sort((a, b) => b[0] - a[0] || a[1].id - b[1].id);
      for (const [s, c] of sc) { if (out.length >= k) break; if (out.every((o) => dist(o.x, o.y, c.cx, c.cy) > 30)) out.push({ x: c.cx, y: c.cy, s }); }
      return out;
    }
    function strongBurn() {
      const blocs = w.blocs.filter((b) => b.n >= 1);
      if (w.time - clT > 10) { clusters = carClusters(Math.max(1, blocs.length)); clT = w.time; }
      // one bloc pins the nearest working fire truck (the game's click-a-truck order)
      const live = w.trucks.filter((t) => t.state !== 'abandoned' && !t.done);
      const used = new Set();
      if (live.length && blocs.length > 1) {
        const tr = live[0];
        let best = null; for (const b of blocs) if (!best || dist(b.cx, b.cy, tr.x, tr.y) < dist(best.cx, best.cy, tr.x, tr.y)) best = b;
        if (best.truck !== tr) { w.setBlocTarget(best.id, tr.x, tr.y, null); best.truck = tr; }
        used.add(best.id);
      }
      let ci = 0;
      for (const b of blocs) {
        if (used.has(b.id)) continue;
        if (b.truck) b.truck = null;
        const c = clusters[ci++ % Math.max(1, clusters.length)];
        if (c) { const o = w.map.nearestOpen(c.x, c.y, 10); if (o) target(b.id, o.x, o.y, null); }
      }
      // radicalise where the crowd is densest inside the bloc closest to its car cluster
      if (w.energy >= 8 && ready('cass')) {
        let bb = null, bd = 1e9;
        for (const b of blocs) { if (b.n < 30 || used.has(b.id)) continue; const d = dist(b.cx, b.cy, b.tx, b.ty); if (d < bd) { bd = d; bb = b; } }
        if (bb) {
          const p = P.densAround(w, w.densP, bb.cx, bb.cy, 4);
          const n = w.convertCasseurs(p.x, p.y, 8, 20);
          if (n) { w.energy -= 8; log.casseurs++; }
          arm('cass', 2);
        }
      }
      if (ready('mob') && w.energy >= 40) { w.spawnProtesters(800, false); w.energy -= 15; arm('mob', 30); log.mobilise++; }
    }

    // ---------------- police helpers ----------------
    function auth(n) { if (w.authority < n) return false; w.authority -= n; return true; }
    function trucks(reserve) {
      const cars = w.map.cars;
      const burning = cars.filter((c) => c.state === 1 && !w.trucks.some((t) => t.car === c.id || (t.sprayAt === c && t.state === 'spray')));
      burning.sort((a, b) => b.near.length - a.near.length || a.id - b.id);
      for (const c of burning) {
        if (w.trucksOut >= w.trucksMax || w.authority < reserve + 4) break;
        if (w.dispatchTruck(c)) { w.authority -= 4; log.trucks++; }
      }
    }
    function freeSquads() { return w.squads.filter((s) => s.n > 0 && !(s.charge > 0)); }
    function charge(sq, x, y) { if (!auth(5)) return false; w.orderSquad(sq, x, y, true, true); log.charges++; return true; }
    function rescueTrucks() {
      for (const tr of w.trucks) {
        if (!(tr.sur > 1 || tr.state === 'abandoned')) continue;
        if (w.squads.some((s) => s.charge > 0 && dist(s.cx, s.cy, tr.x, tr.y) < 6)) continue;
        const fs = freeSquads(); if (!fs.length) return;
        const sq = fs.reduce((a, s) => (dist(s.mx, s.my, tr.x, tr.y) < dist(a.mx, a.my, tr.x, tr.y) ? s : a));
        charge(sq, tr.x, tr.y);
      }
    }
    function chargeClusters(maxN, min, reserve) {
      const cl = topCells(w.densC, maxN, 1, 14, min);
      for (const c of cl) {
        if (w.authority < reserve + 5) break;
        const fs = freeSquads(); if (!fs.length) break;
        const sq = fs.reduce((a, s) => (dist(s.mx, s.my, c.x, c.y) < dist(a.mx, a.my, c.x, c.y) ? s : a));
        if (dist(sq.mx, sq.my, c.x, c.y) > 90) continue;
        charge(sq, c.x, c.y);
      }
    }
    function reinforce(atLeast) {
      if (ready('reinf') && w.authority >= atLeast) { w.authority -= 30; const sq = w.addSquad(w.squadSize); arm('reinf', 20); if (sq) log.reinforce++; return sq; }
      return null;
    }

    // ---------------- police: hold ----------------
    function strongHold() {
      const lm = lms[obj.lm || 0];
      trucks(14);
      rescueTrucks();
      reinforce(45);
      // casseurs at the square: charge them
      const near = topCells(w.densC, 2, 1, 12, 4).filter((c) => dist(c.x, c.y, lm.x, lm.y) < lm.r + 25);
      for (const c of near) {
        const fs = freeSquads(); if (fs.length < 2 || w.authority < 15) break;
        const sq = fs.reduce((a, s) => (dist(s.mx, s.my, c.x, c.y) < dist(a.mx, a.my, c.x, c.y) ? s : a));
        charge(sq, c.x, c.y);
      }
      // every free squad in an arc inside the square, facing the blocs that are coming (split by bloc size)
      const threats = w.blocs.filter((b) => b.n >= 20 && dist(b.cx, b.cy, lm.x, lm.y) < 140).sort((a, b) => b.n - a.n).slice(0, 2);
      const fs = freeSquads();
      const groups = threats.length ? threats.map(() => []) : [[]];
      if (threats.length === 2) {
        const share = threats[0].n / (threats[0].n + threats[1].n);
        const n0 = Math.max(1, Math.min(fs.length - 1, Math.round(fs.length * share)));
        fs.forEach((s, i) => groups[i < n0 ? 0 : 1].push(s));
      } else fs.forEach((s) => groups[0].push(s));
      groups.forEach((g, gi) => {
        const t = threats[gi];
        const base = t ? Math.atan2(t.cy - lm.y, t.cx - lm.x) : Math.atan2(w.map.H / 2 - lm.y, w.map.W / 2 - lm.x);
        g.forEach((sq, j) => {
          const a = base + (j - (g.length - 1) / 2) * 0.55;
          const rr = Math.max(2, lm.r * 0.7);
          const gx = lm.x + Math.cos(a) * rr, gy = lm.y + Math.sin(a) * rr;
          if (dist(gx, gy, sq.ax, sq.ay) > 5) { w.orderSquad(sq, gx, gy, false, true); log.lines++; }
        });
      });
      // gas the densest crowd pressing on the square
      if (ready('gas') && w.authority >= 10) {
        const p = P.densAround(w, w.densP, lm.x, lm.y, Math.ceil((lm.r + 14) / P.CS));
        const blk = P.densAround(w, w.densP, p.x, p.y, 1).sum;
        if (blk > 25 * w.scale) {
          const sq = w.squads.reduce((a, s) => (dist(s.ax, s.ay, p.x, p.y) < dist(a.ax, a.ay, p.x, p.y) ? s : a));
          if (dist(sq.ax, sq.ay, p.x, p.y) <= 40) { w.throwGas(sq.ax, sq.ay, p.x, p.y); w.authority -= 10; arm('gas', 3); log.gas++; }
        }
      }
    }
    // ---------------- police: limit (keep burns under n) ----------------
    function strongLimit() {
      trucks(0);
      rescueTrucks();
      chargeClusters(3, 3, 6);
    }
    // ---------------- police: arrest ----------------
    function strongArrest() {
      rescueTrucks();
      chargeClusters(6, 2, 0);
      trucks(5);
      reinforce(60);
    }

    // ---------------- naive ----------------
    function naiveProtestInit() {
      const lm = lms[(obj && obj.lm) || 0];
      w.blocs.forEach((b) => w.setBlocTarget(b.id, lm.x, lm.y, lm.id));
    }
    function naiveProtestRetarget() {
      const free = lms.filter((l) => l.owner !== 'protest');
      if (free.length) w.blocs.forEach((b) => w.setBlocTarget(b.id, free[0].x, free[0].y, free[0].id));
    }
    function naivePolice() {
      if (obj.type === 'hold') { const lm = lms[obj.lm || 0]; for (const sq of w.squads) w.orderSquad(sq, lm.x, lm.y, false, true); return; }
      const x = w.protCx, y = w.protCy; if (x == null) return;
      if (obj.type === 'arrest') { for (const sq of w.squads) charge(sq, x, y); return; }
      for (const sq of w.squads) w.orderSquad(sq, x, y, false, true);
    }
    let farLm = null;
    function farInit() {
      const o = lms[obj.lm || 0];
      farLm = lms.reduce((a, l) => (dist(l.x, l.y, o.x, o.y) > dist(a.x, a.y, o.x, o.y) ? l : a));
      w.blocs.forEach((b) => w.setBlocTarget(b.id, farLm.x, farLm.y, farLm.id));
    }

    return {
      policy, log,
      pre(s) {
        if (policy === 'idle') return;
        if (policy === 'naive') {
          if (s === 0) { if (protest) naiveProtestInit(); else naivePolice(); }
          return;
        }
        if (policy === 'far') { if (s === 0) farInit(); return; }
        if (policy === 'strong' && s % 30 === 0 && w.time >= 0.5) {
          if (protest) { if (obj.type === 'burn') strongBurn(); else strongCapture(); }
          else if (obj.type === 'hold') strongHold();
          else if (obj.type === 'limit') strongLimit();
          else if (obj.type === 'arrest') strongArrest();
        }
        if (policy === 'strong' && s === 0 && protest) { if (obj.type === 'burn') strongBurn(); else strongCapture(); }
      },
      post(s) {
        if (s % 900 !== 899) return;
        if (policy === 'naive') { if (protest) naiveProtestRetarget(); else naivePolice(); }
        if (policy === 'far') w.blocs.forEach((b) => w.setBlocTarget(b.id, farLm.x, farLm.y, farLm.id));
      },
    };
  }
  module.exports = { createBot };
})();
