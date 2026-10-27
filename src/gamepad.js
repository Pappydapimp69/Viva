// Gamepad input: polled every frame (Chrome hides a pad from the API until one
// of its buttons is pressed, so `gamepadconnected` can't be trusted), radial
// deadzone (a per-axis one leaves square dead gaps on the diagonals), button
// edges, and debounced repeat for menu navigation from stick OR D-pad.
(function () {
  const P = globalThis.PAVE;

  // Standard-mapping button indices.
  const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  P.PAD = B;

  // Radial deadzone with rescale: output magnitude runs 0..1 from the edge of the dead circle.
  P.radialDeadzone = function (x, y, dz) {
    const m = Math.hypot(x, y);
    if (m <= dz) return { x: 0, y: 0, m: 0 };
    const k = Math.min(1, (m - dz) / (1 - dz)) / m;
    return { x: x * k, y: y * k, m: Math.min(1, (m - dz) / (1 - dz)) };
  };

  function PadInput(source) {
    // source() returns an array-like of Gamepad objects; injectable for tests
    this.source = source || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
    this.prev = new Uint8Array(17);
    this.down = new Uint8Array(17);
    this.navDir = null; this.navT = 0;
    this.connected = false; this.id = '';
    this.pad = null;
  }

  PadInput.prototype.poll = function (dt) {
    const pads = this.source() || [];
    const down = this.down, prev = this.prev;
    prev.set(down); down.fill(0);
    let lx = 0, ly = 0, rx = 0, ry = 0, lt = 0, rt = 0, best = 0;
    this.connected = false; this.pad = null;
    for (let p = 0; p < pads.length; p++) {
      const g = pads[p];
      if (!g || g.connected === false) continue;
      if (!this.connected) { this.id = g.id || 'Controller'; this.pad = g; }
      this.connected = true;
      const bs = g.buttons || [];
      for (let i = 0; i < 17 && i < bs.length; i++) {
        const b = bs[i];
        const v = typeof b === 'object' ? b.value : b;
        const pr = typeof b === 'object' ? b.pressed || v > 0.5 : v > 0.5;
        if (pr) down[i] = 1;
        if (i === B.LT) lt = Math.max(lt, v || 0);
        if (i === B.RT) rt = Math.max(rt, v || 0);
      }
      const ax = g.axes || [];
      const l = P.radialDeadzone(ax[0] || 0, ax[1] || 0, 0.18), r = P.radialDeadzone(ax[2] || 0, ax[3] || 0, 0.18);
      // several pads: the one pushed hardest drives the sticks
      if (l.m + r.m > best) { best = l.m + r.m; lx = l.x; ly = l.y; rx = r.x; ry = r.y; }
    }
    this.lx = lx; this.ly = ly; this.rx = rx; this.ry = ry; this.lt = lt; this.rt = rt;
    this.lm = Math.hypot(lx, ly);
    let any = best > 0 || lt > 0.1 || rt > 0.1;
    for (let i = 0; i < 17; i++) if (down[i]) { any = true; break; }
    this.any = any;

    // menu navigation: D-pad wins, else left stick past half-tilt; fire, wait, then repeat
    let dir = null;
    if (down[B.UP]) dir = 'up'; else if (down[B.DOWN]) dir = 'down';
    else if (down[B.LEFT]) dir = 'left'; else if (down[B.RIGHT]) dir = 'right';
    else if (this.lm > 0.5) dir = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 'right' : 'left') : (ly > 0 ? 'down' : 'up');
    this.nav = null;
    if (dir !== this.navDir) { this.navDir = dir; this.navT = 0.38; this.nav = dir; }
    else if (dir) { this.navT -= dt; if (this.navT <= 0) { this.navT = 0.13; this.nav = dir; } }
    return this;
  };
  PadInput.prototype.pressed = function (i) { return this.down[i] === 1 && this.prev[i] === 0; };
  PadInput.prototype.released = function (i) { return this.down[i] === 0 && this.prev[i] === 1; };
  PadInput.prototype.held = function (i) { return this.down[i] === 1; };

  // Rumble only if this pad actually has an actuator (web haptics support is patchy).
  PadInput.prototype.rumble = function (ms, strong, weak) {
    const a = this.pad && this.pad.vibrationActuator;
    if (!a || !a.playEffect) return;
    try { a.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {}); } catch (e) { /* unsupported */ }
  };

  P.PadInput = PadInput;
})();
