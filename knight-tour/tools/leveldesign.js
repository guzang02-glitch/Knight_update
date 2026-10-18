// Level design tool: pick one map per stage by (board size, LEN, "경우의 수" = size of the move-sequence tree).
const MOVES = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
function rng(seed) { return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// one generation attempt for a seed (same algorithm as the game)
function attempt(n, len, seed) {
  const r = rng(seed), full = len === n * n;
  const vis = new Array(n * n).fill(false);
  let x = Math.floor(r() * n), y = Math.floor(r() * n);
  const path = [y * n + x]; vis[y * n + x] = true;
  while (path.length < len) {
    let best = null;
    for (const [dx, dy] of MOVES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || vis[ny * n + nx]) continue;
      let d = 0;
      for (const [ex, ey] of MOVES) { const qx = nx + ex, qy = ny + ey; if (qx >= 0 && qy >= 0 && qx < n && qy < n && !vis[qy * n + qx]) d++; }
      const s = d + r() * (full ? 0.99 : 2.5);
      if (!best || s < best.s) best = { nx, ny, s };
    }
    if (!best) return null;
    x = best.nx; y = best.ny; vis[y * n + x] = true; path.push(y * n + x);
  }
  return { n, len, start: path[0], goal: path[len - 1], rock: vis.map(v => !v), solution: path };
}
function nbs(L) {
  const { n } = L, nb = [];
  for (let c = 0; c < n * n; c++) { const x = c % n, y = (c / n) | 0, list = [];
    if (!L.rock[c]) for (const [dx, dy] of MOVES) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < n && ny < n && !L.rock[ny * n + nx]) list.push(ny * n + nx); }
    nb.push(list); }
  return nb;
}
// tree size = number of reachable move sequences (every prefix the player can produce)
function treeSize(L, cap = 400000) {
  const nb = nbs(L), vis = new Uint8Array(L.n * L.n), G = L.goal; let count = 0, sols = 0;
  vis[L.start] = 1;
  function dfs(c, rem) {
    if (++count > cap) throw 0;
    if (rem === 0) { sols++; return; }
    for (const q of nb[c]) { if (vis[q] || (q === G && rem !== 1)) continue; vis[q] = 1; dfs(q, rem - 1); vis[q] = 0; }
  }
  try { dfs(L.start, L.len - 1); return { T: count, exact: true, sols }; } catch (e) {}
  // Knuth estimator for big trees
  const r = rng(L.start * 131 + L.goal * 7 + L.len), probes = 3000; let sum = 0;
  for (let p = 0; p < probes; p++) {
    const v = new Uint8Array(L.n * L.n); v[L.start] = 1; let c = L.start, rem = L.len - 1, prod = 1, tot = 1;
    while (rem > 0) {
      const opts = nb[c].filter(q => !v[q] && (q !== G || rem === 1));
      if (!opts.length) break;
      prod *= opts.length; tot += prod;
      c = opts[Math.floor(r() * opts.length)]; v[c] = 1; rem--;
    }
    sum += tot;
  }
  return { T: Math.round(sum / probes), exact: false, sols: null };
}

// ---- stage plan ----
const L0 = [6, 11, 17, 24, 32], L9 = [9, 16, 24, 33, 48], EXTRA = [2, 2, 3, 3, 4];
function plan(i) {
  const b = Math.floor(i / 10), k = i % 10, n = 4 + b, no = i + 1;
  let len = Math.round(L0[b] + (L9[b] - L0[b]) * k / 9);
  let type = "normal";
  if (no % 5 === 0) { type = "hurdle"; len += 1; }
  else if (no % 10 === 3 || no % 10 === 8) { type = "long"; len = Math.min(len + EXTRA[b], n === 4 ? 10 : Math.floor(n * n * 0.85)); }
  return { no, n, len, type, k };
}

