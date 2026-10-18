// Level design for the chess-gimmick version.
// Rules: every stage has exactly one answer route and a move-sequence tree ("경우의 수") of at most 100,000.
// 1–10 knight only (4×4), 11–20 + king (5×5), 21–30 + rook (6×6), 31–40 + bishop (7×7), 41–50 all (8×8).
// Each new piece starts with an easy intro stage (one gimmick, case count dips), then the curve climbs again.
// Usage: node leveldesign-chess.js [candidates per LEN] > stages.json
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
const block = html.slice(html.indexOf("// ==LEVELGEN=="), html.indexOf("// ==/LEVELGEN=="));
const { genLevel, neighbors, treeSize } = new Function(block + "; return { genLevel, neighbors, treeSize };")();

const K = +(process.argv[2] || 60);
const CAP = 100000;
const N = i => 4 + Math.floor(i / 10);
const TYPE = no => no % 5 === 0 ? "H" : (no % 10 === 3 || no % 10 === 8) ? "L" : "N";

// pieces and gimmick count per stage (index 0–49)
const CH = [
  { kinds: "", g: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { kinds: "K", g: [1, 1, 1, 2, 2, 2, 2, 3, 3, 3] },
  { kinds: "R", mix: "RK", g: [1, 1, 1, 2, 2, 2, 2, 3, 3, 3] },
  { kinds: "B", mix: "BRK", g: [1, 1, 1, 2, 2, 2, 2, 3, 3, 3] },
  { kinds: "KRB", g: [2, 2, 2, 3, 3, 3, 3, 4, 4, 4] },
];
function gimmicks(i) {
  const ch = CH[Math.floor(i / 10)], k = i % 10;
  return { kinds: k >= 3 && ch.mix ? ch.mix : ch.kinds, g: ch.g[k] };
}

// target log10(case count) for normal stages; each chapter dips at its intro stage and climbs to the next peak
const ANCH = [[1, 0.78], [10, 2.1], [11, 1.8], [20, 3.1], [21, 2.7], [30, 3.8], [31, 3.4], [40, 4.4], [41, 4.0], [50, 4.95]];
function targetLog(no) {
  for (let a = 0; a < ANCH.length - 1; a++) {
    const [s0, v0] = ANCH[a], [s1, v1] = ANCH[a + 1];
    if (no >= s0 && no <= s1) return s1 === s0 ? v0 : v0 + (v1 - v0) * (no - s0) / (s1 - s0);
  }
  return 4.95;
}
const LEN_RANGE = { 4: [6, 13], 5: [9, 19], 6: [12, 26], 7: [14, 32], 8: [16, 38] };

const lg = Math.log10;
const pools = new Map();
function pool(i, len) {
  const key = i + ":" + len;
  if (!pools.has(key)) pools.set(key, makePool(i, len));
  return pools.get(key);
}
function makePool(i, len) {
  const n = N(i), { kinds, g } = gimmicks(i), out = [], seen = new Set();
  for (let a = 0; a < K * 20 && out.length < K; a++) {
    const seed = 1000 + i * 7919 + len * 613 + a * 104729;
    let L;
    try { L = genLevel([n, len, seed, TYPE(i + 1), kinds, g]); } catch (e) { continue; }
    const key = L.solution.join(",");
    if (seen.has(key)) continue; seen.add(key);
    L.nb = neighbors(L);
    let m;
    try { m = treeSize(L, CAP); } catch (e) { continue; }      // over 100,000 move sequences
    if (m.sols !== 1) continue;                                // single answer route only
    out.push({ seed, len, T: m.T });
  }
  return out;
}

const pick = [];
let prevNormal = 0;
for (let i = 0; i < 50; i++) {
  const no = i + 1, n = N(i), type = TYPE(no), [lo, hi] = LEN_RANGE[n];
  const intro = i % 10 === 0;
  let tgt = targetLog(no);
  if (type === "H") tgt += 0.2;                                  // hurdle: a bit above the curve
  if (type === "L") tgt -= 0.15;                                 // long road: longer, fewer branches
  tgt = Math.min(tgt, lg(CAP * 0.97));
  const prevLen = pick.length && !intro ? pick[i - 1].len : lo;
  const lens = [];
  const from = intro ? lo : Math.max(lo, prevLen - 2), to = intro ? hi : Math.min(hi, prevLen + (type === "L" ? 6 : 4));
  for (let len = from; len <= to; len++) lens.push(len);
  let best = null;
  for (const strict of [true, false]) {
   if (best) break;
   for (const len of lens) {
    for (const c of pool(i, len)) {
      if (strict && type === "N" && !intro && c.T <= prevNormal) continue;   // normal stages keep climbing within a chapter
      if (strict && type === "H" && c.T <= pick[i - 1].T) continue;           // hurdle beats the stage before it
      let err = Math.abs(lg(c.T) - tgt);
      if (type === "L") err += Math.max(0, prevLen + 1 - len) * 0.3;  // long road should be longer
      if (!best || err < best.err) best = { ...c, err };
    }
   }
  }
  if (!best) throw new Error("no candidate for stage " + no);
  const { kinds, g } = gimmicks(i);
  pick.push({ no, n, len: best.len, seed: best.seed, type, kinds, g, T: best.T });
  if (type === "N") prevNormal = intro ? best.T : Math.max(prevNormal, best.T);
  if (intro) prevNormal = best.T;
  console.error(`${no}\t${n}x${n}\tLEN ${best.len}\t${type}\t${kinds || "-"}×${g}\tcases ${best.T}\t(target ${Math.round(10 ** tgt)})`);
}
console.log(JSON.stringify(pick));
