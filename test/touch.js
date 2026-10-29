// Touch-only play, driven by real touch events (CDP Input.dispatchTouchEvent),
// never the keyboard: taps, one-finger pan, pinch zoom, long-press, drag-to-build.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: i })) });
  const sleep = (ms) => p.waitForTimeout(ms);
  const tap = async (x, y) => { await touch('touchStart', [{ x, y }]); await sleep(60); await touch('touchEnd', []); await sleep(150); };
  const drag = async (a, c, steps = 8) => { await touch('touchStart', [a]); for (let k = 1; k <= steps; k++) { await touch('touchMove', [{ x: a.x + (c.x - a.x) * k / steps, y: a.y + (c.y - a.y) * k / steps }]); await sleep(30); } await touch('touchEnd', []); await sleep(200); };
  const ev = (fn, a) => p.evaluate(fn, a);
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const scr = (x, y) => ev(([x, y]) => { const c = PAVE.debug.cam; return { x: (x - c.x) * c.zoom + innerWidth / 2, y: (y - c.y) * c.zoom + innerHeight / 2 }; }, [x, y]);

  await p.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await sleep(700);
  // menus by tap
  const camp = await p.locator('#mainMenu [data-go=campaign]').boundingBox();
  await tap(camp.x + camp.width / 2, camp.y + camp.height / 2);
  ok(await ev(() => PAVE.debug.screen) === 'campaignMenu', 'tap opens the campaign menu');

  // protest level
  await ev(() => PAVE.debug.start(0));
  await p.waitForFunction(() => PAVE.debug.world && PAVE.debug.screen === null, null, { timeout: 15000 });
  await sleep(400);
  const c0 = await ev(() => ({ x: PAVE.debug.cam.x, z: PAVE.debug.cam.tz }));
  // pinch out
  await touch('touchStart', [{ x: 380, y: 200 }, { x: 460, y: 200 }]);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', [{ x: 380 - k * 15, y: 200 }, { x: 460 + k * 15, y: 200 }]); await sleep(30); }
  await touch('touchEnd', []); await sleep(200);
  ok(await ev((z) => PAVE.debug.cam.tz > z * 1.5, c0.z), 'pinch zooms in');
  ok(await ev(() => document.body.classList.contains('touch')), 'touch mode on');
  // one-finger pan
  const x0 = await ev(() => PAVE.debug.cam.x);
  await drag({ x: 600, y: 200 }, { x: 300, y: 220 });
  ok(await ev((x) => Math.abs(PAVE.debug.cam.x - x) > 5, x0), 'one-finger drag pans');
  // tap a landmark to march
  const lm = await ev(() => { const l = PAVE.debug.world.map.landmarks[1]; PAVE.debug.cam.x = l.x; PAVE.debug.cam.y = l.y; return { x: l.x, y: l.y, id: l.id }; });
  await sleep(200);
  const s1 = await scr(lm.x, lm.y);
  await tap(s1.x, s1.y);
  ok(await ev((id) => PAVE.debug.world.blocs[0].target === id, lm.id), 'tap marches the bloc to the square');
  // toolbar by tap, then drag to build a barricade near the crowd
  const tb = await p.locator('#tool_barricade').boundingBox();
  await tap(tb.x + tb.width / 2, tb.y + tb.height / 2);
  ok(await ev(() => PAVE.debug.tool) === 'barricade', 'tap selects a toolbar tool');
  // a street near the crowd whose both ends are on open map (not under the HUD) on this small screen
  const cands = await ev(() => { const w = PAVE.debug.world, m = w.map, out = [];
    for (let i = 0; i < w.crowd.n && out.length < 40; i += 97) { if (w.crowd.kind[i] !== 0) continue; const o = m.nearestOpen(w.crowd.x[i], w.crowd.y[i], 3); if (!o) continue; const cl = m.crossLine(o.x, o.y, 14);
      if (cl.span > 6 && cl.span < 20) out.push([{ x: o.x - cl.ux * (cl.a + 1.5), y: o.y - cl.uy * (cl.a + 1.5) }, { x: o.x + cl.ux * (cl.b + 1.5), y: o.y + cl.uy * (cl.b + 1.5) }, o]); }
    return out; });
  const n0 = await ev(() => PAVE.debug.world.barrGroups.length);
  let line = null;
  for (const [a0, c0, o] of cands) {
    await ev((o) => { PAVE.debug.cam.x = o.x; PAVE.debug.cam.y = o.y; }, o); await sleep(150);
    const a = await scr(a0.x, a0.y), c = await scr(c0.x, c0.y);
    const free = await ev(([a, c]) => [a, c].every((q) => { const e = document.elementFromPoint(q.x, q.y); return e && e.id === 'view'; }), [a, c]);
    if (free) { line = [a0, c0]; await drag(a, c); break; }
  }
  ok(await ev((n) => PAVE.debug.world.barrGroups.length > n, n0), 'drag builds a barricade with that tool (' + await ev(() => document.getElementById('tip').textContent) + ', line ' + JSON.stringify(line) + ')');
  // long-press goes back to March
  await touch('touchStart', [{ x: 400, y: 200 }]); await sleep(650); await touch('touchEnd', []); await sleep(150);
  ok(await ev(() => PAVE.debug.tool) === 'march', 'long-press returns to March');
  // pause / speed buttons by tap
  const sp = await p.locator('#btnSpeed').boundingBox();
  await tap(sp.x + sp.width / 2, sp.y + sp.height / 2);
  ok((await p.locator('#btnSpeed').textContent()).trim() === '2×', 'tap the speed button');
  await p.screenshot({ path: path.join(__dirname, 'out', 'touch-protest.png') });

  // police level: tap a squad to select, long-press to place its line
  await ev(() => PAVE.debug.start(2));
  await p.waitForFunction(() => PAVE.debug.world && PAVE.debug.world.side === 'police' && PAVE.debug.screen === null, null, { timeout: 15000 });
  await sleep(500);
  const sq = await ev(() => { const w = PAVE.debug.world, q = w.squads[2]; PAVE.debug.cam.x = q.mx; PAVE.debug.cam.y = q.my; PAVE.debug.cam.tz = PAVE.debug.cam.zoom = 5; return { x: q.mx, y: q.my }; });
  await sleep(250);
  const s2 = await scr(sq.x, sq.y);
  await tap(s2.x, s2.y);
  ok(await ev(() => PAVE.debug.selSquad) === 2, 'tap selects a squad');
  const dest = await ev(() => { const w = PAVE.debug.world, q = w.squads[2], m = w.map; for (let r = 20; r < 60; r += 4) for (let a = 0; a < 6.28; a += 0.5) { const x = q.ax + Math.cos(a) * r, y = q.ay + Math.sin(a) * r; if (m.walkable(x, y) && w.squads.every((s) => Math.hypot(s.mx - x, s.my - y) > 12)) { PAVE.debug.cam.x = x; PAVE.debug.cam.y = y; return { x, y, ax: q.ax }; } } return null; });
  await sleep(250);
  const s3 = await scr(dest.x, dest.y);
  await touch('touchStart', [s3]); await sleep(650); await touch('touchEnd', []); await sleep(200);
  ok(await ev((ax) => Math.abs(PAVE.debug.world.squads[2].ax - ax) > 3, dest.ax), 'long-press places the selected squad\'s line');

  // tutorial speaks touch
  await ev(() => PAVE.debug.startTutorial('protest'));
  await p.waitForFunction(() => PAVE.debug.tut && PAVE.debug.screen === null, null, { timeout: 15000 });
  await tap(400, 200);
  await sleep(300);
  const tt = await ev(() => ({ dev: document.querySelector('#tutorial .tutDev').textContent, text: document.querySelector('#tutorial .tutText').textContent }));
  ok(/Touch/.test(tt.dev) && /[Pp]inch/.test(tt.text), 'tutorial shows touch instructions: ' + tt.text.slice(0, 60));
  await p.screenshot({ path: path.join(__dirname, 'out', 'touch-tutorial.png') });
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
