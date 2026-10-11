/* 纯逻辑自测：node tests/selftest.js */
'use strict';

var G = require('../src/geom.js');
var R = require('../src/router.js');
var Snap = require('../src/snap.js');

var pass = 0, fail = 0;
var failures = [];

function ok(cond, name, extra) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (extra ? '  → ' + extra : ''));
}

function near(a, b, tol) {
  return Math.abs(a - b) <= (tol == null ? 1e-6 : tol);
}

function eq(a, b, name) { ok(a === b, name, 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

/* ================= geom ================= */

console.log('— geom —');

var rect = { id: 'a', shape: 'process', x: 100, y: 100, w: 160, h: 80, style: { radius: 0 } };

var p = G.shapeBoundaryPoint(rect, 400, 140);
eq(p.x, 260, '矩形右边界交点 x');
eq(p.y, 140, '矩形右边界交点 y');

p = G.shapeBoundaryPoint(rect, 180, 400);
eq(p.y, 180, '矩形下边界交点 y');

var diamond = { id: 'd', shape: 'decision', x: 0, y: 0, w: 200, h: 100, style: { radius: 0 } };
// 向右的交点应为菱形右顶点
p = G.shapeBoundaryPoint(diamond, 500, 50);
ok(near(p.x, 200, 1e-6) && near(p.y, 50, 1e-6), '菱形右顶点', JSON.stringify(p));
// 对角方向：|x|/(w/2)+|y|/(h/2)=1
p = G.shapeBoundaryPoint(diamond, 300, 200);
var t = Math.abs(p.x - 100) / 100 + Math.abs(p.y - 50) / 50;
ok(near(t, 1, 1e-6), '菱形交点在对角线上', 'sum=' + t);

var circle = { id: 'c', shape: 'circle', x: 0, y: 0, w: 100, h: 100, style: { radius: 0 } };
p = G.shapeBoundaryPoint(circle, 200, 50);
ok(near(p.x, 100, 1e-6) && near(p.y, 50, 1e-6), '圆形右交点', JSON.stringify(p));
p = G.shapeBoundaryPoint(circle, 100, 100);
var norm = Math.pow((p.x - 50) / 50, 2) + Math.pow((p.y - 50) / 50, 2);
ok(near(norm, 1, 1e-6), '圆形交点落在圆上', 'norm=' + norm);

// 所有形状的交点都必须在轮廓上（多边形距离 ≈ 0）
G.SHAPE_ORDER.forEach(function (key) {
  var shape = G.getShape(key);
  var node = { id: 'x', shape: key, x: 40, y: 60, w: 140, h: 80, style: { radius: 8 } };
  var outline = G.shapeOutline(key, node.w, node.h, 8);
  var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [3, 1], [-2, 5]];
  dirs.forEach(function (d) {
    var pt = G.shapeBoundaryPoint(node, node.x + node.w / 2 + d[0], node.y + node.h / 2 + d[1]);
    var lx = pt.x - (node.x + node.w / 2), ly = pt.y - (node.y + node.h / 2);
    if (shape.boundary) return; // 解析式形状已单独验证
    var best = Infinity;
    for (var i = 0; i < outline.length; i++) {
      var a = outline[i], b = outline[(i + 1) % outline.length];
      best = Math.min(best, distToSegment(lx, ly, a[0], a[1], b[0], b[1]));
    }
    ok(best < 0.01, '形状 ' + key + ' 方向 ' + d.join(',') + ' 交点贴合轮廓', 'dist=' + best.toFixed(4));
  });
});

function distToSegment(px, py, x1, y1, x2, y2) {
  var dx = x2 - x1, dy = y2 - y1;
  var len2 = dx * dx + dy * dy;
  var t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// 文本换行
var lines = G.wrapText('这是一个很长的中文标题用来测试换行', 56, 14, false);
ok(lines.length >= 4, '中文按宽度换行', JSON.stringify(lines));
lines.forEach(function (l) {
  ok(G.textWidth(l, 14, false) <= 56.001, '换行后不超过最大宽度', l + ' → ' + G.textWidth(l, 14, false));
});
eq(G.wrapText('短', 200, 14).length, 1, '短文本单行');
eq(G.wrapText('a\nb', 200, 14).length, 2, '保留手动换行');
var longWord = G.wrapText('supercalifragilisticexpialidocious', 60, 14, false);
ok(longWord.length > 1, '超长英文单词按字符断开', JSON.stringify(longWord));
longWord.forEach(function (l) { ok(G.textWidth(l, 14, false) <= 60.5, '英文断行不超宽', l); });

// 折线
var poly = G.simplify([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]);
eq(poly.length, 3, '共线点被简化');
var mid = G.polylineMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
eq(mid.x, 50, '折线中点 x');
var rounded = G.roundedPolylinePath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 10);
ok(/^M/.test(rounded) && rounded.indexOf('Q') > 0, '圆角折线包含二次曲线', rounded);
ok(rounded.indexOf('NaN') < 0, '路径不含 NaN');

// 矩形工具
var u = G.unionRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 10 }]);
ok(u.x === 0 && u.y === 0 && u.w === 30 && u.h === 15, '并集包围盒', JSON.stringify(u));

/* ================= router ================= */

console.log('— router —');

function node(id, x, y, w, h, shape) {
  return { id: id, shape: shape || 'process', x: x, y: y, w: w || 120, h: h || 60, style: { radius: 0 } };
}

function edge(from, to, mode, fromPort, toPort) {
  return {
    id: 'e1',
    from: { node: from, port: fromPort || 'auto' },
    to: { node: to, port: toPort || 'auto' },
    mode: mode || 'orthogonal'
  };
}

