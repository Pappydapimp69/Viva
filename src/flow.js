// Flow fields: one Dijkstra pass from a goal set gives every tile a distance
// and a downhill direction, so thousands of agents path for the price of one.
// Block a street and the field simply routes everyone around it.
(function () {
  const P = globalThis.PAVE;

  // Shared scratch heap (packed key = dist * 2^17 + tile index, float64 so it never overflows) — no per-call allocation.
  let heap = new Float64Array(1 << 16);
  const SHIFT = 131072; // 2^17, supports maps up to 362x362

  function Field(map, opts) {
    this.map = map;
    this.dist = new Uint16Array(map.N).fill(P.INF);
    this.dx = new Float32Array(map.N);
    this.dy = new Float32Array(map.N);
    this.roadOnly = !!(opts && opts.roadOnly);
    this.sources = null;
    this.ready = false;
    this.dirty = false;
    this.version = -1;
  }

  // sources: array of tile indices
  Field.prototype.compute = function (sources) {
    if (sources) this.sources = sources;
    const map = this.map, W = map.W, H = map.H, N = map.N;
    const solid = map.solid, tile = map.tile, roadOnly = this.roadOnly;
    const dist = this.dist;
    dist.fill(P.INF);
    let hn = 0;
    const push = (key) => {
      if (hn >= heap.length) { const h2 = new Float64Array(heap.length * 2); h2.set(heap); heap = h2; }
      let i = hn++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p] <= key) break;
        heap[i] = heap[p]; i = p;
      }
      heap[i] = key;
    };
    const blocked = (k) => solid[k] || (roadOnly && tile[k] !== 0 && tile[k] !== 2 && tile[k] !== 1);
    for (const s of this.sources) {
      if (s < 0 || s >= N || blocked(s)) continue;
      if (dist[s] !== 0) { dist[s] = 0; push(s); }
    }
    while (hn > 0) {
      const top = heap[0];
      const last = heap[--hn];
      // sift down
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= hn) break;
        if (c + 1 < hn && heap[c + 1] < heap[c]) c++;
        if (heap[c] >= last) break;
        heap[i] = heap[c]; i = c;
      }
      heap[i] = last;
      const d = Math.floor(top / SHIFT), k = top - d * SHIFT;
      if (d > dist[k]) continue;
      const x = k % W, y = (k - x) / W;
      const l = x > 0 && !blocked(k - 1), r = x < W - 1 && !blocked(k + 1);
      const u = y > 0 && !blocked(k - W), dn = y < H - 1 && !blocked(k + W);
      let nd;
      nd = d + 10;
      if (l && nd < dist[k - 1]) { dist[k - 1] = nd; push(nd * SHIFT + k - 1); }
      if (r && nd < dist[k + 1]) { dist[k + 1] = nd; push(nd * SHIFT + k + 1); }
      if (u && nd < dist[k - W]) { dist[k - W] = nd; push(nd * SHIFT + k - W); }
      if (dn && nd < dist[k + W]) { dist[k + W] = nd; push(nd * SHIFT + k + W); }
      nd = d + 14;
      if (nd >= P.INF) continue;
      if (l && u && !blocked(k - W - 1) && nd < dist[k - W - 1]) { dist[k - W - 1] = nd; push(nd * SHIFT + k - W - 1); }
      if (r && u && !blocked(k - W + 1) && nd < dist[k - W + 1]) { dist[k - W + 1] = nd; push(nd * SHIFT + k - W + 1); }
      if (l && dn && !blocked(k + W - 1) && nd < dist[k + W - 1]) { dist[k + W - 1] = nd; push(nd * SHIFT + k + W - 1); }
      if (r && dn && !blocked(k + W + 1) && nd < dist[k + W + 1]) { dist[k + W + 1] = nd; push(nd * SHIFT + k + W + 1); }
    }
    // Directions: weighted sum of downhill neighbours (smoother than 8-way snapping).
    const DX = this.dx, DY = this.dy;
    const OX = [-1, 1, 0, 0, -1, 1, -1, 1], OY = [0, 0, -1, 1, -1, -1, 1, 1], OC = [10, 10, 10, 10, 14, 14, 14, 14];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x, d0 = dist[k];
      let sx = 0, sy = 0;
      if (d0 !== P.INF && d0 !== 0) {
        for (let n = 0; n < 8; n++) {
          const xx = x + OX[n], yy = y + OY[n];
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const dn = dist[yy * W + xx];
          if (dn >= d0) continue;
          if (n >= 4 && (dist[y * W + xx] === P.INF || dist[yy * W + x] === P.INF)) continue;
          const g = (d0 - dn) / OC[n];
          const inv = n >= 4 ? 0.7071 : 1;
          sx += OX[n] * g * inv; sy += OY[n] * g * inv;
        }
        const m = Math.hypot(sx, sy);
        if (m > 0) { sx /= m; sy /= m; }
      }
      DX[k] = sx; DY[k] = sy;
    }
    this.ready = true;
    this.dirty = false;
    this.version = map.version;
    return this;
  };

  // Distance (in tiles) at a world position, Infinity if unreachable.
  Field.prototype.distAt = function (x, y) {
    const m = this.map;
    if (x < 0 || y < 0 || x >= m.W || y >= m.H) return Infinity;
    const d = this.dist[(y | 0) * m.W + (x | 0)];
    return d === P.INF ? Infinity : d / 10;
  };

  P.Field = Field;

  // Sources helper: all open tiles within radius r of (x,y).
  P.discSources = function (map, x, y, r) {
    const out = [];
    const r2 = r * r;
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (xx < 0 || yy < 0 || xx >= map.W || yy >= map.H) continue;
      if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 > r2) continue;
      const k = yy * map.W + xx;
      if (!map.solid[k]) out.push(k);
    }
    if (!out.length) {
      const n = map.nearestOpen(x, y, 20);
      if (n) out.push((n.y | 0) * map.W + (n.x | 0));
    }
    return out;
  };
})();
