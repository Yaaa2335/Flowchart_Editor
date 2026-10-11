/* router.js —— 箭头路径计算（正交折线 / 直线 / 曲线 / 自环）。纯函数，可在 Node 中单测。 */
(function (factory) {
  var isNode = typeof module === 'object' && module.exports;
  var G = isNode ? require('./geom.js') : (window.FD || {}).geom;
  var api = factory(G);
  if (isNode) module.exports = api;
  if (typeof window !== 'undefined') { (window.FD = window.FD || {}).router = api; }
})(function (G) {
  'use strict';

  var DIRS = {
    t: { x: 0, y: -1 },
    r: { x: 1, y: 0 },
    b: { x: 0, y: 1 },
    l: { x: -1, y: 0 }
  };

  var STUB = 14;
  var CORNER = 10;
  var MIN_SEG = 16;      // 转折点距离端口所在直线的最小间距
  var PARALLEL_GAP = 20; // 同一对组件之间多根箭头的错位间距
  var CORNER_SLACK = 80; // 混合走向的拐点允许拉出这个范围
  var TAIL_GAP = 14;     // 箭头尾端到最近转折点之间要留出的空白
  var OBSTACLE_PAD = 6;  // 避让时给组件留的安全距离

  function isFixed(port) { return port === 't' || port === 'r' || port === 'b' || port === 'l'; }

  /**
   * 解析端点：既可以是挂在组件上（{node, port}），
   * 也可以是自由位置（{point:{x,y}}），后者用 0×0 的虚拟节点参与几何计算。
   */
  function resolveEnd(ref, nodes) {
    if (!ref) return null;
    if (ref.node && nodes[ref.node]) return nodes[ref.node];
    if (ref.point && isFinite(ref.point.x) && isFinite(ref.point.y)) {
      return {
        id: '\u0000free', shape: 'process', free: true,
        x: ref.point.x, y: ref.point.y, w: 0, h: 0,
        radius: 0, style: {}
      };
    }
    return null;
  }

  function dirOf(side) { return DIRS[side] || DIRS.r; }

  /** 自动选择节点朝向对方的连接边。 */
  function chooseSide(a, b) {
    var ac = G.rectCenter(a), bc = G.rectCenter(b);
    var dx = bc.x - ac.x, dy = bc.y - ac.y;
    var gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    var gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));

    if (gapX > 0 && gapY <= 0) return dx >= 0 ? 'r' : 'l';
    if (gapY > 0 && gapX <= 0) return dy >= 0 ? 'b' : 't';
    if (gapX > 0 && gapY > 0) {
      var rx = gapX / Math.max(1, (a.w + b.w) / 2);
      var ry = gapY / Math.max(1, (a.h + b.h) / 2);
      if (rx >= ry) return dx >= 0 ? 'r' : 'l';
      return dy >= 0 ? 'b' : 't';
    }
    var nx = Math.abs(dx) / Math.max(1, a.w);
    var ny = Math.abs(dy) / Math.max(1, a.h);
    if (nx >= ny) return dx >= 0 ? 'r' : 'l';
    return dy >= 0 ? 'b' : 't';
  }

  function resSide(node, other, port) {
    return isFixed(port) ? port : chooseSide(node, other);
  }

  function stub(p, side, amount) {
    var d = dirOf(side);
    var k = amount == null ? STUB : amount;
    return { x: p.x + d.x * k, y: p.y + d.y * k };
  }

  /** 端口点沿"垂直方向"偏移，用于让多根平行箭头分开；会夹在组件边长范围内。 */
  function offPort(node, side, off) {
    var p = G.portPoint(node, side);
    if (!off) return p;
    var limit = (side === 't' || side === 'b' ? node.w : node.h) / 2 - 8;
    var d = G.clamp(off, -Math.max(0, limit), Math.max(0, limit));
    if (side === 't' || side === 'b') return { x: p.x + d, y: p.y };
    return { x: p.x, y: p.y + d };
  }

  /**
   * 端口该往哪一侧偏移。
   * 两端端口朝向相同时（都在上/都在下…），两条线要"各自向外扩"才能嵌套；
   * 两端端口相对时（一左一右），则要"整体同向平移"。
   */
  function outwardSign(node, other, side) {
    if (side === 't' || side === 'b') {
      return (node.x + node.w / 2) >= (other.x + other.w / 2) ? 1 : -1;
    }
    return (node.y + node.h / 2) >= (other.y + other.h / 2) ? 1 : -1;
  }

  /**
   * 多条箭头是否属于"同一组"。
   * 只有用同一对端口、方向相反的两根才算真正的双向箭头；
   * 一边连左边、一边连右边这种属于两条互不相干的箭头，不能凑成一对（否则端口会被偏移出错位）。
   */
  function groupKeyOf(edge, nodes) {
    if (!edge || !edge.from || !edge.to || !edge.from.node || !edge.to.node) return null;
    if (edge.from.node === edge.to.node) return null;
    var a = nodes[edge.from.node], b = nodes[edge.to.node];
    if (!a || !b) return null;
    var sa = isFixed(edge.from.port) ? edge.from.port : chooseSide(a, b);
    var sb = isFixed(edge.to.port) ? edge.to.port : chooseSide(b, a);
    var k1 = a.id + '\u0001' + sa + '\u0001' + b.id + '\u0001' + sb;
    var k2 = b.id + '\u0001' + sb + '\u0001' + a.id + '\u0001' + sa;
    return k1 < k2 ? k1 : k2;
  }

  /**
   * 计算每根箭头的平行偏移量。
   * 同一方向的多根箭头自动错开；一对双向箭头在开启「分开」时各偏半个间距。
   */
  function edgeLayout(edges, nodes) {
    var groups = {}, order = {};
    nodes = nodes || {};
    (edges || []).forEach(function (e) {
      if (!e.from || !e.to || !e.from.node || !e.to.node) return;
      if (e.from.node === e.to.node) return;
      var key = groupKeyOf(e, nodes);
      if (!key) return;
      if (!groups[key]) { groups[key] = []; order[key] = true; }
      groups[key].push(e);
    });
    var out = {};
    Object.keys(order).forEach(function (key) {
      var list = groups[key];
      var byDir = {};
      var dirOrder = [];
      list.forEach(function (e) {
        var dk = e.from.node + '\u0000' + e.to.node;
        if (!byDir[dk]) { byDir[dk] = []; dirOrder.push(dk); }
        byDir[dk].push(e);
      });
      // 组内顺序号：单侧约束时用它把中间段一层层错开
      var slot = 0, slots = {};
      dirOrder.forEach(function (dk) { byDir[dk].forEach(function (e) { slots[e.id] = slot++; }); });

      list.forEach(function (e) { out[e.id] = { offset: 0, slot: slots[e.id] }; });

      var separate = false;
      list.forEach(function (e) { if ((e.style && e.style.biMode) === 'separate') separate = true; });

      dirOrder.forEach(function (dk) {
        var bucket = byDir[dk];
        bucket.forEach(function (e, i) {
          out[e.id].offset = bucket.length > 1 ? (i - (bucket.length - 1) / 2) * PARALLEL_GAP : 0;
        });
      });
      if (separate && dirOrder.length === 2 &&
        byDir[dirOrder[0]].length === 1 && byDir[dirOrder[1]].length === 1) {
        out[byDir[dirOrder[0]][0].id].offset = -PARALLEL_GAP / 2;
        out[byDir[dirOrder[1]][0].id].offset = PARALLEL_GAP / 2;
      }
    });
    return out;
  }

  /** 终点/起点箭头需要的最短直线段，避免箭头压在转折点上。 */
  function requiredStub(edge, tailMin) {
    var sw = (edge && edge.style && edge.style.strokeWidth) || 1.8;
    var arrowLen = 6 * sw;
    var min = tailMin == null ? 16 : tailMin;
    return Math.max(STUB, min, arrowLen + TAIL_GAP);
  }

  /**
   * 转折点的可用区间。
   * 两个端口相向时取"中间那段"；同向（都在上/在下/都在左/都在右）时是一侧开放，
   * 这时需要一个兜底边界，否则两条线的中间段会落在同一高度上重叠。
   */
  function bendWindow(anchorA, dirA, anchorB, dirB, gap) {
    var lo = -Infinity, hi = Infinity;
    if (dirA < 0) hi = Math.min(hi, anchorA - gap); else lo = Math.max(lo, anchorA + gap);
    if (dirB < 0) hi = Math.min(hi, anchorB - gap); else lo = Math.max(lo, anchorB + gap);
    if (lo > hi) {
      lo = Math.min(anchorA, anchorB) + gap;
      hi = Math.max(anchorA, anchorB) - gap;
    }
    if (lo > hi) { var mid = (anchorA + anchorB) / 2; lo = mid; hi = mid; }
    var tightHigh = isFinite(hi), tightLow = isFinite(lo);
    if (!tightLow) lo = Math.min(anchorA, anchorB) - 600;
    if (!tightHigh) hi = Math.max(anchorA, anchorB) + 600;
    return { min: lo, max: hi, tightLow: tightLow, tightHigh: tightHigh };
  }

  /** 单侧开放时的默认位置：沿自由方向一层层铺开，形成嵌套走线。 */
  function oneSidedPos(win, slot) {
    if (win.tightHigh && !win.tightLow) return win.max - slot * PARALLEL_GAP;
    if (win.tightLow && !win.tightHigh) return win.min + slot * PARALLEL_GAP;
    return null;
  }

  function clampBend(value, range) {
    return G.clamp(value, range.min, range.max);
  }

  /* ---------------- 避让组件 ---------------- */

  function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    function cross(ax, ay, bx, by) { return ax * by - ay * bx; }
    var d1 = cross(x4 - x3, y4 - y3, x1 - x3, y1 - y3);
    var d2 = cross(x4 - x3, y4 - y3, x2 - x3, y2 - y3);
    var d3 = cross(x2 - x1, y2 - y1, x3 - x1, y3 - y1);
    var d4 = cross(x2 - x1, y2 - y1, x4 - x1, y4 - y1);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  function segmentHitsRect(p, q, r) {
    if (Math.max(p.x, q.x) < r.x || Math.min(p.x, q.x) > r.x + r.w ||
      Math.max(p.y, q.y) < r.y || Math.min(p.y, q.y) > r.y + r.h) return false;
    if (G.pointInRect(p.x, p.y, r) || G.pointInRect(q.x, q.y, r)) return true;
    var e = [
      [r.x, r.y, r.x + r.w, r.y], [r.x + r.w, r.y, r.x + r.w, r.y + r.h],
      [r.x + r.w, r.y + r.h, r.x, r.y + r.h], [r.x, r.y + r.h, r.x, r.y]
    ];
    for (var i = 0; i < 4; i++) {
      if (segmentsIntersect(p.x, p.y, q.x, q.y, e[i][0], e[i][1], e[i][2], e[i][3])) return true;
    }
    return false;
  }

  /** 折线是否穿过任何一个组件矩形。 */
  function polylineHits(pts, rects) {
    if (!rects || !rects.length) return false;
    for (var i = 1; i < pts.length; i++) {
      for (var k = 0; k < rects.length; k++) {
        if (segmentHitsRect(pts[i - 1], pts[i], rects[k])) return true;
      }
    }
    return false;
  }

  /** 两条折线是否相交（用于挑一个不会和同伴撞上的错开方向）。 */
  function polylineCrosses(p, q) {
    return crossCount(p, q) > 0;
  }

  /** 两条折线的交点个数。 */
  function crossCount(p, q) {
    var n = 0;
    for (var i = 1; i < p.length; i++) {
      for (var j = 1; j < q.length; j++) {
        if (segmentsIntersect(p[i - 1].x, p[i - 1].y, p[i].x, p[i].y,
          q[j - 1].x, q[j - 1].y, q[j].x, q[j].y)) n++;
      }
    }
    return n;
  }

  /** 收集需要避开的组件（排除连线两端的组件）。 */
  function obstaclesFor(edge, nodes) {
    var skipA = edge.from && edge.from.node, skipB = edge.to && edge.to.node;
    var out = [];
    for (var k in nodes) {
      if (!Object.prototype.hasOwnProperty.call(nodes, k)) continue;
      if (k === skipA || k === skipB) continue;
      var n = nodes[k];
      if (!n) continue;
      out.push(G.expandRect(n, OBSTACLE_PAD));
    }
    return out;
  }

  /** 全部组件（含连线两端）的外扩矩形，供寻路时避免折回自己身上。 */
  function allRectsOf(nodes) {
    var out = [];
    for (var k in nodes) {
      if (!Object.prototype.hasOwnProperty.call(nodes, k)) continue;
      if (nodes[k]) out.push(G.expandRect(nodes[k], OBSTACLE_PAD));
    }
    return out;
  }

  function insetRect(r, d) {
    return { x: r.x + d, y: r.y + d, w: r.w - d * 2, h: r.h - d * 2 };
  }

  /**
   * 稀疏网格上的 A* 寻路：在"绕得开"的前提下找一条正交折线。
   * 候选网格线取自两端点与各组件的外扩边界，代价里加了转弯惩罚，走线不会碎成锯齿。
   */
  // 同一对组件共用同一条中心线路径（缓存），否则两根箭头会各自找到不同的通道
  var routeCache = {};
  var routeCacheCount = 0;

  function cachedCenterRoute(cacheKey, from, to, rects) {
    var cached = routeCache[cacheKey];
    if (cached !== undefined) return cached;
    if (routeCacheCount > 400) { routeCache = {}; routeCacheCount = 0; }
    var path = gridRoute(from.x, from.y, to.x, to.y, rects);
    routeCache[cacheKey] = path || null;
    routeCacheCount++;
    return routeCache[cacheKey];
  }

  function gridRoute(sx, sy, ex, ey, obstacles, limit) {
    if (!obstacles.length) return null;
    var xs = {}, ys = {};
    var minX = Math.min(sx, ex), maxX = Math.max(sx, ex);
    var minY = Math.min(sy, ey), maxY = Math.max(sy, ey);
    function addX(v) { xs[Math.round(v * 10) / 10] = 1; }
    function addY(v) { ys[Math.round(v * 10) / 10] = 1; }
    addX(sx); addX(ex); addY(sy); addY(ey);
    // 两端点的中间位置也要有网格线，否则绕行只能贴着某一侧组件走
    addX((sx + ex) / 2); addY((sy + ey) / 2);
    for (var k = 0; k < obstacles.length; k++) {
      var r = obstacles[k];
      addX(r.x); addX(r.x + r.w);
      addY(r.y); addY(r.y + r.h);
      minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.w);
      minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y + r.h);
    }
    // 外侧再留一圈，允许从组件外侧绕过去
    addX(minX - 40); addX(maxX + 40);
    addY(minY - 40); addY(maxY + 40);
    var X = Object.keys(xs).map(Number).sort(function (a, b) { return a - b; });
    var Y = Object.keys(ys).map(Number).sort(function (a, b) { return a - b; });
    if (X.length * Y.length > (limit || 900)) return null;

    function idx(arr, v) {
      for (var i = 0; i < arr.length; i++) if (Math.abs(arr[i] - v) < 0.2) return i;
      return -1;
    }
    function blockedAt(px, py) {
      for (var i = 0; i < obstacles.length; i++) {
        var r = obstacles[i];
        if (px > r.x + 0.5 && px < r.x + r.w - 0.5 && py > r.y + 0.5 && py < r.y + r.h - 0.5) return true;
      }
      return false;
    }
    function segBlocked(x1, y1, x2, y2) {
      for (var i = 0; i < obstacles.length; i++) {
        var r = insetRect(obstacles[i], 0.5);
        if (r.w <= 0 || r.h <= 0) continue;
        if (segmentHitsRect({ x: x1, y: y1 }, { x: x2, y: y2 }, r)) return true;
      }
      return false;
    }

    var W = X.length, H = Y.length;
    var startIdx = idx(Y, sy) * W + idx(X, sx);
    var goalIdx = idx(Y, ey) * W + idx(X, ex);
    if (startIdx < 0 || goalIdx < 0) return null;

    var g = new Array(W * H);
    var from = new Array(W * H);
    var closed = new Array(W * H);
    var open = [startIdx];
    g[startIdx] = 0;
    var turnPenalty = 40;
    var cx0 = Math.min(sx, ex), cx1 = Math.max(sx, ex);
    var cy0 = Math.min(sy, ey), cy1 = Math.max(sy, ey);
    var midX = (sx + ex) / 2, midY = (sy + ey) / 2;

    function overshoot(px, py) {
      var ox = px < cx0 ? cx0 - px : px > cx1 ? px - cx1 : 0;
      var oy = py < cy0 ? cy0 - py : py > cy1 ? py - cy1 : 0;
      return ox + oy;
    }

    // 让路径尽量靠向两端点的中间，走线看起来是对称的，而不是贴着某一侧的组件
    // （系数要小于转弯惩罚，否则会为了"靠近中间"多拐几个弯）
    function offMiddle(px, py) {
      return Math.abs(px - midX) * 0.3 + Math.abs(py - midY) * 0.3;
    }

    while (open.length) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) {
        if (g[open[i]] + Math.abs(X[open[i] % W] - X[goalIdx % W]) +
          Math.abs(Y[Math.floor(open[i] / W)] - Y[Math.floor(goalIdx / W)]) <
          g[open[bi]] + Math.abs(X[open[bi] % W] - X[goalIdx % W]) +
          Math.abs(Y[Math.floor(open[bi] / W)] - Y[Math.floor(goalIdx / W)])) bi = i;
      }
      var cur = open.splice(bi, 1)[0];
      if (cur === goalIdx) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      var cxi = cur % W, cyi = Math.floor(cur / W);
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var d = 0; d < dirs.length; d++) {
        var nx = cxi + dirs[d][0], ny = cyi + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var ni = ny * W + nx;
        if (closed[ni]) continue;
        var px = X[nx], py = Y[ny];
        if (blockedAt(px, py)) continue;
        if (segBlocked(X[cxi], Y[cyi], px, py)) continue;
        var step = Math.abs(px - X[cxi]) + Math.abs(py - Y[cyi]);
        var prevDir = from[cur] ? (Math.sign(X[cxi] - X[from[cur] % W]) + ',' + Math.sign(Y[cyi] - Y[Math.floor(from[cur] / W)])) : '';
        var newDir = dirs[d][0] + ',' + dirs[d][1];
        var cost = g[cur] + step + (prevDir && prevDir !== newDir ? turnPenalty : 0) +
          overshoot(px, py) * 0.6 + offMiddle(px, py);
        if (g[ni] === undefined || cost < g[ni] - 1e-6) {
          g[ni] = cost;
          from[ni] = cur;
          open.push(ni);
        }
      }
    }
    if (g[goalIdx] === undefined) return null;
    var path = [];
    var node = goalIdx;
    while (node !== undefined) {
      path.unshift({ x: X[node % W], y: Y[Math.floor(node / W)] });
      if (node === startIdx) break;
      node = from[node];
    }
    return path.length ? G.simplify(path) : null;
  }

  /** 让中间段挪到不穿过任何组件的位置（就近搜索）。 */
  function refineMiddle(build, want, win, obstacles) {
    var pts = build(want);
    if (!obstacles.length || !polylineHits(pts, obstacles)) return { pos: want, pts: pts };
    for (var k = 1; k <= 60; k++) {
      var cands = [want + k * 4, want - k * 4];
      for (var i = 0; i < cands.length; i++) {
        var v = clampBend(cands[i], win);
        if (Math.abs(v - want) < 0.01) continue;
        var p2 = build(v);
        if (!polylineHits(p2, obstacles)) return { pos: v, pts: p2 };
      }
    }
    return { pos: want, pts: pts };
  }

  /** 拐点（两个自由度）的就近搜索。 */
  function refineCorner(build, want, obstacles) {
    var pts = build(want.x, want.y);
    if (!obstacles.length || !polylineHits(pts, obstacles)) return { x: want.x, y: want.y, pts: pts };
    for (var k = 1; k <= 60; k++) {
      var cands = [
        { x: want.x + k * 4, y: want.y }, { x: want.x - k * 4, y: want.y },
        { x: want.x, y: want.y + k * 4 }, { x: want.x, y: want.y - k * 4 }
      ];
      for (var i = 0; i < cands.length; i++) {
        var p2 = build(cands[i].x, cands[i].y);
        if (!polylineHits(p2, obstacles)) return { x: cands[i].x, y: cands[i].y, pts: p2 };
      }
    }
    return { x: want.x, y: want.y, pts: pts };
  }

  /** 组件挡在正中间时的绕行方案：从两侧找一条空旷的"通道"。 */
  function detourLane(laneSegs, start, step, obstacles) {
    var probe = start;
    for (var i = 0; i < 40; i++) {
      var seg = [{ x: laneSegs[0], y: probe }, { x: laneSegs[1], y: probe }];
      if (!polylineHits(seg, obstacles)) return probe;
      probe += step;
    }
    return null;
  }

  function detourH(pa, da, db, pb, obstacles) {
    var dirs = [-1, 1];
    for (var d = 0; d < dirs.length; d++) {
      var dir = dirs[d];
      var start = dir < 0 ? Math.min(da.y, db.y) - MIN_SEG : Math.max(da.y, db.y) + MIN_SEG;
      var lane = detourLane([Math.min(da.x, db.x), Math.max(da.x, db.x)], start, dir * 20, obstacles);
      if (lane === null) continue;
      var pts = G.simplify([pa, da, { x: da.x, y: lane }, { x: db.x, y: lane }, db, pb]);
      if (!polylineHits(pts, obstacles)) return pts;
    }
    return null;
  }

  function detourV(pa, da, db, pb, obstacles) {
    var dirs = [-1, 1];
    for (var d = 0; d < dirs.length; d++) {
      var dir = dirs[d];
      var start = dir < 0 ? Math.min(da.x, db.x) - MIN_SEG : Math.max(da.x, db.x) + MIN_SEG;
      var probe = start, lane = null;
      for (var i = 0; i < 40 && lane === null; i++) {
        var seg = [{ x: probe, y: Math.min(da.y, db.y) }, { x: probe, y: Math.max(da.y, db.y) }];
        if (!polylineHits(seg, obstacles)) lane = probe; else probe += dir * 20;
      }
      if (lane === null) continue;
      var pts = G.simplify([pa, da, { x: lane, y: da.y }, { x: lane, y: db.y }, db, pb]);
      if (!polylineHits(pts, obstacles)) return pts;
    }
    return null;
  }

  /* ---------------- 三种连线方式 ---------------- */

  function endPoint(node, other, port, off) {
    var side = resSide(node, other, port);
    if (isFixed(port) || off) return offPort(node, side, off);
    var c = G.rectCenter(other);
    return G.shapeBoundaryPoint(node, c.x, c.y);
  }

  function straightGeom(a, b, edge, opts) {
    var off = opts.offset || 0;
    var ac = G.rectCenter(a), bc = G.rectCenter(b);
    var sideA = resSide(a, b, edge.from.port);
    var sideB = resSide(b, a, edge.to.port);
    var p0 = endPoint(a, b, edge.from.port, off);
    var p1 = endPoint(b, a, edge.to.port, off);
    var pts = G.simplify([p0, p1]);
    var mid = G.polylineMidpoint(pts);
    return {
      mode: 'straight', d: 'M' + G.f(p0.x) + ' ' + G.f(p0.y) + 'L' + G.f(p1.x) + ' ' + G.f(p1.y),
      points: pts, start: p0, end: p1, startSide: sideA, endSide: sideB,
      label: { x: mid.x, y: mid.y, angle: 0 }, bend: null
    };
  }

  function curveGeom(a, b, edge, opts) {
    var off = opts.offset || 0;
    var sideA = resSide(a, b, edge.from.port);
    var sideB = resSide(b, a, edge.to.port);
    var p0 = endPoint(a, b, edge.from.port, off);
    var p1 = endPoint(b, a, edge.to.port, off);
    var span = G.dist(p0.x, p0.y, p1.x, p1.y);
    var off = G.clamp(span * 0.45, 34, 220);
    var d0 = dirOf(sideA), d1 = dirOf(sideB);
    var c1 = { x: p0.x + d0.x * off, y: p0.y + d0.y * off };
    var c2 = { x: p1.x + d1.x * off, y: p1.y + d1.y * off };
    var mid = G.cubicPoint(p0, c1, c2, p1, 0.5);
    return {
      mode: 'curve',
      d: 'M' + G.f(p0.x) + ' ' + G.f(p0.y) + 'C' + G.f(c1.x) + ' ' + G.f(c1.y) + ' ' +
        G.f(c2.x) + ' ' + G.f(c2.y) + ' ' + G.f(p1.x) + ' ' + G.f(p1.y),
      points: [p0, c1, c2, p1], start: p0, end: p1, startSide: sideA, endSide: sideB,
      label: { x: mid.x, y: mid.y, angle: 0 }, bend: null
    };
  }

  function orthoGeom(a, b, edge, opts) {
    var off = opts.offset || 0;
    var slot = opts.slot || 0;
    var stubLen = opts.stub || STUB;
    var obstacles = opts.obstacles || [];
    var sideA = resSide(a, b, edge.from.port);
    var sideB = resSide(b, a, edge.to.port);
    var horizA = sideA === 'l' || sideA === 'r';
    var horizB = sideB === 'l' || sideB === 'r';
    // 两端端口同向（都在上/都在左…）：两条线各向外扩；两端相对：整体同向平移
    var facingSame = horizA === horizB &&
      (horizA ? DIRS[sideA].x === DIRS[sideB].x : DIRS[sideA].y === DIRS[sideB].y);
    var offA = off, offB = off;
    if (facingSame && off) {
      offA = off * outwardSign(a, b, sideA);
      offB = off * outwardSign(b, a, sideB);
    }
    var pa = offPort(a, sideA, offA), pb = offPort(b, sideB, offB);
    var pa0 = G.portPoint(a, sideA), pb0 = G.portPoint(b, sideB);
    var da = stub(pa, sideA, stubLen), db = stub(pb, sideB, stubLen);
    var da0 = stub(pa0, sideA, stubLen), db0 = stub(pb0, sideB, stubLen);
    var shiftA = { x: pa.x - pa0.x, y: pa.y - pa0.y };
    var shiftB = { x: pb.x - pb0.x, y: pb.y - pb0.y };
    var pts, bend = null;

    if (horizA && horizB) {
      // 人工拖过的转折点以用户为准；否则自动位置，并让多根平行箭头彼此错开
      var winX = bendWindow(da.x, DIRS[sideA].x, db.x, DIRS[sideB].x, MIN_SEG);
      var autoX = oneSidedPos(winX, slot);
      // 转折点该往哪一侧错开，取决于目标在另一端的上面还是下面；
      // 方向搞反的话，两条分开的箭头会在中途交叉。
      // 错开方向必须与"边的方向"无关（否则反向的那根会得到同一个符号、两根仍然重叠）：
      // 用左右两个节点的相对高低来定，正反两根算出来是同一个值。
      var leftN = a.x <= b.x ? a : b, rightN = a.x <= b.x ? b : a;
      var dirSignX = (rightN.y + rightN.h / 2) >= (leftN.y + leftN.h / 2) ? 1 : -1;
      // 手动拖过的转折点也要保留错位量，否则两根分开的箭头中间段会重合
      var shiftX, baseX;
      if (autoX != null) {
        shiftX = (winX.tightHigh ? -1 : 1) * slot * PARALLEL_GAP;
        baseX = autoX - shiftX;
      } else {
        shiftX = -off * dirSignX;
        baseX = (winX.min + winX.max) / 2;
      }
      var wantX = clampBend((edge.bend && isFinite(edge.bend.x) ? edge.bend.x : baseX) + shiftX, winX);
      var buildX = function (v) { return [pa, da, { x: v, y: da.y }, { x: v, y: db.y }, db, pb]; };
      var resX = refineMiddle(buildX, wantX, winX, obstacles);
      pts = resX.pts;
      if (obstacles.length && polylineHits(pts, obstacles)) {
        var altH = detourH(pa, da, db, pb, obstacles);
        if (altH) { pts = altH; resX.pos = null; }
      }
      if (Math.abs(da.y - db.y) > 1) {
        // 走廊太窄时不给手柄，避免出现"拖不动"的手柄
        if (resX.pos != null && winX.max - winX.min > 1) {
          bend = {
            kind: 'seg', axis: 'x', pos: resX.pos, min: winX.min, max: winX.max,
            from: Math.min(da.y, db.y), to: Math.max(da.y, db.y)
          };
        }
      }
    } else if (!horizA && !horizB) {
      var winY = bendWindow(da.y, DIRS[sideA].y, db.y, DIRS[sideB].y, MIN_SEG);
      var autoY = oneSidedPos(winY, slot);
      var topN = a.y <= b.y ? a : b, bottomN = a.y <= b.y ? b : a;
      var dirSignY = (bottomN.x + bottomN.w / 2) >= (topN.x + topN.w / 2) ? 1 : -1;
      var shiftY, baseY;
      if (autoY != null) {
        shiftY = (winY.tightHigh ? -1 : 1) * slot * PARALLEL_GAP;
        baseY = autoY - shiftY;
      } else {
        shiftY = -off * dirSignY;
        baseY = (winY.min + winY.max) / 2;
      }
      var wantY = clampBend((edge.bend && isFinite(edge.bend.y) ? edge.bend.y : baseY) + shiftY, winY);
      var buildY = function (v) { return [pa, da, { x: da.x, y: v }, { x: db.x, y: v }, db, pb]; };
      var resY = refineMiddle(buildY, wantY, winY, obstacles);
      pts = resY.pts;
      if (obstacles.length && polylineHits(pts, obstacles)) {
        var altV = detourV(pa, da, db, pb, obstacles);
        if (altV) { pts = altV; resY.pos = null; }
      }
      if (Math.abs(da.x - db.x) > 1) {
        if (resY.pos != null && winY.max - winY.min > 1) {
          bend = {
            kind: 'seg', axis: 'y', pos: resY.pos, min: winY.min, max: winY.max,
            from: Math.min(da.x, db.x), to: Math.max(da.x, db.x)
          };
        }
      }
      } else if (horizA) {
      // A 水平出、B 垂直进：默认一个直角拐点，拖过之后走成可自由摆放的 S 形
      var hasA = edge.bend && (isFinite(edge.bend.x) || isFinite(edge.bend.y));
      var lox = Math.min(da.x, db.x) - CORNER_SLACK, hix = Math.max(da.x, db.x) + CORNER_SLACK;
      var loy = Math.min(da.y, db.y) - CORNER_SLACK, hiy = Math.max(da.y, db.y) + CORNER_SLACK;
      var want = hasA
        ? { x: G.clamp(isFinite(edge.bend.x) ? edge.bend.x : (da.x + db.x) / 2, lox, hix),
            y: G.clamp(isFinite(edge.bend.y) ? edge.bend.y : (da.y + db.y) / 2, loy, hiy) }
        : { x: db.x, y: da.y };
      var buildC = function (cx, cy) { return [pa, da, { x: cx, y: da.y }, { x: cx, y: cy }, { x: db.x, y: cy }, db, pb]; };
      var resC = refineCorner(buildC, want, obstacles);
      pts = resC.pts;
      bend = { kind: 'corner', x: resC.x, y: resC.y };
    } else {
      var hasB = edge.bend && (isFinite(edge.bend.x) || isFinite(edge.bend.y));
      var lox2 = Math.min(da.x, db.x) - CORNER_SLACK, hix2 = Math.max(da.x, db.x) + CORNER_SLACK;
      var loy2 = Math.min(da.y, db.y) - CORNER_SLACK, hiy2 = Math.max(da.y, db.y) + CORNER_SLACK;
      var want2 = hasB
        ? { x: G.clamp(isFinite(edge.bend.x) ? edge.bend.x : (da.x + db.x) / 2, lox2, hix2),
            y: G.clamp(isFinite(edge.bend.y) ? edge.bend.y : (da.y + db.y) / 2, loy2, hiy2) }
        : { x: da.x, y: db.y };
      var buildC2 = function (cx, cy) { return [pa, da, { x: da.x, y: cy }, { x: cx, y: cy }, { x: cx, y: db.y }, db, pb]; };
      var resC2 = refineCorner(buildC2, want2, obstacles);
      pts = resC2.pts;
      bend = { kind: 'corner', x: resC2.x, y: resC2.y };
    }

    // 兜底：只要还穿过组件，就在稀疏网格上重新寻一条绕得开的正交折线
    var allRects = opts.avoidAll || [];
    var needRoute = obstacles.length > 0 && polylineHits(pts, obstacles);
    if (!needRoute && allRects.length && pts.length > 3) {
      // 连线两端自己的组件也要避开：中间段不能从自己身上穿过去
      needRoute = polylineHits(pts.slice(1, pts.length - 1), allRects);
    }
    if (needRoute) {
      // 两端偏移量相同的（端口相对的那种）先用中心线寻路，再把整条路径平移出平行线，
      // 否则同一对组件的两根箭头会各自选中同一条通道、中间段叠在一起。
      var uniform = Math.abs(shiftA.x - shiftB.x) < 1e-6 && Math.abs(shiftA.y - shiftB.y) < 1e-6;
      var from = uniform ? da0 : da, to = uniform ? db0 : db;
      // 同一对组件的两根箭头必须共用同一条中心线，否则它们会各选一条通道
      var forward = (from.x + from.y * 1000) <= (to.x + to.y * 1000);
      var a1 = forward ? from : to, b1 = forward ? to : from;
      var canonKey = (opts.groupKey || edge.id) + '|' +
        [a1.x, a1.y, b1.x, b1.y].map(function (v) { return Math.round(v * 10); }).join(',');
      var base = cachedCenterRoute(canonKey, a1, b1, allRects);
      var grid = base ? (forward ? base : base.slice().reverse()) : null;
      if (grid && grid.length > 1) {
        var mag = Math.max(Math.abs(shiftA.x), Math.abs(shiftA.y));
        if (uniform && mag > 0.5) {
          // 两根箭头共用同一条中心线，但各往对角线方向错开：
          // 只沿端口方向平移的话，折线的中间竖段会重叠。
          var s = Math.abs(shiftA.y) >= Math.abs(shiftA.x) ? Math.sign(shiftA.y) : Math.sign(shiftA.x);
          if (!s) s = 1;
          var cands = [[s * mag, s * mag], [s * mag, -s * mag]];
          var pick = cands[0];
          var bestCross = Infinity;
          for (var ci = 0; ci < cands.length; ci++) {
            var oa = grid.map(function (p) { return { x: p.x + cands[ci][0], y: p.y + cands[ci][1] }; });
            var ob = grid.map(function (p) { return { x: p.x - cands[ci][0], y: p.y - cands[ci][1] }; });
            var n = crossCount(oa, ob);
            if (n < bestCross) { bestCross = n; pick = cands[ci]; }
          }
          var routed = grid.map(function (p) { return { x: p.x + pick[0], y: p.y + pick[1] }; });
          var first = routed[0], last = routed[routed.length - 1];
          pts = G.simplify([pa, da, { x: first.x, y: da.y }]
            .concat(routed, [{ x: last.x, y: db.y }, db, pb]));
        } else {
          pts = G.simplify([pa].concat(grid, [pb]));
        }
        bend = null;
      }
    }

    pts = G.simplify(pts);
    // simplify 可能把端点当作共线点删掉，这里确保首尾保留
    if (pts[0] !== pa && G.dist(pts[0].x, pts[0].y, pa.x, pa.y) > 0.6) pts.unshift(pa);
    if (G.dist(pts[pts.length - 1].x, pts[pts.length - 1].y, pb.x, pb.y) > 0.6) pts.push(pb);

    var mid = G.polylineMidpoint(pts);
    return {
      mode: 'orthogonal', d: G.roundedPolylinePath(pts, CORNER),
      points: pts, start: pa, end: pb, startSide: sideA, endSide: sideB,
      label: { x: mid.x, y: mid.y, angle: 0 }, bend: bend
    };
  }

  function selfLoop(a, edge) {
    var out = 46 + Math.min(a.w, a.h) * 0.35;
    var p0 = { x: a.x + a.w, y: a.y + a.h * 0.28 };
    var p1 = { x: a.x + a.w, y: a.y + a.h * 0.72 };
    var c1 = { x: p0.x + out, y: p0.y };
    var c2 = { x: p1.x + out, y: p1.y };
    var mid = G.cubicPoint(p0, c1, c2, p1, 0.5);
    return {
      mode: 'loop',
      d: 'M' + G.f(p0.x) + ' ' + G.f(p0.y) + 'C' + G.f(c1.x) + ' ' + G.f(c1.y) + ' ' +
        G.f(c2.x) + ' ' + G.f(c2.y) + ' ' + G.f(p1.x) + ' ' + G.f(p1.y),
      points: [p0, c1, c2, p1], start: p0, end: p1, startSide: 'r', endSide: 'r',
      label: { x: mid.x, y: mid.y, angle: 0 }, bend: null
    };
  }

  /** 计算一条箭头的完整几何信息。nodes 为 id -> node 的映射。 */
  function edgeGeometry(edge, nodes, opts) {
    opts = opts || {};
    var a = resolveEnd(edge.from, nodes);
    var b = resolveEnd(edge.to, nodes);
    if (!a || !b) return null;
    if (edge.from.node && edge.from.node === edge.to.node) return selfLoop(a, edge);
    var mode = edge.mode || 'orthogonal';
    var o = {
      offset: opts.offset || 0, slot: opts.slot || 0, stub: opts.stub,
      obstacles: opts.obstacles || obstaclesFor(edge, nodes),
      avoidAll: opts.avoidAll || allRectsOf(nodes),
      groupKey: opts.groupKey || groupKeyOf(edge, nodes)
    };
    if (mode === 'straight') return straightGeom(a, b, edge, o);
    if (mode === 'curve') return curveGeom(a, b, edge, o);
    return orthoGeom(a, b, edge, o);
  }

  return {
    DIRS: DIRS, STUB: STUB, MIN_SEG: MIN_SEG, PARALLEL_GAP: PARALLEL_GAP,
    isFixed: isFixed, chooseSide: chooseSide,
    edgeGeometry: edgeGeometry, selfLoop: selfLoop, resolveEnd: resolveEnd,
    edgeLayout: edgeLayout, requiredStub: requiredStub, offPort: offPort,
    bendWindow: bendWindow, oneSidedPos: oneSidedPos, obstaclesFor: obstaclesFor,
    polylineHits: polylineHits, segmentHitsRect: segmentHitsRect,
    allRectsOf: allRectsOf, gridRoute: gridRoute, groupKeyOf: groupKeyOf, insetRect: insetRect,
    segmentsIntersect: segmentsIntersect
  };
});