var A = node('A', 0, 0, 120, 60);      // 右边界 x=120, 中心 y=30
var B = node('B', 300, 0, 120, 60);     // 左边界 x=300
var C = node('C', 0, 200, 120, 60);     // 正下方

var geo = R.edgeGeometry(edge('A', 'B'), { A: A, B: B });
eq(geo.startSide, 'r', '左右布局：起点在右侧');
eq(geo.endSide, 'l', '左右布局：终点在左侧');
ok(near(geo.start.x, 120) && near(geo.start.y, 30), '起点为右端口', JSON.stringify(geo.start));
ok(near(geo.end.x, 300) && near(geo.end.y, 30), '终点为左端口', JSON.stringify(geo.end));
ok(geo.d.indexOf('NaN') < 0, '折线路径无 NaN');
assertNotThroughNodes(geo.points, [A, B], '左右布局折线不穿过组件');

var geoV = R.edgeGeometry(edge('A', 'C'), { A: A, C: C });
eq(geoV.startSide, 'b', '上下布局：起点在下侧');
eq(geoV.endSide, 't', '上下布局：终点在上侧');
ok(near(geoV.start.y, 60) && near(geoV.end.y, 200), '上下端口正确');
assertNotThroughNodes(geoV.points, [A, C], '上下布局折线不穿过组件');

// 目标在右下方（对角）
var D = node('D', 420, 260, 120, 60);
var geoD = R.edgeGeometry(edge('A', 'D'), { A: A, D: D });
assertNotThroughNodes(geoD.points, [A, D], '对角布局折线不穿过组件');

// 目标在左上方，起点应朝上
var E = node('E', -300, -200, 120, 60);
var geoE = R.edgeGeometry(edge('A', 'E'), { A: A, E: E });
ok(geoE.startSide === 'l' || geoE.startSide === 't', '反向布局起点朝左/上', geoE.startSide);
assertNotThroughNodes(geoE.points, [A, E], '反向布局折线不穿过组件');

// 固定端口
var geoFix = R.edgeGeometry(edge('A', 'C', 'orthogonal', 'r', 'r'), { A: A, C: C });
eq(geoFix.startSide, 'r', '固定起点端口生效');
eq(geoFix.endSide, 'r', '固定终点端口生效');

// 直线模式
var geoS = R.edgeGeometry(edge('A', 'B', 'straight'), { A: A, B: B });
eq(geoS.mode, 'straight', '直线模式');
eq(geoS.points.length, 2, '直线只有两个点');
ok(near(geoS.start.x, 120) && near(geoS.end.x, 300), '直线端点落在组件边界');
ok(near(geoS.label.x, 210, 1e-6), '直线标签在中点');

// 曲线模式
var geoC = R.edgeGeometry(edge('A', 'B', 'curve'), { A: A, B: B });
eq(geoC.mode, 'curve', '曲线模式');
eq(geoC.points.length, 4, '曲线有四个控制点');
ok(geoC.d.indexOf('C') > 0, '曲线路径使用三次贝塞尔');

// 自环
var geoLoop = R.edgeGeometry(edge('A', 'A'), { A: A });
eq(geoLoop.mode, 'loop', '自环模式');
ok(geoLoop.label.x > A.x + A.w, '自环标签在组件右侧');

// 自由端点（不挂在组件上的箭头）
var freeTo = { id: 'f1', from: { node: 'A', port: 'auto' }, to: { point: { x: 500, y: 300 } }, mode: 'orthogonal' };
var gf = R.edgeGeometry(freeTo, { A: A });
ok(!!gf && gf.d.indexOf('NaN') < 0, '自由终点：折线路径有效');
ok(near(gf.end.x, 500) && near(gf.end.y, 300), '自由终点就是指定坐标', JSON.stringify(gf.end));

var freeFrom = { id: 'f2', from: { point: { x: -100, y: -80 } }, to: { node: 'A', port: 'auto' }, mode: 'orthogonal' };
var gff = R.edgeGeometry(freeFrom, { A: A });
ok(!!gff && gff.d.indexOf('NaN') < 0, '自由起点：折线路径有效');
ok(near(gff.start.x, -100) && near(gff.start.y, -80), '自由起点就是指定坐标');

var bothFree = { id: 'f3', from: { point: { x: 0, y: 0 } }, to: { point: { x: 200, y: 150 } }, mode: 'orthogonal' };
var gboth = R.edgeGeometry(bothFree, {});
ok(!!gboth && gboth.mode !== 'loop', '两端都自由时不应被当成自环', gboth && gboth.mode);
ok(gboth.d.indexOf('NaN') < 0, '两端自由：路径有效');

['orthogonal', 'straight', 'curve'].forEach(function (mode) {
  var g1 = R.edgeGeometry({ id: 'f4', from: { node: 'A', port: 'auto' }, to: { point: { x: 420, y: 260 } }, mode: mode }, { A: A });
  var g2 = R.edgeGeometry({ id: 'f5', from: { point: { x: 300, y: 300 } }, to: { node: 'A', port: 'auto' }, mode: mode }, { A: A });
  ok(g1 && g1.d.indexOf('NaN') < 0, mode + ' 模式自由终点有效');
  ok(g2 && g2.d.indexOf('NaN') < 0, mode + ' 模式自由起点有效');
});

eq(R.edgeGeometry({ id: 'f6', from: { node: 'ghost' }, to: { node: 'A', port: 'auto' } }, { A: A }), null,
  '端点指向不存在的组件时返回 null');

/* ---- 同一对组件之间的多根箭头 / 双向箭头 ---- */

