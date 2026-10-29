// Drives the real page with a fake standard-mapping gamepad.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    const pad = { id: 'Fake Xbox Controller (STANDARD GAMEPAD)', connected: true, mapping: 'standard',
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
    window.__pad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  });
  await p.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await p.waitForTimeout(800);
  const until = async (fn, arg, ms = 4000) => { await p.waitForFunction(fn, arg, { timeout: ms }); };
  // hold a button across several frames, then release (an instant tap can fall between polls)
  const tap = async (i) => {
    await p.evaluate((i) => { __pad.buttons[i] = { pressed: true, value: 1 }; }, i);
    await p.waitForTimeout(120);
    await p.evaluate((i) => { __pad.buttons[i] = { pressed: false, value: 0 }; }, i);
    await p.waitForTimeout(120);
  };
  const steer = async (x, y) => {
    for (let k = 0; k < 150; k++) {
      const o = await p.evaluate(([x, y]) => { const c = PAVE.debug.cam, r = PAVE.debug.reticle; return { dx: (x - r.x) * c.zoom, dy: (y - r.y) * c.zoom }; }, [x, y]);
      const d = Math.hypot(o.dx, o.dy); if (d < 5) break;
      const m = Math.min(1, Math.max(0.28, d / 260));
      await p.evaluate(([a, b]) => { __pad.axes = [a, b, 0, 0]; }, [o.dx / d * m, o.dy / d * m]); await p.waitForTimeout(40);
    }
    await p.evaluate(() => { __pad.axes = [0, 0, 0, 0]; }); await p.waitForTimeout(150);
  };
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

  await tap(13); // any press activates pad mode + focuses the primary menu button
  await until(() => PAVE.debug.lastInput === 'pad' && PAVE.debug.padFocus);
  ok(await p.evaluate(() => PAVE.debug.padFocus.textContent.trim()) === 'CAMPAIGN', 'first press lands on the primary button: ' + await p.evaluate(() => PAVE.debug.padFocus.textContent.trim()));
  // go to top (CAMPAIGN) and press A
  for (let i = 0; i < 6; i++) await tap(12);
  ok(/^TUTORIAL/.test(await p.evaluate(() => PAVE.debug.padFocus.textContent.trim())), 'D-pad up reaches TUTORIAL at the top');
  await tap(13);
  ok(await p.evaluate(() => PAVE.debug.padFocus.textContent.trim()) === 'CAMPAIGN', 'D-pad down reaches CAMPAIGN');
  await tap(0);
  await until(() => PAVE.debug.screen === 'campaignMenu');
  ok(true, 'A opens the campaign');
  await tap(1);
  await until(() => PAVE.debug.screen === 'mainMenu');
  ok(true, 'B goes back');
  // settings: change crowd density with left/right on a select
  for (let i = 0; i < 3; i++) await tap(13);
  const lbl = await p.evaluate(() => PAVE.debug.padFocus.textContent.trim());
  ok(lbl === 'SETTINGS', 'down x3 reaches SETTINGS (' + lbl + ')');
  await tap(0); await until(() => PAVE.debug.screen === 'settingsMenu');
  const status = await p.evaluate(() => document.getElementById('padStatus').textContent);
  ok(/Fake Xbox/.test(status), 'settings shows the controller: ' + status);
  await tap(1); await until(() => PAVE.debug.screen === 'mainMenu');

  // start a police level directly and play with the pad
  await p.evaluate(() => PAVE.debug.start(2));
  await until(() => PAVE.debug.world && PAVE.debug.screen === null, null, 8000);
  await p.waitForTimeout(300);
  await tap(13); // re-assert pad mode in game
  ok(await p.evaluate(() => !document.getElementById('padCursor').classList.contains('hidden')), 'reticle visible in game');
  const r0 = await p.evaluate(() => PAVE.debug.reticle.x);
  await p.evaluate(() => { __pad.axes = [0.9, 0, 0, 0]; }); await p.waitForTimeout(400); await p.evaluate(() => { __pad.axes = [0, 0, 0, 0]; });
  ok(await p.evaluate((c) => PAVE.debug.reticle.x > c + 2, r0), 'left stick moves the view / reticle');
  // RB cycles tool
  const t0 = await p.evaluate(() => PAVE.debug.tool); await tap(5); const t1 = await p.evaluate(() => PAVE.debug.tool);
  ok(t0 !== t1, 'RB changes tool ' + t0 + ' -> ' + t1);
  await tap(4); ok(await p.evaluate(() => PAVE.debug.tool) === t0, 'LB goes back');
  await tap(5); await tap(1); ok(await p.evaluate(() => PAVE.debug.tool) === 'move', 'B cancels back to the default tool');
  // reticle snaps onto a squad, A selects it
  const tsq = await p.evaluate(() => { const w = PAVE.debug.world, i = (PAVE.debug.selSquad + 1) % w.squads.length, sq = w.squads[i]; return { i, x: sq.mx, y: sq.my }; });
  const target = tsq.i;
  await steer(tsq.x + 0.5, tsq.y);
  ok(await p.evaluate(() => PAVE.debug.padSnap && PAVE.debug.padSnap.kind === 'squad'), 'reticle snaps to the squad');
  await tap(0);
  ok(await p.evaluate((t) => PAVE.debug.selSquad === t, target), 'A on a squad selects it');
  // move away and A places its line there
  const a0 = await p.evaluate(() => PAVE.debug.world.squads[PAVE.debug.selSquad].ax);
  const spot = await p.evaluate(() => { const w = PAVE.debug.world, m = w.map, sq = w.squads[PAVE.debug.selSquad];
    for (let r = 25; r < 120; r += 5) for (let a = 0; a < 6.28; a += 0.5) { const x = sq.ax + Math.cos(a) * r, y = sq.ay + Math.sin(a) * r;
      if (m.walkable(x, y) && w.squads.every((q) => Math.hypot(q.mx - x, q.my - y) > 20)) return { x, y }; } });
  await steer(spot.x, spot.y);
  await tap(0);
  const a1 = await p.evaluate(() => PAVE.debug.world.squads[PAVE.debug.selSquad].ax);
  ok(Math.abs(a0 - a1) > 5, 'A away from squads places the line there');
  // Y next squad
  const s0 = await p.evaluate(() => PAVE.debug.selSquad); await tap(3);
  ok(await p.evaluate((s0) => PAVE.debug.selSquad !== s0, s0), 'Y selects the next squad');
  // D-pad up = reinforce
  const n0 = await p.evaluate(() => PAVE.debug.world.squads.length); await p.evaluate(() => { PAVE.debug.world.authority = 100; });
  await tap(12); ok(await p.evaluate(() => PAVE.debug.world.squads.length) === n0 + 1, 'D-pad up reinforces');
  // Start pauses, B resumes
  await tap(9); await until(() => PAVE.debug.screen === 'pauseMenu'); ok(true, 'Start pauses');
  await tap(1); await until(() => PAVE.debug.screen === null); ok(true, 'B resumes');
  await p.screenshot({ path: path.join(__dirname, 'out', 'gamepad.png') });
  // protest side: A with March moves the bloc target to the cursor
  await tap(9); await until(() => PAVE.debug.screen === 'pauseMenu');
  await p.evaluate(() => PAVE.debug.start(0));
  await until(() => PAVE.debug.world && PAVE.debug.world.side === 'protest' && PAVE.debug.screen === null, null, 8000);
  await p.waitForTimeout(300);
  // aim near a landmark: the reticle snaps to it and A marches the bloc there
  const lmt = await p.evaluate(() => { const lm = PAVE.debug.world.map.landmarks[1]; return { id: lm.id, x: lm.x + 3, y: lm.y - 2 }; });
  const lmId = lmt.id;
  await steer(lmt.x, lmt.y);
  ok(await p.evaluate(() => PAVE.debug.padSnap && PAVE.debug.padSnap.kind === 'landmark'), 'reticle snaps to the landmark');
  await tap(0);
  ok(await p.evaluate((id) => PAVE.debug.world.blocs[0].target === id, lmId), 'A marches the bloc to the snapped landmark');
  await tap(5); ok(await p.evaluate(() => PAVE.debug.tool) === 'casseurs', 'RB reaches Casseurs on the protest side');
  // a panel that pops up while the stick is still held from play must not move its focus
  await p.evaluate(() => PAVE.debug.startTutorial('protest'));
  await p.waitForFunction(() => PAVE.debug.tut && PAVE.debug.screen === null, null, { timeout: 15000 });
  await tap(13);
  await p.evaluate(() => { __pad.axes = [-0.95, 0, 0, 0]; }); await p.waitForTimeout(300);
  await p.evaluate(() => { const t = PAVE.debug.tut; t.i = t.steps.length - 1; t.next(); }); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => PAVE.debug.padFocus && PAVE.debug.padFocus.id) === 'tutCampaign', 'stick held through a pop-up does not move its focus');
  await p.evaluate(() => { __pad.axes = [0, 0, 0, 0]; }); await p.waitForTimeout(200);
  await p.evaluate(() => { __pad.axes = [-0.95, 0, 0, 0]; }); await p.waitForTimeout(200); await p.evaluate(() => { __pad.axes = [0, 0, 0, 0]; }); await p.waitForTimeout(200);
  ok(await p.evaluate(() => PAVE.debug.padFocus && PAVE.debug.padFocus.id) === 'tutStay', 'a fresh push does move it');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
