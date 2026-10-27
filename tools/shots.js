// Zoomed-out screenshots of each campaign level's map (visual variety check).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await p.waitForTimeout(800);
  for (const i of (process.argv[2] || '0,1,2,5').split(',').map(Number)) {
    await p.evaluate((i) => PAVE.debug.start(i), i);
    await p.waitForFunction(() => PAVE.debug.world && PAVE.debug.screen === null, null, { timeout: 15000 });
    await p.evaluate(() => { const c = PAVE.debug.cam, w = PAVE.debug.world; c.tz = c.zoom = 2.6; c.x = w.map.W / 2; c.y = w.map.H / 2; });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: path.join(__dirname, '..', 'test', 'out', 'map' + i + '.png') });
    console.log('level', i, await p.evaluate(() => PAVE.debug.world.map.style));
  }
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})();
