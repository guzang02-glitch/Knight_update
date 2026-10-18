// How often is a generated map single-solution, per board / LEN? And what does it cost to prove?
const src = require("fs").readFileSync(__dirname + "/leveldesign.js", "utf8");
const { attempt, treeSize, nbs } = new Function(src.slice(0, src.indexOf("// ---- stage plan")) + "; return { attempt, treeSize, nbs };")();

// count full solutions (stop at 2) with the game's pruning; returns 1, 2 or -1 (gave up)
function countSolutions(L, limit = 3e6) {
  const nb = nbs(L), total = L.n * L.n, G = L.goal, vis = new Uint8Array(total);
  vis[L.start] = 1;
  let nodes = 0, sols = 0;
  const seen = new Uint8Array(total), queue = new Int16Array(total);
  const free = q => { let d = 0; for (const r of nb[q]) if (!vis[r]) d++; return d; };
  function hopeless(c, rem) {
    if (rem <= 1) return false;
    for (let q = 0; q < total; q++) {
      if (L.rock[q] || vis[q]) continue;
      const d = free(q) + (nb[c].includes(q) ? 1 : 0);
      if (d < (q === G ? 1 : 2)) return true;
    }
    seen.fill(0); seen[c] = 1; let h = 0, tl = 0, reached = 0; queue[tl++] = c;
    while (h < tl) { const p = queue[h++]; for (const r of nb[p]) if (!vis[r] && !seen[r]) { seen[r] = 1; reached++; queue[tl++] = r; } }
    return reached < rem;
  }
  function dfs(c, rem) {
    if (rem === 0) { sols++; return sols >= 2; }
    if (++nodes > limit) throw 0;
    if (hopeless(c, rem)) return false;
    const opts = nb[c].filter(q => !vis[q] && (q !== G || rem === 1)).sort((a, b) => free(a) - free(b));
    for (const q of opts) { vis[q] = 1; const stop = dfs(q, rem - 1); vis[q] = 0; if (stop) return true; }
    return false;
  }
  try { dfs(L.start, L.len - 1); return { sols: Math.min(sols, 2), nodes }; } catch (e) { return { sols: -1, nodes }; }
}
module.exports = { countSolutions };

if (require.main === module) {
  for (const [n, len] of [[4, 10], [5, 16], [6, 22], [7, 30], [8, 36], [8, 42]]) {
    let u = 0, two = 0, unk = 0, tried = 0; const t0 = Date.now(); const uT = [];
    for (let a = 0; tried < 200 && a < 4000; a++) {
      const L = attempt(n, len, 555 + a * 104729 + len);
      if (!L) continue; tried++;
      const r = countSolutions(L);
      if (r.sols === 1) { u++; uT.push(treeSize(L, 100000).T); } else if (r.sols === 2) two++; else unk++;
    }
    uT.sort((a, b) => a - b);
    console.log(`${n}x${n} LEN ${len}: unique ${u}/${tried}, multi ${two}, unknown ${unk}, ${Date.now() - t0}ms  unique case range ${uT[0] || "-"} ~ ${uT[uT.length - 1] || "-"}`);
  }
}