var P = node('P', 0, 0, 120, 60);
var Q2 = node('Q2', 300, 120, 120, 60);   // 右下错开，路径带中间的竖段

function mkEdge(id, from, to, extra) {
  var e = {
    id: id, from: { node: from, port: 'auto' }, to: { node: to, port: 'auto' },
    mode: 'orthogonal', style: { strokeWidth: 1.8, biSeparate: false }
  };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) e[k] = extra[k];
  return e;
}

var two = [mkEdge('p1', 'P', 'Q2'), mkEdge('p2', 'P', 'Q2')];
var PQ = { P: P, Q2: Q2 };
var lay = R.edgeLayout(two, PQ);
eq(lay.p1.offset, -10, '同向两根箭头：第一根偏 -10');
eq(lay.p2.offset, 10, '同向两根箭头：第二根偏 +10');
eq(lay.p1.slot, 0, '同向两根箭头：第一根槽位 0');
eq(lay.p2.slot, 1, '同向两根箭头：第二根槽位 1');
var gTwoA = R.edgeGeometry(two[0], { P: P, Q2: Q2 }, { offset: lay.p1.offset, slot: lay.p1.slot });
var gTwoB = R.edgeGeometry(two[1], { P: P, Q2: Q2 }, { offset: lay.p2.offset, slot: lay.p2.slot });
ok(gTwoA.d !== gTwoB.d, '两根平行箭头路径不重合');
eq(Math.abs(gTwoA.start.y - gTwoB.start.y), 20, '两根箭头在端口上错开一个间距');
assertNotThroughNodes(gTwoA.points, [P, Q2], '第一根平行箭头不穿过组件');
assertNotThroughNodes(gTwoB.points, [P, Q2], '第二根平行箭头不穿过组件');

var single = [mkEdge('s1', 'P', 'Q2')];
eq(R.edgeLayout(single, PQ).s1.offset, 0, '只有一根箭头时不偏移');

var pair = [mkEdge('b1', 'P', 'Q2'), mkEdge('b2', 'Q2', 'P')];
var layPair = R.edgeLayout(pair, PQ);
eq(layPair.b1.offset, 0, '默认（无）：正向偏移 0');
eq(layPair.b2.offset, 0, '默认（无）：反向偏移 0');
var gOverA = R.edgeGeometry(pair[0], { P: P, Q2: Q2 }, { offset: 0 });
var gOverB = R.edgeGeometry(pair[1], { P: P, Q2: Q2 }, { offset: 0 });
ok(near(gOverA.points[2].x, gOverB.points[2].x), '重合时两条线走同一条轨迹');

pair[0].style.biMode = 'separate';
var laySep = R.edgeLayout(pair, PQ);
eq(laySep.b1.offset, -10, '「分开」：正向偏 -10');
eq(laySep.b2.offset, 10, '「分开」：反向偏 +10');
var gSepA = R.edgeGeometry(pair[0], { P: P, Q2: Q2 }, { offset: laySep.b1.offset });
var gSepB = R.edgeGeometry(pair[1], { P: P, Q2: Q2 }, { offset: laySep.b2.offset });
ok(gSepA.d !== gSepB.d, '分开后两条线路径不同');
ok(gSepA.start.y < P.y + 30 && gSepB.start.y > Q2.y + 30,
  '分开后一条整体偏上、一条整体偏下',
  gSepA.start.y + ' / ' + gSepB.start.y);
eq(Math.abs((Q2.y + 30) - gSepB.start.y), 10, '分开量为半个间距');

// 自由端点与自环不参与平行错位
eq(R.edgeLayout([{ id: 'x', from: { point: { x: 0, y: 0 } }, to: { node: 'P', port: 'auto' }, style: {} }], PQ).x, undefined,
  '自由端点箭头不参与平行错位');
eq(R.edgeLayout([mkEdge('loop', 'P', 'P')], PQ).loop, undefined, '自环不参与平行错位');

// 新的「重合」语义：合并成一条两端带箭头的线，不再需要偏移
var mergedEdge = mkEdge('mg1', 'P', 'Q2');
mergedEdge.style.biMode = 'overlap';
mergedEdge.style.arrowStart = true;
var layMerged = R.edgeLayout([mergedEdge], PQ);
eq(layMerged.mg1.offset, 0, '合并后的双向箭头线不做偏移');
eq(layMerged.mg1.slot, 0, '合并后的双向箭头线单独成组');

/* ---- 分组只看"同一对端口"，左右各连一根不算一对 ---- */
var GA = node('GA', 0, 0, 120, 60);
var GB = node('GB', 400, 0, 120, 60);
var gNodes = { GA: GA, GB: GB };
var leftFwd = mkEdge('lf', 'GA', 'GB', { from: { node: 'GA', port: 'l' }, to: { node: 'GB', port: 'l' } });
var leftRev = mkEdge('lr', 'GB', 'GA', { from: { node: 'GB', port: 'l' }, to: { node: 'GA', port: 'l' } });
var rightRev = mkEdge('rr', 'GB', 'GA', { from: { node: 'GB', port: 'r' }, to: { node: 'GA', port: 'r' } });
ok(R.groupKeyOf(leftFwd, gNodes) === R.groupKeyOf(leftRev, gNodes),
  '同一边的反向箭头属于同一组');
ok(R.groupKeyOf(leftFwd, gNodes) !== R.groupKeyOf(rightRev, gNodes),
  '左边一根、右边一根不能算成一对');
var layMix = R.edgeLayout([leftFwd, leftRev, rightRev], gNodes);
eq(layMix[rightRev.id].offset, 0, '不同边的箭头不会被偏移（否则会错位）');

