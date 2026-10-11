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

  /* ---------------- 三种连线方式 ---------------- */

  function straightGeom(a, b, edge) {
    var ac = G.rectCenter(a), bc = G.rectCenter(b);
    var sideA = resSide(a, b, edge.from.port);
    var sideB = resSide(b, a, edge.to.port);
    var p0 = isFixed(edge.from.port) ? G.portPoint(a, sideA) : G.shapeBoundaryPoint(a, bc.x, bc.y);
    var p1 = isFixed(edge.to.port) ? G.portPoint(b, sideB) : G.shapeBoundaryPoint(b, ac.x, ac.y);
    var pts = G.simplify([p0, p1]);
    var mid = G.polylineMidpoint(pts);
    return {
      mode: 'straight', d: 'M' + G.f(p0.x) + ' ' + G.f(p0.y) + 'L' + G.f(p1.x) + ' ' + G.f(p1.y),
      points: pts, start: p0, end: p1, startSide: sideA, endSide: sideB,
      label: { x: mid.x, y: mid.y, angle: 0 }
    };
  }

  function curveGeom(a, b, edge) {
    var ac = G.rectCenter(a), bc = G.rectCenter(b);
    var sideA = resSide(a, b, edge.from.port);
    var sideB = resSide(b, a, edge.to.port);
    var p0 = isFixed(edge.from.port) ? G.portPoint(a, sideA) : G.shapeBoundaryPoint(a, bc.x, bc.y);
    var p1 = isFixed(edge.to.port) ? G.portPoint(b, sideB) : G.shapeBoundaryPoint(b, ac.x, ac.y);
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
      label: { x: mid.x, y: mid.y, angle: 0 }
    };
  }

  function orthoGeom(a, b, edge) {
    var sideA = resSide(a, b, edge.from.port);
    var sideB = resSide(b, a, edge.to.port);
    var pa = G.portPoint(a, sideA), pb = G.portPoint(b, sideB);
    var da = stub(pa, sideA), db = stub(pb, sideB);
    var horizA = sideA === 'l' || sideA === 'r';
    var horizB = sideB === 'l' || sideB === 'r';
    var pts;

    if (horizA && horizB) {
      var mx = (da.x + db.x) / 2;
      pts = [pa, da, { x: mx, y: da.y }, { x: mx, y: db.y }, db, pb];
    } else if (!horizA && !horizB) {
      var my = (da.y + db.y) / 2;
      pts = [pa, da, { x: da.x, y: my }, { x: db.x, y: my }, db, pb];
    } else if (horizA) {
      pts = [pa, da, { x: db.x, y: da.y }, db, pb];
    } else {
      pts = [pa, da, { x: da.x, y: db.y }, db, pb];
    }

    pts = G.simplify(pts);
    // simplify 可能把端点当作共线点删掉，这里确保首尾保留
    if (pts[0] !== pa && G.dist(pts[0].x, pts[0].y, pa.x, pa.y) > 0.6) pts.unshift(pa);
    if (G.dist(pts[pts.length - 1].x, pts[pts.length - 1].y, pb.x, pb.y) > 0.6) pts.push(pb);

    var mid = G.polylineMidpoint(pts);
    return {
      mode: 'orthogonal', d: G.roundedPolylinePath(pts, CORNER),
      points: pts, start: pa, end: pb, startSide: sideA, endSide: sideB,
      label: { x: mid.x, y: mid.y, angle: 0 }
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
      label: { x: mid.x, y: mid.y, angle: 0 }
    };
  }

  /** 计算一条箭头的完整几何信息。nodes 为 id -> node 的映射。 */
  function edgeGeometry(edge, nodes) {
    var a = resolveEnd(edge.from, nodes);
    var b = resolveEnd(edge.to, nodes);
    if (!a || !b) return null;
    if (edge.from.node && edge.from.node === edge.to.node) return selfLoop(a, edge);
    var mode = edge.mode || 'orthogonal';
    if (mode === 'straight') return straightGeom(a, b, edge);
    if (mode === 'curve') return curveGeom(a, b, edge);
    return orthoGeom(a, b, edge);
  }

  return {
    DIRS: DIRS, STUB: STUB, isFixed: isFixed, chooseSide: chooseSide,
    edgeGeometry: edgeGeometry, selfLoop: selfLoop, resolveEnd: resolveEnd
  };
});
