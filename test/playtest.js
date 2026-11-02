// Playtest recorder: with ?playtest, a level logs orders and refusals, the end card shows the survey,
// and COPY PLAYTEST REPORT yields a short paste-able report. Without the flag nothing shows.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  const url = 'file://' + path.join(__dirname, '..', 'index.html');
  const errs = [];
  async function page(q) {
    const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(url + q); await p.waitForTimeout(1200);
    await p.evaluate(() => localStorage.clear());
    return p;
  }

  const p = await page('?playtest');
  await p.evaluate(() => PAVE.debug.start(0));
  await p.waitForFunction(() => PAVE.debug.world && PAVE.debug.screen === null, null, { timeout: 10000 });
  await p.evaluate(() => PAVE.debug.setPaused(false));
  // a march at the first landmark, the same order again at once (a repeat), and one into a building (refused)
  await p.evaluate(() => {
    const w = PAVE.debug.world, lm = w.map.landmarks[0];
    PAVE.debug.pickTool('march');
    PAVE.debug.primary(lm.x, lm.y); PAVE.debug.primary(lm.x + 1, lm.y);
    const m = w.map; let bx = -1, by = -1;
    for (let y = 2; y < m.H - 2 && bx < 0; y += 3) for (let x = 2; x < m.W - 2; x += 3) if (!m.nearestOpen(x, y, 10)) { bx = x; by = y; break; }
    if (bx >= 0) PAVE.debug.primary(bx, by);
  });
  await p.waitForFunction(() => PAVE.debug.world.time > 5, null, { timeout: 30000 });
  await p.evaluate(() => PAVE.debug.world.finish(true, 'test'));
  await p.waitForFunction(() => PAVE.debug.screen === 'endScreen', null, { timeout: 5000 });
  ok(await p.isVisible('#ptSurvey'), 'end card shows the playtest survey');
  await p.click('.pts[data-q=orders] button:nth-child(4)');
  await p.click('.pts[data-q=clear] button:nth-child(2)');
  await p.fill('#ptNote', 'lost track of bloc B');
  await p.click('#ptCopy');
  const rep = await p.inputValue('#ptOut');
  console.log(rep.split('\n').map((l) => '     | ' + l).join('\n'));
  ok(/orders: 2 \(march ×2\)/.test(rep), 'counts the two marches');
  ok(/same order repeated within 6 s: 1/.test(rep), 'flags the instant repeat');
  ok(/refused: Can't march into a building ×1$/m.test(rep), 'logs only the refused order, not tool hints');
  ok(/visibly moved within 3 s: 2\/2 · median [\d.]+ tiles closer/.test(rep), 'measures how far the bloc moved');
  ok(/survey: orders did what I meant 4\/5 · could tell what was happening 2\/5 · "lost track of bloc B"/.test(rep), 'survey answers in the report');
  ok(rep.length < 1500, 'report short enough to paste (' + rep.length + ' chars)');
  // it survives a reload and shows up under Settings
  await p.reload(); await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('[data-go=settings]').click());
  await p.click('#setPtCopy');
  ok(/march ×2/.test(await p.inputValue('#setPtOut')), 'Settings copies saved reports after a reload');
  await p.close();

  const q = await page('');
  await q.evaluate(() => PAVE.debug.start(0));
  await q.waitForFunction(() => PAVE.debug.world && PAVE.debug.screen === null, null, { timeout: 10000 });
  await q.evaluate(() => PAVE.debug.world.finish(true, 'test'));
  await q.waitForFunction(() => PAVE.debug.screen === 'endScreen', null, { timeout: 5000 });
  ok(!(await q.isVisible('#ptSurvey')), 'no survey without the flag');
  await q.close();

  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
  process.exit(fails ? 1 : 0);
})();