/* ---- 同一对端口上的「分开」两根线不能互相交叉 ---- */
function routesCross(pa, pb) {
  for (var i = 1; i < pa.length; i++) {
    for (var j = 1; j < pb.length; j++) {
      if (R.segmentsIntersect(pa[i - 1].x, pa[i - 1].y, pa[i].x, pa[i].y,
        pb[j - 1].x, pb[j - 1].y, pb[j].x, pb[j].y)) return true;
    }
  }
  return false;
}
var sepPair = [mkEdge('sp1', 'P', 'Q2'), mkEdge('sp2', 'Q2', 'P')];
sepPair[0].style.biMode = 'separate';
var laySp = R.edgeLayout(sepPair, PQ);
var spA = R.edgeGeometry(sepPair[0], PQ, { offset: laySp.sp1.offset });
var spB = R.edgeGeometry(sepPair[1], PQ, { offset: laySp.sp2.offset });
ok(!routesCross(spA.points, spB.points), '斜向布局下分开的两条线不交叉');
ok(!routesCross(spA.points, spB.points) && spA.d !== spB.d, '分开后仍是两条不同的线');

var F1 = node('F1', 0, 200, 120, 60);
var F2 = node('F2', 300, 200, 120, 60);
var flatNodes = { F1: F1, F2: F2 };
var flatPair = [
  mkEdge('fp1', 'F1', 'F2', { from: { node: 'F1', port: 't' }, to: { node: 'F2', port: 't' } }),
  mkEdge('fp2', 'F2', 'F1', { from: { node: 'F2', port: 't' }, to: { node: 'F1', port: 't' } })
];
flatPair[0].style.biMode = 'separate';
var layFlat = R.edgeLayout(flatPair, flatNodes);
var flA = R.edgeGeometry(flatPair[0], flatNodes, { offset: layFlat.fp1.offset, slot: layFlat.fp1.slot, stub: 20 });
var flB = R.edgeGeometry(flatPair[1], flatNodes, { offset: layFlat.fp2.offset, slot: layFlat.fp2.slot, stub: 20 });
ok(!routesCross(flA.points, flB.points), '等高组件的双向箭头分开后不交叉',
  JSON.stringify(flA.points) + ' / ' + JSON.stringify(flB.points));
ok(Math.abs(flA.bend.pos - flB.bend.pos) > 10, '等高时两条线分处内外两层',
  flA.bend.pos + ' vs ' + flB.bend.pos);

/* ---- 混合走向 + 中间挡组件：必须找得到绕开的路径 ---- */
var MA = node('MA', 0, 0, 120, 60);
var MB = node('MB', 620, 300, 120, 60);
var MC = node('MC', 300, 150, 120, 60);
var mixNodes = { MA: MA, MB: MB, MC: MC };
var mixOb = {
  id: 'mx', from: { node: 'MA', port: 'r' }, to: { node: 'MB', port: 't' },
  mode: 'orthogonal', style: { strokeWidth: 1.8 }
};
var gMixOb = R.edgeGeometry(mixOb, mixNodes, { stub: 20 });
ok(!R.polylineHits(gMixOb.points, R.obstaclesFor(mixOb, mixNodes)),
  '混合走向也会绕开挡路的组件', JSON.stringify(gMixOb.points));
assertNotThroughNodes(gMixOb.points, [MA, MB, MC], '混合走向绕行不穿过任何组件');

/* ---- 网格寻路本身可用 ---- */
var gridPts = R.gridRoute(0, 0, 400, 0, [{ x: 150, y: -50, w: 100, h: 100 }]);
ok(!!gridPts && gridPts.length >= 2, '网格寻路能给出绕行折线', JSON.stringify(gridPts));
ok(!R.polylineHits(gridPts, [R.insetRect({ x: 150, y: -50, w: 100, h: 100 }, 0.5)]),
  '寻路结果不穿过障碍（贴边不算）', JSON.stringify(gridPts));
eq(R.gridRoute(0, 0, 400, 0, []), null, '没有障碍时不走寻路');

/* ---- 连线不能从自己的两端组件身上穿过去 ---- */
var UA = node('UA', 0, 0, 160, 60);
var UB = node('UB', 300, 0, 160, 60);
var uNodes = { UA: UA, UB: UB };
var uRects = R.allRectsOf(uNodes);
var ue = {
  id: 'u1', from: { node: 'UA', port: 't' }, to: { node: 'UB', port: 'b' },
  mode: 'orthogonal', style: { strokeWidth: 1.8 }
};
var gU = R.edgeGeometry(ue, uNodes, { stub: 20 });
ok(!R.polylineHits(gU.points.slice(1, -1), uRects),
  '左组件上端口接右组件下端口时不穿过两个组件', JSON.stringify(gU.points));
ok(gU.points[0].y === 0 && gU.points[gU.points.length - 1].y === 60, '两端仍接在正确的端口上');
// 另一个方向：左组件下端口接右组件上端口
var gU2 = R.edgeGeometry({
  id: 'u2', from: { node: 'UA', port: 'b' }, to: { node: 'UB', port: 't' },
  mode: 'orthogonal', style: { strokeWidth: 1.8 }
}, uNodes, { stub: 20 });
ok(!R.polylineHits(gU2.points.slice(1, -1), uRects),
  '反向接法也不穿过组件', JSON.stringify(gU2.points));

