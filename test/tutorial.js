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
  // steer the centred reticle onto a point; pass track=true to follow the tutorial's
  // (possibly moving) target each frame, like a player chasing a truck
  const steerTo = async (x, y, track) => {
    for (let k = 0; k < 120; k++) {
      if (track) { const tt = await ev(() => PAVE.debug.tut.target()); if (tt) { x = tt.x; y = tt.y; } }
      const o = await ev(([x, y]) => { const c = PAVE.debug.cam, r = PAVE.debug.reticle; return { dx: (x - r.x) * c.zoom, dy: (y - r.y) * c.zoom }; }, [x, y]);
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
  const lmAt = (i) => ev((i) => { const L = PAVE.debug.world.map.landmarks, l = L[i] || L[0]; return { x: l.x, y: l.y }; }, i);
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
      case 'Look around': {
        // pan toward the middle of the map (the camera starts near an edge it can't pass)
        const dir = await ev(() => { const c = PAVE.debug.cam, m = PAVE.debug.world.map; return { x: Math.sign(m.W / 2 - c.x) || 1, y: Math.sign(m.H / 2 - c.y) || 1 }; });
        if (dev === 'pad') { await axes([0.7 * dir.x, 0.7 * dir.y, 0, 0]); await sleep(900); await axes([0, 0, 0, 0]); }
        else { const kx = dir.x > 0 ? 'd' : 'a', ky = dir.y > 0 ? 's' : 'w'; await p.keyboard.down(kx); await p.keyboard.down(ky); await sleep(900); await p.keyboard.up(kx); await p.keyboard.up(ky); }
        break;
      }
      case 'Zoom in': if (dev === 'pad') { await press(7, true); await sleep(800); await press(7, false); } else { await p.mouse.move(800, 450); for (let k = 0; k < 6; k++) { await p.mouse.wheel(0, -200); await sleep(60); } } break;
      case 'This is your bloc': case 'Bridges are chokepoints': case 'CROWD': case 'ENERGY': case 'Authority': await sleep(450); if (dev === 'pad') await tap(0); else await key('Enter'); break;
      case 'Speed up time': if (dev === 'pad') await tap(8); else await key('Tab'); break;
      case 'March on the square': case 'Radicalise': case 'Select a squad': case 'Charge the casseurs': case 'Call the pompiers':
        if (title === 'Charge the casseurs') { if (dev === 'pad') await toolUntil('charge'); else await key('c'); }
        if (title === 'Call the pompiers') { if (dev === 'pad') await toolUntil('truck'); else await key('f'); }
        await act(t);
        if (process.env.TUT_DEBUG) console.log('DEBUG', title, JSON.stringify(await ev((t) => { const c = PAVE.debug.cam, w = PAVE.debug.world; const sx = (t.x - c.x) * c.zoom + 800, sy = (t.y - c.y) * c.zoom + 450, el = document.elementFromPoint(sx, sy);
          let near = 0; for (let i = 0; i < w.crowd.n; i++) if (w.crowd.kind[i] === 0 && (w.crowd.x[i] - t.x) ** 2 + (w.crowd.y[i] - t.y) ** 2 < 64) near++;
          return { t, tool: PAVE.debug.tool, sx: sx | 0, sy: sy | 0, el: el && (el.id || el.className), near, tip: document.getElementById('tip').textContent, energy: w.energy | 0 }; }, t)));
        break;
      case 'Take the square': case 'Fire spreads': {
        // speed is 2x from the speed step: go to 3x while waiting, then back to 1x
        if (dev === 'pad') await tap(8); else await key('Tab');
        await waitStepChange(title, 150000);
        if (dev === 'pad') await tap(8); else await key('Tab');
        break;
      }
      case 'Pin a fire truck': {
        if (dev === 'pad') await tap(1); else await key('1');
        const tr = await target();
        if (tr) { if (dev === 'pad') { await steerTo(tr.x, tr.y, true); await tap(0); } else await act(tr); }
        const watch = async () => ev(() => { const w = PAVE.debug.world, t0 = PAVE.debug.tut.s.truck, b = w.blocs[PAVE.debug.selBloc || 0];
          return t0 ? { tool: PAVE.debug.tool, snap: PAVE.debug.padSnap && PAVE.debug.padSnap.kind, truck: [t0.x | 0, t0.y | 0, t0.state, +(t0.sur || 0).toFixed(1), t0.press], bloc: [b.id, b.tx | 0, b.ty | 0, !!b.truck, b.n], sel: PAVE.debug.selBloc } : 'no truck'; });
        if (process.env.TUT_DEBUG) console.log('DEBUG truck after A', JSON.stringify(await watch()));
        const okT = await waitStepChange(title, 60000);
        if (!okT && process.env.TUT_DEBUG) console.log('DEBUG truck at fail', JSON.stringify(await watch()));
        break;
      }
      case 'Tear gas!': {
        if (dev === 'pad') await tap(1); else await key('1');
        await act(await lmAt(2));
        break;
      }
      case 'Your second bloc': {
        if (dev === 'pad') await tap(3); else await key('q');
        await act(await lmAt(1));
        break;
      }
      case 'Switch squads': if (dev === 'pad') await tap(3); else await key('q'); break;
      case 'Final test': {
        if (side === 'protest') {
          // bloc B (selected) joins bloc A on the defended square
          await act(await lmAt(2));
        } else {
          // every squad onto the square, spread round its centre
          const n = await ev(() => PAVE.debug.world.squads.length), L = await lmAt(0);
          for (let q = 0; q < n; q++) {
            if (dev === 'pad') await tap(3); else await key('q');
            const a = q * 2.1, pt = { x: L.x + Math.cos(a) * 6, y: L.y + Math.sin(a) * 6 };
            if (dev === 'pad') await act(pt); else await clickAt(pt.x, pt.y, 'right');
          }
        }
        if (dev === 'pad') { await tap(8); await tap(8); } else { await key('Tab'); await key('Tab'); }
        await waitStepChange(title, 300000);
        break;
      }
      case 'Pick a tool': if (dev === 'pad') await toolUntil('casseurs'); else await key('2'); break;
      case 'Fireworks vs shields': if (dev === 'pad') await toolUntil('fireworks'); else await key('3'); await act(t); break;
      case 'Form a line': if (dev === 'pad') await act(t); else await clickAt(t.x, t.y, 'right'); break;
      case 'Tear gas': {
        if (dev === 'pad') await toolUntil('gas'); else await key('g');
        const g = t || await w(() => { const wd = PAVE.debug.world, sq = wd.squads[PAVE.debug.selSquad]; return { x: sq.ax + sq.nx * 10, y: sq.ay + sq.ny * 10 }; });
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
    if (process.env.TUT_VERBOSE) console.log(log[log.length - 1]);
    if (!moved) break;
  }
  const fin = await ev(() => ({ done: !!(PAVE.debug.tut && PAVE.debug.tut.finished), saved: JSON.parse(localStorage.getItem('pave.progress') || '{}').tut }));
  log.push((fin.done ? 'ok   ' : 'FAIL ') + side + '/' + dev + '  finished, saved ' + JSON.stringify(fin.saved));
  // the finish card must work with this device too
  await p.screenshot({ path: path.join(__dirname, 'out', 'tut-end-' + side + '-' + dev + '.png') });
  if (!fin.done) { await b.close(); return log; }
  if (dev === 'pad') { await sleep(300); await tap(0); } // focus lands on the primary button by itself: one press
  else await p.click('#tutCampaign', { timeout: 4000 }).catch(() => {});
  const toCampaign = await p.waitForFunction(() => PAVE.debug.screen === 'campaignMenu', null, { timeout: 4000 }).then(() => true, () => false);
  if (!toCampaign && process.env.TUT_DEBUG) console.log('DEBUG card', JSON.stringify(await ev(() => ({ screen: PAVE.debug.screen, focus: PAVE.debug.padFocus && (PAVE.debug.padFocus.id || PAVE.debug.padFocus.textContent), last: PAVE.debug.lastInput, end: !document.querySelector('.tutEnd').classList.contains('hidden'), paused: document.getElementById('pauseMenu').classList.contains('hidden') ? 'no' : 'pauseMenu' }))));
  log.push((toCampaign ? 'ok   ' : 'FAIL ') + side + '/' + dev + '  finish card: TO THE CAMPAIGN works');
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
