/* view.js —— SVG 渲染层：网格、组件、箭头、选中框/手柄/连接点、临时覆盖层。 */
(function () {
  'use strict';

  var G = window.FD.geom;
  var R = window.FD.router;
  var SVGNS = 'http://www.w3.org/2000/svg';

  var HANDLE_SIZE = 8;
  var PORT_R = 5;
  var FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  var HANDLE_CURSOR = {
    nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw',
    n: 'ns', s: 'ns', w: 'ew', e: 'ew'
  };

  function mk(name, attrs) {
    var node = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    return node;
  }

  function setAttrs(node, attrs) {
    for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v == null) { if (node.hasAttribute(k)) node.removeAttribute(k); continue; }
      var s = String(v);
      if (node.getAttribute(k) !== s) node.setAttribute(k, s);
    }
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function colorId(color) {
    return 'm' + String(color).replace(/[^a-zA-Z0-9]/g, '');
  }

  function createView(svg) {
    var defs = svg.querySelector('#defs');
    var gridRect = svg.querySelector('#gridRect');
    var world = svg.querySelector('#world');
    var layerEdges = svg.querySelector('#layerEdges');
    var layerNodes = svg.querySelector('#layerNodes');
    var layerGuides = svg.querySelector('#layerGuides');
    var layerMarquee = svg.querySelector('#layerMarquee');
    var layerUi = svg.querySelector('#layerUi');
    var layerHot = svg.querySelector('#layerHot');

    /* ---------- defs ---------- */

    var shadowFilter = mk('filter', { id: 'fdShadow', x: '-30%', y: '-30%', width: '160%', height: '180%' });
    shadowFilter.appendChild(mk('feDropShadow', { dx: 0, dy: 2, stdDeviation: 3, 'flood-color': '#0f172a', 'flood-opacity': '0.18' }));
    defs.appendChild(shadowFilter);

    var gridPattern = mk('pattern', { id: 'fdGrid', patternUnits: 'userSpaceOnUse', width: 20, height: 20 });
    var gridLines = mk('path', { fill: 'none', 'stroke-width': 1, d: 'M20 0H0V20', 'shape-rendering': 'crispEdges' });
    var gridDots = mk('g', {});
    gridPattern.appendChild(gridLines);
    gridPattern.appendChild(gridDots);
    defs.appendChild(gridPattern);

    var markers = {};
    function ensureMarker(color) {
      var id = colorId(color);
      if (markers[id]) return markers[id];
      var marker = mk('marker', {
        id: id, viewBox: '0 0 12 10', refX: 11, refY: 5,
        markerWidth: 7, markerHeight: 6, orient: 'auto-start-reverse',
        markerUnits: 'strokeWidth'
      });
      marker.appendChild(mk('path', { d: 'M1 1L11 5L1 9Z', fill: color }));
      defs.appendChild(marker);
      markers[id] = id;
      return id;
    }

    /* ---------- 变换与网格 ---------- */

    function applyView(view) {
      setAttrs(world, { transform: 'translate(' + G.f(view.x) + ' ' + G.f(view.y) + ') scale(' + view.zoom + ')' });
      setAttrs(gridPattern, { patternTransform: 'translate(' + G.f(view.x) + ' ' + G.f(view.y) + ') scale(' + view.zoom + ')' });
    }

    function applyGrid(settings, view) {
      var size = Math.max(4, settings.gridSize || 20);
      setAttrs(gridPattern, { width: size, height: size });
      var style = settings.gridStyle || 'line';
      // 线宽按缩放反向补偿：缩小画布时网格线仍是 1px，不会细到看不见
      var zoom = Math.max(0.05, view.zoom || 1);
      var lineW = 1 / zoom;
      setAttrs(gridLines, {
        d: 'M' + size + ' 0H0V' + size,
        'stroke-width': lineW,
        style: 'stroke: var(--grid-line)'
      });
      setAttrs(gridDots, { style: 'fill: var(--grid-dot)' });
      if (style === 'dot') {
        var r = G.clamp(1.2 / zoom, 0.6, size * 0.3);
        var pts = [[0, 0], [size, 0], [0, size], [size, size]];
        if (gridDots.childNodes.length !== 4) {
          clear(gridDots);
          for (var i = 0; i < 4; i++) gridDots.appendChild(mk('circle', { r: r }));
        }
        for (i = 0; i < 4; i++) setAttrs(gridDots.childNodes[i], { cx: pts[i][0], cy: pts[i][1], r: r });
        setAttrs(gridLines, { d: null });
      } else {
        clear(gridDots);
      }
      setAttrs(gridRect, {
        fill: settings.grid ? 'url(#fdGrid)' : 'transparent',
        style: settings.grid ? null : 'fill: transparent'
      });
      // 网格密度过小时不再显示，避免糊成一片
      var tooDense = size * view.zoom < 6;
      setAttrs(gridRect, { opacity: settings.grid && !tooDense ? 1 : 0 });
    }

    /* ---------- 文本排版缓存 ---------- */

    var wrapCache = new Map();
  var themeTextColor = null;
  var themeCanvasBg = null;

  function cssVar(name, fallback) {
    var v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue(name); } catch (err) { v = ''; }
    return (v || '').trim() || fallback;
  }

  function uiTextColor() {
    if (!themeTextColor) themeTextColor = cssVar('--text', '#1f2733');
    return themeTextColor;
  }

  /** 箭头标签的底色：必须写成属性，否则导出的 SVG 里会变成默认黑色。 */
  function uiCanvasBg() {
    if (!themeCanvasBg) themeCanvasBg = cssVar('--canvas-bg', '#ffffff');
    return themeCanvasBg;
  }

    function layout(node) {
      var st = node.style;
      var padX = (G.getShape(node.shape).textPad || 10) + (node.shape === 'text' ? 0 : 0);
      var maxW = Math.max(12, node.w - padX * 2);
      var key = node.text + '\u0000' + st.fontSize + '\u0000' + (st.bold ? 1 : 0) + '\u0000' + Math.round(maxW);
      var lines = wrapCache.get(key);
      if (!lines) {
        lines = G.wrapText(node.text, maxW, st.fontSize, st.bold);
        if (wrapCache.size > 800) wrapCache.clear();
        wrapCache.set(key, lines);
      }
      var lh = st.fontSize * 1.35;
      return { lines: lines, lh: lh, padX: padX, maxW: maxW };
    }

    /* ---------- 组件渲染 ---------- */

    var nodeEls = new Map();
    var edgeEls = new Map();
    var uiSig = null;
    var hotSig = null;

    function renderNode(rec, node) {
      var st = node.style;
      var g = rec.g;
      setAttrs(g, { transform: 'translate(' + G.f(node.x) + ' ' + G.f(node.y) + ')', 'data-id': node.id });

      var shape = G.getShape(node.shape);
      var radius = shape.radiusEditable ? G.clamp(st.radius == null ? shape.defaultRadius : st.radius, 0, Math.min(node.w, node.h) / 2) : 0;
      var d = shape.noShape ? '' : shape.draw(0, 0, node.w, node.h, radius, shape);

      if (!rec.path) {
        rec.path = mk('path', { class: 'node-shape' });
        rec.hit = mk('path', { class: 'node-hit', fill: 'transparent', stroke: 'transparent', 'stroke-width': 12 });
        rec.decor = mk('path', { class: 'node-decor', fill: 'none' });
        rec.text = mk('text', { class: 'node-text' });
        rec.hit.setAttribute('data-node', node.id);
        g.appendChild(rec.path);
        g.appendChild(rec.decor);
        g.appendChild(rec.hit);
        g.appendChild(rec.text);
      }

      var decor = shape.noShape ? [] : G.shapeDecor({ x: 0, y: 0, w: node.w, h: node.h, shape: node.shape, radius: radius });
      setAttrs(rec.decor, {
        d: decor.length ? decor.join(' ') : null,
        stroke: decor.length ? (st.stroke === 'none' ? 'none' : st.stroke) : null,
        'stroke-width': st.strokeWidth, 'stroke-dasharray': st.dash || null, opacity: 0.75
      });
      setAttrs(rec.path, {
        d: d || null,
        fill: st.fill || 'none',
        stroke: st.strokeWidth > 0 && st.stroke !== 'none' ? st.stroke : 'none',
        'stroke-width': st.strokeWidth,
        'stroke-dasharray': st.dash || null,
        'stroke-linejoin': 'round',
        filter: st.shadow && !shape.noShape ? 'url(#fdShadow)' : null
      });
      setAttrs(rec.hit, { d: d || ('M0 0H' + G.f(node.w) + 'V' + G.f(node.h) + 'H0Z'), 'data-node': node.id });

      var lay = layout(node);
      var fontSize = st.fontSize;
      var anchor = st.align === 'left' ? 'start' : st.align === 'right' ? 'end' : 'middle';
      var tx = st.align === 'left' ? lay.padX : st.align === 'right' ? node.w - lay.padX : node.w / 2;
      var startY = node.h / 2 - (lay.lines.length - 1) * lay.lh / 2;
      var textSig = lay.lines.join('\u0001') + '|' + fontSize + '|' + st.fontColor + '|' + st.bold + '|' + st.italic + '|' + anchor + '|' + G.f(tx) + '|' + G.f(startY) + '|' + lay.lh;

      if (rec.textSig !== textSig) {
        rec.textSig = textSig;
        setAttrs(rec.text, {
          'font-size': fontSize,
          'font-weight': st.bold ? 700 : 400,
          'font-style': st.italic ? 'italic' : null,
          'font-family': FONT,
          fill: st.fontColor,
          'text-anchor': anchor,
          'dominant-baseline': 'central'
        });
        clear(rec.text);
        for (var i = 0; i < lay.lines.length; i++) {
          var tspan = mk('tspan', { x: G.f(tx), y: G.f(startY + i * lay.lh) });
          tspan.textContent = lay.lines[i];
          rec.text.appendChild(tspan);
        }
      }
      rec.node = node;
    }

    function renderEdge(rec, edge, geo, selected) {
      var st = edge.style;
      var g = rec.g;
      if (!rec.visible) {
        rec.hit = mk('path', { class: 'edge-hit' });
        rec.visible = mk('path', { class: 'edge-visible' });
        rec.labelBg = mk('rect', { class: 'edge-label-bg', rx: 4, fill: uiCanvasBg() });
        rec.label = mk('text', { class: 'edge-label', 'dominant-baseline': 'central' });
        g.appendChild(rec.hit);
        g.appendChild(rec.visible);
        g.appendChild(rec.labelBg);
        g.appendChild(rec.label);
      }
      setAttrs(g, { 'data-id': edge.id });
      var markerEnd = st.arrowEnd ? 'url(#' + ensureMarker(st.color) + ')' : null;
      var markerStart = st.arrowStart ? 'url(#' + ensureMarker(st.color) + ')' : null;
      setAttrs(rec.hit, { d: geo.d, 'data-edge': edge.id });
      setAttrs(rec.visible, {
        d: geo.d, fill: 'none', stroke: st.color, 'stroke-width': st.strokeWidth,
        'stroke-dasharray': st.dash || null,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'marker-end': markerEnd, 'marker-start': markerStart,
        opacity: selected ? 1 : 0.96
      });

      if (edge.label) {
        var w = G.textWidth(edge.label, 12) + 10;
        setAttrs(rec.labelBg, {
          x: G.f(geo.label.x - w / 2), y: G.f(geo.label.y - 9),
          width: G.f(w), height: 18, fill: uiCanvasBg()
        });
        setAttrs(rec.label, {
          x: G.f(geo.label.x), y: G.f(geo.label.y),
          'text-anchor': 'middle', 'font-family': FONT, fill: uiTextColor()
        });
        if (rec.label.textContent !== edge.label) rec.label.textContent = edge.label;
      } else {
        setAttrs(rec.labelBg, { width: 0, height: 0 });
        if (rec.label.textContent) rec.label.textContent = '';
      }
    }

    /* ---------- 选中框 / 手柄 / 连接点 ---------- */

    function w2s(p, view) { return { x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y }; }

    function rectToScreen(rect, view) {
      var p = w2s(rect, view);
      return { x: p.x, y: p.y, w: rect.w * view.zoom, h: rect.h * view.zoom };
    }

    function renderChrome(state, sig, ctx) {
      if (uiSig !== sig) {
        uiSig = sig;
        clear(layerUi);
        var view = state.view;
        var nodes = state.nodes;
        var multi = state.selection.nodes.length > 1;

        // 悬停高亮
        if (ctx.hoverId && !state.selection.nodes.length) {
          var hn = findNode(nodes, ctx.hoverId);
          if (hn) {
            var r = rectToScreen(hn, view);
            layerUi.appendChild(mk('rect', {
              class: 'hover-outline', x: r.x - 1, y: r.y - 1, width: r.w + 2, height: r.h + 2, rx: 3
            }));
          }
        }

        var sel = state.selection.nodes;
        for (var i = 0; i < sel.length; i++) {
          var node = findNode(nodes, sel[i]);
          if (!node) continue;
          var rs = rectToScreen(node, view);
          layerUi.appendChild(mk('rect', {
            class: 'sel-outline', x: rs.x - 1, y: rs.y - 1, width: rs.w + 2, height: rs.h + 2, rx: 3
          }));
        }

        // 选中的箭头显示可拖动的端点
        var edgeSel = state.selection.edges;
        for (var ei = 0; ei < edgeSel.length; ei++) {
          var geo = ctx.edgeGeos && ctx.edgeGeos[edgeSel[ei]];
          if (!geo) continue;
          var ends = [['from', geo.start], ['to', geo.end]];
          for (var q = 0; q < ends.length; q++) {
            var ep = w2s(ends[q][1], view);
            layerUi.appendChild(mk('circle', {
              class: 'edge-anchor', cx: G.f(ep.x), cy: G.f(ep.y), r: 5.5,
              'data-anchor': ends[q][0], 'data-edge': edgeSel[ei]
            }));
          }
        }

        // 单选时显示缩放手柄与连接点
        if (sel.length === 1 && !ctx.editing) {
          var n = findNode(nodes, sel[0]);
          if (n && !n.locked) {
            var r1 = rectToScreen(n, view);
            var hs = HANDLE_SIZE;
            var defs = [
              ['nw', r1.x, r1.y], ['n', r1.x + r1.w / 2, r1.y], ['ne', r1.x + r1.w, r1.y],
              ['e', r1.x + r1.w, r1.y + r1.h / 2], ['se', r1.x + r1.w, r1.y + r1.h],
              ['s', r1.x + r1.w / 2, r1.y + r1.h], ['sw', r1.x, r1.y + r1.h], ['w', r1.x, r1.y + r1.h / 2]
            ];
            for (var k = 0; k < defs.length; k++) {
              var h = mk('rect', {
                class: 'handle', x: defs[k][1] - hs / 2, y: defs[k][2] - hs / 2,
                width: hs, height: hs, rx: 2,
                'data-handle': defs[k][0], 'data-node': n.id,
                style: 'cursor: ' + (HANDLE_CURSOR[defs[k][0]] || 'default') + '-resize'
              });
              layerUi.appendChild(h);
            }
          }
          if (n) {
            var ports = G.nodePorts(n);
            for (var p = 0; p < ports.length; p++) {
              var sp = w2s(ports[p], view);
              layerUi.appendChild(mk('circle', {
                class: 'port', cx: G.f(sp.x), cy: G.f(sp.y), r: PORT_R,
                'data-port': ports[p].side, 'data-node': n.id
              }));
            }
          }
        }

        // 多选时显示整体外框
        if (multi) {
          var boxes = selectedRects(state);
          if (boxes) {
            var rb = rectToScreen(boxes, view);
            layerUi.appendChild(mk('rect', {
              class: 'sel-outline', x: rb.x - 6, y: rb.y - 6, width: rb.w + 12, height: rb.h + 12, rx: 4, opacity: 0.55
            }));
          }
        }
      }
    }

    function findNode(nodes, id) {
      for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i];
      return null;
    }

    function selectedRects(state) {
      var rects = [];
      for (var i = 0; i < state.selection.nodes.length; i++) {
        var n = findNode(state.nodes, state.selection.nodes[i]);
        if (n) rects.push(n);
      }
      return rects.length ? G.unionRects(rects) : null;
    }

    /* ---------- 临时覆盖层 ---------- */

    function setOverlay(o) {
      o = o || {};
      var sig = JSON.stringify([
        o.guides || [], o.marquee || null, o.ghost || null, o.hotPort || null, o.hotNode || null,
        o.view ? [o.view.x, o.view.y, o.view.zoom] : null
      ]);
      if (sig === hotSig) return;
      hotSig = sig;
      var view = o.view;
      clear(layerGuides);
      clear(layerMarquee);
      clear(layerHot);

      if (o.guides) {
        for (var i = 0; i < o.guides.length; i++) {
          var gd = o.guides[i];
          var a, b, labelPos;
          if (gd.axis === 'v') {
            a = w2s({ x: gd.pos, y: gd.from - 12 }, view);
            b = w2s({ x: gd.pos, y: gd.to + 12 }, view);
          } else {
            a = w2s({ x: gd.from - 12, y: gd.pos }, view);
            b = w2s({ x: gd.to + 12, y: gd.pos }, view);
          }
          layerGuides.appendChild(mk('line', { class: 'guide-line', x1: G.f(a.x), y1: G.f(a.y), x2: G.f(b.x), y2: G.f(b.y) }));
          if (o.showGuideLabel) {
            labelPos = gd.axis === 'v' ? { x: a.x + 4, y: Math.min(a.y, b.y) + 11 } : { x: Math.min(a.x, b.x) + 4, y: a.y - 4 };
            var ltext = mk('text', { class: 'guide-label', x: G.f(labelPos.x), y: G.f(labelPos.y) });
            ltext.textContent = gd.axis === 'v' ? 'x=' + G.f(gd.pos) : 'y=' + G.f(gd.pos);
            layerGuides.appendChild(ltext);
          }
        }
      }

      if (o.marquee) {
        layerMarquee.appendChild(mk('rect', {
          class: 'marquee', x: G.f(o.marquee.x), y: G.f(o.marquee.y),
          width: G.f(o.marquee.w), height: G.f(o.marquee.h)
        }));
      }

      if (o.ghost) {
        if (o.ghost.node) {
          var gr = rectToScreen(o.ghost.node, view);
          layerHot.appendChild(mk('rect', {
            class: 'ghost-node', x: gr.x, y: gr.y, width: gr.w, height: gr.h, rx: 4
          }));
        }
        if (o.ghost.path) {
          layerHot.appendChild(mk('path', { class: 'ghost-edge', d: o.ghost.path }));
        }
      }

      if (o.hotNode) {
        var hr = rectToScreen(o.hotNode, view);
        layerHot.appendChild(mk('rect', {
          class: 'ghost-node', x: hr.x - 3, y: hr.y - 3, width: hr.w + 6, height: hr.h + 6, rx: 5
        }));
      }
      if (o.hotPort) {
        var hp = w2s(o.hotPort, view);
        layerHot.appendChild(mk('circle', {
          class: 'anchor-halo', cx: G.f(hp.x), cy: G.f(hp.y), r: 11
        }));
        layerHot.appendChild(mk('circle', { class: 'anchor-dot', cx: G.f(hp.x), cy: G.f(hp.y), r: 4.5 }));
      }
    }

    /* ---------- 主渲染 ---------- */

    function render(state, ctx) {
      ctx = ctx || {};
      applyView(state.view);
      applyGrid(state.settings, state.view);

      var nodes = state.nodes;
      var map = {};
      var alive = {};
      var i, node;

      for (i = 0; i < nodes.length; i++) {
        node = nodes[i];
        map[node.id] = node;
        alive[node.id] = true;
        var rec = nodeEls.get(node.id);
        if (!rec) {
          rec = { g: mk('g', { class: 'node' }) };
          layerNodes.appendChild(rec.g);
          nodeEls.set(node.id, rec);
        }
        // 保证 DOM 顺序与数据顺序一致，否则「置顶/置底」看不出效果
        if (layerNodes.children[i] !== rec.g) layerNodes.insertBefore(rec.g, layerNodes.children[i] || null);
        renderNode(rec, node);
      }
      nodeEls.forEach(function (rec, id) {
        if (!alive[id]) { layerNodes.removeChild(rec.g); nodeEls.delete(id); }
      });

      var aliveEdges = {};
      var edgeGeos = {};
      var edgeSlot = 0;
      for (i = 0; i < state.edges.length; i++) {
        var edge = state.edges[i];
        var geo = R.edgeGeometry(edge, map);
        if (!geo) continue;
        edgeGeos[edge.id] = geo;
        aliveEdges[edge.id] = true;
        var erec = edgeEls.get(edge.id);
        if (!erec) {
          erec = { g: mk('g', { class: 'edge' }) };
          layerEdges.appendChild(erec.g);
          edgeEls.set(edge.id, erec);
        }
        if (layerEdges.children[edgeSlot] !== erec.g) {
          layerEdges.insertBefore(erec.g, layerEdges.children[edgeSlot] || null);
        }
        edgeSlot++;
        renderEdge(erec, edge, geo, state.selection.edges.indexOf(edge.id) >= 0);
      }
      edgeEls.forEach(function (rec, id) {
        if (!aliveEdges[id]) { layerEdges.removeChild(rec.g); edgeEls.delete(id); }
      });

      var uiSignature = JSON.stringify([
        state.selection.nodes, state.view.x, state.view.y, state.view.zoom,
        nodes.filter(function (n) { return state.selection.nodes.indexOf(n.id) >= 0; })
          .map(function (n) { return [n.id, n.x, n.y, n.w, n.h, n.locked ? 1 : 0]; }),
        state.selection.edges.map(function (id) {
          var g = edgeGeos[id];
          return g ? [id, G.round2(g.start.x), G.round2(g.start.y), G.round2(g.end.x), G.round2(g.end.y)] : [id];
        }),
        ctx.hoverId || null, ctx.editing ? 1 : 0
      ]);
      ctx.edgeGeos = edgeGeos;
      renderChrome(state, uiSignature, ctx);
    }

    return {
      render: render, setOverlay: setOverlay, applyView: applyView,
      rectToScreen: rectToScreen, w2s: w2s,
      invalidateChrome: function () { uiSig = null; },
      invalidateOverlay: function () { hotSig = null; },
      invalidateTheme: function () { themeTextColor = null; themeCanvasBg = null; }
    };
  }

  window.FD.createView = createView;
})();