/* ---- 各种相对位置下，分开的一对箭头都不能相交 ---- */
function pairCrossing(portA, portB, dx, dy) {
  var Pa = node('Pa', 0, 0, 160, 60);
  var Pb = node('Pb', 320 + dx, dy, 160, 60);
  var nodes = { Pa: Pa, Pb: Pb };
  var f = mkEdge('f1', 'Pa', 'Pb', { from: { node: 'Pa', port: portA }, to: { node: 'Pb', port: portB } });
  var r = mkEdge('f2', 'Pb', 'Pa', { from: { node: 'Pb', port: portB }, to: { node: 'Pa', port: portA } });
  f.style.biMode = 'separate';
  r.style.biMode = 'separate';
  var lay = R.edgeLayout([f, r], nodes);
  var gf = R.edgeGeometry(f, nodes, { offset: lay.f1.offset, slot: lay.f1.slot, stub: 20 });
  var gr = R.edgeGeometry(r, nodes, { offset: lay.f2.offset, slot: lay.f2.slot, stub: 20 });
  return { cross: routesCross(gf.points, gr.points), a: gf.points, b: gr.points };
}
var REL = [[0, 140], [0, -140], [0, 0], [160, 140], [160, -140], [-160, 140], [-160, -140], [40, 220]];
REL.forEach(function (d) {
  var res = pairCrossing('r', 'l', d[0], d[1]);
  ok(!res.cross, '左右端口分开时，相对位置 ' + d.join(',') + ' 不交叉',
    JSON.stringify(res.a) + ' / ' + JSON.stringify(res.b));
});
REL.forEach(function (d) {
  var res = pairCrossing('t', 't', d[0], d[1]);
  ok(!res.cross, '同侧端口分开时，相对位置 ' + d.join(',') + ' 不交叉',
    JSON.stringify(res.a) + ' / ' + JSON.stringify(res.b));
});

/* ---- 手动拖过转折点后，两根分开的箭头仍然错开 ---- */
var bendPair = [mkEdge('bp1', 'P', 'Q2'), mkEdge('bp2', 'Q2', 'P')];
bendPair.forEach(function (e) { e.style.biMode = 'separate'; e.bend = { x: 210 }; });
var layBp = R.edgeLayout(bendPair, PQ);
var gBp1 = R.edgeGeometry(bendPair[0], PQ, { offset: layBp.bp1.offset, slot: layBp.bp1.slot, stub: 20 });
var gBp2 = R.edgeGeometry(bendPair[1], PQ, { offset: layBp.bp2.offset, slot: layBp.bp2.slot, stub: 20 });
ok(!!gBp1.bend && !!gBp2.bend, '手动设置后两根都有转折点');
ok(Math.abs(gBp1.bend.pos - gBp2.bend.pos) >= 19, '手动转折点后两根仍保持错开',
  gBp1.bend.pos + ' vs ' + gBp2.bend.pos);
ok(!routesCross(gBp1.points, gBp2.points), '手动转折点后两根仍不交叉');

/* ---- 需要绕行时，走线尽量落在两组件的中间 ---- */
var MA2 = node('MA2', 0, 0, 160, 60);
var MB2 = node('MB2', 300, 0, 160, 60);
var midEdge = {
  id: 'me', from: { node: 'MA2', port: 't' }, to: { node: 'MB2', port: 'b' },
  mode: 'orthogonal', style: { strokeWidth: 1.8 }
};
var gMid = R.edgeGeometry(midEdge, { MA2: MA2, MB2: MB2 }, { stub: 20 });
var verticals = [];
for (var vi = 1; vi < gMid.points.length; vi++) {
  if (Math.abs(gMid.points[vi].x - gMid.points[vi - 1].x) < 0.01) verticals.push(gMid.points[vi].x);
}
ok(verticals.some(function (x) { return Math.abs(x - 230) <= 26; }),
  '上端口接下端口时，绕行段走在两组件之间', JSON.stringify(gMid.points));

/* ---- 两个组件等高、都用顶部端口时也必须分开 ---- */
var T1 = node('T1', 0, 200, 120, 60);
var T2 = node('T2', 300, 200, 120, 60);
var topEdge = {
  id: 'tp1', from: { node: 'T1', port: 't' }, to: { node: 'T2', port: 't' },
  mode: 'orthogonal', style: { strokeWidth: 1.8 }
};
var gTop0 = R.edgeGeometry(topEdge, { T1: T1, T2: T2 }, { offset: -10, slot: 0, stub: 20 });
var gTop1 = R.edgeGeometry(topEdge, { T1: T1, T2: T2 }, { offset: 10, slot: 1, stub: 20 });
ok(gTop0.bend && gTop0.bend.kind === 'seg' && gTop0.bend.axis === 'y',
  '同向端口也给出可拖动的水平段', JSON.stringify(gTop0.bend));
ok(gTop0.bend.pos < 200 - 8, '转折点落在端口之上（向外折）', gTop0.bend.pos);
ok(gTop1.bend.pos < gTop0.bend.pos - 10, '两根箭头分层错开，不会重叠',
  gTop0.bend.pos + ' vs ' + gTop1.bend.pos);
ok(gTop0.d !== gTop1.d, '等高组件的同向箭头路径不同');
assertNotThroughNodes(gTop0.points, [T1, T2], '顶部走线不穿过组件');
assertNotThroughNodes(gTop1.points, [T1, T2], '顶部第二根走线不穿过组件');

