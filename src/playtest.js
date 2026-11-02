// Playtest recorder. Off unless the URL has ?playtest or Settings turns it on.
// Records what the player asked for and whether the crowd visibly did it, plus a tiny
// end-of-level survey, then packs it into a short text report the tester can paste anywhere.
// (Brain: keep the export short enough to paste; store aggregates, not raw event streams.)
(function () {
  const P = globalThis.PAVE;

  function Playtest() { this.run = null; this.history = []; }

  Playtest.prototype.begin = function (world, lv, device) {
    this.run = {
      level: lv.id, side: world.side, device, t0: world.time,
      orders: {}, nOrders: 0, rejects: {}, repeats: 0, selects: 0, tools: 0, pauses: 0,
      fast: 0, slow: 0, slowMoves: [], pending: [], last: null,
      lastAct: 0, gaps: [], devices: {},
    };
  };

  // the player did something on purpose: closes an idle gap
  Playtest.prototype.act = function (world, device) {
    const r = this.run; if (!r) return;
    const gap = world.time - r.lastAct;
    if (gap > 20) r.gaps.push(gap);
    r.lastAct = world.time;
    if (device) r.devices[device] = (r.devices[device] || 0) + 1;
  };

  // an order that should make a bloc or squad walk somewhere: watch whether it does
  Playtest.prototype.order = function (world, kind, x, y, who, device) {
    const r = this.run; if (!r) return;
    this.act(world, device);
    r.orders[kind] = (r.orders[kind] || 0) + 1; r.nOrders++;
    const l = r.last;
    if (l && l.kind === kind && world.time - l.t < 6 && Math.hypot(l.x - x, l.y - y) < 10) r.repeats++;
    r.last = { kind, x, y, t: world.time };
    if (who) {
      const p = pos(world, who);
      if (p) r.pending.push({ who, x, y, t: world.time, d0: Math.hypot(p.x - x, p.y - y) });
    }
  };
  Playtest.prototype.reject = function (world, why) {
    const r = this.run; if (!r) return;
    this.act(world);
    r.rejects[why] = (r.rejects[why] || 0) + 1;
  };
  Playtest.prototype.count = function (world, what) {
    const r = this.run; if (!r) return;
    this.act(world);
    r[what]++;
  };

  function pos(world, who) {
    if (who.bloc != null) { const b = world.blocs[who.bloc]; return b && b.n ? { x: b.cx, y: b.cy } : null; }
    const s = world.squads[who.squad]; return s && s.mx != null ? { x: s.mx, y: s.my } : null;
  }

  // 3 s after an order: how far did the group's centre close on the spot? Under 1 tile reads as "nothing happened"
  // (already standing there counts as done)
  Playtest.prototype.update = function (world) {
    const r = this.run; if (!r || !r.pending.length) return;
    r.pending = r.pending.filter((o) => {
      if (world.time - o.t < 3) return true;
      const p = pos(world, o.who);
      if (!p) return false;
      const d = Math.hypot(p.x - o.x, p.y - o.y), moved = o.d0 - d;
      if (o.d0 >= 6) r.slowMoves.push(moved);
      if (o.d0 < 6 || moved >= 1) r.fast++; else r.slow++;
      return false;
    });
  };

  Playtest.prototype.finish = function (world, result) {
    const r = this.run; if (!r) return null;
    this.update(world);
    if (world.time - r.lastAct > 20) r.gaps.push(world.time - r.lastAct);
    r.result = result; r.time = world.time; r.limit = world.timeLimit;
    r.stats = { burned: world.stats.burned, arrests: world.stats.arrests, captures: world.stats.captures };
    this.run = null;
    this.history.push(r);
    if (this.history.length > 20) this.history.shift();
    return r;
  };

  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ×' + v).join(', ') || 'none';
  const med = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

  Playtest.prototype.report = function (r, build) {
    const res = r.result;
    const out = [
      'PAVÉ playtest · ' + (build || '') + ' · ' + r.level + ' · ' + r.side + ' · ' + (Object.keys(r.devices).join('+') || r.device),
      'result: ' + (res.quit ? 'quit' : res.win ? 'win ' + '★'.repeat(res.stars) : 'loss') + ' at ' + P.fmtTime(r.time) + ' of ' + P.fmtTime(r.limit)
        + ' · burned ' + r.stats.burned + ' · arrests ' + r.stats.arrests + ' · squares ' + r.stats.captures,
      'orders: ' + r.nOrders + ' (' + top(r.orders) + ') · refused: ' + top(r.rejects),
      'visibly moved within 3 s: ' + r.fast + '/' + (r.fast + r.slow) + (r.slowMoves.length ? ' · median ' + med(r.slowMoves).toFixed(1) + ' tiles closer' : ''),
      'same order repeated within 6 s: ' + r.repeats + ' · selects ' + r.selects + ' · tool changes ' + r.tools + ' · pauses ' + r.pauses,
      'idle gaps >20 s: ' + r.gaps.length + (r.gaps.length ? ' (longest ' + Math.round(Math.max(...r.gaps)) + ' s)' : ''),
    ];
    if (r.survey) out.push('survey: orders did what I meant ' + (r.survey.orders || '-') + '/5 · could tell what was happening ' + (r.survey.clear || '-') + '/5'
      + (r.survey.note ? ' · "' + r.survey.note.replace(/\s+/g, ' ').slice(0, 400) + '"' : ''));
    return out.join('\n');
  };

  P.Playtest = Playtest;
})();
