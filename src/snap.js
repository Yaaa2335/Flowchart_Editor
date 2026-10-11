/* snap.js —— 吸附引擎：网格吸附、智能参考线吸附、箭头端点吸附、缩放吸附。纯函数。 */
(function (factory) {
  var isNode = typeof module === 'object' && module.exports;
  var G = isNode ? require('./geom.js') : (window.FD || {}).geom;
  var api = factory(G);
  if (isNode) module.exports = api;
  if (typeof window !== 'undefined') { (window.FD = window.FD || {}).snap = api; }
})(function (G) {
  'use strict';

  var EPS = 0.05;

  function linesOf(rect, axis) {
    if (axis === 'v') {
      return [
        { v: rect.x, role: 'left' },
        { v: rect.x + rect.w / 2, role: 'hcenter' },
        { v: rect.x + rect.w, role: 'right' }
      ];
    }
    return [
      { v: rect.y, role: 'top' },
      { v: rect.y + rect.h / 2, role: 'vcenter' },
      { v: rect.y + rect.h, role: 'bottom' }
    ];
  }

  /** 找出使某条移动边与其他组件边对齐时的最佳位移量。 */
  function bestDelta(movingRect, others, axis, threshold) {
    var mine = linesOf(movingRect, axis);
    var best = null;
    for (var i = 0; i < others.length; i++) {
      var theirs = linesOf(others[i], axis);
      for (var a = 0; a < mine.length; a++) {
        for (var b = 0; b < theirs.length; b++) {
          var delta = theirs[b].v - mine[a].v;
          var ad = Math.abs(delta);
          if (ad > threshold + EPS) continue;
          if (!best || ad < best.abs - EPS) best = { delta: delta, abs: ad };
        }
      }
    }
    return best;
  }

  /** 位移后，收集所有恰好对齐的边，用于画参考线。 */
  function collectGuides(rect, others, axis) {
    var mine = linesOf(rect, axis);
    var out = [];
    for (var i = 0; i < others.length; i++) {
      var other = others[i];
      var theirs = linesOf(other, axis);
      for (var a = 0; a < mine.length; a++) {
        for (var b = 0; b < theirs.length; b++) {
          if (Math.abs(theirs[b].v - mine[a].v) > EPS) continue;
          var dup = false;
          for (var k = 0; k < out.length; k++) {
            if (Math.abs(out[k].pos - theirs[b].v) < EPS && Math.abs(out[k].from - other.y) < EPS) { dup = true; break; }
          }
          if (dup) continue;
          out.push({
            axis: axis, pos: theirs[b].v,
            from: axis === 'v' ? Math.min(rect.y, other.y) : Math.min(rect.x, other.x),
            to: axis === 'v' ? Math.max(rect.y + rect.h, other.y + other.h) : Math.max(rect.x + rect.w, other.x + other.w),
            nodeId: other.id
          });
        }
      }
    }
    return out;
  }

  function gridSnap(value, gridSize) {
    return Math.round(value / gridSize) * gridSize;
  }

  /** 若干候选线中，让其中一条贴到网格所需的最小位移。 */
  function bestGridDelta(values, gridSize) {
    var best = null;
    for (var i = 0; i < values.length; i++) {
      var d = gridSnap(values[i], gridSize) - values[i];
      if (best === null || Math.abs(d) < Math.abs(best) - 1e-9) best = d;
    }
    return best || 0;
  }

  /**
   * 拖动组件时的吸附。
   * rect: 期望位置 {x,y,w,h}；others: 其他组件矩形数组（可带 id）；
   * opts: { guides, grid, gridSize, threshold }
   */
  function snapMove(rect, others, opts) {
    opts = opts || {};
    var threshold = opts.threshold == null ? 8 : opts.threshold;
    var gridSize = opts.gridSize || 20;
    var list = others || [];
    var x = rect.x, y = rect.y;
    var byGuideX = false, byGuideY = false, byGridX = false, byGridY = false;

    if (opts.guides && list.length) {
      var bx = bestDelta(rect, list, 'v', threshold);
      if (bx) { x = rect.x + bx.delta; byGuideX = true; }
      var by = bestDelta(rect, list, 'h', threshold);
      if (by) { y = rect.y + by.delta; byGuideY = true; }
    }

    if (opts.grid) {
      // 上/中/下（左/中/右）三条线里挑位移最小的一条去贴网格，
      // 这样即使组件尺寸不是网格倍数，下边线也能吸附到网格上。
      if (!byGuideX) {
        var gdx = bestGridDelta([x, x + rect.w / 2, x + rect.w], gridSize);
        if (Math.abs(gdx) > 1e-9) { x += gdx; byGridX = true; }
      }
      if (!byGuideY) {
        var gdy = bestGridDelta([y, y + rect.h / 2, y + rect.h], gridSize);
        if (Math.abs(gdy) > 1e-9) { y += gdy; byGridY = true; }
      }
    }

    var finalRect = { x: x, y: y, w: rect.w, h: rect.h };
    var guides = [];
    if (opts.guides && list.length) {
      if (byGuideX) guides = guides.concat(collectGuides(finalRect, list, 'v'));
      if (byGuideY) guides = guides.concat(collectGuides(finalRect, list, 'h'));
    }

    return {
      x: x, y: y, guides: guides,
      snappedX: byGuideX || byGridX, snappedY: byGuideY || byGridY
    };
  }

  /**
   * 缩放组件时的吸附。edges: {left,right,top,bottom} 表示哪些边正在被拖动。
   */
  function snapResize(rect, others, edges, opts) {
    opts = opts || {};
    var threshold = opts.threshold == null ? 8 : opts.threshold;
    var gridSize = opts.gridSize || 20;
    var list = others || [];
    var r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    var guides = [];

    function snapEdge(value, axis, kinds) {
      var best = null;
      if (opts.guides && list.length) {
        for (var i = 0; i < list.length; i++) {
          var theirs = linesOf(list[i], axis);
          for (var b = 0; b < theirs.length; b++) {
            var d = theirs[b].v - value;
            if (Math.abs(d) > threshold + EPS) continue;
            if (!best || Math.abs(d) < Math.abs(best.delta) - EPS) best = { delta: d };
          }
        }
      }
      if (best) return { value: value + best.delta, guide: true };
      if (opts.grid) return { value: gridSnap(value, gridSize), guide: false };
      return { value: value, guide: false };
    }

    var vEdges = [], hEdges = [];
    if (edges.left) vEdges.push('left');
    if (edges.right) vEdges.push('right');
    if (edges.top) hEdges.push('top');
    if (edges.bottom) hEdges.push('bottom');

    vEdges.forEach(function (e) {
      var v = e === 'left' ? r.x : r.x + r.w;
      var res = snapEdge(v, 'v');
      if (e === 'left') { r.w = r.w + (r.x - res.value); r.x = res.value; }
      else { r.w = res.value - r.x; }
    });
    hEdges.forEach(function (e) {
      var v = e === 'top' ? r.y : r.y + r.h;
      var res = snapEdge(v, 'h');
      if (e === 'top') { r.h = r.h + (r.y - res.value); r.y = res.value; }
      else { r.h = res.value - r.y; }
    });

    if (opts.guides && list.length) {
      guides = guides.concat(collectGuides(r, list, 'v'), collectGuides(r, list, 'h'));
    }
    return { rect: r, guides: guides };
  }

  /**
   * 箭头端点吸附：返回最近的连接点。
   * pt: {x,y}；nodes: 组件数组；opts: { threshold, exclude: [id...], inside: true }
   */
  function snapPort(pt, nodes, opts) {
    opts = opts || {};
    var threshold = opts.threshold == null ? 12 : opts.threshold;
    var exclude = opts.exclude || [];
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (exclude.indexOf(n.id) >= 0) continue;
      var rect = { x: n.x, y: n.y, w: n.w, h: n.h };
      // 指针落在组件内部 → 一定吸附；在阈值范围内也吸附
      var isInside = G.pointInRect(pt.x, pt.y, rect);
      var isNear = G.pointInRect(pt.x, pt.y, G.expandRect(rect, threshold));
      for (var s = 0; s < G.SIDES.length; s++) {
        var p = G.portPoint(n, G.SIDES[s]);
        var d = G.dist(pt.x, pt.y, p.x, p.y);
        if (!isInside && !isNear && d > threshold) continue;
        var score = isInside ? d - 1e6 : d;
        if (!best || score < best.score) {
          best = { node: n, side: G.SIDES[s], point: { x: p.x, y: p.y }, dist: d, score: score };
        }
      }
    }
    if (!best) return null;
    delete best.score;
    return best;
  }

  /** 判断两个组件矩形是否对齐（用于选中多个组件时的提示）。 */
  function rectAligned(a, b, tol) {
    var t = tol == null ? 0.5 : tol;
    var av = linesOf(a, 'v'), bv = linesOf(b, 'v');
    var ah = linesOf(a, 'h'), bh = linesOf(b, 'h');
    for (var i = 0; i < av.length; i++) {
      for (var j = 0; j < bv.length; j++) if (Math.abs(av[i].v - bv[j].v) < t) return true;
    }
    for (i = 0; i < ah.length; i++) {
      for (j = 0; j < bh.length; j++) if (Math.abs(ah[i].v - bh[j].v) < t) return true;
    }
    return false;
  }

  return {
    EPS: EPS, linesOf: linesOf, bestDelta: bestDelta, collectGuides: collectGuides,
    gridSnap: gridSnap, snapMove: snapMove, snapResize: snapResize, snapPort: snapPort,
    rectAligned: rectAligned, bestGridDelta: bestGridDelta
  };
});