/* ---- 组件挡在正中间时自动绕开 ---- */
var OA = node('OA', 0, 0, 120, 60);
var OB = node('OB', 600, 0, 120, 60);
var OC = node('OC', 300, 0, 120, 60);
var obEdge = {
  id: 'ob1', from: { node: 'OA', port: 'auto' }, to: { node: 'OB', port: 'auto' },
  mode: 'orthogonal', style: { strokeWidth: 1.8 }
};
var obNodes = { OA: OA, OB: OB, OC: OC };
var obList = R.obstaclesFor(obEdge, obNodes);
ok(R.polylineHits([{ x: 120, y: 30 }, { x: 600, y: 30 }], obList), '检测函数能发现穿过组件');
ok(!R.polylineHits([{ x: 120, y: -30 }, { x: 600, y: -30 }], obList), '检测函数不误报空旷区域');
var gOb = R.edgeGeometry(obEdge, obNodes, { stub: 20 });
ok(!R.polylineHits(gOb.points, obList), '实际走线自动绕开中间的组件', JSON.stringify(gOb.points));
ok(gOb.d.indexOf('NaN') < 0, '绕行走线有效');
assertNotThroughNodes(gOb.points, [OA, OB, OC], '绕行走线不穿过任何组件');

// 竖直方向同理
var VA = node('VA', 0, 0, 120, 60);
var VB = node('VB', 0, 600, 120, 60);
var VC = node('VC', 0, 300, 120, 60);
var obV = {
  id: 'ob2', from: { node: 'VA', port: 'auto' }, to: { node: 'VB', port: 'auto' },
  mode: 'orthogonal', style: { strokeWidth: 1.8 }
};
var obNodesV = { VA: VA, VB: VB, VC: VC };
var gObV = R.edgeGeometry(obV, obNodesV, { stub: 20 });
ok(!R.polylineHits(gObV.points, R.obstaclesFor(obV, obNodesV)),
  '竖直方向也会绕开中间的组件', JSON.stringify(gObV.points));

/* ---- 尾部最短直线 ---- */

ok(Math.abs(R.requiredStub({ style: { strokeWidth: 1.8 } }, 16) - 24.8) < 1e-6,
  '细线时尾部留出箭头长度', R.requiredStub({ style: { strokeWidth: 1.8 } }, 16));
eq(R.requiredStub({ style: { strokeWidth: 3 } }, 16), 32, '粗线时尾部更长');
eq(R.requiredStub({ style: { strokeWidth: 1.8 } }, 40), 40, '手动设定的尾线优先');
var gTail = R.edgeGeometry(mkEdge('t1', 'P', 'Q2'), { P: P, Q2: Q2 }, { offset: 0, stub: 40 });
var lastPts = gTail.points.slice(-2);
function tailRun(geo) {
  var p = geo.points.slice(-2);
  return G.dist(p[0].x, p[0].y, p[1].x, p[1].y);
}
ok(tailRun(gTail) >= 40 - 0.01, '终点前的直线段不短于设定的尾线长度', tailRun(gTail));
// 最坏情况（转折点被拖到最靠近终点）：尾线长度 = 设定值 + 最小间距，说明设定值真的起作用
var gWorstSmall = R.edgeGeometry(mkEdge('t3', 'P', 'Q2', { bend: { x: 99999 } }),
  { P: P, Q2: Q2 }, { offset: 0, stub: 18 });
var gWorstBig = R.edgeGeometry(mkEdge('t4', 'P', 'Q2', { bend: { x: 99999 } }),
  { P: P, Q2: Q2 }, { offset: 0, stub: 90 });
ok(tailRun(gWorstSmall) >= 18 - 0.01 && tailRun(gWorstBig) >= 90 - 0.01,
  '最坏情况下直线段仍不小于设定的尾线长度', tailRun(gWorstSmall) + ' / ' + tailRun(gWorstBig));
ok(tailRun(gWorstBig) > tailRun(gWorstSmall), '尾线调大后箭头离转折点更远',
  tailRun(gWorstSmall) + ' → ' + tailRun(gWorstBig));
// 三种走向都不能让箭头贴在转折点上
[['P', 'Q2', 'auto', 'auto'], ['P', 'Q2', 'r', 't'], ['V1', 'V2', 'auto', 'auto']].forEach(function (cfg) {
  var nodes = { P: P, Q2: Q2, V1: node('V1', 0, 0, 120, 60), V2: node('V2', 90, 300, 120, 60) };
  var e = {
    id: 'tail-' + cfg[2] + cfg[3], from: { node: cfg[0], port: cfg[2] },
    to: { node: cfg[1], port: cfg[3] }, mode: 'orthogonal', style: { strokeWidth: 2.5 }
  };
  var stub = R.requiredStub(e, 16);
  var g = R.edgeGeometry(e, nodes, { offset: 0, stub: stub });
  ok(tailRun(g) >= stub - 0.01, cfg[0] + '→' + cfg[1] + ' 端点前留足直线',
    tailRun(g) + ' >= ' + stub);
});

/* ---- 人工调整折线位置 ---- */

var gAuto = R.edgeGeometry(mkEdge('bd1', 'P', 'Q2'), { P: P, Q2: Q2 }, { offset: 0, stub: 20 });
ok(gAuto.bend && gAuto.bend.kind === 'seg' && gAuto.bend.axis === 'x',
  '左右布局给出可拖动的竖直段', JSON.stringify(gAuto.bend));
var autoX = gAuto.bend.pos;
var bendEdge = mkEdge('bd2', 'P', 'Q2', { bend: { x: autoX + 40 } });
var gMoved = R.edgeGeometry(bendEdge, { P: P, Q2: Q2 }, { offset: 0, stub: 20 });
eq(gMoved.bend.pos, autoX + 40, '人工指定的转折点生效');
bendEdge.bend = { x: 99999 };
var gClamp2 = R.edgeGeometry(bendEdge, { P: P, Q2: Q2 }, { offset: 0, stub: 20 });
ok(near(gClamp2.bend.pos, gClamp2.bend.max), '过大的转折点被夹到上限',
  gClamp2.bend.pos + ' max=' + gClamp2.bend.max);
