// HUD layout at phone, tablet and desktop sizes, with the tutorial coach, the
// controller hints and the mouse cursor states co-active: no two HUD panels may
// overlap and every panel must sit fully on screen.
const { chromium } = require('playwright');
const path = require('path');
const SIZES = [[412, 915, 'phone-portrait'], [915, 412, 'phone-landscape'], [740, 360, 'small-landscape'], [1024, 768, 'tablet'], [1366, 768, 'laptop'], [1920, 1080, 'desktop']];
const PANELS = ['#topLeft', '#carsBadge', '#timer', '#topRight', '#toolbar', '#squadBar', '#minimap', '#tutorial', '#phone', '#padHints'];
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  for (const [w, h, name] of SIZES) {
    for (const mode of ['police', 'tutorial-pad']) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 1000, hasTouch: w < 1000 });
      const p = await ctx.newPage();
      await p.addInitScript((pad) => {
        const g = { id: 'Pad', connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
        window.__pad = g; navigator.getGamepads = () => (pad ? [g] : []);
      }, mode === 'tutorial-pad');
      await p.goto('file://' + path.join(__dirname, '..', 'index.html'));
      await p.waitForTimeout(500);
      if (mode === 'police') await p.evaluate(() => PAVE.debug.start(2)); else await p.evaluate(() => PAVE.debug.startTutorial('protest'));
      await p.waitForFunction(() => PAVE.debug.world && PAVE.debug.screen === null, null, { timeout: 15000 });
      if (mode === 'tutorial-pad') { await p.evaluate(() => { __pad.buttons[13] = { pressed: true, value: 1 }; }); await p.waitForTimeout(150); await p.evaluate(() => { __pad.buttons[13] = { pressed: false, value: 0 }; }); }
      await p.waitForTimeout(800);
      const boxes = await p.evaluate((sel) => sel.map((s) => { const e = document.querySelector(s); if (!e || e.offsetParent === null) return null; const st = getComputedStyle(e); if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { s, x: r.left, y: r.top, w: r.width, h: r.height } : null; }).filter(Boolean), PANELS);
      const probs = [];
      for (const a of boxes) {
        if (a.x < -1 || a.y < -1 || a.x + a.w > w + 1 || a.y + a.h > h + 1) probs.push(a.s + ' off-screen');
        for (const c of boxes) {
          if (a.s >= c.s) continue;
          const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x), oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
          if (ox > 2 && oy > 2) probs.push(a.s + ' overlaps ' + c.s + ' (' + Math.round(ox) + 'x' + Math.round(oy) + ')');
        }
      }
      // the map must fill the screen (no empty bars at the default view)
      const fills = await p.evaluate(() => { const c = PAVE.debug.cam, m = PAVE.debug.world.map; return m.W * c.zoom >= innerWidth - 2 && m.H * c.zoom >= innerHeight - 2; });
      if (!fills) probs.push('map does not fill the screen');
      console.log((probs.length ? 'FAIL ' : 'ok   ') + name + ' ' + w + 'x' + h + ' ' + mode + (probs.length ? ': ' + probs.join('; ') : ''));
      if (probs.length) fail++;
      await p.screenshot({ path: path.join(__dirname, 'out', 'layout-' + name + '-' + mode + '.png') });
      await ctx.close();
    }
  }
  await b.close();
  process.exit(fail ? 1 : 0);
})();
