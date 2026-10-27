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
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

  await tap(13); // any press activates pad mode + focuses the primary menu button
  await until(() => PAVE.debug.lastInput === 'pad' && PAVE.debug.padFocus);
  ok(await p.evaluate(() => PAVE.debug.padFocus.textContent.trim()) === 'CAMPAIGN', 'first press lands on the primary button: ' + await p.evaluate(() => PAVE.debug.padFocus.textContent.trim()));
  // go to top (CAMPAIGN) and press A
  for (let i = 0; i < 6; i++) await tap(12);
  ok(await p.evaluate(() => PAVE.debug.padFocus.textContent.trim()) === 'CAMPAIGN', 'D-pad up reaches CAMPAIGN');
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
  ok(await p.evaluate(() => !document.getElementById('padCursor').classList.contains('hidden')), 'cursor visible in game');
  const c0 = await p.evaluate(() => document.getElementById('padCursor').style.transform);
  await p.evaluate(() => { __pad.axes = [0.9, 0, 0, 0]; }); await p.waitForTimeout(400); await p.evaluate(() => { __pad.axes = [0, 0, 0, 0]; });
  const c1 = await p.evaluate(() => document.getElementById('padCursor').style.transform);
  ok(c0 !== c1, 'left stick moves the cursor');
  // RB cycles tool
  const t0 = await p.evaluate(() => PAVE.debug.tool); await tap(5); const t1 = await p.evaluate(() => PAVE.debug.tool);
  ok(t0 !== t1, 'RB changes tool ' + t0 + ' -> ' + t1);
  await tap(4); ok(await p.evaluate(() => PAVE.debug.tool) === t0, 'LB goes back');
  // Y next squad, B orders it to the cursor
  const s0 = await p.evaluate(() => PAVE.debug.selSquad); await tap(3);
  ok(await p.evaluate((s0) => PAVE.debug.selSquad !== s0, s0), 'Y selects the next squad');
  const a0 = await p.evaluate(() => { const w = PAVE.debug.world; return w.squads[PAVE.debug.selSquad].ax; });
  await p.evaluate(() => { __pad.axes = [-0.8, 0.5, 0, 0]; }); await p.waitForTimeout(300); await p.evaluate(() => { __pad.axes = [0, 0, 0, 0]; });
  await tap(1);
  const a1 = await p.evaluate(() => { const w = PAVE.debug.world; return w.squads[PAVE.debug.selSquad].ax; });
  ok(a0 !== a1, 'B orders the selected squad to the cursor');
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
  const tx0 = await p.evaluate(() => PAVE.debug.world.blocs[0].tx);
  await p.evaluate(() => { __pad.axes = [0.7, -0.3, 0, 0]; }); await p.waitForTimeout(300); await p.evaluate(() => { __pad.axes = [0, 0, 0, 0]; });
  await tap(0);
  ok(await p.evaluate((tx0) => PAVE.debug.world.blocs[0].tx !== tx0, tx0), 'A sends the bloc to the cursor');
  await tap(5); ok(await p.evaluate(() => PAVE.debug.tool) === 'casseurs', 'RB reaches Casseurs on the protest side');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