bendEdge.bend = { x: -99999 };
var gClamp3 = R.edgeGeometry(bendEdge, { P: P, Q2: Q2 }, { offset: 0, stub: 20 });
ok(near(gClamp3.bend.pos, gClamp3.bend.min), '过小的转折点被夹到下限',
  gClamp3.bend.pos + ' min=' + gClamp3.bend.min);
ok(gClamp2.bend.max - gClamp2.bend.min >= R.MIN_SEG * 2 - 0.01, '可用区间包含两端最小直线',
  gClamp2.bend.min + '..' + gClamp2.bend.max);

// 上下布局给出可拖动的水平段
var V1 = node('V1', 0, 0, 120, 60);
var V2 = node('V2', 90, 300, 120, 60);
var gVert = R.edgeGeometry(mkEdge('v1', 'V1', 'V2'), { V1: V1, V2: V2 }, { offset: 0, stub: 20 });
ok(gVert.bend && gVert.bend.kind === 'seg' && gVert.bend.axis === 'y',
  '上下布局给出可拖动的水平段', JSON.stringify(gVert.bend));

// 混合走向给出一个可自由摆放的拐点手柄
var M2 = node('M2', 300, 120, 120, 60);
function mixEdge(bend) {
  return {
    id: 'm1', from: { node: 'P', port: 'r' }, to: { node: 'M2', port: 't' },
    mode: 'orthogonal', style: { strokeWidth: 1.8 }, bend: bend
  };
}
var gMix = R.edgeGeometry(mixEdge(null), { P: P, M2: M2 }, { offset: 0, stub: 20 });
ok(gMix.bend && gMix.bend.kind === 'corner', '混合走向给出拐点手柄', JSON.stringify(gMix.bend));
ok(gMix.d.indexOf('NaN') < 0, '混合走向路径有效');
var cornerX = gMix.bend.x, cornerY = gMix.bend.y;
var gMix2 = R.edgeGeometry(mixEdge({ x: cornerX - 30, y: cornerY + 20 }), { P: P, M2: M2 }, { offset: 0, stub: 20 });
eq(gMix2.bend.x, cornerX - 30, '拐点可以沿水平方向摆放');
eq(gMix2.bend.y, cornerY + 20, '拐点可以沿垂直方向摆放');
ok(gMix2.d !== gMix.d, '拖动拐点后走线改变');
assertNotThroughNodes(gMix2.points, [P, M2], '拖动拐点后的走线仍不穿过组件');
var gMix3 = R.edgeGeometry(mixEdge({ x: 999999, y: -999999 }), { P: P, M2: M2 }, { offset: 0, stub: 20 });
ok(Math.abs(gMix3.bend.x) < 600 && Math.abs(gMix3.bend.y) < 600,
  '极端拖动被限制在合理范围内', JSON.stringify(gMix3.bend));

// 不同形状组合都不应产生 NaN
var shapes = ['process', 'terminator', 'decision', 'data', 'document', 'database', 'prep', 'subprocess', 'circle', 'text'];
shapes.forEach(function (s1) {
  shapes.forEach(function (s2) {
    var n1 = node('P', 0, 0, 140, 80, s1);
    var n2 = node('Q', 320, 220, 140, 80, s2);
    ['orthogonal', 'straight', 'curve'].forEach(function (mode) {
      var g = R.edgeGeometry(edge('P', 'Q', mode), { P: n1, Q: n2 });
      ok(g && g.d && g.d.indexOf('NaN') < 0, '形状组合 ' + s1 + '+' + s2 + ' [' + mode + '] 路径有效', g ? g.d : 'null');
      ok(g && isFinite(g.label.x) && isFinite(g.label.y), '形状组合 ' + s1 + '+' + s2 + ' [' + mode + '] 标签位置有效');
    });
  });
});

function assertNotThroughNodes(points, nodes, name) {
  var inset = 1.5;
  for (var i = 1; i < points.length; i++) {
    var a = points[i - 1], b = points[i];
    for (var t = 0.02; t < 0.99; t += 0.02) {
      var x = a.x + (b.x - a.x) * t;
      var y = a.y + (b.y - a.y) * t;
      for (var k = 0; k < nodes.length; k++) {
        var n = nodes[k];
        if (x > n.x + inset && x < n.x + n.w - inset && y > n.y + inset && y < n.y + n.h - inset) {
          ok(false, name, '点 (' + x.toFixed(1) + ',' + y.toFixed(1) + ') 落在组件内');
          return;
        }
      }
    }
  }
  ok(true, name);
}

/* ================= snap ================= */

console.log('— snap —');

var moving = { x: 103, y: 50, w: 120, h: 60 };
var other = { id: 'o1', x: 100, y: 200, w: 120, h: 60 };

var res = Snap.snapMove(moving, [other], { guides: true, grid: false, threshold: 8 });
eq(res.x, 100, '智能参考线吸附左边缘');
eq(res.y, 50, '无对齐时纵向不动');
ok(res.guides.length > 0 && res.guides[0].axis === 'v' && near(res.guides[0].pos, 100), '返回纵向参考线');

// 网格吸附
res = Snap.snapMove({ x: 103, y: 57, w: 120, h: 60 }, [], { guides: true, grid: true, gridSize: 20, threshold: 8 });
eq(res.x, 100, '网格吸附 x');
eq(res.y, 60, '网格吸附 y');
ok(res.snappedX && res.snappedY, '标记已吸附');

