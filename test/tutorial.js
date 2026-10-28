// Plays both tutorials end to end with each input device (mouse+keyboard, fake
// controller). A step that one device can't complete fails here. Usage:
//   node test/tutorial.js [protest|police] [mk|pad]
const { chromium } = require('playwright');
const path = require('path');

async function run(side, dev) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    const pad = { id: 'Fake Pad (STANDARD GAMEPAD)', connected: true, mapping: 'standard',
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
    window.__pad = pad; window.__padOn = false;
    navigator.getGamepads = () => (window.__padOn ? [pad] : []);
  });
  await p.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await p.waitForTimeout(600);
  const ev = (fn, a) => p.evaluate(fn, a);
  const sleep = (ms) => p.waitForTimeout(ms);
  const step = () => ev(() => PAVE.debug.tut && (PAVE.debug.tut.finished ? 'DONE' : PAVE.debug.tut.step().title));
  const waitStepChange = async (title, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await step()) !== title) return true; await sleep(150); } return false; };
  // --- pad helpers
  const press = (i, v) => ev(([i, v]) => { __pad.buttons[i] = { pressed: v, value: v ? 1 : 0 }; }, [i, v]);
  const tap = async (i) => { await press(i, true); await sleep(110); await press(i, false); await sleep(110); };
  const axes = (a) => ev((a) => { __pad.axes = a; }, a);
  const steerTo = async (x, y) => {
    for (let k = 0; k < 120; k++) {
      const o = await ev(([x, y]) => { const c = PAVE.debug.cam; return { dx: (x - c.x) * c.zoom, dy: (y - c.y) * c.zoom }; }, [x, y]);
      const d = Math.hypot(o.dx, o.dy);
      if (d < 6) break;
      const m = Math.min(1, Math.max(0.28, d / 260));
      await axes([o.dx / d * m, o.dy / d * m, 0, 0]); await sleep(50);
    }
    await axes([0, 0, 0, 0]); await sleep(120);
  };
  const toolUntil = async (id) => { for (let k = 0; k < 8 && (await ev(() => PAVE.debug.tool)) !== id; k++) await tap(5); };
  // --- mouse helpers (camera is centred on the target first; step 1 already tested camera input)
  const centre = (x, y) => ev(([x, y]) => { const c = PAVE.debug.cam; c.x = x; c.y = y; }, [x, y]);
  const W = 1600, H = 900;
  // the game clamps the camera at map edges, so click wherever the target actually is on screen
  const clickAt = async (x, y, button) => {
    await centre(x, y); await sleep(150);
    const s = await ev(([x, y]) => { const c = PAVE.debug.cam; return { x: (x - c.x) * c.zoom + 800, y: (y - c.y) * c.zoom + 450 }; }, [x, y]);
    await p.mouse.move(s.x + 3, s.y + 3); await p.mouse.move(s.x, s.y); await p.mouse.click(s.x, s.y, { button: button || 'left' }); await sleep(150);
  };
  const target = () => ev(() => PAVE.debug.tut.target());
  const act = async (t) => { if (dev === 'pad') { await steerTo(t.x, t.y); await tap(0); } else await clickAt(t.x, t.y); };
  const line = async (a, bb) => {
    if (dev === 'pad') { await steerTo(a.x, a.y); await press(0, true); await sleep(120); await steerTo(bb.x, bb.y); await press(0, false); await sleep(200); return; }
    await centre((a.x + bb.x) / 2, (a.y + bb.y) / 2); await sleep(150);
    const s = await ev(([a, b]) => { const c = PAVE.debug.cam, f = (q) => ({ x: (q.x - c.x) * c.zoom + 800, y: (q.y - c.y) * c.zoom + 450 }); return [f(a), f(b)]; }, [a, bb]);
    await p.mouse.move(s[0].x, s[0].y); await p.mouse.down(); await p.mouse.move(s[1].x, s[1].y, { steps: 6 }); await p.mouse.up(); await sleep(200);
  };
  const streetAcross = (near) => ev((n) => {
    const m = PAVE.debug.world.map;
    for (let r = 4; r < 60; r += 2) for (let a = 0; a < 6.28; a += 0.4) {
      const o = m.nearestOpen(n.x + Math.cos(a) * r, n.y + Math.sin(a) * r, 3); if (!o) continue;
      const cl = m.crossLine(o.x, o.y, 14); if (cl.span > 6 && cl.span < 20) return [{ x: o.x - cl.ux * (cl.a + 1.5), y: o.y - cl.uy * (cl.a + 1.5) }, { x: o.x + cl.ux * (cl.b + 1.5), y: o.y + cl.uy * (cl.b + 1.5) }];
    }
    return null;
  }, near);
  const key = (k) => p.keyboard.press(k);

  if (dev === 'pad') { await ev(() => { window.__padOn = true; }); }
  await ev((s) => PAVE.debug.startTutorial(s), side);
  await p.waitForFunction(() => PAVE.debug.tut && PAVE.debug.screen === null, null, { timeout: 15000 });
  await sleep(500);
  if (dev === 'pad') { await tap(13); await sleep(200); }
  const log = [];
  for (let guard = 0; guard < 20; guard++) {
    const title = await step();
    if (title === 'DONE') break;
    const devShown = await ev(() => document.querySelector('#tutorial .tutDev').textContent);
    const t = await target();
    const w = (fn) => ev(fn);
    switch (title) {
      case 'Look around': if (dev === 'pad') { await axes([0.9, 0, 0, 0]); await sleep(700); await axes([0, 0, 0, 0]); } else { await p.keyboard.down('d'); await sleep(700); await p.keyboard.up('d'); } break;
      case 'Zoom': if (dev === 'pad') { await press(7, true); await sleep(800); await press(7, false); } else { await p.mouse.move(800, 450); for (let k = 0; k < 6; k++) { await p.mouse.wheel(0, -200); await sleep(60); } } break;
      case 'This is your bloc': case 'Momentum is everything': case 'Authority': await sleep(450); if (dev === 'pad') await tap(0); else await key('Enter'); break;
      case 'March on the square': case 'Radicalise': case 'Select a squad': case 'Charge the casseurs': case 'Call the pompiers':
        if (title === 'Charge the casseurs') { if (dev === 'pad') await toolUntil('charge'); else await key('c'); }
        if (title === 'Call the pompiers') { if (dev === 'pad') await toolUntil('truck'); else await key('f'); }
        await act(t); break;
      case 'Take the square': case 'Fire spreads':
        if (dev === 'pad') { await tap(8); await tap(8); } else { await key('Tab'); await key('Tab'); }
        await waitStepChange(title, 150000);
        if (dev === 'pad') await tap(8); else await key('Tab');
        break;
      case 'Pick a tool': if (dev === 'pad') await toolUntil('casseurs'); else await key('2'); break;
      case 'Fireworks vs shields': if (dev === 'pad') await toolUntil('fireworks'); else await key('3'); await act(t); break;
      case 'Form a line': if (dev === 'pad') await act(t); else await clickAt(t.x, t.y, 'right'); break;
      case 'Tear gas': {
        if (dev === 'pad') await toolUntil('gas'); else await key('g');
        const g = await w(() => { const wd = PAVE.debug.world, sq = wd.squads[1]; return { x: sq.ax + sq.nx * 10, y: sq.ay + sq.ny * 10 }; });
        await act(g); break;
      }
      case 'Build a barricade': case 'Close a street': {
        if (dev === 'pad') await toolUntil(title === 'Build a barricade' ? 'barricade' : 'barrier'); else await key(title === 'Build a barricade' ? '4' : 'b');
        const near = await w(() => { const wd = PAVE.debug.world, b = wd.blocs[0]; return wd.side === 'protest' ? { x: b.cx, y: b.cy } : { x: wd.squads[1].ax, y: wd.squads[1].ay }; });
        const l = await streetAcross(near);
        if (l) await line(l[0], l[1]); break;
      }
      case 'Call for backup': case 'Reinforcements': if (dev === 'pad') await tap(12); else await key(side === 'protest' ? '5' : 'r'); break;
    }
    const moved = await waitStepChange(title, 6000);
    log.push((moved ? 'ok   ' : 'FAIL ') + side + '/' + dev + '  ' + title + '  [' + devShown + ']');
    if (!moved) break;
  }
  const fin = await ev(() => ({ done: !!(PAVE.debug.tut && PAVE.debug.tut.finished), saved: JSON.parse(localStorage.getItem('pave.progress') || '{}').tut }));
  log.push((fin.done ? 'ok   ' : 'FAIL ') + side + '/' + dev + '  finished, saved ' + JSON.stringify(fin.saved));
  await p.screenshot({ path: path.join(__dirname, 'out', 'tut-' + side + '-' + dev + '.png') });
  if (errs.length) log.push('FAIL page errors: ' + errs.join(' | '));
  await b.close();
  return log;
}

(async () => {
  const sides = process.argv[2] ? [process.argv[2]] : ['protest', 'police'];
  const devs = process.argv[3] ? [process.argv[3]] : ['mk', 'pad'];
  let fail = false;
  for (const s of sides) for (const d of devs) { const log = await run(s, d); log.forEach((l) => { console.log(l); if (l.startsWith('FAIL')) fail = true; }); }
  process.exit(fail ? 1 : 0);
})();
