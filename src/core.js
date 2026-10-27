// PAVÉ — core namespace, constants, seeded RNG, small helpers.
// Every src file is a classic script that attaches to globalThis.PAVE so the
// game runs from file:// (Electron / double-click) and the sim loads in Node tests.
(function () {
  const P = (globalThis.PAVE = globalThis.PAVE || {});

  P.VERSION = '1.0.0';

  // Tile kinds
  P.T = { ROAD: 0, SIDEWALK: 1, PLAZA: 2, BUILDING: 3, PARK: 4, MONUMENT: 5 };
  // Agent kinds
  P.K = { PROT: 0, CASS: 1, POL: 2, DEAD: 255 };
  // Sides
  P.SIDE = { PROTEST: 'protest', POLICE: 'police' };

  P.CS = 4;          // coarse cell size in tiles (density / gas / heat grids)
  P.TS = 5;          // base-map texture pixels per tile
  P.SIM_DT = 1 / 30; // fixed simulation step
  P.INF = 65535;

  // mulberry32 — seeded, so a level replays the same map every time.
  P.rng = function (seed) {
    let s = seed >>> 0 || 1;
    const r = function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
    r.range = (a, b) => a + r() * (b - a);
    r.pick = (a) => a[Math.floor(r() * a.length)];
    r.shuffle = (a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    };
    return r;
  };

  P.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  P.lerp = (a, b, t) => a + (b - a) * t;
  P.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  P.fmtTime = (s) => {
    s = Math.max(0, Math.ceil(s));
    const m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  };
  P.fmtNum = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(Math.round(n)));
})();
