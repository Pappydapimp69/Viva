// Headless smoke test: menu loads, each level starts, sim runs, no page errors.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await p.waitForTimeout(1500);
  const out = path.join(__dirname, 'out'); require('fs').mkdirSync(out, { recursive: true });
  await p.screenshot({ path: out + '/menu.png' });
  const which = (process.argv[2] || '0,2,5').split(',').map(Number);
  for (const i of which) {
    await p.evaluate((i) => PAVE.debug.start(i), i);
    await p.waitForTimeout(1500);
    await p.evaluate(() => { PAVE.debug.setPaused(false); });
    await p.waitForTimeout(6000);
    const st = await p.evaluate(() => { const w = PAVE.debug.world; return { n: w.crowd.n, t: w.time.toFixed(1), burned: w.stats.burned }; });
    console.log('level', i, JSON.stringify(st));
    await p.screenshot({ path: out + '/level' + i + '.png' });
  }
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
