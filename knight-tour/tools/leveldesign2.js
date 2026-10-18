// Level design v2: case count (move-sequence tree size) follows a target curve from stage 1,
// LEN is the shortest length that can reach the target. Hurdle (x5/x0) and long (x3/x8) rules kept.
const src = require("fs").readFileSync(__dirname + "/leveldesign.js", "utf8");
const { attempt, treeSize } = new Function(src.slice(0, src.indexOf("// ---- stage plan")) + "; return { attempt, treeSize };")();
const K = +(process.argv[2] || 120);

// target log10(case count) for normal stages: linear between anchors (stage → log10)
const ANCHORS = [[1, 0.78], [9, 2.1], [19, 3.6], [29, 5.2], [39, 7.0], [49, 10.3]];
function targetLog(no) {
  for (let a = 0; a < ANCHORS.length - 1; a++) {
    const [s0, v0] = ANCHORS[a], [s1, v1] = ANCHORS[a + 1];
    if (no <= s1) return v0 + (v1 - v0) * (no - s0) / (s1 - s0);
  }
  return ANCHORS[ANCHORS.length - 1][1];
}
const N = i => 4 + Math.floor(i / 10);
const TYPE = no => no % 5 === 0 ? "hurdle" : (no % 10 === 3 || no % 10 === 8) ? "long" : "normal";
const MAXLEN = n => n === 4 ? 14 : Math.floor(n * n * 0.82);

const cache = new Map();
function pool(i, len) {
  const key = i + ":" + len;
  if (cache.has(key)) return cache.get(key);
  const n = N(i), cands = [], seen = new Set();
  for (let a = 0; a < K * 10 && cands.length < K; a++) {
    const seed = 1000 + i * 7919 + len * 613 + a * 104729;
    const L = attempt(n, len, seed);
    if (!L) continue;
    const k = L.solution.join(","); if (seen.has(k)) continue; seen.add(k);
    const m = treeSize(L, n >= 7 ? 100000 : 400000);
    cands.push({ seed, len, T: m.T, exact: m.exact, start: L.start, goal: L.goal });
  }
  cands.sort((a, b) => a.T - b.T);
  cache.set(key, cands);
  return cands;
}
const lg = x => Math.log10(x);
const pick = new Array(50).fill(null);

// 1) normal stages
let lastT = 0, lastLen = 0;
for (let i = 0; i < 50; i++) {
  const no = i + 1, n = N(i);
  if (TYPE(no) !== "normal") continue;
  if (i % 10 === 0) lastLen = Math.max(6, lastLen - 1);           // new board: LEN may restart a little lower
  const tgt = Math.max(targetLog(no), lg(lastT * 1.2 || 1));
  let best = null;
  const afterLong = i > 0 && TYPE(i) === "long";                    // leave room for the long stage before this one
  for (let len = Math.max(6, lastLen); len <= Math.min(MAXLEN(n), Math.max(6, lastLen) + (afterLong ? 1 : 4)); len++) {
    const c = pool(i, len).filter(x => x.T > lastT * 1.15);
    if (!c.length) continue;
    const cand = c.reduce((b, x) => Math.abs(lg(x.T) - tgt) < Math.abs(lg(b.T) - tgt) ? x : b);
    const err = Math.abs(lg(cand.T) - tgt);
    if (!best || err < best.err - 0.05) best = { ...cand, err };    // prefer the shorter LEN unless clearly better
    if (err < 0.08) break;
  }
  if (!best) throw new Error("no normal candidate for stage " + no);
  pick[i] = best; lastT = best.T; lastLen = best.len;
}
const prevN = i => { for (let j = i - 1; j >= 0; j--) if (TYPE(j + 1) === "normal") return pick[j]; };
const nextN = i => { for (let j = i + 1; j < 50; j++) if (TYPE(j + 1) === "normal") return pick[j]; };

// 2) long stages: LEN longer than both neighbours, fewer cases than both
for (let i = 0; i < 50; i++) {
  if (TYPE(i + 1) !== "long") continue;
  const a = prevN(i), b = nextN(i), n = N(i);
  const hiT = Math.min(a ? a.T : Infinity, b ? b.T : Infinity);
  const minLen = Math.max(a ? a.len : 0, b ? b.len : 0) + (n <= 5 ? 1 : 2);
  let got = null;
  for (let len = Math.min(minLen, MAXLEN(n)); len <= MAXLEN(n) && !got; len++) {
    let ok = pool(i, len).filter(x => x.T < hiT * 0.8);
    if (!ok.length) ok = pool(i, len).filter(x => x.T < hiT);
    if (ok.length) got = ok[Math.floor((ok.length - 1) * 0.6)];
  }
  if (!got) { const c = pool(i, Math.min(minLen, MAXLEN(n))); got = c[0]; }
  pick[i] = got;
}

// 3) hurdles: more cases than every earlier stage in the band and the next stage in the band
for (let i = 0; i < 50; i++) {
  if (TYPE(i + 1) !== "hurdle") continue;
  const b0 = Math.floor(i / 10) * 10, n = N(i);
  let mx = 0, ln = 0;
  for (let j = b0; j < i; j++) { mx = Math.max(mx, pick[j].T); if (TYPE(j + 1) === "normal") ln = Math.max(ln, pick[j].len); }
  if (i + 1 < b0 + 10) { mx = Math.max(mx, pick[i + 1].T); ln = Math.max(ln, pick[i + 1].len); }
  const need = mx * 1.5;
  let got = null;
  for (let len = Math.min(ln + 1, MAXLEN(n)); len <= Math.min(MAXLEN(n), ln + 4) && !got; len++) {
    const ok = pool(i, len).filter(x => x.T >= need);
    if (ok.length) got = ok[Math.floor((ok.length - 1) * 0.25)];
  }
  if (!got) { const c = pool(i, Math.min(MAXLEN(n), ln + 4)); got = c[c.length - 1]; }
  pick[i] = got;
}

// rule check
const out = pick.map((p, i) => ({ no: i + 1, n: N(i), type: TYPE(i + 1), ...p }));
const fails = [];
out.forEach((s, i) => {
  if (s.type === "normal") { const p = prevN(i); if (p && s.T <= p.T) fails.push(s.no + " normal"); }
  if (s.type === "long") { const a = prevN(i), b = nextN(i); if ((a && (s.T >= a.T || s.len <= a.len)) || (b && (s.T >= b.T || s.len <= b.len))) fails.push(s.no + " long"); }
  if (s.type === "hurdle") { const b0 = Math.floor(i / 10) * 10; for (let j = b0; j < i; j++) if (out[j].T >= s.T) fails.push(s.no + " hurdle<" + out[j].no); if (i + 1 < b0 + 10 && out[i + 1].T >= s.T) fails.push(s.no + " hurdle<next"); }
});
console.error("rule fails:", fails.join(", ") || "none");
console.log(JSON.stringify(out));
