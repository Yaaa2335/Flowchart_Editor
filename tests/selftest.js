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
