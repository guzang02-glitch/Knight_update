  // ---------- levels ----------
  // StageTable: [board size, cells to step on (LEN), map seed, type, gimmick pieces, gimmick count]
  // 1–10 knight only, 11–20 + king, 21–30 + rook, 31–40 + bishop, 41–50 all pieces.
  // Type: N normal, H hurdle (x5/x0), L long (x3/x8). Seeds picked by tools/leveldesign-chess.js
  // (single answer route, move-sequence tree ≤ 100,000 for every stage).
  const STAGES = /*STAGES*/[]/*/STAGES*/;
  // ==LEVELGEN==
  const MOVES = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
  const KING = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  const LINES = { R: [[1,0],[-1,0],[0,1],[0,-1]], B: [[1,1],[1,-1],[-1,1],[-1,-1]] };

  function rng(seed) {
    return () => {
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Cells reachable in one move from c for a piece ("N" knight, "K" king, "R" rook, "B" bishop).
  // Rook and bishop slide any distance and may stop on any open cell; only rocks (and the edge) block the line,
  // stepped cells can be passed over. `blocked(q)` says whether q is a rock.
  function pieceMoves(n, c, kind, blocked) {
    const x = c % n, y = (c / n) | 0, out = [];
    if (kind === "R" || kind === "B") {
      for (const [dx, dy] of LINES[kind]) {
        let nx = x + dx, ny = y + dy;
        while (nx >= 0 && ny >= 0 && nx < n && ny < n && !blocked(ny * n + nx)) { out.push(ny * n + nx); nx += dx; ny += dy; }
      }
      return out;
    }
    for (const [dx, dy] of kind === "K" ? KING : MOVES) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < n && ny < n && !blocked(ny * n + nx)) out.push(ny * n + nx);
    }
    return out;
  }

  // Draw a random route of the target length (Warnsdorff + noise); every cell off the route becomes a rock.
  // Gimmick cells are placed on the route at roughly even steps: standing on one, the next move uses that piece.
  // A rook / bishop step only crosses cells already on the route, so the line stays open once rocks are placed.
  // spec = [board size, LEN, seed, type, pieces, count] (a StageTable row, or a daily puzzle's spec)
  function genLevel(spec) {
    const [n, len, seed, type, kinds = "", gcount = 0] = spec;
    const full = len === n * n;
    for (let attempt = 0; attempt < 2000; attempt++) {
      const r = rng(seed + attempt * 7);
      const vis = new Array(n * n).fill(false), gim = new Array(n * n).fill("");
      const slots = new Set();
      for (let g = 0; g < gcount; g++) {
        let k = 1 + Math.floor((g + 0.25 + r() * 0.5) * (len - 3) / gcount);
        while (slots.has(k)) k++;
        slots.add(k);
      }
      let c = Math.floor(r() * n * n), placed = 0;
      const path = [c];
      vis[c] = true;
      while (path.length < len) {
        const step = path.length - 1;
        let kind = "N", cands = null;
        if (slots.has(step) && placed < gcount && step > 0) {
          const k = kinds[placed % kinds.length];          // rotate: the chapter's own piece first, then the mix
          const opts = pieceMoves(n, c, k, () => false).filter(q => !vis[q] && lineClear(n, c, q, vis));
          if (opts.length) { kind = k; cands = opts; gim[c] = k; placed++; }
          else { let k = step + 1; while (slots.has(k)) k++; slots.add(k); }   // try a later step instead
        }
        if (!cands) cands = pieceMoves(n, c, "N", () => false).filter(q => !vis[q]);
        let best = null;
        for (const q of cands) {
          let d = 0;
          for (const e of pieceMoves(n, q, "N", () => false)) if (!vis[e]) d++;
          const s = d + r() * (full ? 0.99 : 2.5);
          if (!best || s < best.s) best = { q, s };
        }
        if (!best) break;
        c = best.q; vis[c] = true; path.push(c);
      }
      if (path.length === len && placed === gcount)
        return { n, len, type, start: path[0], goal: path[len - 1], solution: path, rock: vis.map(v => !v), gim };
    }
    throw new Error("level generation failed: " + spec);
  }
  // every cell strictly between a and b (same line) is already on the route
  function lineClear(n, a, b, vis) {
    const ax = a % n, ay = (a / n) | 0, bx = b % n, by = (b / n) | 0;
    const dx = Math.sign(bx - ax), dy = Math.sign(by - ay);
    for (let x = ax + dx, y = ay + dy; x !== bx || y !== by; x += dx, y += dy) if (!vis[y * n + x]) return false;
    return true;
  }

  // nb[c] = cells reachable from c with c's own piece (out-edges); inb[q] = cells that can reach q (in-edges)
  function neighbors(L) {
    const { n } = L, nb = [];
    for (let c = 0; c < n * n; c++) nb.push(L.rock[c] ? [] : pieceMoves(n, c, L.gim ? L.gim[c] || "N" : "N", q => L.rock[q]));
    L.inb = nb.map(() => []);
    nb.forEach((list, c) => list.forEach(q => L.inb[q].push(c)));
    return nb;
  }

  // Depth-first search for routes that cover every open cell and end on the goal, continuing `path`.
  // Returns { next, count, nodes }: next = first cell of a found route (-1 none, -2 gave up at `limit` nodes).
  // countUpTo > 0 keeps searching until that many routes are found (used to check uniqueness).
  // Moves are one-way (a rook can reach a cell that cannot jump back), so in- and out-edges are checked separately.
  function searchLevel(L, path, limit, countUpTo = 0) {
    const nb = L.nb, inb = L.inb, total = L.n * L.n, G = L.goal;
    const vis = new Uint8Array(total);
    for (const c of path) vis[c] = 1;
    let nodes = 0, count = 0;
    const free = q => { let d = 0; for (const r of nb[q]) if (!vis[r]) d++; return d; };
    const seen = new Uint8Array(total), queue = new Int16Array(total);
    // every open cell needs a way in (from an open cell or the current one) and, except the goal, a way out
    function hopeless(c, rem) {
      if (rem <= 1) return false;
      for (let q = 0; q < total; q++) {
        if (L.rock[q] || vis[q]) continue;
        let ins = 0, inA = -1;
        for (const p of inb[q]) if (!vis[p] || p === c) { ins++; inA = p; }
        if (!ins) return true;
        if (q === G) continue;
        let outs = 0, outA = -1;
        for (const r of nb[q]) if (!vis[r]) { outs++; outA = r; }
        if (!outs || (ins === 1 && outs === 1 && inA === outA)) return true;
      }
      // every open cell must still be reachable from here
      seen.fill(0); seen[c] = 1;
      let head = 0, tail = 0, reached = 0;
      queue[tail++] = c;
      while (head < tail) {
        const p = queue[head++];
        for (const r of nb[p]) if (!vis[r] && !seen[r]) { seen[r] = 1; reached++; queue[tail++] = r; }
      }
      return reached < rem;
    }
    function order(c, rem) {
      return nb[c].filter(q => !vis[q] && (q !== G || rem === 1))
        .map(q => [q, free(q)]).sort((a, b) => a[1] - b[1]).map(p => p[0]);
    }
    function dfs(c, rem) {
      if (rem === 0) return ++count >= Math.max(1, countUpTo);
      if (++nodes > limit) throw "timeout";
      if (hopeless(c, rem)) return false;
      for (const q of order(c, rem)) {
        vis[q] = 1;
        const stop = dfs(q, rem - 1);
        vis[q] = 0;
        if (stop) return true;
      }
      return false;
    }
    const c0 = path[path.length - 1], rem0 = L.len - path.length;
    let first = -1;
    try {
      if (rem0 === 0 || hopeless(c0, rem0)) return { next: -1, count, nodes };
      for (const q of order(c0, rem0)) {
        vis[q] = 1;
        const before = count;
        const stop = dfs(q, rem0 - 1);
        vis[q] = 0;
        if (count > before && first < 0) first = q;
        if (stop) break;
      }
      return { next: first, count, nodes };
    } catch (e) { return { next: first >= 0 ? first : -2, count, nodes }; }
  }

  // "경우의 수": number of move sequences the player can make from the start (every prefix, dead ends included).
  // Throws once `cap` is passed. Also counts complete routes.
  function treeSize(L, cap) {
    const nb = L.nb, vis = new Uint8Array(L.n * L.n), G = L.goal;
    let count = 0, sols = 0;
    vis[L.start] = 1;
    (function dfs(c, rem) {
      if (++count > cap) throw "cap";
      if (rem === 0) { sols++; return; }
      for (const q of nb[c]) { if (vis[q] || (q === G && rem !== 1)) continue; vis[q] = 1; dfs(q, rem - 1); vis[q] = 0; }
    })(L.start, L.len - 1);
    return { T: count, sols };
  }
  // ==/LEVELGEN==