// 尺寸不是网格倍数时，也应该让某条线（下/中/右）贴到网格，而不是只贴左上角
res = Snap.snapMove({ x: 103, y: 50, w: 233, h: 60 }, [], { guides: true, grid: true, gridSize: 20, threshold: 8 });
eq(res.x, 103.5, '取位移最小的中线吸附');
ok(near((res.x + 233 / 2) % 20, 0, 1e-6), '非网格尺寸时中线落在网格上', res.x + 233 / 2);

res = Snap.snapMove({ x: 50, y: 67, w: 160, h: 77 }, [], { guides: true, grid: true, gridSize: 20, threshold: 8 });
eq(res.y, 63, '下边线位移更小时优先吸附下边线');
ok(near((res.y + 77) % 20, 0, 1e-6), '吸附后下边线落在网格上', res.y + 77);

eq(Snap.bestGridDelta([67, 105.5, 144], 20), -4, 'bestGridDelta 取最小位移');
eq(Snap.bestGridDelta([100, 200, 300], 20), 0, '已对齐时位移为 0');

// 默认尺寸应当与默认网格（20）匹配
G.SHAPE_ORDER.forEach(function (key) {
  var shape = G.getShape(key);
  ok(shape.defaultW % 20 === 0 && shape.defaultH % 20 === 0,
    '组件「' + shape.name + '」默认尺寸是网格倍数',
    shape.defaultW + '×' + shape.defaultH);
});

// 参考线优先于网格
res = Snap.snapMove({ x: 103, y: 57, w: 120, h: 60 }, [other], { guides: true, grid: true, gridSize: 20, threshold: 8 });
eq(res.x, 100, '同时开启时参考线优先（x 也对齐到 100）');
eq(res.y, 60, 'y 仍受网格约束');

// 超出阈值不吸附
res = Snap.snapMove({ x: 130, y: 50, w: 120, h: 60 }, [other], { guides: true, grid: false, threshold: 8 });
eq(res.x, 130, '超出阈值保持原位置');
eq(res.guides.length, 0, '未吸附时没有参考线');

// 上边缘对齐（最近的候选是边对边）
res = Snap.snapMove({ x: 100, y: 197, w: 120, h: 20 }, [other], { guides: true, grid: false, threshold: 8 });
eq(res.y, 200, '上边缘对齐');

// 中心对边也算对齐：当它位移更小时优先生效
res = Snap.snapMove({ x: 100, y: 194, w: 120, h: 20 }, [other], { guides: true, grid: false, threshold: 8 });
eq(res.y, 190, '中心对齐到对方上边（位移更小者优先）');

// 多组件：选择最近的一条
var o2 = { id: 'o2', x: 96, y: 300, w: 120, h: 60 };
res = Snap.snapMove({ x: 100, y: 50, w: 120, h: 60 }, [other, o2], { guides: true, grid: false, threshold: 8 });
eq(res.x, 100, '多组件时 x 保持');
ok(res.guides.length >= 2, '两个组件都产生参考线', res.guides.length);

// 缩放吸附
var rz = Snap.snapResize({ x: 100, y: 100, w: 123, h: 57 }, [], { right: true, bottom: true },
  { guides: false, grid: true, gridSize: 20, threshold: 8 });
eq(rz.rect.w, 120, '缩放宽度吸附到网格'); // 223 → 220
eq(rz.rect.h, 60, '缩放高度吸附到网格');
eq(rz.rect.x, 100, '缩放不改变锚点 x');

rz = Snap.snapResize({ x: 97, y: 100, w: 223, h: 60 }, [], { left: true },
  { guides: false, grid: true, gridSize: 20, threshold: 8 });
ok(near(rz.rect.x, 100) && near(rz.rect.x + rz.rect.w, 320), '拖动左边时右边缘固定', JSON.stringify(rz.rect));

// 端点吸附
var n1 = { id: 'n1', shape: 'process', x: 0, y: 0, w: 120, h: 60 };
var n2 = { id: 'n2', shape: 'process', x: 300, y: 0, w: 120, h: 60 };
var sp = Snap.snapPort({ x: 124, y: 4 }, [n1, n2], { threshold: 12 });
ok(sp && sp.node.id === 'n1' && sp.side === 'r' && near(sp.point.x, 120) && near(sp.point.y, 30), '吸附到右端口', JSON.stringify(sp));

sp = Snap.snapPort({ x: 310, y: 30 }, [n1, n2], { threshold: 12 });
ok(sp && sp.node.id === 'n2' && sp.side === 'l', '吸附到左端口', JSON.stringify(sp));

sp = Snap.snapPort({ x: 60, y: 30 }, [n1, n2], { threshold: 12 });
ok(sp && sp.node.id === 'n1', '指针在组件内部时吸附该组件', JSON.stringify(sp));

sp = Snap.snapPort({ x: 200, y: 300 }, [n1, n2], { threshold: 12 });
eq(sp, null, '远离组件时不吸附');

sp = Snap.snapPort({ x: 124, y: 4 }, [n1, n2], { threshold: 12, exclude: ['n1'] });
eq(sp, null, '排除自身后不吸附');

// 缩放倍数下的阈值换算
sp = Snap.snapPort({ x: 130, y: 30 }, [n1], { threshold: 20 });
ok(sp && sp.side === 'r', '较大阈值时吸附', JSON.stringify(sp));

/* ================= 结果 ================= */

console.log('');
if (fail === 0) {
  console.log('全部通过：' + pass + ' 项断言');
  process.exit(0);
}
console.log('失败 ' + fail + ' / ' + (pass + fail) + ' 项：');
failures.slice(0, 40).forEach(function (f) { console.log('  ✗ ' + f); });
process.exit(1);
