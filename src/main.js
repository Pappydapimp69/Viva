// Game shell: menus, HUD, input, camera, tools, the fixed-step loop, saves,
// achievements (local + Steam bridge when running under Electron).
(function () {
  const P = globalThis.PAVE;
  const S = P.SIDE, K = P.K;
  const $ = (id) => document.getElementById(id);
  const audio = P.audio;

  // ------------------------------------------------------------ persistence
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pave.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pave.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const settings = Object.assign({ vol: 0.7, crowd: 1, edge: false, fps: false, full: false, safe: 0 }, store.get('settings', {}));
  const applySafe = () => document.documentElement.style.setProperty('--safe', String(settings.safe || 0));
  applySafe();
  const progress = Object.assign({ unlocked: 1, stars: {}, ach: {}, tut: {} }, store.get('progress', {}));
  progress.tut = progress.tut || {};
  const saveSettings = () => store.set('settings', settings);
  const saveProgress = () => store.set('progress', progress);

  const ACH = {
    FIRST_FIRE: 'Allumer le feu — burn your first car',
    CENT: 'Cent voitures — 100 cars burned in one night',
    HOLD: 'Tenir la ligne — win Tenir la Ligne',
    POMPIER: 'Soldat du feu — extinguish 25 fires in one game',
    NASSE: 'La Nasse — win La Nasse',
    BRULE: 'Paris brûle-t-il ? — win Paris Brûle',
    PEACE: 'Manif pacifique — win a protest level with fewer than 5 cars burned',
    ALL3: 'Trois étoiles — three stars on every level',
  };
  function unlock(id) {
    if (progress.ach[id]) return;
    progress.ach[id] = Date.now(); saveProgress();
    try { if (globalThis.steam && globalThis.steam.activate) globalThis.steam.activate(id); } catch (e) { /* no steam */ }
    const t = $('achToast');
    t.innerHTML = '<b>ACHIEVEMENT</b>' + ACH[id];
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 4200);
  }

  // ------------------------------------------------------------ state
  const canvas = $('view');
  const R = new P.Renderer(canvas);
  let world = null, level = null, levelIdx = -1, chat = null;
  const cam = { x: 160, y: 160, zoom: 3, tz: 3 };
  let paused = true, speed = 1, acc = 0, last = performance.now();
  let tool = null, selBloc = 0, selSquad = -1, tut = null;
  let mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, mid: false, drag: null, lastX: 0, lastY: 0 };
  const keys = {};
  let captionT = 0, shownCaptions = {};
  let prevScreen = 'mainMenu';
  let fpsT = 0, fpsN = 0;

  function resize() {
    const dpr = 1; // crowd layer is per-pixel; keep 1:1 for speed
    canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr);
    R.resize(canvas.width, canvas.height);
  }
  addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------------ screens
  const screens = ['mainMenu', 'tutorialMenu', 'campaignMenu', 'sandboxMenu', 'settingsMenu', 'howtoMenu', 'creditsMenu', 'briefing', 'pauseMenu', 'endScreen', 'loading'];
  let current = 'mainMenu';
  function show(id) {
    if (id !== current && ['settingsMenu', 'howtoMenu'].includes(id)) prevScreen = current;
    for (const s of screens) $(s).classList.toggle('hidden', s !== id);
    current = id;
    if (id === 'campaignMenu') buildLevelGrid();
    if (id === 'mainMenu' || id === 'tutorialMenu') refreshTutorialBadges();
    if (id === 'settingsMenu') loadSettingsUI();
  }
  function hideScreens() { for (const s of screens) $(s).classList.add('hidden'); current = null; }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    audio.init(); audio.play('ui');
    const go = b.dataset.go;
    if (go === 'main') { show('mainMenu'); }
    else if (go === 'campaign') show('campaignMenu');
    else if (go === 'tutorial') show('tutorialMenu');
    else if (go === 'tutProtest') startTutorial('protest');
    else if (go === 'tutPolice') startTutorial('police');
    else if (go === 'sandbox') show('sandboxMenu');
    else if (go === 'settings') show('settingsMenu');
    else if (go === 'howto') show('howtoMenu');
    else if (go === 'credits') show('creditsMenu');
    else if (go === 'back') show(prevScreen || 'mainMenu');
    else if (go === 'quit') { if (globalThis.steam && globalThis.steam.quit) globalThis.steam.quit(); else window.close(); }
  });

  function buildLevelGrid() {
    const g = $('levelGrid');
    g.innerHTML = '';
    P.LEVELS.forEach((lv, i) => {
      const b = document.createElement('button');
      const locked = i >= progress.unlocked;
      b.className = 'lvl' + (locked ? ' locked' : '');
      const st = progress.stars[lv.id] || 0;
      b.innerHTML = `<span class="side ${lv.side}">${i + 1} · ${lv.side === S.PROTEST ? '✊ PROTEST' : '🛡 POLICE'}${lv.night ? ' · NIGHT' : ''}</span>
        <span class="n">${lv.name}</span><span style="font-size:12px;color:#bbb">${lv.objectives.map((o) => o.label).join(' · ')}</span>
        <span class="st">${locked ? '🔒' : '★'.repeat(st) + '☆'.repeat(3 - st)}</span>`;
      if (!locked) b.onclick = () => { audio.init(); audio.play('ui'); brief(i); };
      g.appendChild(b);
    });
  }

  function brief(i) {
    const lv = P.LEVELS[i];
    levelIdx = i;
    $('brSide').textContent = lv.side === S.PROTEST ? '✊ YOU LEAD THE PROTEST' : '🛡 YOU COMMAND THE POLICE';
    $('brSide').style.color = lv.side === S.PROTEST ? '#ff8a5b' : '#7fb0ff';
    $('brName').textContent = lv.name;
    $('brText').textContent = lv.brief;
    $('brObj').innerHTML = lv.objectives.map((o) => '<li>▸ ' + o.label + '</li>').join('') + `<li style="color:#aaa">⏱ ${P.fmtTime(lv.time)}</li>`;
    $('brTut').classList.toggle('hidden', !!progress.tut[lv.side]);
    $('brTut').dataset.go = lv.side === S.PROTEST ? 'tutProtest' : 'tutPolice';
    $('brTut').textContent = 'NEW HERE? ' + (lv.side === S.PROTEST ? 'PROTEST' : 'POLICE') + ' TUTORIAL FIRST';
    show('briefing');
  }
  $('brGo').onclick = () => { audio.init(); start(P.LEVELS[levelIdx]); };
  $('sbStart').onclick = () => {
    audio.init();
    levelIdx = -1;
    start(P.sandboxLevel({ side: $('sbSide').value, pop: +$('sbPop').value, size: +$('sbSize').value,
      squads: +$('sbSq').value, night: $('sbNight').value === '1', seed: +$('sbSeed').value || 1, style: $('sbStyle').value }), true);
  };

  function loadSettingsUI() {
    $('setVol').value = settings.vol; $('setCrowd').value = String(settings.crowd);
    $('setSafe').value = settings.safe || 0;
    $('setEdge').checked = settings.edge; $('setFps').checked = settings.fps; $('setFull').checked = !!document.fullscreenElement;
  }
  $('setVol').oninput = (e) => { settings.vol = +e.target.value; audio.setVolume(settings.vol); saveSettings(); };
  $('setSafe').oninput = (e) => { settings.safe = +e.target.value; applySafe(); saveSettings(); };
  $('setCrowd').onchange = (e) => { settings.crowd = +e.target.value; saveSettings(); };
  $('setEdge').onchange = (e) => { settings.edge = e.target.checked; saveSettings(); };
  $('setFps').onchange = (e) => { settings.fps = e.target.checked; saveSettings(); $('fps').textContent = ''; };
  $('setFull').onchange = (e) => {
    settings.full = e.target.checked; saveSettings();
    if (e.target.checked) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen && document.fullscreenElement && document.exitFullscreen();
  };

  // ------------------------------------------------------------ game start
  function start(lv, sandbox) {
    show('loading');
    $('loadText').textContent = 'Paving the streets…';
    setTimeout(() => {
      level = lv;
      world = new P.World(lv, { crowdScale: sandbox ? 1 : settings.crowd, maxAgents: 140000 });
      R.setWorld(world);
      chat = new P.Chat($('chatLog'), world.side, world.map);
      $('chatLog').innerHTML = '';
      const prot = world.side === S.PROTEST;
      $('hud').classList.toggle('police', !prot);
      $('phoneTitle').textContent = prot ? 'BLOC 11e' : 'PC PRÉFECTURE';
      $('phoneAvatar').textContent = prot ? 'B' : 'P';
      $('phoneInput').firstChild.textContent = prot ? 'Message…' : 'Canal 3…';
      $('resLabel').textContent = prot ? 'CROWD' : 'AUTHORITY';
      $('energyRow').classList.toggle('hidden', !prot);
      $('lvName').textContent = lv.name.toUpperCase();
      (lv.chat || []).forEach((m, i) => setTimeout(() => chat && chat.post(m, prot ? ['yanis', 'inès', 'sarah'][i % 3] : 'PC Préfecture'), 900 + i * 1400));
      // camera: start on the player's side
      const focus = prot ? (world.rally || world.spawnEntries[0]) : world.map.landmarks[(lv.objectives[0] && lv.objectives[0].lm) || 0];
      cam.x = focus.x; cam.y = focus.y; cam.zoom = cam.tz = 3.2;
      tool = prot ? 'march' : 'move';
      selBloc = 0; selSquad = prot ? -1 : 0;
      shownCaptions = {};
      speed = 1; $('btnSpeed').textContent = '1×';
      buildToolbar();
      buildSquadBar();
      hideScreens();
      $('hud').classList.remove('hidden');
      caption(lv.caption[0], lv.caption[1], 3.5);
      if (tut) { tut.destroy(); tut = null; }
      $('tutorial').classList.add('hidden');
      if (lv.tutorial) {
        $('tutorial').classList.remove('hidden');
        $('tutorial').querySelector('.tutBody').classList.remove('hidden');
        $('tutorial').querySelector('.tutEnd').classList.add('hidden');
        tut = new P.Tutorial(lv.side, tutApi);
      }
      paused = false; acc = 0;
      R.miniT = 0;
    }, 30);
  }

  // ------------------------------------------------------------ tutorial
  const tutApi = {
    get world() { return world; }, get lastInput() { return lastInput; }, get tool() { return tool; },
    get selSquad() { return selSquad; }, setSelSquad(i) { selSquad = i; }, pickTool: (id) => pickTool(id), cam,
    el: $('tutorial'),
    onDone(side) {
      progress.tut[side] = true; saveProgress();
      $('tutorial').querySelector('.tutBody').classList.add('hidden');
      $('tutorial').querySelector('.tutEnd').classList.remove('hidden');
      document.querySelectorAll('.tutHi').forEach((el) => el.classList.remove('tutHi'));
      audio.play('win');
    },
  };
  function startTutorial(side) { audio.init(); levelIdx = -2; start(P.TUTORIALS[side], true); }
  function refreshTutorialBadges() {
    $('tutNew').classList.toggle('hidden', !!(progress.tut.protest && progress.tut.police));
    $('tutDoneP').textContent = progress.tut.protest ? '✔' : '';
    $('tutDoneC').textContent = progress.tut.police ? '✔' : '';
  }
  $('tutSkip').onclick = (e) => { e.stopPropagation(); if (tut) { tut.destroy(); tut = null; } $('tutorial').classList.add('hidden'); };
  $('tutContinue').onclick = (e) => { e.stopPropagation(); if (tut) tut.confirm(); };
  $('tutCampaign').onclick = (e) => { e.stopPropagation(); if (tut) { tut.destroy(); tut = null; } quitToMenu(); show('campaignMenu'); };
  $('tutStay').onclick = (e) => { e.stopPropagation(); $('tutorial').classList.add('hidden'); };

  function caption(a, b, t) {
    const c = $('caption');
    c.innerHTML = `${a} ${b ? '<span class="y">' + b + '</span>' : ''}`;
    c.classList.add('show');
    captionT = t || 2.8;
  }
  function captionOnce(key, a, b) { if (shownCaptions[key]) return; shownCaptions[key] = 1; caption(a, b, 2.6); }
  let tipT = 0;
  function tip(text) {
    if (lastInput === 'pad') text = text.replace(/^Drag/, 'Hold A and move').replace(/right-click/g, 'press B').replace(/^Click/, 'Press A').replace(/click/g, 'select');
    $('tip').textContent = text; $('tip').classList.add('show'); tipT = 2.2; }

  // ------------------------------------------------------------ tools
  const PROT_TOOLS = [
    { id: 'march', key: '1', ico: '🚩', name: 'MARCH', cost: 0, hint: 'Click: send the selected bloc there (Q: next bloc)' },
    { id: 'casseurs', key: '2', ico: '🖤', name: 'CASSEURS', cost: 8, hint: 'Click the crowd: radicalise ~20 people' },
    { id: 'fireworks', key: '3', ico: '🎆', name: 'FIREWORKS', cost: 6, cd: 5, hint: 'Click police: stun the line' },
    { id: 'barricade', key: '4', ico: '🚧', name: 'BARRICADE', cost: 0.6, hint: 'Drag across a street (cost per tile)' },
    { id: 'mobilise', key: '5', ico: '📣', name: 'MOBILISE', cost: 15, cd: 30, hint: 'Instant: the group chat brings 800 more' },
  ];
  const POL_TOOLS = [
    { id: 'move', key: 'M', ico: '🛡', name: 'LINE', cost: 0, hint: 'Click a squad, right-click to form a line' },
    { id: 'charge', key: 'C', ico: '⚡', name: 'CHARGE', cost: 5, hint: 'Click: selected squad charges and arrests casseurs' },
    { id: 'gas', key: 'G', ico: '💨', name: 'GAS', cost: 10, cd: 3, hint: 'Click: tear gas (thrown by the selected squad)' },
    { id: 'barrier', key: 'B', ico: '🚧', name: 'BARRIER', cost: 0.8, hint: 'Drag across a street (cost per tile)' },
    { id: 'truck', key: 'F', ico: '🚒', name: 'POMPIERS', cost: 4, hint: 'Click a burning car: send a fire truck' },
    { id: 'reinforce', key: 'R', ico: '🚐', name: 'REINFORCE', cost: 30, cd: 20, hint: 'Instant: a fresh CRS company' },
  ];
  const tools = () => (world && world.side === S.PROTEST ? PROT_TOOLS : POL_TOOLS);
  // what tools cost: ENERGY for the protest, AUTHORITY for the police
  function res() { return world.side === S.PROTEST ? world.energy : world.authority; }
  function spend(n) { if (world.side === S.PROTEST) world.energy = Math.max(0, world.energy - n); else world.authority -= n; }

  function buildToolbar() {
    const tb = $('toolbar');
    tb.innerHTML = '';
    for (const t of tools()) {
      const b = document.createElement('button');
      b.className = 'tool'; b.id = 'tool_' + t.id; b.title = t.hint;
      b.innerHTML = `<span class="key">${t.key}</span>${t.cost ? `<span class="cost">${t.cost}</span>` : ''}<span class="ico">${t.ico}</span>${t.name}<span class="cd"></span>`;
      b.onclick = (e) => { e.stopPropagation(); pickTool(t.id); };
      tb.appendChild(b);
    }
  }
  function pickTool(id) {
    const t = tools().find((x) => x.id === id);
    if (!t) return;
    audio.play('ui');
    if (id === 'mobilise' || id === 'reinforce') { useInstant(t); return; }
    tool = id;
    tip(t.hint);
  }
  function useInstant(t) {
    if ((world.cooldowns[t.id] || 0) > 0) return tip('Recharging…');
    if (res() < t.cost) return tip('Not enough ' + (world.side === S.PROTEST ? 'energy' : 'authority'));
    spend(t.cost); world.cooldowns[t.id] = t.cd || 0;
    if (t.id === 'mobilise') {
      const n = world.spawnProtesters(800, false);
      world.emit('mobilise', { x: world.spawnEntries[0].x, y: world.spawnEntries[0].y });
      chat.me('tout le monde à ' + (world.blocs[selBloc].target >= 0 ? world.map.landmarks[world.blocs[selBloc].target].name : 'la manif') + ' 📣');
      tip('+' + n + ' protesters on the way');
    } else if (t.id === 'reinforce') {
      const sq = world.addSquad(world.squadSize);
      if (sq) { buildSquadBar(); selSquad = sq.id; tip(sq.name + ' deployed'); }
    }
  }

  function buildSquadBar() {
    const bar = $('squadBar');
    bar.innerHTML = '';
    if (world.side === S.PROTEST) {
      world.blocs.forEach((b, i) => {
        const el = document.createElement('button');
        el.className = 'sq'; el.id = 'blc_' + i;
        el.onclick = (e) => { e.stopPropagation(); selBloc = i; };
        bar.appendChild(el);
      });
    } else {
      world.squads.forEach((sq, i) => {
        const el = document.createElement('button');
        el.className = 'sq'; el.id = 'sq_' + i;
        el.onclick = (e) => { e.stopPropagation(); selSquad = i; cam.x = sq.ax; cam.y = sq.ay; };
        bar.appendChild(el);
      });
    }
  }
  function updateSquadBar() {
    if (world.side === S.PROTEST) {
      world.blocs.forEach((b, i) => {
        const el = $('blc_' + i); if (!el) return;
        el.className = 'sq' + (i === selBloc ? ' sel' : '');
        const tgt = b.target >= 0 ? 'Pl. ' + world.map.landmarks[b.target].name : world.map.streetAt(b.tx, b.ty);
        el.textContent = `${'ABC'[i]} · ${P.fmtNum(b.n)} → ${tgt}`;
      });
    } else {
      if (world.squads.length !== $('squadBar').children.length) buildSquadBar();
      world.squads.forEach((sq, i) => {
        const el = $('sq_' + i); if (!el) return;
        el.className = 'sq' + (i === selSquad ? ' sel' : '') + (sq.charge > 0 ? ' charge' : '');
        el.textContent = `${i < 9 ? i + 1 : '·'} ${sq.name}${sq.charge > 0 ? ' ⚡' : ''}`;
      });
    }
  }

  // nearest agent of a kind to a point (click helpers)
  function nearestAgent(x, y, kindTest, maxD) {
    const cr = world.crowd;
    let best = -1, bd = maxD * maxD;
    for (let i = 0; i < cr.n; i++) {
      if (!kindTest(cr.kind[i])) continue;
      const dx = cr.x[i] - x, dy = cr.y[i] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function nearestBurning(x, y, maxD) {
    let best = null, bd = maxD;
    for (const c of world.map.cars) if (c.state === 1) { const d = Math.hypot(c.cx - x, c.cy - y); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  function primary(wx, wy) {
    const t = tools().find((x) => x.id === tool);
    if (!t || !world) return;
    if ((world.cooldowns[t.id] || 0) > 0) return tip('Recharging…');
    if (t.cost && t.id !== 'barricade' && t.id !== 'barrier' && res() < t.cost) return tip('Not enough ' + (world.side === S.PROTEST ? 'energy' : 'authority'));
    const map = world.map;
    switch (tool) {
      case 'march': {
        if (!map.nearestOpen(wx, wy, 10)) return tip('Can\'t march into a building');
        let lmId = null;
        for (const lm of map.landmarks) if (Math.hypot(lm.x - wx, lm.y - wy) < lm.r + 3) { lmId = lm.id; wx = lm.x; wy = lm.y; }
        world.setBlocTarget(selBloc, wx, wy, lmId);
        audio.play('order');
        const name = lmId != null ? map.landmarks[lmId].name : map.streetAt(wx, wy);
        chat.me((world.blocs.length > 1 ? 'bloc ' + 'ABC'[selBloc] + ' → ' : 'on va ') + name + ' ✊');
        break;
      }
      case 'casseurs': {
        const n = world.convertCasseurs(wx, wy, 8, 20);
        if (!n) return tip('No protesters there');
        spend(t.cost); audio.play('ui');
        captionOnce('cass', 'HOODS', 'UP');
        break;
      }
      case 'fireworks': {
        const i = nearestAgent(wx, wy, (k) => k !== K.POL, 40);
        if (i < 0) return tip('Nobody close enough to launch');
        world.launchFireworks(world.crowd.x[i], world.crowd.y[i], wx, wy);
        spend(t.cost); world.cooldowns.fireworks = t.cd;
        audio.play('firework', camDist(wx, wy));
        captionOnce('fw', 'MORTARS', 'LAUNCHED');
        break;
      }
      case 'move': {
        const i = nearestAgent(wx, wy, (k) => k === K.POL, 3);
        if (i >= 0) { selSquad = world.crowd.grp[i]; audio.play('ui'); return; }
        // also select by clicking where a squad stands as a group (its centre)
        for (let q = 0; q < world.squads.length; q++) {
          const sq = world.squads[q];
          if (sq.mx != null && Math.hypot(sq.mx - wx, sq.my - wy) < 5) { selSquad = q; audio.play('ui'); return; }
        }
        orderSel(wx, wy, false);
        break;
      }
      case 'charge': {
        if (selSquad < 0) return tip('Select a squad first');
        orderSel(wx, wy, true);
        break;
      }
      case 'gas': {
        const sq = world.squads[selSquad] || world.squads.reduce((a, s) => (Math.hypot(s.ax - wx, s.ay - wy) < Math.hypot(a.ax - wx, a.ay - wy) ? s : a));
        if (Math.hypot(sq.ax - wx, sq.ay - wy) > 40) return tip(sq.name + ' is too far (40 m)');
        world.throwGas(sq.ax, sq.ay, wx, wy);
        spend(t.cost); world.cooldowns.gas = t.cd;
        audio.play('gas', camDist(wx, wy));
        captionOnce('gas', 'TEAR', 'GAS');
        break;
      }
      case 'truck': {
        const c = nearestBurning(wx, wy, 10);
        if (!c) return tip('Click a burning car');
        if (world.trucksOut >= world.trucksMax) return tip('All trucks are out (' + world.trucksMax + ')');
        if (world.dispatchTruck(c)) { spend(t.cost); audio.play('order'); captionOnce('pomp', 'TRUCK', 'ROLLING'); }
        else tip('No road to that fire');
        break;
      }
    }
  }
  function orderSel(wx, wy, charge) {
    const sq = world.squads[selSquad];
    if (!sq) return tip('Select a squad (click one, or 1–9)');
    if (charge) { if (world.authority < 5) return tip('Not enough authority'); world.authority -= 5; }
    if (world.orderSquad(sq, wx, wy, charge)) { audio.play('order'); if (!charge) captionOnce('line', 'LINE', 'FORMED'); }
  }
  function camDist(x, y) { return Math.hypot(x - cam.x, y - cam.y) * (3 / cam.zoom); }

  function placeLine(a, b) {
    const t = tools().find((x) => x.id === tool);
    const kind = world.side === S.PROTEST ? 1 : 2;
    const len = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) + 1;
    const afford = Math.floor(res() / t.cost);
    const maxT = Math.min(30, afford, Math.ceil(len) * 2);
    if (maxT <= 0) return tip('Not enough ' + (kind === 1 ? 'energy' : 'authority'));
    if (kind === 1 && nearestAgent((a.x + b.x) / 2, (a.y + b.y) / 2, (k) => k !== K.POL, 25) < 0) return tip('Build it near your people');
    const n = world.placeBarricade(a.x, a.y, b.x, b.y, kind, maxT);
    if (n) { spend(n * t.cost); audio.play('barricade', camDist(a.x, a.y)); if (kind === 1) captionOnce('barr', 'STREET', 'CLOSED'); }
  }

  // ------------------------------------------------------------ input
  function toWorld(sx, sy) { return { x: (sx - canvas.width / 2) / cam.zoom + cam.x, y: (sy - canvas.height / 2) / cam.zoom + cam.y }; }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    audio.init();
    if (!world || paused) return;
    const w = toWorld(e.offsetX, e.offsetY);
    if (e.button === 1 || (e.button === 2 && world.side === S.PROTEST)) { mouse.mid = true; mouse.lastX = e.clientX; mouse.lastY = e.clientY; mouse.panMoved = 0; return; }
    if (e.button === 2) { orderSel(w.x, w.y, false); return; }
    if (e.button === 0) {
      if (tool === 'barricade' || tool === 'barrier') { mouse.drag = { x: w.x, y: w.y }; return; }
      primary(w.x, w.y);
    }
  });
  addEventListener('mouseup', (e) => {
    if (mouse.mid && (e.button === 1 || e.button === 2)) {
      mouse.mid = false;
      if (e.button === 2 && world && world.side === S.PROTEST && mouse.panMoved < 4) pickTool('march');
    }
    if (mouse.drag && e.button === 0 && world) {
      const w = toWorld(mouse.x, mouse.y);
      placeLine(mouse.drag, w);
      mouse.drag = null;
    }
  });
  addEventListener('mousemove', (e) => {
    if (e.movementX || e.movementY) lastInput = 'mouse';
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    if (mouse.mid) {
      const dx = e.clientX - mouse.lastX, dy = e.clientY - mouse.lastY;
      mouse.panMoved += Math.abs(dx) + Math.abs(dy);
      cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom;
      mouse.lastX = e.clientX; mouse.lastY = e.clientY;
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!world) return;
    cam.tz = P.clamp(cam.tz * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.9, 16);
  }, { passive: false });
  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (!world) return;
    if (e.code === 'Escape') { togglePause(); return; }
    if (e.code === 'Tab') { e.preventDefault(); cycleSpeed(); return; }
    if (paused) return;
    if ((e.code === 'Enter' || e.code === 'Space') && tut && tut.confirm()) { e.preventDefault(); return; }
    const k = e.key.toUpperCase();
    if (world.side === S.PROTEST) {
      const t = PROT_TOOLS.find((x) => x.key === k); if (t) pickTool(t.id);
      if (k === 'Q') { selBloc = (selBloc + 1) % world.blocs.length; const b = world.blocs[selBloc]; if (b.n) { cam.x = b.cx; cam.y = b.cy; } }
    } else {
      const t = POL_TOOLS.find((x) => x.key === k); if (t) pickTool(t.id);
      if (/^[1-9]$/.test(e.key) && world.squads[+e.key - 1]) {
        selSquad = +e.key - 1;
        if (e.shiftKey || lastNum === e.key) { const sq = world.squads[selSquad]; cam.x = sq.ax; cam.y = sq.ay; }
        lastNum = e.key; setTimeout(() => { lastNum = null; }, 350);
      }
      if (k === 'Q') selSquad = (selSquad + 1) % world.squads.length;
    }
  });
  let lastNum = null;
  addEventListener('keyup', (e) => { keys[e.code] = false; });

  const mm = $('minimap'), mmg = mm.getContext('2d');
  function miniJump(e) {
    if (!world) return;
    const r = mm.getBoundingClientRect();
    cam.x = ((e.clientX - r.left) / r.width) * world.map.W;
    cam.y = ((e.clientY - r.top) / r.height) * world.map.H;
  }
  let miniDrag = false;
  mm.addEventListener('mousedown', (e) => { miniDrag = true; miniJump(e); });
  addEventListener('mouseup', () => { miniDrag = false; });
  mm.addEventListener('mousemove', (e) => { if (miniDrag) miniJump(e); });

  function togglePause() {
    if (!world || world.result) return;
    paused = !paused;
    $('psSkipTut').classList.toggle('hidden', !(tut && !tut.finished));
    if (paused) show('pauseMenu'); else hideScreens();
  }

  // ------------------------------------------------------------ gamepad
  // A thin adapter: every pad action calls the same functions the mouse and
  // keyboard use, so a new tool can't silently miss one input surface.
  const pad = new P.PadInput();
  const PB = P.PAD;
  let lastInput = 'mouse', padFocus = null, padCur = { x: 0, y: 0, init: false };

  // in-game panels with buttons (tutorial finish card) are menus for the pad too
  function modalEl() {
    if (current || !world) return null;
    for (const el of document.querySelectorAll('#hud .padModal')) if (el.offsetParent !== null && !el.classList.contains('hidden')) return el;
    return null;
  }
  function focusables() {
    const scr = current ? $(current) : modalEl();
    if (!scr) return [];
    return Array.from(scr.querySelectorAll('button, select, input')).filter((el) =>
      el.offsetParent !== null && !el.classList.contains('hidden') && !el.classList.contains('locked') && !el.disabled);
  }
  function setFocus(el) {
    if (padFocus) padFocus.classList.remove('padFocus');
    padFocus = el;
    if (el) { el.classList.add('padFocus'); el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
  }
  function defaultFocus(list) {
    return list.find((el) => el.classList.contains('big') && !el.classList.contains('back')) || list.find((el) => !el.classList.contains('back')) || list[0] || null;
  }
  // spatial navigation: nearest element in the pressed direction, so grids and
  // forms move by their real rows/columns instead of one flat list
  function moveFocus(dir) {
    const list = focusables();
    if (!list.length) return;
    if (!padFocus || !list.includes(padFocus)) { setFocus(defaultFocus(list)); return; }
    const r0 = padFocus.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0, dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    let best = null, bs = Infinity;
    for (const el of list) {
      if (el === padFocus) continue;
      const r = el.getBoundingClientRect(), ex = r.left + r.width / 2 - cx, ey = r.top + r.height / 2 - cy;
      const along = ex * dx + ey * dy;
      if (along <= 4) continue;
      const score = along + Math.abs(ex * dy - ey * dx) * 2.5;
      if (score < bs) { bs = score; best = el; }
    }
    if (best) { setFocus(best); audio.play('ui'); }
  }
  function adjust(el, d) {
    if (el.tagName === 'SELECT') {
      const n = el.options.length;
      el.selectedIndex = (el.selectedIndex + d + n) % n;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'number')) {
      const step = +el.step || 1, v = +el.value + d * step;
      el.value = el.type === 'range' ? P.clamp(v, +el.min, +el.max) : v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }
  function menuPad() {
    const list = focusables();
    // the first input on a screen only lands focus; it doesn't also move it
    if (!padFocus || !list.includes(padFocus)) { setFocus(defaultFocus(list)); return; }
    if (pad.nav) {
      if ((pad.nav === 'left' || pad.nav === 'right') && padFocus && adjust(padFocus, pad.nav === 'left' ? -1 : 1)) audio.play('ui');
      else moveFocus(pad.nav);
    }
    if (pad.pressed(PB.A) && padFocus) {
      audio.init();
      if (padFocus.tagName === 'SELECT') adjust(padFocus, 1);
      else if (!(padFocus.tagName === 'INPUT' && padFocus.type !== 'checkbox')) padFocus.click();
    }
    if (pad.pressed(PB.B)) { // always-available back
      if (current === 'pauseMenu') togglePause();
      else { const b = list.find((el) => el.classList.contains('back')); if (b) { audio.init(); b.click(); } }
    }
    if (pad.pressed(PB.START) && current === 'pauseMenu') togglePause();
  }
  function cycleTool(d) {
    const ts = tools().filter((t) => t.id !== 'mobilise' && t.id !== 'reinforce');
    const i = ts.findIndex((t) => t.id === tool);
    pickTool(ts[(i + d + ts.length) % ts.length].id);
  }
  function centerSel() {
    if (world.side === S.PROTEST) { const b = world.blocs[selBloc]; if (b && b.n) { cam.x = b.cx; cam.y = b.cy; } }
    else { const sq = world.squads[selSquad]; if (sq) { cam.x = sq.ax; cam.y = sq.ay; } }
  }
  // Console-RTS controls: the reticle stays at screen centre and the left stick
  // moves the camera; the reticle snaps to the nearest useful target for the tool.
  let padSnap = null;
  function snapTarget(wx, wy, radius) {
    let best = null, bd = radius * radius;
    const consider = (x, y, kind, ref) => { const d = (x - wx) ** 2 + (y - wy) ** 2; if (d < bd) { bd = d; best = { x, y, kind, ref }; } };
    if (world.side === S.POLICE) {
      if (tool === 'truck') { for (const c of world.map.cars) if (c.state === 1) consider(c.cx, c.cy, 'fire', c); }
      else if (tool === 'move' || tool === 'charge') world.squads.forEach((sq, i) => { if (i !== selSquad || tool === 'move') consider(sq.mx != null ? sq.mx : sq.ax, sq.my != null ? sq.my : sq.ay, 'squad', i); });
      if (tool === 'charge' || tool === 'gas') {
        const cr = world.crowd; // nearest casseur cluster point
        for (let i = 0; i < cr.n; i += 3) if (cr.kind[i] === K.CASS) consider(cr.x[i], cr.y[i], 'casseur', null);
      }
    } else {
      if (tool === 'march') for (const lm of world.map.landmarks) consider(lm.x, lm.y, 'landmark', lm);
      if (tool === 'march' || tool === 'casseurs') for (const tr of world.trucks) if (tr.state !== 'abandoned') consider(tr.x, tr.y, 'truck', tr);
      if (tool === 'fireworks') world.squads.forEach((sq, i) => consider(sq.mx != null ? sq.mx : sq.ax, sq.my != null ? sq.my : sq.ay, 'squad', i));
      if (tool === 'casseurs') world.blocs.forEach((b) => { if (b.n > 50) consider(b.cx, b.cy, 'bloc', b); });
    }
    return best;
  }
  function gamePad(dt) {
    if (pad.pressed(PB.START)) { togglePause(); return; }
    if (pad.pressed(PB.BACK)) cycleSpeed();
    if (paused) return;
    if (pad.pressed(PB.A) && tut && tut.confirm()) return;
    padCur.x = canvas.width / 2; padCur.y = canvas.height / 2; padCur.init = true;
    mouse.x = padCur.x; mouse.y = padCur.y;
    const c = toWorld(padCur.x, padCur.y);
    padSnap = snapTarget(c.x, c.y, 34 / cam.zoom + 2);
    // pan: response curve for fine aim, sticky (slower) while hovering a target
    const sticky = padSnap && pad.lm < 0.7 ? 0.45 : 1;
    const sp = 1100 * Math.pow(pad.lm, 1.6) * sticky / cam.zoom * dt;
    if (pad.lm > 0) { cam.x += pad.lx / pad.lm * sp; cam.y += pad.ly / pad.lm * sp; }
    // right stick: vertical zooms, triggers zoom too
    const zt = (pad.rt - pad.lt) - pad.ry;
    if (Math.abs(zt) > 0.05) cam.tz = P.clamp(cam.tz * (1 + zt * dt * 2.4), 0.9, 16);
    if (Math.abs(pad.rx) > 0.05) cam.x += pad.rx * 400 / cam.zoom * dt;

    const w = padSnap ? { x: padSnap.x, y: padSnap.y } : c;
    if (pad.pressed(PB.A)) {
      audio.init();
      if (tool === 'barricade' || tool === 'barrier') mouse.drag = { x: c.x, y: c.y };
      else if (padSnap && padSnap.kind === 'squad' && tool === 'move') { selSquad = padSnap.ref; audio.play('ui'); tip(world.squads[selSquad].name + ' selected — move and press A to place the line'); }
      else primary(w.x, w.y);
    }
    if (pad.released(PB.A) && mouse.drag) { placeLine(mouse.drag, c); mouse.drag = null; }
    // B cancels: drop a barricade being drawn, else go back to the default tool
    if (pad.pressed(PB.B)) {
      if (mouse.drag) mouse.drag = null;
      else pickTool(world.side === S.PROTEST ? 'march' : 'move');
    }
    if (pad.pressed(PB.X)) { // jump the camera to the selection
      centerSel(); audio.play('ui');
    }
    if (pad.pressed(PB.Y)) {
      if (world.side === S.POLICE) selSquad = (selSquad + 1) % world.squads.length;
      else selBloc = (selBloc + 1) % world.blocs.length;
      centerSel(); audio.play('ui');
    }
    if (pad.pressed(PB.LB)) cycleTool(-1);
    if (pad.pressed(PB.RB)) cycleTool(1);
    if (pad.pressed(PB.UP)) pickTool(world.side === S.PROTEST ? 'mobilise' : 'reinforce');
    if (pad.pressed(PB.DOWN) || pad.pressed(PB.R3)) {
      // jump to the hottest spot: the biggest fire, or the landmark under most pressure
      let best = null, bv = -1;
      for (const cc of world.map.cars) if (cc.state === 1 && cc.burn > bv) { bv = cc.burn; best = cc; }
      if (best) { cam.x = best.cx; cam.y = best.cy; }
      else { const lm = world.map.landmarks.reduce((a, l) => (Math.abs(l.control) > Math.abs(a.control) ? l : a)); cam.x = lm.x; cam.y = lm.y; }
    }
    if (pad.pressed(PB.LEFT) || pad.pressed(PB.RIGHT)) {
      const d = pad.pressed(PB.LEFT) ? -1 : 1;
      if (world.side === S.POLICE) selSquad = (selSquad + d + world.squads.length) % world.squads.length;
      else selBloc = (selBloc + d + world.blocs.length) % world.blocs.length;
      audio.play('ui');
    }
    // reticle label: what A will do right now
    const t = tools().find((x) => x.id === tool);
    let label = t ? t.name : '';
    if (padSnap) label += ' · ' + (padSnap.kind === 'squad' ? world.squads[padSnap.ref].name : padSnap.kind === 'landmark' ? padSnap.ref.name : padSnap.kind === 'fire' ? 'FIRE' : padSnap.kind === 'bloc' ? 'BLOC' : padSnap.kind === 'truck' ? 'FIRE TRUCK' : 'CASSEURS');
    else if (mouse.drag) label += ' · release A to build';
    $('padLabel').textContent = label;
    $('padCursor').classList.toggle('snap', !!padSnap);
  }
  const PAD_HINTS = {
    protest: 'Left stick: move · A: do it · B: cancel · LB/RB: tool · Y: next bloc · X: go to bloc · Down: hot spot · Up: mobilise · Right stick / triggers: zoom · Start: pause',
    police: 'Left stick: move · A: select squad / do it · B: cancel · LB/RB: tool · Y: next squad · X: go to squad · Down: hot spot · Up: reinforce · Right stick / triggers: zoom · Start: pause',
  };
  function pollPad(dt) {
    pad.poll(dt);
    if (pad.connected && pad.any) lastInput = 'pad';
    const on = pad.connected && lastInput === 'pad';
    document.body.classList.toggle('pad', on);
    const st = $('padStatus');
    if (st) st.textContent = pad.connected ? pad.id.replace(/\s*\(.*$/, '').slice(0, 40) : 'None — press a button on it';
    const modal = modalEl();
    const inGame = !!world && !current && !modal;
    $('padCursor').classList.toggle('hidden', !(on && inGame));
    $('padLabel').classList.toggle('hidden', !(on && inGame));
    $('padHints').classList.toggle('hidden', !(on && inGame));
    if (!pad.connected) return;
    if (current || modal) { if (on) menuPad(); }
    else if (world) {
      gamePad(dt);
      $('padCursor').style.transform = `translate(${padCur.x}px, ${padCur.y}px)`;
      $('padLabel').style.transform = `translate(${padCur.x}px, ${padCur.y + 26}px) translateX(-50%)`;
      $('padHints').textContent = PAD_HINTS[world.side];
    }
  }
  // The Guide/Home button opens a system overlay that steals focus: pause rather than run unseen.
  function autoPause() { if (world && !paused && !world.result && !current) togglePause(); }
  addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });

  function cycleSpeed() { speed = speed === 1 ? 2 : speed === 2 ? 3 : 1; $('btnSpeed').textContent = speed + '×'; }
  $('btnPause').onclick = (e) => { e.stopPropagation(); togglePause(); };
  $('btnSpeed').onclick = (e) => { e.stopPropagation(); cycleSpeed(); };
  $('psResume').onclick = () => togglePause();
  $('psRestart').onclick = () => { paused = true; start(level, levelIdx < 0); };
  $('psQuit').onclick = () => quitToMenu();
  $('psSkipTut').onclick = () => { if (tut) { tut.destroy(); tut = null; } $('tutorial').classList.add('hidden'); togglePause(); };
  function quitToMenu() { if (tut) { tut.destroy(); tut = null; } $('tutorial').classList.add('hidden'); world = null; paused = true; $('hud').classList.add('hidden'); show('mainMenu'); }

  // ------------------------------------------------------------ overlay (world space)
  const overlay = (g, z) => {
    if (!world) return;
    const tt = tut && tut.target();
    if (tt) {
      const pulse = 1 + Math.sin(performance.now() / 180) * 0.12;
      g.strokeStyle = 'rgba(255,210,31,0.95)'; g.lineWidth = 3 / z;
      g.beginPath(); g.arc(tt.x, tt.y, tt.r * pulse, 0, 6.283); g.stroke();
      g.strokeStyle = 'rgba(255,210,31,0.35)'; g.lineWidth = 8 / z;
      g.beginPath(); g.arc(tt.x, tt.y, tt.r * pulse + 6 / z, 0, 6.283); g.stroke();
    }
    const lw = 1.6 / z;
    if (world.side === S.PROTEST) {
      world.blocs.forEach((b, i) => {
        const sel = i === selBloc;
        g.strokeStyle = sel ? 'rgba(255,210,31,0.95)' : 'rgba(255,255,255,0.5)'; g.lineWidth = lw * (sel ? 2 : 1);
        g.beginPath(); g.moveTo(b.tx, b.ty); g.lineTo(b.tx, b.ty - 6); g.stroke();
        g.fillStyle = sel ? '#ffd21f' : '#ddd';
        g.beginPath(); g.moveTo(b.tx, b.ty - 6); g.lineTo(b.tx + 3.4, b.ty - 5); g.lineTo(b.tx, b.ty - 4); g.fill();
        if (sel && b.n) { g.setLineDash([0.8, 0.8]); g.beginPath(); g.moveTo(b.cx, b.cy); g.lineTo(b.tx, b.ty); g.stroke(); g.setLineDash([]); }
      });
    } else {
      world.squads.forEach((sq, i) => {
        const sel = i === selSquad;
        g.strokeStyle = sq.charge > 0 ? 'rgba(255,90,70,0.9)' : sel ? 'rgba(255,210,31,0.95)' : 'rgba(120,170,255,0.35)';
        g.lineWidth = lw * (sel ? 2 : 1);
        const hw = 6;
        g.beginPath(); g.moveTo(sq.ax - sq.ux * hw, sq.ay - sq.uy * hw); g.lineTo(sq.ax + sq.ux * hw, sq.ay + sq.uy * hw); g.stroke();
        if (sel) {
          g.beginPath(); g.moveTo(sq.ax, sq.ay); g.lineTo(sq.ax + sq.nx * 4, sq.ay + sq.ny * 4); g.stroke();
          g.font = `${12 / z}px sans-serif`; g.fillStyle = '#ffd21f'; g.textAlign = 'center';
          g.fillText(sq.name, sq.ax, sq.ay - 3);
        }
      });
    }
    const w = toWorld(mouse.x, mouse.y);
    g.lineWidth = lw;
    if (mouse.drag) {
      g.strokeStyle = world.side === S.PROTEST ? 'rgba(255,170,60,0.9)' : 'rgba(200,215,240,0.9)';
      g.lineWidth = 1; g.beginPath(); g.moveTo(mouse.drag.x, mouse.drag.y); g.lineTo(w.x, w.y); g.stroke();
    } else if (tool === 'casseurs' || tool === 'gas' || tool === 'fireworks') {
      const r = tool === 'casseurs' ? 8 : tool === 'gas' ? 6 : 6.5;
      g.strokeStyle = tool === 'gas' ? 'rgba(240,240,240,0.7)' : tool === 'casseurs' ? 'rgba(20,20,20,0.9)' : 'rgba(255,90,90,0.9)';
      g.setLineDash([1, 1]); g.beginPath(); g.arc(w.x, w.y, r, 0, 6.283); g.stroke(); g.setLineDash([]);
    }
  };

  // off-screen tutorial targets get an arrow on the screen edge pointing at them
  function drawTutArrow(g) {
    const tt = tut && tut.target();
    if (!tt) return;
    const sx = (tt.x - cam.x) * cam.zoom + canvas.width / 2, sy = (tt.y - cam.y) * cam.zoom + canvas.height / 2;
    const m = 70;
    if (sx > m && sy > m && sx < canvas.width - m && sy < canvas.height - m) return;
    const cx = canvas.width / 2, cy = canvas.height / 2, a = Math.atan2(sy - cy, sx - cx);
    const k = Math.min((canvas.width / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (canvas.height / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
    const ax = cx + Math.cos(a) * k, ay = cy + Math.sin(a) * k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.save(); g.translate(ax, ay); g.rotate(a);
    g.fillStyle = '#ffd21f'; g.strokeStyle = '#111'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(26, 0); g.lineTo(-12, -18); g.lineTo(-4, 0); g.lineTo(-12, 18); g.closePath(); g.stroke(); g.fill();
    g.restore();
  }

  // ------------------------------------------------------------ per-frame
  function handleEvents() {
    const evs = world.events;
    if (!evs.length) return;
    for (const e of evs) {
      if (tut) tut.onEvent(e);
      R.fxEvent(e);
      chat.event(e, world.time);
      switch (e.type) {
        case 'ignite':
          if (camDist(e.x, e.y) < 120 && Math.random() < 0.5) audio.play('ignite', camDist(e.x, e.y));
          if (lastInput === 'pad' && camDist(e.x, e.y) < 60) pad.rumble(120, 0.25, 0.5);
          $('carsBadge').classList.remove('bump'); void $('carsBadge').offsetWidth; $('carsBadge').classList.add('bump');
          if (world.stats.burned === 1) unlock('FIRST_FIRE');
          if (world.stats.burned >= 100) unlock('CENT');
          if (e.by === 'spread') captionOnce('spread', 'IT\'S', 'CATCHING');
          break;
        case 'capture': if (lastInput === 'pad') pad.rumble(350, 0.8, 0.4); audio.play(world.side === S.PROTEST ? 'capture' : 'lost'); caption('PLACE DE LA', e.name.toUpperCase(), 2.4); break;
        case 'retake': audio.play(world.side === S.PROTEST ? 'lost' : 'capture'); break;
        case 'gas': if (world.side === S.PROTEST) audio.play('gas', camDist(e.x, e.y)); break;
        case 'fireworks': if (world.side === S.POLICE) audio.play('firework', camDist(e.x, e.y)); break;
        case 'burst':
          if (e.hit > 20) captionOnce('fw', 'MORTARS', 'LAUNCHED');
          if (e.injured && camDist(e.x, e.y) < 90) tip(e.injured + ' officer' + (e.injured > 1 ? 's' : '') + ' injured');
          break;
        case 'charge': if (world.side === S.PROTEST && camDist(e.x, e.y) < 80) captionOnce('charge', 'THE', 'CHARGE'); break;
        case 'extinguished': if (world.stats.extinguished >= 25) unlock('POMPIER'); break;
        case 'truckSurrounded':
          if (world.side === S.POLICE) { captionOnce('pin', 'TRUCK', 'SURROUNDED'); tip('A fire truck is pinned — charge or gas the crowd around it'); }
          else captionOnce('pin', 'TRUCK', 'PINNED');
          break;
        case 'truckAbandoned':
          caption('TRUCK', 'ABANDONED', 2.2); audio.play(world.side === S.PROTEST ? 'capture' : 'lost');
          if (lastInput === 'pad') pad.rumble(250, 0.6, 0.3);
          break;
        case 'win': case 'lose': end(); break;
      }
    }
    world.events.length = 0;
  }

  function end() {
    const r = world.result, st = world.stats;
    audio.play(r.win ? 'win' : 'lose');
    $('endTitle').textContent = r.win ? (world.side === S.PROTEST ? 'VICTOIRE !' : 'ORDRE RÉTABLI') : 'DÉFAITE';
    $('endTitle').style.color = r.win ? '#ffd21f' : '#ff6b5b';
    $('endStars').textContent = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
    $('endWhy').textContent = r.why;
    $('endStats').innerHTML = [['Cars burned', st.burned], ['Arrests', st.arrests], ['Peak crowd', P.fmtNum(st.peak)],
      ['Landmarks taken', st.captures], ['Officers injured', st.injured || 0], ['Tear gas', st.gasUsed], ['Fireworks', st.fireworks], ['Fires put out', st.extinguished],
      ['Time', P.fmtTime(r.time)]].map(([a, b]) => `<div>${a}<b>${b}</b></div>`).join('');
    const isCampaign = levelIdx >= 0;
    if (r.win && isCampaign) {
      const id = level.id;
      progress.stars[id] = Math.max(progress.stars[id] || 0, r.stars);
      progress.unlocked = Math.max(progress.unlocked, Math.min(P.LEVELS.length, levelIdx + 2));
      saveProgress();
      if (id === 'line') unlock('HOLD');
      if (id === 'nasse') unlock('NASSE');
      if (id === 'brule') unlock('BRULE');
      if (world.side === S.PROTEST && st.burned < 5) unlock('PEACE');
      if (P.LEVELS.every((l) => (progress.stars[l.id] || 0) >= 3)) unlock('ALL3');
    }
    $('endNext').classList.toggle('hidden', !(r.win && isCampaign && levelIdx + 1 < P.LEVELS.length));
    paused = true;
    setTimeout(() => show('endScreen'), 900);
  }
  $('endMenu').onclick = () => quitToMenu();
  $('endRetry').onclick = () => start(level, levelIdx < 0);
  $('endNext').onclick = () => brief(levelIdx + 1);

  function updateHUD() {
    const w = world;
    $('carsN').textContent = w.stats.burned;
    const left = w.timeLimit - w.time;
    $('timer').textContent = P.fmtTime(left);
    $('timer').classList.toggle('low', left < 30);
    const r = res();
    // top bar: CROWD (protest: how many people the movement draws) or AUTHORITY (police money)
    const top = world.side === S.PROTEST ? w.momentum : w.authority;
    $('resFill').style.width = top + '%';
    $('resVal').textContent = Math.floor(top);
    if (world.side === S.PROTEST) {
      $('enFill').style.width = w.energy + '%';
      $('enVal').textContent = Math.floor(w.energy);
    }
    // why the bar moves: net rate and the biggest sources, per minute
    if (world.side === S.PROTEST) {
      const NAMES = { crowd: 'word of mouth', squares: 'squares', fires: 'fires', fireworks: 'mortar hits', gas: 'tear gas', arrests: 'arrests', spent: 'spent', trucks: 'trucks' };
      const rs = Object.entries(w.momRate).filter(([, v]) => Math.abs(v) >= 0.5);
      const net = rs.filter(([k]) => k !== 'spent').reduce((a, [, v]) => a + v, 0);
      rs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const target = w.targetPop(), now = w.protCount;
      const trend = now < target * 0.97 ? '▲ ' + P.fmtNum(target) + ' want to join' : now > target * 1.15 ? '▼ people drifting home' : 'steady';
      $('resWhy').innerHTML = P.fmtNum(now) + ' people · <b class="' + (now <= target ? 'up' : 'down') + '">' + trend + '</b><br>' +
        '<b class="' + (net >= 0 ? 'up' : 'down') + '">' + (net >= 0 ? '+' : '') + net.toFixed(0) + '/min</b> ' +
        rs.filter(([k]) => k !== 'spent').slice(0, 3).map(([k, v]) => NAMES[k] + ' ' + (v >= 0 ? '+' : '') + v.toFixed(0)).join(' · ');
    } else $('resWhy').innerHTML = '<b class="up">+45/min</b> refills on its own';
    $('cProt').textContent = P.fmtNum(w.protCount - w.cassCount);
    $('cCass').textContent = P.fmtNum(w.cassCount);
    $('cPol').textContent = P.fmtNum(w.polCount);
    $('cArr').textContent = w.stats.arrests;
    $('objList').innerHTML = w.objectives.map((o) => `<li class="${o.done ? 'done' : o.failed ? 'failed' : ''}"><span>${o.done ? '✔' : '▸'} ${o.label}</span><b>${o.progress}</b></li>`).join('');
    for (const t of tools()) {
      const el = $('tool_' + t.id); if (!el) continue;
      el.classList.toggle('active', tool === t.id);
      el.classList.toggle('disabled', t.cost > r);
      const cd = w.cooldowns[t.id] || 0;
      el.querySelector('.cd').style.height = (t.cd && cd > 0 ? (cd / t.cd) * 100 : 0) + '%';
    }
    if (world.side === S.PROTEST) $('phoneSub').textContent = P.fmtNum(w.protCount) + ' membres';
    else $('phoneSub').textContent = w.squads.length + ' unités · ' + w.trucksOut + '/' + w.trucksMax + ' VSAV';
    const hh = 14 + Math.floor(w.time / 60 / 4) + (level.night ? 7 : 0), mi = Math.floor(w.time / 4) % 60;
    $('phoneTime').textContent = (hh % 24) + ':' + (mi < 10 ? '0' : '') + mi;
    updateSquadBar();
  }

  function drawMinimap() {
    const w = world, map = w.map, s = mm.width / map.W;
    mmg.imageSmoothingEnabled = true;
    mmg.drawImage(R.tex.mini, 0, 0, mm.width, mm.height);
    const CS = P.CS, CW = w.CW;
    for (let cy = 0; cy < w.CH; cy++) for (let cx = 0; cx < CW; cx++) {
      const k = cy * CW + cx, p = w.densP[k], q = w.densPol[k], gs = w.gas[k];
      if (p > 0.5) { mmg.fillStyle = `rgba(255,${Math.max(40, 160 - p * 6)},60,${Math.min(0.95, 0.25 + p / 25)})`; mmg.fillRect(cx * CS * s, cy * CS * s, CS * s + 0.5, CS * s + 0.5); }
      if (q > 0.5) { mmg.fillStyle = 'rgba(80,140,255,0.95)'; mmg.fillRect(cx * CS * s, cy * CS * s, CS * s + 0.5, CS * s + 0.5); }
      if (gs > 0.2) { mmg.fillStyle = 'rgba(255,255,255,0.5)'; mmg.fillRect(cx * CS * s, cy * CS * s, CS * s, CS * s); }
    }
    mmg.fillStyle = '#ffb000';
    for (const c of map.cars) if (c.state === 1) mmg.fillRect(c.cx * s - 1, c.cy * s - 1, 2.5, 2.5);
    for (const lm of map.landmarks) {
      mmg.strokeStyle = lm.owner === 'protest' ? '#ff4a3a' : '#5a8cff'; mmg.lineWidth = 1.5;
      mmg.beginPath(); mmg.arc(lm.x * s, lm.y * s, lm.r * s, 0, 6.283); mmg.stroke();
    }
    const vw = canvas.width / cam.zoom * s, vh = canvas.height / cam.zoom * s;
    mmg.strokeStyle = '#fff'; mmg.lineWidth = 1;
    mmg.strokeRect((cam.x * s) - vw / 2, (cam.y * s) - vh / 2, vw, vh);
  }

  function audioState() {
    const w = world;
    let nearCrowd = 0, nearFire = 0;
    const CS = P.CS, CW = w.CW, rad = 60 / Math.max(1, cam.zoom / 3);
    const x0 = Math.max(0, ((cam.x - rad) / CS) | 0), x1 = Math.min(CW - 1, ((cam.x + rad) / CS) | 0);
    const y0 = Math.max(0, ((cam.y - rad) / CS) | 0), y1 = Math.min(w.CH - 1, ((cam.y + rad) / CS) | 0);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) nearCrowd += w.densP[y * CW + x];
    for (const c of w.map.cars) if (c.state === 1 && Math.abs(c.cx - cam.x) < rad && Math.abs(c.cy - cam.y) < rad) nearFire++;
    return { nearCrowd: nearCrowd * Math.min(1, 3 / cam.zoom + 0.4), nearFire, panic: w.avgPanic || 0, trucks: w.trucks.length, paused };
  }

  // ------------------------------------------------------------ loop
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    pollPad(dt);
    if (!world) { drawMenuBackdrop(dt); return; }

    // camera
    const pan = 520 / cam.zoom * dt;
    if (keys.KeyW || keys.ArrowUp) cam.y -= pan;
    if (keys.KeyS || keys.ArrowDown) cam.y += pan;
    if (keys.KeyA || keys.ArrowLeft) cam.x -= pan;
    if (keys.KeyD || keys.ArrowRight) cam.x += pan;
    if (settings.edge && !paused && document.hasFocus()) {
      const m = 8;
      if (mouse.x < m) cam.x -= pan; if (mouse.x > canvas.width - m) cam.x += pan;
      if (mouse.y < m) cam.y -= pan; if (mouse.y > canvas.height - m) cam.y += pan;
    }
    const before = toWorld(mouse.x, mouse.y);
    cam.zoom += (cam.tz - cam.zoom) * Math.min(1, dt * 12);
    const after = toWorld(mouse.x, mouse.y);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    // with a pad the reticle is the screen centre, so let the centre reach the map edge
    const padMode = lastInput === 'pad';
    const hw = padMode ? 0 : canvas.width / 2 / cam.zoom, hh = padMode ? 0 : canvas.height / 2 / cam.zoom;
    cam.x = hw * 2 >= world.map.W ? world.map.W / 2 : P.clamp(cam.x, hw, world.map.W - hw);
    cam.y = hh * 2 >= world.map.H ? world.map.H / 2 : P.clamp(cam.y, hh, world.map.H - hh);

    if (!paused) {
      acc += dt * speed;
      let steps = 0;
      while (acc >= P.SIM_DT && steps < 3 * speed) { world.tick(P.SIM_DT); acc -= P.SIM_DT; steps++; }
      if (steps >= 3 * speed) acc = 0; // can't keep up: drop time rather than spiral
      handleEvents();
    }
    R.draw(cam, paused ? 0 : dt, { overlay });
    if (tut && !paused) { tut.update(dt); drawTutArrow(R.g); }
    if (captionT > 0) { captionT -= dt; if (captionT <= 0) $('caption').classList.remove('show'); }
    if (tipT > 0) { tipT -= dt; if (tipT <= 0) $('tip').classList.remove('show'); }
    R.miniT = (R.miniT || 0) - dt;
    if (R.miniT <= 0) { R.miniT = 0.25; drawMinimap(); updateHUD(); }
    audio.update(dt, audioState());
    if (settings.fps) {
      fpsT += dt; fpsN++;
      if (fpsT > 0.5) { $('fps').textContent = Math.round(fpsN / fpsT) + ' fps · ' + world.crowd.n + ' agents'; fpsT = 0; fpsN = 0; }
    }
  }

  // live city behind the main menu
  let menuWorld = null, menuT = 0;
  function drawMenuBackdrop(dt) {
    if (!menuWorld) {
      menuWorld = new P.World(Object.assign(P.sandboxLevel({ side: S.POLICE, pop: 9000, size: 256, squads: 4, night: false, seed: 7 }), { startFrac: 0.8 }), { crowdScale: 1 });
      R.setWorld(menuWorld);
      cam.x = menuWorld.map.landmarks[0].x; cam.y = menuWorld.map.landmarks[0].y; cam.zoom = 2.6;
    }
    if (R.w !== menuWorld) R.setWorld(menuWorld);
    menuT += dt;
    menuWorld.tick(P.SIM_DT);
    menuWorld.events.length = 0;
    cam.x += Math.cos(menuT * 0.05) * dt * 3; cam.y += Math.sin(menuT * 0.04) * dt * 2;
    cam.zoom = 2.6;
    R.draw(cam, dt, null);
  }

  $('ver').textContent = P.VERSION;
  if (!globalThis.steam) $('btnQuit').classList.toggle('hidden', !/Electron/i.test(navigator.userAgent));
  audio.setVolume(settings.vol);
  show('mainMenu');
  requestAnimationFrame(frame);

  // test hook (used by the smoke test; harmless in game)
  P.debug = { get world() { return world; }, get tut() { return tut; }, startTutorial, get padSnap() { return padSnap; }, pad, get lastInput() { return lastInput; }, get padFocus() { return padFocus; }, get screen() { return current; }, get tool() { return tool; }, get selSquad() { return selSquad; }, start: (i) => start(P.LEVELS[i]), cam, primary, pickTool, setPaused: (v) => { paused = v; }, R };
})();
