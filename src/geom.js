/* geom.js —— 纯几何计算 / 形状库 / 文本排版。不依赖 DOM，可在 Node 中直接单测。 */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { (window.FD = window.FD || {}).geom = api; }
})(function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function round2(v) { return Math.round(v * 100) / 100; }

  function f(v) {
    var r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? 0 : r;
  }

  var seq = 0;
  function uid(prefix) {
    seq += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36).slice(-4) + seq.toString(36);
  }

  function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------------- 文本度量 ---------------- */

  var measureFn = null;

  /** 注入真实测量函数（浏览器里用 canvas measureText）；不注入则用近似宽度。 */
  function setMeasurer(fn) { measureFn = fn; }

  function textWidth(str, fontSize, bold) {
    if (!str) return 0;
    if (measureFn) return measureFn(str, fontSize, bold);
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      var code = str.charCodeAt(i);
      if (code >= 0x2e80) w += 1;
      else if (ch === ' ') w += 0.3;
      else if (code >= 0x41 && code <= 0x5a) w += 0.63;
      else if (/[iljt.,;:'!|]/.test(ch)) w += 0.3;
      else w += 0.53;
    }
    return w * fontSize * (bold ? 1.05 : 1);
  }

  var CJK = /[\u2e80-\u9fff\u3000-\u303f\uf900-\ufaff\uff00-\uffef]/;

  function tokenize(line) {
    var out = [];
    var buf = '';
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (CJK.test(ch)) {
        if (buf) { out.push(buf); buf = ''; }
        out.push(ch);
      } else if (ch === ' ') {
        buf += ch;
        out.push(buf);
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  /** 按宽度换行，返回行数组。 */
  function wrapText(text, maxWidth, fontSize, bold) {
    var raw = String(text == null ? '' : text).split('\n');
    var lines = [];
    for (var i = 0; i < raw.length; i++) {
      var para = raw[i];
      if (!para) { lines.push(''); continue; }
      if (textWidth(para, fontSize, bold) <= maxWidth) { lines.push(para); continue; }
      var tokens = tokenize(para);
      // 单个词超过可用宽度时按字符断开，避免溢出组件
      var expanded = [];
      for (var t = 0; t < tokens.length; t++) {
        var tk = tokens[t];
        if (tk.length > 1 && textWidth(tk, fontSize, bold) > maxWidth) {
          for (var c = 0; c < tk.length; c++) expanded.push(tk[c]);
        } else {
          expanded.push(tk);
        }
      }
      tokens = expanded;
      var line = '';
      for (var j = 0; j < tokens.length; j++) {
        var tok = tokens[j];
        var cand = line + tok;
        if (line && textWidth(cand, fontSize, bold) > maxWidth) {
          lines.push(line.replace(/\s+$/, ''));
          line = /^\s+$/.test(tok) ? '' : tok.replace(/^\s+/, '');
        } else {
          line = cand;
        }
      }
      lines.push(line.replace(/\s+$/, ''));
    }
    return lines.length ? lines : [''];
  }

  /** 多行文本占用的尺寸。 */
  function measureLines(lines, fontSize, bold) {
    var maxW = 0;
    for (var i = 0; i < lines.length; i++) {
      var w = textWidth(lines[i], fontSize, bold);
      if (w > maxW) maxW = w;
    }
    return { w: maxW, h: lines.length * fontSize * 1.35 };
  }

  /* ---------------- 路径构造 ---------------- */

  function roundRectPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, Math.min(w, h) / 2));
    if (r < 0.5) {
      return 'M' + f(x) + ' ' + f(y) + 'H' + f(x + w) + 'V' + f(y + h) + 'H' + f(x) + 'Z';
    }
    return 'M' + f(x + r) + ' ' + f(y) +
      'H' + f(x + w - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x + w) + ' ' + f(y + r) +
      'V' + f(y + h - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x + w - r) + ' ' + f(y + h) +
      'H' + f(x + r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x) + ' ' + f(y + h - r) +
      'V' + f(y + r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x + r) + ' ' + f(y) + 'Z';
  }

  function polygonPath(pts) {
    if (!pts.length) return '';
    var d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
    for (var i = 1; i < pts.length; i++) d += 'L' + f(pts[i][0]) + ' ' + f(pts[i][1]);
    return d + 'Z';
  }

  /** 折线转带圆角的路径（用于正交连线）。 */
  function roundedPolylinePath(pts, radius) {
    var p = dedupe(pts, 0.6);
    if (!p.length) return '';
    if (p.length === 1) return 'M' + f(p[0].x) + ' ' + f(p[0].y);
    var d = 'M' + f(p[0].x) + ' ' + f(p[0].y);
    for (var i = 1; i < p.length - 1; i++) {
      var prev = p[i - 1], cur = p[i], next = p[i + 1];
      var len1 = dist(prev.x, prev.y, cur.x, cur.y);
      var len2 = dist(cur.x, cur.y, next.x, next.y);
      var u1x = (cur.x - prev.x) / (len1 || 1), u1y = (cur.y - prev.y) / (len1 || 1);
      var u2x = (next.x - cur.x) / (len2 || 1), u2y = (next.y - cur.y) / (len2 || 1);
      var cross = u1x * u2y - u1y * u2x;
      var r = Math.min(radius || 0, len1 / 2, len2 / 2);
      if (r < 0.6 || Math.abs(cross) < 1e-6) {
        d += 'L' + f(cur.x) + ' ' + f(cur.y);
        continue;
      }
      var ax = cur.x - u1x * r, ay = cur.y - u1y * r;
      var bx = cur.x + u2x * r, by = cur.y + u2y * r;
      d += 'L' + f(ax) + ' ' + f(ay) + 'Q' + f(cur.x) + ' ' + f(cur.y) + ' ' + f(bx) + ' ' + f(by);
    }
    var last = p[p.length - 1];
    return d + 'L' + f(last.x) + ' ' + f(last.y);
  }

  function dedupe(pts, eps) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p) continue;
      var prev = out[out.length - 1];
      if (prev && dist(prev.x, prev.y, p.x, p.y) < (eps || 0.5)) continue;
      out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  /** 去掉共线的中间点。 */
  function simplify(pts) {
    var p = dedupe(pts, 0.5);
    if (p.length < 3) return p;
    var out = [p[0]];
    for (var i = 1; i < p.length - 1; i++) {
      var a = out[out.length - 1], b = p[i], c = p[i + 1];
      var cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) > 1e-6) out.push(b);
    }
    out.push(p[p.length - 1]);
    return out;
  }

  /** 折线半程点及其切线方向。 */
  function polylineMidpoint(pts) {
    var p = dedupe(pts, 0.5);
    if (!p.length) return { x: 0, y: 0, angle: 0 };
    if (p.length === 1) return { x: p[0].x, y: p[0].y, angle: 0 };
    var total = 0, i;
    for (i = 1; i < p.length; i++) total += dist(p[i - 1].x, p[i - 1].y, p[i].x, p[i].y);
    var half = total / 2, acc = 0;
    for (i = 1; i < p.length; i++) {
      var seg = dist(p[i - 1].x, p[i - 1].y, p[i].x, p[i].y);
      if (acc + seg >= half) {
        var t = seg ? (half - acc) / seg : 0;
        return {
          x: lerp(p[i - 1].x, p[i].x, t),
          y: lerp(p[i - 1].y, p[i].y, t),
          angle: Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x)
        };
      }
      acc += seg;
    }
    return { x: p[p.length - 1].x, y: p[p.length - 1].y, angle: 0 };
  }

  function cubicPoint(p0, c1, c2, p1, t) {
    var mt = 1 - t;
    var a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return { x: a * p0.x + b * c1.x + c * c2.x + d * p1.x, y: a * p0.y + b * c1.y + c * c2.y + d * p1.y };
  }

  /* ---------------- 矩形工具 ---------------- */

  function nodeRect(n) { return { x: n.x, y: n.y, w: n.w, h: n.h }; }
  function rectCenter(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  function pointInRect(px, py, r) { return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }
  function rectContainsRect(outer, inner) {
    return inner.x >= outer.x && inner.y >= outer.y &&
      inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
  }
  function rectsIntersect(a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }
  function expandRect(r, pad) {
    return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
  }
  function normalizeRect(x1, y1, x2, y2) {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  function unionRects(rects) {
    if (!rects.length) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* ---------------- 射线与多边形求交 ---------------- */

  /** 从原点沿 (dx,dy) 射线，求与多边形边界的交点（返回最近的正向交点）。 */
  function polygonRay(poly, dx, dy) {
    var bestT = Infinity, i;
    for (i = 0; i < poly.length; i++) {
      var p = poly[i], q = poly[(i + 1) % poly.length];
      var ex = q[0] - p[0], ey = q[1] - p[1];
      var den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      var t = (p[0] * ey - p[1] * ex) / den;
      if (t <= 1e-6) continue;
      var s = Math.abs(ey) > Math.abs(ex) ? (t * dy - p[1]) / ey : (t * dx - p[0]) / ex;
      if (s < -1e-6 || s > 1 + 1e-6) continue;
      if (t < bestT) bestT = t;
    }
    if (!isFinite(bestT)) return { x: dx, y: dy };
    return { x: dx * bestT, y: dy * bestT };
  }

  function ellipseRay(w, h, dx, dy) {
    var a = w / 2, b = h / 2;
    var t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
    return { x: dx * t, y: dy * t };
  }

  /* ---------------- 形状库 ---------------- */

  function rectOutline(w, h) {
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  }

  var SHAPES = {
    process: {
      name: '处理', group: '基础', defaultW: 160, defaultH: 60, defaultRadius: 10, radiusEditable: true,
      draw: function (x, y, w, h, r) { return roundRectPath(x, y, w, h, r); },
      outline: function (w, h) { return rectOutline(w, h); }
    },
    terminator: {
      name: '起止', group: '基础', defaultW: 140, defaultH: 60, defaultRadius: 0, radiusEditable: false,
      draw: function (x, y, w, h) { return roundRectPath(x, y, w, h, Math.min(w, h) / 2); },
      outline: function (w, h) {
        return [[-w / 2, 0], [-w / 2 + h / 2, -h / 2], [w / 2 - h / 2, -h / 2], [w / 2, 0],
        [w / 2 - h / 2, h / 2], [-w / 2 + h / 2, h / 2]];
      }
    },
    decision: {
      name: '判断', group: '基础', defaultW: 160, defaultH: 80, defaultRadius: 0, radiusEditable: false,
      draw: function (x, y, w, h) {
        return 'M' + f(x + w / 2) + ' ' + f(y) + 'L' + f(x + w) + ' ' + f(y + h / 2) +
          'L' + f(x + w / 2) + ' ' + f(y + h) + 'L' + f(x) + ' ' + f(y + h / 2) + 'Z';
      },
      outline: function (w, h) {
        return [[0, -h / 2], [w / 2, 0], [0, h / 2], [-w / 2, 0]];
      }
    },
    data: {
      name: '数据', group: '基础', defaultW: 160, defaultH: 60, defaultRadius: 0, radiusEditable: false,
      offset: function (w, h) { return Math.min(w * 0.18, h * 0.5, 26); },
      draw: function (x, y, w, h, r, shape) {
        var s = shape.offset(w, h);
        return 'M' + f(x + s) + ' ' + f(y) + 'H' + f(x + w) + 'L' + f(x + w - s) + ' ' + f(y + h) +
          'H' + f(x) + 'Z';
      },
      outline: function (w, h, r, shape) {
        var s = shape.offset(w, h);
        return [[-w / 2 + s, -h / 2], [w / 2, -h / 2], [w / 2 - s, h / 2], [-w / 2, h / 2]];
      }
    },
    document: {
      name: '文档', group: '基础', defaultW: 160, defaultH: 80, defaultRadius: 0, radiusEditable: false,
      wave: function (w, h) { return Math.min(h * 0.16, 15); },
      draw: function (x, y, w, h, r, shape) {
        var v = shape.wave(w, h);
        return 'M' + f(x) + ' ' + f(y) + 'H' + f(x + w) + 'V' + f(y + h - v) +
          'C' + f(x + w * 0.72) + ' ' + f(y + h - v * 2.1) + ' ' + f(x + w * 0.28) + ' ' + f(y + h + v * 0.9) +
          ' ' + f(x) + ' ' + f(y + h - v) + 'Z';
      },
      outline: function (w, h, r, shape) {
        var v = shape.wave(w, h);
        return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2 - v], [0, h / 2],
        [-w / 2, h / 2 - v]];
      }
    },
    database: {
      name: '数据库', group: '基础', defaultW: 140, defaultH: 80, defaultRadius: 0, radiusEditable: false,
      ry: function (w, h) { return Math.max(4, Math.min(h * 0.18, 16)); },
      draw: function (x, y, w, h, r, shape) {
        var ry = shape.ry(w, h), half = w / 2;
        return 'M' + f(x) + ' ' + f(y + ry) +
          'A' + f(half) + ' ' + f(ry) + ' 0 0 1 ' + f(x + w) + ' ' + f(y + ry) +
          'V' + f(y + h - ry) +
          'A' + f(half) + ' ' + f(ry) + ' 0 0 0 ' + f(x) + ' ' + f(y + h - ry) + 'Z';
      },
      decor: function (x, y, w, h, r, shape) {
        var ry = shape.ry(w, h), half = w / 2;
        return ['M' + f(x) + ' ' + f(y + ry) + 'A' + f(half) + ' ' + f(ry) + ' 0 0 0 ' +
          f(x + w) + ' ' + f(y + ry)];
      },
      outline: function (w, h, r, shape) {
        var ry = shape.ry(w, h);
        return [[0, -h / 2], [w / 2, -h / 2 + ry], [w / 2, h / 2 - ry], [0, h / 2],
        [-w / 2, h / 2 - ry], [-w / 2, -h / 2 + ry]];
      }
    },
    prep: {
      name: '准备', group: '基础', defaultW: 160, defaultH: 80, defaultRadius: 0, radiusEditable: false,
      offset: function (w, h) { return Math.min(w * 0.18, h * 0.5, 26); },
      draw: function (x, y, w, h, r, shape) {
        var s = shape.offset(w, h);
        return 'M' + f(x + s) + ' ' + f(y) + 'H' + f(x + w - s) + 'L' + f(x + w) + ' ' + f(y + h / 2) +
          'L' + f(x + w - s) + ' ' + f(y + h) + 'H' + f(x + s) + 'L' + f(x) + ' ' + f(y + h / 2) + 'Z';
      },
      outline: function (w, h, r, shape) {
        var s = shape.offset(w, h);
        return [[-w / 2 + s, -h / 2], [w / 2 - s, -h / 2], [w / 2, 0], [w / 2 - s, h / 2],
        [-w / 2 + s, h / 2], [-w / 2, 0]];
      }
    },
    subprocess: {
      name: '子流程', group: '基础', defaultW: 160, defaultH: 60, defaultRadius: 6, radiusEditable: true,
      draw: function (x, y, w, h, r) { return roundRectPath(x, y, w, h, r); },
      decor: function (x, y, w, h) {
        var inset = Math.min(10, w * 0.12);
        return ['M' + f(x + inset) + ' ' + f(y) + 'V' + f(y + h),
        'M' + f(x + w - inset) + ' ' + f(y) + 'V' + f(y + h)];
      },
      outline: function (w, h) { return rectOutline(w, h); }
    },
    circle: {
      name: '连接圆', group: '基础', defaultW: 80, defaultH: 80, defaultRadius: 0, radiusEditable: false,
      draw: function (x, y, w, h) {
        var cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
        return 'M' + f(cx) + ' ' + f(cy - ry) + 'A' + f(rx) + ' ' + f(ry) + ' 0 1 1 ' + f(cx) + ' ' + f(cy + ry) +
          'A' + f(rx) + ' ' + f(ry) + ' 0 1 1 ' + f(cx) + ' ' + f(cy - ry) + 'Z';
      },
      boundary: function (w, h, dx, dy) { return ellipseRay(w, h, dx, dy); }
    },
    text: {
      name: '纯文本', group: '基础', defaultW: 140, defaultH: 40, defaultRadius: 0, radiusEditable: false,
      noShape: true,
      draw: function () { return ''; },
      outline: function (w, h) { return rectOutline(w, h); },
      textPad: 4
    }
  };

  var SHAPE_ORDER = ['process', 'terminator', 'decision', 'data', 'document', 'database', 'prep', 'subprocess', 'circle', 'text'];

  function getShape(key) { return SHAPES[key] || SHAPES.process; }

  /** 形状在当前尺寸下的中心坐标轮廓（相对节点中心）。 */
  function shapeOutline(shapeKey, w, h, radius) {
    var s = getShape(shapeKey);
    if (!s.outline) return rectOutline(w, h);
    return s.outline(w, h, radius, s);
  }

  /** 从节点中心沿 (dx,dy) 方向到轮廓的交点（世界坐标）。 */
  function shapeBoundaryPoint(node, tx, ty) {
    var s = getShape(node.shape);
    var c = rectCenter(node);
    var dx = tx - c.x, dy = ty - c.y;
    if (dx === 0 && dy === 0) dx = 1;
    var local = s.boundary ? s.boundary(node.w, node.h, dx, dy, s) : polygonRay(shapeOutline(node.shape, node.w, node.h, node.radius), dx, dy);
    return { x: c.x + local.x, y: c.y + local.y };
  }

  /** 四个方向的连接点（世界坐标）。 */
  var SIDES = ['t', 'r', 'b', 'l'];

  function portPoint(node, side) {
    var cx = node.x + node.w / 2, cy = node.y + node.h / 2;
    switch (side) {
      case 't': return { x: cx, y: node.y };
      case 'b': return { x: cx, y: node.y + node.h };
      case 'l': return { x: node.x, y: cy };
      default: return { x: node.x + node.w, y: cy };
    }
  }

  function nodePorts(node) {
    var out = [];
    for (var i = 0; i < SIDES.length; i++) {
      var p = portPoint(node, SIDES[i]);
      p.side = SIDES[i];
      out.push(p);
    }
    return out;
  }

  /** 生成形状路径（世界坐标）。 */
  function shapePath(node) {
    var s = getShape(node.shape);
    return s.draw(node.x, node.y, node.w, node.h, node.radius || 0, s);
  }

  function shapeDecor(node) {
    var s = getShape(node.shape);
    if (!s.decor) return [];
    return s.decor(node.x, node.y, node.w, node.h, node.radius || 0, s);
  }

  /** 由方向向量得到最接近的边。 */
  function sideFromVector(dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'r' : 'l';
    return dy >= 0 ? 'b' : 't';
  }

  return {
    clamp: clamp, f: f, round2: round2, uid: uid, dist: dist, lerp: lerp,
    setMeasurer: setMeasurer, textWidth: textWidth, wrapText: wrapText, measureLines: measureLines,
    roundRectPath: roundRectPath, polygonPath: polygonPath, roundedPolylinePath: roundedPolylinePath,
    dedupe: dedupe, simplify: simplify, polylineMidpoint: polylineMidpoint, cubicPoint: cubicPoint,
    nodeRect: nodeRect, rectCenter: rectCenter, pointInRect: pointInRect, rectContainsRect: rectContainsRect,
    rectsIntersect: rectsIntersect, expandRect: expandRect, normalizeRect: normalizeRect, unionRects: unionRects,
    polygonRay: polygonRay, ellipseRay: ellipseRay,
    SHAPES: SHAPES, SHAPE_ORDER: SHAPE_ORDER, SIDES: SIDES, getShape: getShape,
    shapeOutline: shapeOutline, shapeBoundaryPoint: shapeBoundaryPoint,
    portPoint: portPoint, nodePorts: nodePorts, shapePath: shapePath, shapeDecor: shapeDecor,
    sideFromVector: sideFromVector
  };
});