const K = +(process.argv[2] || 150);
const plans = [], pools = [];
for (let i = 0; i < 50; i++) {
  const P = plan(i);
  const cands = [], seen = new Set();
  for (let a = 0; a < K * 8 && cands.length < K; a++) {
    const seed = 1000 + i * 7919 + a * 104729;
    const L = attempt(P.n, P.len, seed);
    if (!L) continue;
    const key = L.solution.join(",");
    if (seen.has(key)) continue; seen.add(key);
    const m = treeSize(L);
    cands.push({ seed, T: m.T, exact: m.exact, start: L.start, goal: L.goal, rocks: L.rock.filter(Boolean).length });
  }
  cands.sort((a, b) => a.T - b.T);
  plans.push(P); pools.push(cands);
}
const pick = new Array(50).fill(null);
const at = (c, p) => c[Math.min(c.length - 1, Math.max(0, Math.floor(p * (c.length - 1))))];
const HUR = 1.3, GROW = 1.06;
// cap for a normal stage: stay well below the next hurdle of its band
const hurdleCap = i => { const b1 = Math.floor(i / 10) * 10 + 10; for (let j = i + 1; j < b1; j++) if (plans[j].type === "hurdle") return pools[j][pools[j].length - 1].T / (HUR * 1.05); return Infinity; };
const longMin = i => [i - 1, i + 1].filter(j => j >= 0 && j < 50 && plans[j].type === "long").reduce((m, j) => Math.max(m, pools[j][0].T + 1), 0);
// 1) normal stages: rise steadily, each above the previous normal stage
let last = 0;
for (let i = 0; i < 50; i++) {
  if (plans[i].type !== "normal") continue;
  const c = pools[i], lo = Math.max(last * GROW, longMin(i)), hi = hurdleCap(i);
  const target = Math.min(hi, Math.max(lo, at(c, 0.3 + 0.4 * plans[i].k / 9).T));
  const ok = c.filter(x => x.T >= lo && x.T <= hi);
  pick[i] = ok.length ? ok.reduce((b, x) => Math.abs(Math.log(x.T / target)) < Math.abs(Math.log(b.T / target)) ? x : b) : c[c.length - 1];
  last = pick[i].T;
}
const prevNormal = i => { for (let j = i - 1; j >= 0; j--) if (plans[j].type === "normal") return pick[j]; return null; };
const nextNormal = i => { for (let j = i + 1; j < 50; j++) if (plans[j].type === "normal") return pick[j]; return null; };
// 2) long stages (x3, x8): longer LEN, fewer cases than both neighbouring normal stages
for (let i = 0; i < 50; i++) {
  if (plans[i].type !== "long") continue;
  const a = prevNormal(i), b = nextNormal(i);
  const hi = Math.min(a ? a.T : Infinity, b ? b.T : Infinity);
  const ok = pools[i].filter(x => x.T < hi * 0.85);
  const ok2 = ok.length ? ok : pools[i].filter(x => x.T < hi);
  pick[i] = ok2.length ? ok2[Math.floor((ok2.length - 1) * 0.5)] : pools[i][0];
}
// 3) hurdle stages (x5, x0): more cases than every other stage before it in the band and the next stage in the band
for (let i = 0; i < 50; i++) {
  if (plans[i].type !== "hurdle") continue;
  const b0 = Math.floor(i / 10) * 10;
  let mx = 0;
  for (let j = b0; j < i; j++) mx = Math.max(mx, pick[j].T);
  if (i + 1 < b0 + 10 && pick[i + 1]) mx = Math.max(mx, pick[i + 1].T);
  const lo = mx * HUR;
  const ok = pools[i].filter(x => x.T >= lo);
  pick[i] = ok.length ? ok[Math.floor((ok.length - 1) * 0.3)] : pools[i][pools[i].length - 1];
}
const out = plans.map((P, i) => ({ ...P, ...pick[i], ncand: pools[i].length }));
// rule check
const fails = [];
out.forEach((s, i) => {
  if (s.type === "long") { const a = prevNormal(i), b = nextNormal(i); if ((a && s.T >= a.T) || (b && s.T >= b.T)) fails.push(s.no + " long-T"); }
  if (s.type === "hurdle") { const b0 = Math.floor(i / 10) * 10; for (let j = b0; j < i; j++) if (out[j].T >= s.T) fails.push(s.no + " hurdle<" + out[j].no); if (i + 1 < b0 + 10 && out[i + 1].T >= s.T) fails.push(s.no + " hurdle<next"); }
  if (s.type === "normal") { const p = prevNormal(i); if (p && s.T <= p.T) fails.push(s.no + " normal-not-rising"); }
});
console.error("rule fails:", fails.join(", ") || "none");
console.log(JSON.stringify(out));
