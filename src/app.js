/* app.js —— 交互、面板、快捷键、导入导出。 */
(function () {
  'use strict';

  var G = window.FD.geom, R = window.FD.router, Snap = window.FD.snap;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  var MIN_SIZE = 16;
  var STORAGE_DOC = 'fd.doc.v1';
  var STORAGE_SETTINGS = 'fd.settings.v1';
  var STORAGE_SHAPES = 'fd.customShapes.v1';
  var STORAGE_TEMPLATES = 'fd.templates.v1';
  var STORAGE_TABS = 'fd.tabs.v1';

  var store = window.FD.createStore();
  var state = store.state;
  var settings = state.settings;      // 全局设置，所有画板共用
  var tabs = [];                      // 多画板：[{id, name, store}]
  var activeTabId = null;
  var draggingTemplate = null;

  function el(id) { return document.getElementById(id); }
  function closest(node, sel) { return node && node.closest ? node.closest(sel) : null; }

  /* ---------------- 文本测量 ---------------- */

  (function () {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    G.setMeasurer(function (str, size, bold) {
      ctx.font = (bold ? '700 ' : '400 ') + size + 'px ' + FONT;
      return ctx.measureText(str).width;
    });
  })();

  /* ---------------- 基础引用 ---------------- */

  var board = el('board');
  var wrap = el('canvasWrap');
  var editor = el('editor');
  var view = window.FD.createView(board);

  var tool = 'select';
  var drag = null;
  var editing = null;
  var hoverId = null;
  var spaceDown = false;
  var clipboard = null;
  var syncing = false;
  var nudgeGroup = null;
  var saveTimer = null;
  var msgTimer = null;

  /* ---------------- 坐标换算 ---------------- */

  function pointerScreen(e) {
    var r = board.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function pointerWorld(e) {
    var s = pointerScreen(e);
    return { x: (s.x - state.view.x) / state.view.zoom, y: (s.y - state.view.y) / state.view.zoom };
  }
  function screenRectToWorld(r) {
    return {
      x: (r.x - state.view.x) / state.view.zoom,
      y: (r.y - state.view.y) / state.view.zoom,
      w: r.w / state.view.zoom,
      h: r.h / state.view.zoom
    };
  }

  /* ---------------- 消息与光标 ---------------- */

  function msg(text, kind) {
    var node = el('stMessage');
    node.textContent = text;
    node.className = 'msg' + (kind ? ' ' + kind : '');
    if (msgTimer) clearTimeout(msgTimer);
    if (kind !== 'sticky') {
      msgTimer = setTimeout(function () { node.textContent = '就绪'; node.className = 'msg'; }, 3200);
    }
  }

  function pill(text, dur) {
    var node = el('pillHint');
    node.dataset.sticky = '';
    node.textContent = text;
    node.classList.add('show');
    if (pill._t) clearTimeout(pill._t);
    pill._t = setTimeout(function () { node.classList.remove('show'); }, dur || 2200);
  }

  /** 空画布时常驻显示引导提示 */
  function updateEmptyHint() {
    var node = el('pillHint');
    if (state.nodes.length === 0 && !drag && !editing) {
      if (pill._t) { clearTimeout(pill._t); pill._t = null; }
      node.dataset.sticky = '1';
      node.textContent = '从左侧拖入组件，或双击画布快速新建';
      node.classList.add('show');
    } else if (node.dataset.sticky === '1') {
      node.dataset.sticky = '';
      node.classList.remove('show');
    }
  }

  function setCursor(name) { wrap.dataset.cursor = name || (tool === 'pan' ? 'grab' : tool === 'connect' ? 'crosshair' : 'default'); }

  /* ---------------- 渲染 ---------------- */

  function render() {
    view.render(state, { hoverId: hoverId, editing: !!editing });
    updateEmptyHint();
    syncProps();
    updateStatus();
    scheduleAutosave();
  }

  function updateStatus() {
    var n = state.selection.nodes.length, e = state.selection.edges.length;
    el('stSelection').textContent = (n + e) === 0 ? '未选中'
      : '选中 ' + (n ? n + ' 个组件' : '') + (n && e ? '、' : '') + (e ? e + ' 条箭头' : '');
    el('stZoom').textContent = Math.round(state.view.zoom * 100) + '%';
    el('btn-zoom-reset').textContent = Math.round(state.view.zoom * 100) + '%';
    el('btn-undo').disabled = !store.canUndo();
    el('btn-redo').disabled = !store.canRedo();
  }

  function updatePointerReadout(p) {
    var node = el('stPointer');
    if (p) node.textContent = 'x: ' + Math.round(p.x) + ', y: ' + Math.round(p.y);
  }

  /* ---------------- 设置 ---------------- */

  var CHIP_MAP = [
    ['grid', 'tg-grid'], ['snapGrid', 'tg-snap-grid'], ['snapGuides', 'tg-guides'], ['snapPorts', 'tg-ports'],
    ['grid', 'cs-grid'], ['snapGrid', 'cs-snapGrid'], ['snapGuides', 'cs-guides'], ['snapPorts', 'cs-ports']
  ];

  function syncSettingsUI() {
    var s = state.settings;
    CHIP_MAP.forEach(function (pair) {
      var node = el(pair[1]);
      if (!node) return;
      var on = !!s[pair[0]];
      node.classList.toggle('on', on);
      node.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    el('sel-grid-size').value = String(s.gridSize);
    el('cs-gridSize').value = s.gridSize;
    el('cs-tailMin').value = s.tailMin;
    el('sel-grid-style').value = s.gridStyle;
    el('cs-gridStyle').value = s.gridStyle;
    el('cs-threshold').value = s.threshold;
    el('cs-edgeMode').value = s.edgeMode;
    var segs = el('edgeModeGroup').querySelectorAll('.seg');
    for (var i = 0; i < segs.length; i++) segs[i].classList.toggle('on', segs[i].dataset.edgeMode === s.edgeMode);
  }

  function setSetting(key, value) {
    state.settings[key] = value;
    syncSettingsUI();
    saveSettings();
    render();
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(state.settings)); } catch (err) { /* 忽略 */ }
  }

  function scheduleAutosave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORAGE_TABS, JSON.stringify({
          active: activeTabId,
          tabs: tabs.map(function (tab) {
            return { id: tab.id, name: tab.name, data: tab.store.serialize() };
          })
        }));
      } catch (err) { /* 忽略 */ }
    }, 700);
  }

  /* ---------------- 多画板（标签页） ---------------- */

  function tabById(id) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i];
    return null;
  }

  function createTab(name, data, id) {
    var s = window.FD.createStore();
    s.state.settings = settings;
    if (data) s.load(data, true);
    var tab = { id: id || G.uid('tab'), name: name || ('画板 ' + (tabs.length + 1)), store: s };
    tabs.push(tab);
    return tab;
  }

  function activateTab(id) {
    var tab = tabById(id);
    if (!tab) return;
    if (editing) commitEdit(true);
    activeTabId = id;
    store = tab.store;
    state = store.state;
    state.settings = settings;
    applyTheme(settings.theme || 'light');
    syncSettingsUI();
    applyPanelState('left');
    applyPanelState('right');
    view.invalidateChrome();
    view.invalidateOverlay();
    renderTabs();
    render();
    scheduleAutosave();
  }

  function closeTab(id) {
    if (tabs.length <= 1) { msg('至少要保留一个画板', 'warn'); return; }
    var idx = -1;
    tabs.forEach(function (tab, i) { if (tab.id === id) idx = i; });
    if (idx < 0) return;
    var wasActive = (id === activeTabId);
    tabs.splice(idx, 1);
    if (wasActive) activateTab(tabs[Math.min(idx, tabs.length - 1)].id);
    else { renderTabs(); scheduleAutosave(); }
    msg('已关闭画板');
  }

  function renameTab(id) {
    var tab = tabById(id);
    if (!tab) return;
    var name = null;
    try { name = window.prompt('画板名称：', tab.name); } catch (err) { name = null; }
    if (name === null) return;
    tab.name = String(name).trim().slice(0, 16) || tab.name;
    renderTabs();
    scheduleAutosave();
  }

  function renderTabs() {
    var list = el('tabList');
    if (!list) return;
    list.innerHTML = '';
    tabs.forEach(function (tab) {
      var btn = document.createElement('button');
      btn.className = 'tab' + (tab.id === activeTabId ? ' on' : '');
      btn.title = tab.name + '（双击重命名）';
      var nm = document.createElement('span');
      nm.className = 'tab-name';
      nm.textContent = tab.name;
      btn.appendChild(nm);
      if (tabs.length > 1) {
        var x = document.createElement('span');
        x.className = 'tab-close';
        x.textContent = '×';
        x.title = '关闭这个画板';
        x.addEventListener('click', function (ev) {
          ev.stopPropagation();
          closeTab(tab.id);
        });
        btn.appendChild(x);
      }
      btn.addEventListener('click', function () {
        if (tab.id !== activeTabId) activateTab(tab.id);
      });
      btn.addEventListener('dblclick', function () { renameTab(tab.id); });
      list.appendChild(btn);
    });
  }

  /* ---------------- 组件库 ---------------- */

  function shapeIcon(key, w, h) {
    var shape = G.getShape(key);
    var boxW = 34, boxH = 24;
    var rect = { x: 2, y: 2, w: boxW, h: boxH };
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + (boxW + 4) + ' ' + (boxH + 4));
    svg.setAttribute('width', 38);
    svg.setAttribute('height', 28);
    var path = document.createElementNS(SVGNS, 'path');
    var d = shape.draw(rect.x, rect.y, rect.w, rect.h, shape.radiusEditable ? Math.min(4, shape.defaultRadius) : 0, shape);
    if (d) {
      path.setAttribute('d', d);
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('fill-opacity', '0.14');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.4');
      svg.appendChild(path);
    }
    if (shape.noShape) {
      var t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', boxW / 2 + 2);
      t.setAttribute('y', boxH / 2 + 6);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', '12');
      t.setAttribute('font-weight', '600');
      t.setAttribute('fill', 'currentColor');
      t.textContent = '文本';
      svg.appendChild(t);
    }
    return svg;
  }

  function makeShapeButton(key, label, opts) {
    opts = opts || {};
    var btn = document.createElement('button');
    btn.className = 'shape-btn';
    btn.draggable = true;
    btn.dataset.shape = key;
    btn.title = '拖到画布，或点击添加到视图中央';
    btn.appendChild(shapeIcon(key));
    var span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData(opts.mime || 'text/fd-shape', opts.payload == null ? key : String(opts.payload));
      e.dataTransfer.setData('text/plain', key);
      e.dataTransfer.effectAllowed = 'copy';
    });
    btn.addEventListener('dragend', function () { el('dropVeil').hidden = true; });
    btn.addEventListener('click', function () {
      if (opts.onClick) { opts.onClick(); return; }
      var pos = viewportCenterWorld();
      addShapeAt(key, pos.x, pos.y);
    });
    if (opts.onContextMenu) btn.addEventListener('contextmenu', opts.onContextMenu);
    return btn;
  }

  function buildPalette() {
    var list = el('shapeList');
    list.innerHTML = '';
    G.SHAPE_ORDER.forEach(function (key) { list.appendChild(makeShapeButton(key, G.getShape(key).name)); });
  }

  function viewportCenterWorld() {
    return {
      x: (wrap.clientWidth / 2 - state.view.x) / state.view.zoom,
      y: (wrap.clientHeight / 2 - state.view.y) / state.view.zoom
    };
  }

  function addShapeAt(key, wx, wy, overrides, silent) {
    var node = store.makeNode(key, wx, wy, overrides);
    if (state.settings.snapGrid) {
      var g = state.settings.gridSize;
      if (!overrides) {
        // 默认尺寸也取网格倍数，落到网格上时四条边都在网格线上
        node.w = Math.max(g, Math.ceil(node.w / g) * g);
        node.h = Math.max(g, Math.ceil(node.h / g) * g);
      }
      node.x = Math.round((wx - node.w / 2) / g) * g;
      node.y = Math.round((wy - node.h / 2) / g) * g;
    }
    if (!silent) {
      store.addNode(node);
      store.selectNodes([node.id]);
      store.commit();
      render();
      msg('已添加「' + G.getShape(key).name + '」');
    }
    return node;
  }

  /* ---------------- 自定义组件 ---------------- */

  function loadCustomShapes() {
    try {
      var raw = localStorage.getItem(STORAGE_SHAPES);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (err) { return []; }
  }

  function saveCustomShapes(arr) {
    try { localStorage.setItem(STORAGE_SHAPES, JSON.stringify(arr)); } catch (err) { /* 忽略 */ }
  }

  function buildCustomList() {
    var box = el('customList');
    var shapes = loadCustomShapes();
    box.innerHTML = '';
    el('customEmpty').hidden = shapes.length > 0;
    shapes.forEach(function (item, index) {
      var btn = makeShapeButton(item.shape, item.name, {
        mime: 'text/fd-custom',
        payload: index,
        onClick: function () {
          var pos = viewportCenterWorld();
          addShapeAt(item.shape, pos.x, pos.y, customOverrides(item));
        },
        onContextMenu: function (e) {
          e.preventDefault();
          var arr = loadCustomShapes();
          arr.splice(index, 1);
          saveCustomShapes(arr);
          buildCustomList();
          msg('已删除自定义组件');
        }
      });
      btn.dataset.custom = String(index);
      btn.title = '自定义组件：' + Math.round(item.w) + '×' + Math.round(item.h) + '（拖入或点击添加，右键删除）';
      box.appendChild(btn);
    });
  }

  function customOverrides(item) {
    return {
      w: item.w, h: item.h, text: item.text,
      style: JSON.parse(JSON.stringify(item.style))
    };
  }

  function saveCurrentAsCustom() {
    var node = store.selectedNodes()[0];
    if (!node) { msg('请先选中一个组件再保存', 'warn'); return; }
    var arr = loadCustomShapes();
    var name = (node.text || G.getShape(node.shape).name).slice(0, 6) || '自定义';
    arr.unshift({
      name: name, shape: node.shape, w: node.w, h: node.h, text: node.text,
      style: JSON.parse(JSON.stringify(node.style))
    });
    saveCustomShapes(arr.slice(0, 24));
    buildCustomList();
    msg('已保存自定义组件「' + name + '」');
  }

  /* ---------------- 自定义模板（整块复用框选内容） ---------------- */

  function loadTemplates() {
    try {
      var raw = localStorage.getItem(STORAGE_TEMPLATES);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (err) { return []; }
  }

  function saveTemplates(arr) {
    try { localStorage.setItem(STORAGE_TEMPLATES, JSON.stringify(arr)); } catch (err) { /* 忽略 */ }
  }

  function buildTemplateList() {
    var box = el('templateList');
    var list = loadTemplates();
    box.innerHTML = '';
    el('templateEmpty').hidden = list.length > 0;
    list.forEach(function (tpl, index) {
      var btn = document.createElement('button');
      btn.className = 'btn wide';
      btn.draggable = true;
      btn.dataset.templateIndex = String(index);
      btn.title = '点击插入到视图中央，或拖到画布指定位置；右键删除。共 ' +
        tpl.nodes.length + ' 个组件、' + tpl.edges.length + ' 条箭头';
      var label = document.createElement('span');
      label.className = 'tpl-name';
      label.textContent = tpl.name;
      var meta = document.createElement('em');
      meta.className = 'tpl-meta';
      meta.textContent = tpl.nodes.length + ' 个 / ' + tpl.edges.length + ' 条';
      btn.appendChild(label);
      btn.appendChild(meta);
      btn.addEventListener('click', function () {
        var pos = viewportCenterWorld();
        insertTemplate(tpl, pos.x, pos.y);
      });
      btn.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/fd-template', String(index));
        e.dataTransfer.effectAllowed = 'copy';
      });
      btn.addEventListener('dragend', function () { el('dropVeil').hidden = true; });
      btn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        var arr = loadTemplates();
        arr.splice(index, 1);
        saveTemplates(arr);
        buildTemplateList();
        msg('已删除模板');
      });
      box.appendChild(btn);
    });
  }

  function saveSelectionAsTemplate() {
    var nodes = store.selectedNodes();
    if (nodes.length < 2) {
      msg('请先框选或按住 Shift 选中至少两个组件', 'warn');
      pill('先框选要复用的组件，再点「存为模板」', 3200);
      return;
    }
    var ids = nodes.map(function (n) { return n.id; });
    var edges = state.edges.filter(function (e) {
      return e.from.node && e.to.node &&
        ids.indexOf(e.from.node) >= 0 && ids.indexOf(e.to.node) >= 0;
    });
    var suggested = '模板 ' + (loadTemplates().length + 1);
    var name = null;
    try { name = window.prompt('给这个模板起个名字：', suggested); } catch (err) { name = suggested; }
    if (name === null) return;
    name = String(name || '').trim() || suggested;
    var arr = loadTemplates();
    arr.unshift({
      name: name.slice(0, 16),
      nodes: nodes.map(function (n) { return JSON.parse(JSON.stringify(n)); }),
      edges: edges.map(function (e) { return JSON.parse(JSON.stringify(e)); })
    });
    saveTemplates(arr.slice(0, 24));
    buildTemplateList();
    msg('已保存模板「' + name + '」：' + nodes.length + ' 个组件、' + edges.length + ' 条箭头');
  }

  /** 把模板整块插入画布，中心对齐到 (wx, wy)。 */
  function insertTemplate(tpl, wx, wy) {
    if (!tpl || !tpl.nodes || !tpl.nodes.length) return;
    var box = G.unionRects(tpl.nodes);
    var ox = wx - (box.x + box.w / 2);
    var oy = wy - (box.y + box.h / 2);
    if (state.settings.snapGrid) {
      var g = state.settings.gridSize;
      ox = Math.round(ox / g) * g;
      oy = Math.round(oy / g) * g;
    }
    var map = {};
    var newNodes = [];
    tpl.nodes.forEach(function (raw) {
      var copy = JSON.parse(JSON.stringify(raw));
      var oldId = copy.id;
      copy.id = G.uid('n');
      copy.x = Math.round((copy.x + ox) * 100) / 100;
      copy.y = Math.round((copy.y + oy) * 100) / 100;
      map[oldId] = copy.id;
      store.addNode(copy);
      newNodes.push(copy.id);
    });
    var newEdges = [];
    (tpl.edges || []).forEach(function (raw) {
      var copy = JSON.parse(JSON.stringify(raw));
      copy.id = G.uid('e');
      if (copy.from.node && map[copy.from.node]) copy.from.node = map[copy.from.node];
      if (copy.to.node && map[copy.to.node]) copy.to.node = map[copy.to.node];
      if (copy.from.point) { copy.from.point.x += ox; copy.from.point.y += oy; }
      if (copy.to.point) { copy.to.point.x += ox; copy.to.point.y += oy; }
      store.addEdge(copy);
      newEdges.push(copy.id);
    });
    store.selectNodes(newNodes);
    store.selectEdges(newEdges, true);
    store.commit();
    render();
    msg('已插入模板「' + tpl.name + '」');
  }

  /* ---------------- 属性面板 ---------------- */

  function primaryNode() { return store.selectedNodes()[0] || null; }
  function primaryEdge() { return store.selectedEdges()[0] || null; }
  function eachSelectedNode(fn) { store.selectedNodes().forEach(fn); }

  function buildShapeOptions() {
    var sel = el('np-shape');
    sel.innerHTML = '';
    G.SHAPE_ORDER.forEach(function (key) {
      var o = document.createElement('option');
      o.value = key;
      o.textContent = G.getShape(key).name;
      sel.appendChild(o);
    });
  }

  function syncProps() {
    syncing = true;
    var node = primaryNode();
    var edge = primaryEdge();
    var multi = state.selection.nodes.length > 1;

    el('propsNone').hidden = !!node || !!edge;
    el('propsNode').hidden = !node;
    el('propsEdge').hidden = !node && !edge;

    if (node) {
      setVal('np-shape', node.shape);
      setVal('np-x', Math.round(node.x));
      setVal('np-y', Math.round(node.y));
      setVal('np-w', Math.round(node.w));
      setVal('np-h', Math.round(node.h));
      setVal('np-fill', toHex(node.style.fill) || '#ffffff');
      setVal('np-stroke', toHex(node.style.stroke) || '#3c4657');
      setVal('np-strokeWidth', node.style.strokeWidth);
      setVal('np-radius', node.style.radius == null ? 0 : Math.round(node.style.radius));
      setVal('np-dash', node.style.dash || '');
      setVal('np-fontSize', node.style.fontSize);
      setVal('np-fontColor', toHex(node.style.fontColor) || '#1f2733');
      setVal('np-align', node.style.align);
      el('np-lockRatio').checked = !!node.lockRatio;
      toggleClass('np-bold', node.style.bold);
      toggleClass('np-italic', node.style.italic);
      toggleClass('np-shadow', node.style.shadow);
      toggleClass('np-lock', node.locked);
      el('alignRow').style.opacity = multi ? '1' : '0.65';
    }
    if (edge) {
      setVal('ep-mode', edge.mode);
      setVal('ep-label', edge.label || '');
      setVal('ep-color', toHex(edge.style.color) || '#5d6779');
      setVal('ep-strokeWidth', edge.style.strokeWidth);
      setVal('ep-dash', edge.style.dash || '');
      setVal('ep-from-port', edge.from.node ? (edge.from.port || 'auto') : 'free');
      setVal('ep-to-port', edge.to.node ? (edge.to.port || 'auto') : 'free');
      toggleClass('ep-arrowEnd', edge.style.arrowEnd);
      toggleClass('ep-arrowStart', edge.style.arrowStart);
      var biMode = edge.style.biMode || 'none';
      toggleClass('ep-bi-none', biMode === 'none');
      toggleClass('ep-bi-overlap', biMode === 'overlap');
      toggleClass('ep-bi-separate', biMode === 'separate');
      var merged = biMode === 'overlap';
      var noneBtn = el('ep-bi-none');
      var canRevert = biMode === 'none' || edge.style.biAuto === true;
      noneBtn.disabled = !canRevert;
      noneBtn.title = canRevert
        ? '不做特殊处理：同向多根箭头自动错开，反向箭头自然重叠'
        : '两端都是你自己连的箭头，不能自动退回单向；想变单向请先删掉其中一根';
      el('ep-bi-tip').textContent = merged
        ? '这是一条双向箭头线（两端都有箭头）：选中、拖动、删除都是整体操作；选「分开」会拆成两条可分别删除的箭头。' +
          (canRevert ? '选「无」则退回原来那根单向箭头。' : '')
        : groupEdgesOf(edge).length > 1
          ? '同一对端口上有 ' + groupEdgesOf(edge).length + ' 根箭头，各自可单独删除：' +
            '选「分开」让它们并排（互不交叉），选「重合」合并成一条两端带箭头的双向箭头线。' +
            (canRevert ? '这两根是自动补出来的，选「无」会退回原来那根单向箭头。' : '两根都是你手动连的，所以「无」不可用。')
          : '当前是单向箭头：「重合」把它变成两端带箭头的双向箭头线，「分开」会补上反向那根并排显示。';
    }
    syncing = false;
  }

  function setVal(id, v) {
    var node = el(id);
    if (!node) return;
    if (node === document.activeElement) return;
    node.value = v;
  }

  function toggleClass(id, on) {
    var node = el(id);
    if (node) node.classList.toggle('on', !!on);
  }

  function toHex(color) {
    if (!color || color === 'none') return null;
    if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(color)) {
      return ('#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3]).toLowerCase();
    }
    var m = /^rgba?\(([^)]+)\)$/i.exec(color);
    if (m) {
      var parts = m[1].split(',').map(function (s) { return parseFloat(s); });
      return '#' + parts.slice(0, 3).map(function (v) {
        var h = Math.max(0, Math.min(255, Math.round(v))).toString(16);
        return h.length === 1 ? '0' + h : h;
      }).join('');
    }
    return null;
  }

  /* ---------------- 属性编辑绑定 ---------------- */

  function liveUpdate(fn, commitNow) {
    if (syncing) return;
    fn();
    render();
    if (commitNow) store.commit();
  }

  function bindNumber(id, apply) {
    var node = el(id);
    node.addEventListener('input', function () {
      var v = parseFloat(node.value);
      if (!isFinite(v)) return;
      liveUpdate(function () { apply(v); });
    });
    node.addEventListener('change', function () { store.commit(); syncProps(); });
  }

  function bindColor(id, apply) {
    var node = el(id);
    node.addEventListener('input', function () { liveUpdate(function () { apply(node.value); }); });
    node.addEventListener('change', function () { store.commit(); });
  }

  function bindSelect(id, apply) {
    var node = el(id);
    node.addEventListener('change', function () { liveUpdate(function () { apply(node.value); }, true); });
  }

  function bindToggle(id, apply) {
    var node = el(id);
    node.addEventListener('click', function () {
      liveUpdate(function () { apply(); }, false);
      store.commit();
      render();
    });
  }

  function eachEdgeStyle(key) {
    var value = arguments.length > 1 ? arguments[1] : arguments[0];
    store.selectedEdges().forEach(function (e) { e.style[key] = value; });
  }

  function applyStyleToSelected(key, value) {
    var nodes = store.selectedNodes();
    nodes.forEach(function (n) {
      if (key === 'radius' && !G.getShape(n.shape).radiusEditable) return;
      n.style[key] = value;
    });
  }

  function selectedNodeBBox() { return G.unionRects(store.selectedNodes()); }

  /* ---------------- 对齐 ---------------- */

  function alignSelection(mode) {
    var nodes = store.selectedNodes();
    if (nodes.length < 2) { msg('至少选择两个组件才能对齐', 'warn'); return; }
    var b = G.unionRects(nodes);
    if (mode === 'dist-h' || mode === 'dist-v') {
      distribute(nodes, mode === 'dist-h' ? 'h' : 'v');
    } else {
      nodes.forEach(function (n) {
        if (mode === 'left') n.x = b.x;
        else if (mode === 'right') n.x = b.x + b.w - n.w;
        else if (mode === 'hcenter') n.x = b.x + (b.w - n.w) / 2;
        else if (mode === 'top') n.y = b.y;
        else if (mode === 'bottom') n.y = b.y + b.h - n.h;
        else if (mode === 'vcenter') n.y = b.y + (b.h - n.h) / 2;
      });
    }
    store.commit();
    render();
  }

  function distribute(nodes, axis) {
    if (nodes.length < 3) { msg('等间距分布需要至少三个组件', 'warn'); return; }
    var key = axis === 'h' ? 'x' : 'y';
    var sizeKey = axis === 'h' ? 'w' : 'h';
    var sorted = nodes.slice().sort(function (a, b) { return a[key] - b[key]; });
    var start = sorted[0][key];
    var end = sorted[sorted.length - 1][key] + sorted[sorted.length - 1][sizeKey];
    var total = 0;
    sorted.forEach(function (n) { total += n[sizeKey]; });
    var gap = (end - start - total) / (sorted.length - 1);
    var cursor = start;
    sorted.forEach(function (n) {
      n[key] = Math.round(cursor * 100) / 100;
      cursor += n[sizeKey] + gap;
    });
  }

  function fitNodeToText(node) {
    var padX = 22, padY = 16;
    var lines = G.wrapText(node.text, 100000, node.style.fontSize, node.style.bold);
    var m = G.measureLines(lines, node.style.fontSize, node.style.bold);
    node.w = Math.max(40, Math.ceil(m.w + padX));
    node.h = Math.max(28, Math.ceil(m.h + padY));
  }

  /* ---------------- 指针交互 ---------------- */

  function bindDragEvents() {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function unbindDragEvents() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  function onPointerDown(e) {
    if (e.button === 2) return;
    if (!el('contextMenu').hidden) { hideMenus(); if (e.button === 0) return; }
    if (editing) commitEdit(true);
    var pt = pointerWorld(e);
    var target = e.target;

    if (tool === 'pan' || spaceDown || e.button === 1) {
      drag = { type: 'pan', startScreen: pointerScreen(e), origin: { x: state.view.x, y: state.view.y } };
      setCursor('grabbing');
      bindDragEvents();
      e.preventDefault();
      return;
    }

    var anchorEl = closest(target, '[data-anchor]');
    if (anchorEl) {
      var anchorEdgeId = anchorEl.getAttribute('data-edge');
      drag = {
        type: 'edgeEnd', edgeId: anchorEdgeId,
        end: anchorEl.getAttribute('data-anchor'), target: null,
        offset: (R.edgeLayout(state.edges, store.nodeMap())[anchorEdgeId] || { offset: 0 }).offset
      };
      setCursor('crosshair');
      bindDragEvents();
      updateEdgeEnd(e);
      return;
    }

    var bendEl = closest(target, '[data-bend]');
    if (bendEl) {
      var bendEdgeId = bendEl.getAttribute('data-edge');
      var bendEdge = store.edgeById(bendEdgeId);
      drag = {
        type: 'bend', edgeId: bendEdgeId,
        axis: bendEl.getAttribute('data-bend'),
        group: bendEdge ? groupEdgesOf(bendEdge).map(function (item) { return item.id; }) : []
      };
      setCursor(drag.axis === 'x' ? 'ew' : 'ns');
      bindDragEvents();
      updateBend(e);
      return;
    }

    var labelEl = closest(target, '[data-label]');
    if (labelEl) {
      var labelEdgeId = labelEl.getAttribute('data-label');
      if (!store.isEdgeSelected(labelEdgeId)) store.selectEdges([labelEdgeId]);
      drag = { type: 'label', edgeId: labelEdgeId };
      setCursor('move');
      bindDragEvents();
      render();
      return;
    }

    var handleEl = closest(target, '[data-handle]');
    if (handleEl) {
      var hnode = store.nodeById(handleEl.getAttribute('data-node'));
      if (!hnode) return;
      drag = {
        type: 'resize', dir: handleEl.getAttribute('data-handle'), id: hnode.id,
        init: { x: hnode.x, y: hnode.y, w: hnode.w, h: hnode.h }
      };
      bindDragEvents();
      return;
    }

    var portEl = closest(target, '[data-port]');
    if (portEl) {
      startConnect(portEl.getAttribute('data-node'), portEl.getAttribute('data-port'), e);
      return;
    }

    var nodeEl = closest(target, '[data-node]');
    var edgeEl = closest(target, '[data-edge]');

    if (tool === 'connect') {
      if (nodeEl) {
        var n = store.nodeById(nodeEl.getAttribute('data-node'));
        var side = G.sideFromVector(pt.x - (n.x + n.w / 2), pt.y - (n.y + n.h / 2));
        startConnect(n.id, side, e);
      }
      return;
    }

    if (nodeEl) {
      var id = nodeEl.getAttribute('data-node');
      if (e.shiftKey) store.toggleNode(id);
      else if (!store.isNodeSelected(id)) store.selectNodes([id]);
      var node = store.nodeById(id);
      hoverId = id;
      if (node && store.isNodeSelected(id) && !node.locked && !e.altKey) startMove(e, id);
      render();
      return;
    }

    if (edgeEl) {
      var eid = edgeEl.getAttribute('data-edge');
      if (e.shiftKey) store.toggleEdge(eid);
      else store.selectEdges([eid]);
      render();
      return;
    }

    if (!e.shiftKey) store.clearSelection();
    drag = {
      type: 'marquee', startScreen: pointerScreen(e),
      base: { nodes: state.selection.nodes.slice() }
    };
    bindDragEvents();
    render();
  }

  function startMove(e, primaryId) {
    var nodes = store.selectedNodes();
    if (!nodes.length) return;
    drag = {
      type: 'move',
      primaryId: primaryId || nodes[0].id,
      start: pointerWorld(e),
      init: nodes.map(function (n) { return { id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }; })
    };
    setCursor('move');
    bindDragEvents();
  }

  function startConnect(nodeId, side, e) {
    drag = { type: 'connect', from: nodeId, side: side, target: null };
    setCursor('crosshair');
    bindDragEvents();
    updateConnect(e);
  }

  function onPointerMove(e) {
    updatePointerReadout(pointerWorld(e));
    if (!drag) {
      var nodeEl = closest(e.target, '[data-node]');
      var id = nodeEl ? nodeEl.getAttribute('data-node') : null;
      if (id !== hoverId) { hoverId = id; render(); }
      return;
    }
    if (drag.type === 'move') updateMove(e);
    else if (drag.type === 'resize') updateResize(e);
    else if (drag.type === 'marquee') updateMarquee(e);
    else if (drag.type === 'pan') updatePan(e);
    else if (drag.type === 'connect') updateConnect(e);
    else if (drag.type === 'edgeEnd') updateEdgeEnd(e);
    else if (drag.type === 'bend') updateBend(e);
    else if (drag.type === 'label') updateLabel(e);
  }

  function updateMove(e) {
    var w = pointerWorld(e);
    var dx = w.x - drag.start.x, dy = w.y - drag.start.y;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
    }
    var primaryInit = null;
    for (var i = 0; i < drag.init.length; i++) if (drag.init[i].id === drag.primaryId) primaryInit = drag.init[i];
    if (!primaryInit) primaryInit = drag.init[0];

    var proposed = { x: primaryInit.x + dx, y: primaryInit.y + dy, w: primaryInit.w, h: primaryInit.h };
    var selIds = drag.init.map(function (i2) { return i2.id; });
    var others = state.nodes.filter(function (n) { return selIds.indexOf(n.id) < 0; });
    var snap;
    if (e.altKey) {
      snap = { x: proposed.x, y: proposed.y, guides: [] };
      pill('已临时关闭吸附', 1200);
    } else {
      snap = Snap.snapMove(proposed, others, {
        guides: state.settings.snapGuides,
        grid: state.settings.snapGrid,
        gridSize: state.settings.gridSize,
        threshold: state.settings.threshold / state.view.zoom
      });
    }
    var adx = snap.x - primaryInit.x, ady = snap.y - primaryInit.y;
    drag.init.forEach(function (item) {
      var n = store.nodeById(item.id);
      if (!n || n.locked) return;
      n.x = item.x + adx;
      n.y = item.y + ady;
    });
    view.setOverlay({ view: state.view, guides: snap.guides, showGuideLabel: true });
    render();
  }

  function updateResize(e) {
    var w = pointerWorld(e);
    var dir = drag.dir, init = drag.init;
    var left = dir.indexOf('w') >= 0, right = dir.indexOf('e') >= 0;
    var top = dir.indexOf('n') >= 0, bottom = dir.indexOf('s') >= 0;
    var x = init.x, y = init.y, rw = init.w, rh = init.h;
    var node = store.nodeById(drag.id);
    if (!node) return;

    if (right) rw = Math.max(MIN_SIZE, w.x - init.x);
    if (left) {
      var nx = Math.min(w.x, init.x + init.w - MIN_SIZE);
      rw = Math.max(MIN_SIZE, init.x + init.w - nx);
      x = init.x + init.w - rw;
    }
    if (bottom) rh = Math.max(MIN_SIZE, w.y - init.y);
    if (top) {
      var ny = Math.min(w.y, init.y + init.h - MIN_SIZE);
      rh = Math.max(MIN_SIZE, init.y + init.h - ny);
      y = init.y + init.h - rh;
    }

    var lockRatio = node.lockRatio || e.shiftKey;
    if (lockRatio) {
      var ratio = init.w / init.h;
      if ((left || right) && (top || bottom)) {
        rh = Math.max(MIN_SIZE, rw / ratio);
        if (top) y = init.y + init.h - rh;
      } else if (left || right) {
        rh = Math.max(MIN_SIZE, rw / ratio);
        y = init.y + init.h / 2 - rh / 2;
      } else if (top || bottom) {
        rw = Math.max(MIN_SIZE, rh * ratio);
        x = init.x + init.w / 2 - rw / 2;
      }
    }

    var guides = [];
    if (!lockRatio && !e.altKey) {
      var selIds = state.selection.nodes;
      var others = state.nodes.filter(function (n) { return selIds.indexOf(n.id) < 0; });
      var res = Snap.snapResize({ x: x, y: y, w: rw, h: rh }, others,
        { left: left, right: right, top: top, bottom: bottom },
        {
          guides: state.settings.snapGuides, grid: state.settings.snapGrid,
          gridSize: state.settings.gridSize,
          threshold: state.settings.threshold / state.view.zoom
        });
      x = res.rect.x; y = res.rect.y; rw = res.rect.w; rh = res.rect.h;
      guides = res.guides;
    }

    node.x = x; node.y = y;
    node.w = Math.max(MIN_SIZE, rw);
    node.h = Math.max(MIN_SIZE, rh);
    view.setOverlay({ view: state.view, guides: guides });
    render();
  }

  function updateMarquee(e) {
    var p = pointerScreen(e);
    var r = G.normalizeRect(drag.startScreen.x, drag.startScreen.y, p.x, p.y);
    var world = screenRectToWorld(r);
    var ids = [];
    state.nodes.forEach(function (n) { if (G.rectsIntersect(n, world)) ids.push(n.id); });
    var keep = drag.base.nodes.slice();
    ids.forEach(function (id) { if (keep.indexOf(id) < 0) keep.push(id); });
    store.selectNodes(keep, false);
    view.setOverlay({ view: state.view, marquee: r });
    render();
  }

  function updatePan(e) {
    var p = pointerScreen(e);
    state.view.x = drag.origin.x + (p.x - drag.startScreen.x);
    state.view.y = drag.origin.y + (p.y - drag.startScreen.y);
    render();
  }

  /** 统一入口：带上平行错位与尾部最小长度，保证各处算出来的路径一致。 */
  function geoOfEdge(edge, edges) {
    var map = store.nodeMap();
    var offsets = R.edgeLayout(edges || state.edges, map);
    var lay = offsets[edge.id] || { offset: 0, slot: 0 };
    return R.edgeGeometry(edge, map, {
      offset: lay.offset,
      slot: lay.slot,
      stub: R.requiredStub(edge, state.settings.tailMin)
    });
  }

  function connectPreview(fromRef, toRef, offset) {
    var geo = R.edgeGeometry(
      { from: fromRef, to: toRef, mode: state.settings.edgeMode },
      store.nodeMap(),
      { offset: offset || 0 }
    );
    return geo ? screenPath(geo) : null;
  }

  function screenPath(geo) {
    var pts = (geo.points || []).map(function (p) {
      return view.w2s(p, state.view);
    });
    if (geo.mode === 'orthogonal') return G.roundedPolylinePath(pts, 10);
    if (geo.mode === 'curve' || geo.mode === 'loop') {
      if (pts.length < 4) return '';
      return 'M' + G.f(pts[0].x) + ' ' + G.f(pts[0].y) + 'C' + G.f(pts[1].x) + ' ' + G.f(pts[1].y) +
        ' ' + G.f(pts[2].x) + ' ' + G.f(pts[2].y) + ' ' + G.f(pts[3].x) + ' ' + G.f(pts[3].y);
    }
    if (pts.length < 2) return '';
    return 'M' + G.f(pts[0].x) + ' ' + G.f(pts[0].y) + 'L' + G.f(pts[1].x) + ' ' + G.f(pts[1].y);
  }

  function updateConnect(e) {
    var src = store.nodeById(drag.from);
    if (!src) return;
    var pt = pointerWorld(e);
    var threshold = Math.max(state.settings.threshold / state.view.zoom, 12);
    var target = null;
    if (state.settings.snapPorts && !e.altKey) {
      target = Snap.snapPort(pt, state.nodes, { threshold: threshold, exclude: [drag.from] });
    }
    drag.target = target;
    drag.freePoint = pt;
    var fromRef = store.endpointNode(drag.from, drag.side);
    var toRef = target
      ? store.endpointNode(target.node.id, target.side)
      : store.endpointPoint(pt.x, pt.y);
    var path = connectPreview(fromRef, toRef, drag.offset);
    view.setOverlay({
      view: state.view,
      ghost: path ? { path: path } : null,
      hotNode: target ? target.node : null,
      hotPort: target ? target.point : null
    });
  }

  function updateEdgeEnd(e) {
    var edge = store.edgeById(drag.edgeId);
    if (!edge) return;
    var pt = pointerWorld(e);
    var threshold = Math.max(state.settings.threshold / state.view.zoom, 12);
    var target = state.settings.snapPorts && !e.altKey
      ? Snap.snapPort(pt, state.nodes, { threshold: threshold, exclude: [] })
      : null;
    drag.target = target;
    drag.freePoint = pt;
    var fromRef, toRef;
    if (drag.end === 'from') {
      fromRef = target ? store.endpointNode(target.node.id, target.side) : store.endpointPoint(pt.x, pt.y);
      toRef = edge.to;
    } else {
      fromRef = edge.from;
      toRef = target ? store.endpointNode(target.node.id, target.side) : store.endpointPoint(pt.x, pt.y);
    }
    var path = connectPreview(fromRef, toRef);
    view.setOverlay({
      view: state.view,
      ghost: path ? { path: path } : null,
      hotNode: target ? target.node : null,
      hotPort: target ? target.point : null
    });
  }

  /** 拖动折线中途那根直线，自行决定它落在哪里。 */
  function updateBend(e) {
    var edge = store.edgeById(drag.edgeId);
    if (!edge) return;
    var w = pointerWorld(e);
    var g = state.settings.gridSize;
    function snap(v) {
      return state.settings.snapGrid ? Math.round(v / g) * g : Math.round(v * 10) / 10;
    }
    // 同一对端口上的多根箭头作为一个整体一起挪，否则「重合」的一对会被拆开
    var ids = (drag.group && drag.group.length) ? drag.group : [drag.edgeId];
    ids.forEach(function (id) {
      var item = store.edgeById(id);
      if (!item) return;
      if (!item.bend) item.bend = {};
      if (drag.axis === 'corner') {
        item.bend.x = snap(w.x);
        item.bend.y = snap(w.y);
      } else if (drag.axis === 'x') {
        item.bend.x = snap(w.x);
      } else {
        item.bend.y = snap(w.y);
      }
    });
    render();
  }

  function resetBend(edges) {
    var list = edges || store.selectedEdges();
    if (!list.length) return;
    var ids = {};
    list.forEach(function (e) {
      groupEdgesOf(e).forEach(function (item) { ids[item.id] = true; });
    });
    Object.keys(ids).forEach(function (id) {
      var item = store.edgeById(id);
      if (item) delete item.bend;
    });
    store.commit();
    render();
    msg('折线转折点已恢复自动位置');
  }

  /** 拖动箭头标签：可以在箭头附近随便摆，但不能压住组件（渲染时还会再兜一次底）。 */
  function updateLabel(e) {
    var edge = store.edgeById(drag.edgeId);
    if (!edge) return;
    var w = pointerWorld(e);
    edge.labelPos = { x: Math.round(w.x * 10) / 10, y: Math.round(w.y * 10) / 10 };
    render();
  }

  function resetLabelPos(edges) {
    var list = edges || store.selectedEdges();
    if (!list.length) return;
    list.forEach(function (item) {
      var target = store.edgeById(item.id);
      if (target) delete target.labelPos;
    });
    store.commit();
    render();
    msg('标签已回到箭头中间');
  }

  function onPointerUp(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    unbindDragEvents();
    view.invalidateOverlay();
    view.setOverlay({ view: state.view });
    setCursor(null);

    if (d.type === 'move' || d.type === 'resize' || d.type === 'bend' || d.type === 'label') {
      store.commit();
      render();
    } else if (d.type === 'connect') {
      finishConnect(d);
    } else if (d.type === 'edgeEnd') {
      finishEdgeEnd(d);
    } else {
      render();
    }
  }

  function finishConnect(d) {
    var toRef;
    if (d.target) {
      if (d.target.node.id === d.from) { msg('暂不支持连接自身'); render(); return; }
      toRef = store.endpointNode(d.target.node.id, d.target.side);
    } else {
      if (!d.freePoint) { render(); return; }
      toRef = store.endpointPoint(d.freePoint.x, d.freePoint.y);
    }
    var edge = store.makeEdge(store.endpointNode(d.from, d.side), toRef, state.settings.edgeMode);
    store.addEdge(edge);
    store.selectEdges([edge.id]);
    store.commit();
    render();
    msg(d.target ? '已创建箭头' : '已创建箭头，终点为自由位置');
  }

  function finishEdgeEnd(d) {
    var edge = store.edgeById(d.edgeId);
    if (!edge) { render(); return; }
    var ref = d.target
      ? store.endpointNode(d.target.node.id, d.target.side)
      : (d.freePoint ? store.endpointPoint(d.freePoint.x, d.freePoint.y) : null);
    if (!ref) { render(); return; }
    if (d.end === 'from') edge.from = ref;
    else edge.to = ref;
    store.commit();
    render();
  }

  /* ---------------- 文本编辑 ---------------- */

  function startEdit(type, id) {
    if (type === 'node') {
      var node = store.nodeById(id);
      if (!node) return;
      var r = view.rectToScreen(node, state.view);
      editor.style.left = r.x + 'px';
      editor.style.top = r.y + 'px';
      editor.style.width = Math.max(60, r.w) + 'px';
      editor.style.height = Math.max(26, r.h) + 'px';
      editor.style.fontSize = Math.max(9, node.style.fontSize * state.view.zoom) + 'px';
      editor.style.textAlign = node.style.align;
      editor.value = node.text;
    } else {
      var edge = store.edgeById(id);
      if (!edge) return;
      var geo = geoOfEdge(edge);
      if (!geo) return;
      var p = view.w2s(geo.label, state.view);
      editor.style.left = (p.x - 70) + 'px';
      editor.style.top = (p.y - 14) + 'px';
      editor.style.width = '140px';
      editor.style.height = '28px';
      editor.style.fontSize = '12px';
      editor.style.textAlign = 'center';
      editor.value = edge.label || '';
    }
    editing = { type: type, id: id };
    editor.hidden = false;
    editor.focus();
    editor.select();
    render();
  }

  function commitEdit(save) {
    if (!editing) return;
    var info = editing;
    var value = editor.value;
    editing = null;
    editor.hidden = true;
    editor.value = '';
    if (save) {
      if (info.type === 'node') {
        var node = store.nodeById(info.id);
        if (node) node.text = value;
      } else {
        var edge = store.edgeById(info.id);
        if (edge) edge.label = value.trim();
      }
      store.commit();
    }
    render();
  }

  /* ---------------- 缩放 ---------------- */

  function zoomAt(screenX, screenY, factor) {
    var zoom = G.clamp(state.view.zoom * factor, 0.15, 4);
    if (zoom === state.view.zoom) return;
    var wx = (screenX - state.view.x) / state.view.zoom;
    var wy = (screenY - state.view.y) / state.view.zoom;
    state.view.zoom = zoom;
    state.view.x = screenX - wx * zoom;
    state.view.y = screenY - wy * zoom;
    render();
  }

  function setZoom(zoom) {
    zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, zoom / state.view.zoom);
  }

  function fitView() {
    var b = contentBounds();
    var vw = wrap.clientWidth, vh = wrap.clientHeight;
    if (!b || b.w <= 0 || b.h <= 0) {
      state.view = { x: vw / 2, y: 80, zoom: 1 };
      render();
      return;
    }
    var pad = 70;
    var zoom = Math.min((vw - pad * 2) / b.w, (vh - pad * 2) / b.h);
    zoom = G.clamp(zoom, 0.15, 1.8);
    state.view.zoom = zoom;
    state.view.x = vw / 2 - (b.x + b.w / 2) * zoom;
    state.view.y = vh / 2 - (b.y + b.h / 2) * zoom;
    render();
  }

  function contentBounds() {
    var rects = state.nodes.map(function (n) { return { x: n.x, y: n.y, w: n.w, h: n.h }; });
    var map = store.nodeMap();
    var offsets = R.edgeLayout(state.edges, map);
    state.edges.forEach(function (edge) {
      var lay = offsets[edge.id] || { offset: 0, slot: 0 };
      var geo = R.edgeGeometry(edge, map, {
        offset: lay.offset,
        slot: lay.slot,
        stub: R.requiredStub(edge, state.settings.tailMin)
      });
      if (!geo) return;
      (geo.points || []).forEach(function (p) {
        rects.push({ x: p.x, y: p.y, w: 0, h: 0 });
      });
    });
    return G.unionRects(rects);
  }

  /* ---------------- 键盘 ---------------- */

  function isTypingTarget(t) {
    if (!t) return false;
    var tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (editing) { commitEdit(false); return; }
      if (drag) { drag = null; unbindDragEvents(); view.setOverlay({ view: state.view }); }
      store.clearSelection();
      hideMenus();
      render();
      return;
    }
    if (editing) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit(true); }
      return;
    }
    if (isTypingTarget(e.target)) return;

    var mod = e.ctrlKey || e.metaKey;
    var key = e.key;

    if (key === ' ' && !spaceDown) {
      e.preventDefault();
      if (e.target && e.target.tagName === 'BUTTON') e.target.blur();
      spaceDown = true;
      setCursor('grab');
      return;
    }

    if (mod && (key === 'z' || key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey ? store.redo() : store.undo()) { view.invalidateChrome(); render(); msg(e.shiftKey ? '已重做' : '已撤销'); }
      return;
    }
    if (mod && (key === 'y' || key === 'Y')) {
      e.preventDefault();
      if (store.redo()) { view.invalidateChrome(); render(); msg('已重做'); }
      return;
    }
    if (mod && (key === 'c' || key === 'C')) { doCopy(); return; }
    if (mod && (key === 'x' || key === 'X')) { doCopy(); store.deleteSelection(); store.commit(); render(); msg('已剪切'); return; }
    if (mod && (key === 'v' || key === 'V')) { doPaste(); return; }
    if (mod && (key === 'd' || key === 'D')) { e.preventDefault(); store.duplicateSelection(); store.commit(); render(); msg('已复制一份'); return; }
    if (mod && (key === 'a' || key === 'A')) { e.preventDefault(); store.selectAll(); render(); return; }
    if (mod && (key === 's' || key === 'S')) { e.preventDefault(); saveJsonFile(); return; }
    if (mod && (key === '0')) { e.preventDefault(); fitView(); return; }
    if (mod && (key === '=' || key === '+')) { e.preventDefault(); zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1.2); return; }
    if (mod && (key === '-')) { e.preventDefault(); zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1 / 1.2); return; }

    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      if (store.selectionCount()) { store.deleteSelection(); store.commit(); render(); msg('已删除'); }
      return;
    }
    if (key === 'v' || key === 'V') { setTool('select'); return; }
    if (key === 'l' || key === 'L') { setTool('connect'); return; }
    if (key === 'h' || key === 'H') { setTool('pan'); return; }
    if (key === 'f' || key === 'F') { fitView(); return; }

    if (key.indexOf('Arrow') === 0) {
      e.preventDefault();
      nudge(key, e.shiftKey ? 10 : (e.altKey ? 0.5 : 1));
      return;
    }
    if (key === 'g' && !mod) { setSetting('grid', !state.settings.grid); return; }
  }

  function onKeyUp(e) {
    if (e.key === ' ') { spaceDown = false; setCursor(null); }
  }

  function nudge(direction, step) {
    var nodes = store.selectedNodes();
    if (!nodes.length) return;
    var dx = direction === 'ArrowLeft' ? -step : direction === 'ArrowRight' ? step : 0;
    var dy = direction === 'ArrowUp' ? -step : direction === 'ArrowDown' ? step : 0;
    nodes.forEach(function (n) {
      if (n.locked) return;
      n.x += dx;
      n.y += dy;
    });
    render();
    // 连续微调合并为一步撤销
    if (!nudgeGroup) {
      nudgeGroup = setTimeout(function () {
        nudgeGroup = null;
        store.commit();
      }, 700);
    }
  }

  function doCopy() {
    var nodes = store.selectedNodes();
    var edges = store.selectedEdges();
    if (!nodes.length && !edges.length) return;
    var ids = nodes.map(function (n) { return n.id; });
    clipboard = {
      nodes: nodes.map(function (n) { return store.cloneNode(n); }),
      edges: edges.filter(function (e) {
        return ids.indexOf(e.from.node) >= 0 && ids.indexOf(e.to.node) >= 0;
      }).map(function (e) { return JSON.parse(JSON.stringify(e)); })
    };
    msg('已复制 ' + clipboard.nodes.length + ' 个组件');
  }

  function doPaste() {
    if (!clipboard || !clipboard.nodes.length) return;
    var map = {};
    var newIds = [];
    clipboard.nodes.forEach(function (n) {
      var copy = store.cloneNode(n);
      copy.id = G.uid('n');
      copy.x += 28;
      copy.y += 28;
      map[n.id] = copy.id;
      store.addNode(copy);
      newIds.push(copy.id);
    });
    var newEdgeIds = [];
    clipboard.edges.forEach(function (e) {
      var copy = JSON.parse(JSON.stringify(e));
      copy.id = G.uid('e');
      if (map[e.from.node]) copy.from.node = map[e.from.node];
      if (map[e.to.node]) copy.to.node = map[e.to.node];
      store.addEdge(copy);
      newEdgeIds.push(copy.id);
    });
    store.selectNodes(newIds);
    store.selectEdges(newEdgeIds, true);
    clipboard.nodes.forEach(function (n) { n.x += 28; n.y += 28; });
    store.commit();
    render();
    msg('已粘贴');
  }

  /* ---------------- 文件 ---------------- */

  function download(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function timestamp() {
    var d = new Date();
    function p(v) { return v < 10 ? '0' + v : String(v); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function saveJsonFile() {
    var data = store.serialize();
    download('流程图-' + timestamp() + '.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    msg('已保存 JSON 文件');
  }

  function openJsonFile() { el('fileInput').click(); }

  function buildExportSvg() {
    var b = contentBounds();
    if (!b) b = { x: 0, y: 0, w: 420, h: 300 };
    var pad = 24;
    var out = document.createElementNS(SVGNS, 'svg');
    out.setAttribute('xmlns', SVGNS);
    out.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    out.setAttribute('version', '1.1');
    out.setAttribute('width', Math.round(b.w + pad * 2));
    out.setAttribute('height', Math.round(b.h + pad * 2));
    out.setAttribute('viewBox', [G.f(b.x - pad), G.f(b.y - pad), G.f(b.w + pad * 2), G.f(b.h + pad * 2)].join(' '));

    var defs = board.querySelector('#defs').cloneNode(true);
    var grid = defs.querySelector('#fdGrid');
    if (grid) grid.parentNode.removeChild(grid);
    out.appendChild(defs);

    var bg = document.createElementNS(SVGNS, 'rect');
    bg.setAttribute('x', G.f(b.x - pad));
    bg.setAttribute('y', G.f(b.y - pad));
    bg.setAttribute('width', G.f(b.w + pad * 2));
    bg.setAttribute('height', G.f(b.h + pad * 2));
    bg.setAttribute('fill', canvasBackground());
    out.appendChild(bg);

    ['#layerEdges', '#layerNodes'].forEach(function (sel) {
      var layer = board.querySelector(sel).cloneNode(true);
      var junk = layer.querySelectorAll('.node-hit, .edge-hit');
      for (var i = 0; i < junk.length; i++) junk[i].parentNode.removeChild(junk[i]);
      out.appendChild(layer);
    });

    var style = document.createElementNS(SVGNS, 'style');
    style.textContent = 'text{font-family:' + FONT + '}';
    out.appendChild(style);
    return out;
  }

  function canvasBackground() {
    var c = getComputedStyle(wrap).backgroundColor;
    if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return '#ffffff';
    return c;
  }

  function exportSvg() {
    var svg = buildExportSvg();
    var text = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
    download('流程图-' + timestamp() + '.svg', new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
    msg('已导出 SVG');
  }

  function exportPng() {
    var svg = buildExportSvg();
    var source = new XMLSerializer().serializeToString(svg);
    var w = parseFloat(svg.getAttribute('width'));
    var h = parseFloat(svg.getAttribute('height'));
    var blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      var scale = 2;
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = canvasBackground();
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      if (canvas.toBlob) {
        canvas.toBlob(function (b) {
          if (b) { download('流程图-' + timestamp() + '.png', b); msg('已导出 PNG'); }
          else msg('PNG 导出失败，请改用 SVG', 'warn');
        }, 'image/png');
      } else {
        msg('当前浏览器不支持 PNG 导出，请改用 SVG', 'warn');
      }
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      msg('PNG 导出失败，请改用 SVG 导出', 'warn');
    };
    img.src = url;
  }

  function onFileChosen(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        store.load(data, true);
        if (!data.view) fitView();
        view.invalidateChrome();
        render();
        msg('已打开「' + file.name + '」');
      } catch (err) {
        msg('文件解析失败：' + err.message, 'warn');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  /* ---------------- 模板 / 新建 ---------------- */

  function loadTemplate(key) {
    var data = window.FD.templates.build(key);
    if (!data) return;
    store.load(data, true);
    view.invalidateChrome();
    fitView();
    msg('已载入示例模板');
  }

  /** 新建画板：开一个新标签页，不动当前这张。 */
  function newBoard() {
    var tab = createTab('画板 ' + (tabs.length + 1));
    activateTab(tab.id);
    pill('新画板已创建，可在标签上双击改名');
  }

  /** 清空当前画板（标签页还在）。 */
  function clearBoard() {
    if (state.nodes.length && !window.confirm('清空当前画板？这一步可以撤销。')) return;
    store.reset();
    view.invalidateChrome();
    state.view = { x: 0, y: 0, zoom: 1 };
    fitView();
    render();
    msg('已清空当前画板');
  }

  /* ---------------- 菜单 ---------------- */

  function hideMenus() {
    el('menu-export').hidden = true;
    el('btn-export').setAttribute('aria-expanded', 'false');
    el('contextMenu').hidden = true;
  }

  /* ---------------- 右键菜单 ---------------- */

  function showContextMenu(screenPos, items) {
    var menu = el('contextMenu');
    menu.innerHTML = '';
    items.forEach(function (item) {
      if (item === '-') {
        var sep = document.createElement('div');
        sep.className = 'sep';
        menu.appendChild(sep);
        return;
      }
      var btn = document.createElement('button');
      btn.textContent = item.label;
      if (item.danger) btn.className = 'danger';
      if (item.active) btn.classList.add('on');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        hideMenus();
        item.run();
      });
      menu.appendChild(btn);
    });
    menu.hidden = false;
    menu.style.left = '0px';
    menu.style.top = '0px';
    var w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(screenPos.x, wrap.clientWidth - w - 6)) + 'px';
    menu.style.top = Math.max(4, Math.min(screenPos.y, wrap.clientHeight - h - 6)) + 'px';
  }

  function nodeMenuItems(id) {
    var node = store.nodeById(id);
    if (!node) return [];
    return [
      { label: '编辑文字', run: function () { startEdit('node', id); } },
      { label: '复制一份', run: function () { store.selectNodes([id]); store.duplicateSelection(); store.commit(); render(); } },
      { label: '存为自定义组件', run: function () { store.selectNodes([id]); saveCurrentAsCustom(); } },
      '-',
      { label: '置顶', run: function () { store.bringForward([id]); store.commit(); render(); } },
      { label: '置底', run: function () { store.sendBackward([id]); store.commit(); render(); } },
      { label: node.locked ? '解除锁定' : '锁定位置', active: !!node.locked, run: function () { node.locked = !node.locked; store.commit(); render(); } },
      '-',
      { label: '删除', danger: true, run: function () { store.selectNodes([id]); store.deleteSelection(); store.commit(); render(); msg('已删除'); } }
    ];
  }

  function edgeMenuItems(id) {
    var edge = store.edgeById(id);
    if (!edge) return [];
    return [
      { label: '折线', active: edge.mode === 'orthogonal', run: function () { setEdgeMode(id, 'orthogonal'); } },
      { label: '直线', active: edge.mode === 'straight', run: function () { setEdgeMode(id, 'straight'); } },
      { label: '曲线', active: edge.mode === 'curve', run: function () { setEdgeMode(id, 'curve'); } },
      '-',
      { label: '编辑标签', run: function () { store.selectEdges([id]); render(); startEdit('edge', id); } },
      { label: '反转方向', run: function () { var f = edge.from; edge.from = edge.to; edge.to = f; store.commit(); render(); } },
      { label: '重置折线位置', run: function () { store.selectEdges([id]); resetBend([edge]); } },
      { label: '重置标签位置', run: function () { store.selectEdges([id]); resetLabelPos([edge]); } },
      {
        label: '合并为双向箭头线', active: edge.style.biMode === 'overlap',
        run: function () {
          store.selectEdges([id]);
          setBiMode('overlap');
        }
      },
      {
        label: '拆分为两条并排箭头', active: edge.style.biMode === 'separate',
        run: function () {
          store.selectEdges([id]);
          setBiMode('separate');
        }
      },
      '-',
      { label: '删除箭头', danger: true, run: function () { store.selectEdges([id]); store.deleteSelection(); store.commit(); render(); msg('已删除箭头'); } }
    ];
  }

  function setEdgeMode(id, mode) {
    var edge = store.edgeById(id);
    if (!edge) return;
    edge.mode = mode;
    store.commit();
    render();
  }

  function canvasMenuItems() {
    return [
      { label: '把选中内容存为模板', run: saveSelectionAsTemplate },
      '-',
      { label: '粘贴', run: doPaste },
      { label: '全选', run: function () { store.selectAll(); render(); } },
      '-',
      { label: '新建画板（新标签页）', run: newBoard },
      { label: '清空当前画板', run: clearBoard },
      '-',
      { label: '显示网格底纹', active: state.settings.grid, run: function () { setSetting('grid', !state.settings.grid); } },
      { label: '吸附到网格', active: state.settings.snapGrid, run: function () { setSetting('snapGrid', !state.settings.snapGrid); } },
      { label: '智能参考线', active: state.settings.snapGuides, run: function () { setSetting('snapGuides', !state.settings.snapGuides); } },
      { label: '箭头吸附', active: state.settings.snapPorts, run: function () { setSetting('snapPorts', !state.settings.snapPorts); } },
      '-',
      { label: '适应窗口', run: fitView }
    ];
  }

  /* ---------------- 工具切换 ---------------- */

  /* ---------------- 面板收起 / 展开 ---------------- */

  function togglePanel(side) {
    var key = side === 'left' ? 'collapseLeft' : 'collapseRight';
    state.settings[key] = !state.settings[key];
    applyPanelState(side);
    saveSettings();
    msg(state.settings[key]
      ? (side === 'left' ? '组件库已收起' : '属性面板已收起')
      : (side === 'left' ? '组件库已展开' : '属性面板已展开'));
  }

  function applyPanelState(side) {
    var key = side === 'left' ? 'collapseLeft' : 'collapseRight';
    var panel = el(side === 'left' ? 'panelLeft' : 'panelRight');
    var btn = el(side === 'left' ? 'btn-collapse-left' : 'btn-collapse-right');
    var collapsed = !!state.settings[key];
    panel.classList.toggle('collapsed', collapsed);
    if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function setTool(name) {
    tool = name;
    var segs = el('toolGroup').querySelectorAll('.seg');
    for (var i = 0; i < segs.length; i++) segs[i].classList.toggle('on', segs[i].dataset.tool === name);
    setCursor(null);
    if (name === 'connect') pill('从组件边缘的连接点拖出箭头', 2600);
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindUI() {
    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('dblclick', function (e) {
      var nodeEl = closest(e.target, '[data-node]');
      if (nodeEl) { startEdit('node', nodeEl.getAttribute('data-node')); return; }
      var edgeEl = closest(e.target, '[data-edge]');
      if (edgeEl) { startEdit('edge', edgeEl.getAttribute('data-edge')); return; }
      var pt = pointerWorld(e);
      var node = addShapeAt('process', pt.x, pt.y, null, true);
      store.addNode(node);
      store.selectNodes([node.id]);
      store.commit();
      render();
      startEdit('node', node.id);
    });
    board.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var nodeEl = closest(e.target, '[data-node]');
      var edgeEl = closest(e.target, '[data-edge]');
      var screen = pointerScreen(e);
      if (nodeEl) {
        var id = nodeEl.getAttribute('data-node');
        if (!store.isNodeSelected(id)) store.selectNodes([id]);
        render();
        showContextMenu(screen, nodeMenuItems(id));
        return;
      }
      if (edgeEl) {
        var eid = edgeEl.getAttribute('data-edge');
        if (!store.isEdgeSelected(eid)) store.selectEdges([eid]);
        render();
        showContextMenu(screen, edgeMenuItems(eid));
        return;
      }
      showContextMenu(screen, canvasMenuItems());
    });
    board.addEventListener('wheel', onWheel, { passive: false });

    wrap.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      var veil = el('dropVeil');
      var caption = veil.querySelector('span');
      if (draggingTemplate) {
        // 拖动示例模板时给出落点预览
        var tpl = window.FD.templates.build(draggingTemplate.key);
        var box = tpl ? G.unionRects(tpl.nodes) : null;
        if (box) {
          var pt = pointerWorld(e);
          var ox = pt.x - (box.x + box.w / 2), oy = pt.y - (box.y + box.h / 2);
          if (state.settings.snapGrid) {
            var g = state.settings.gridSize;
            ox = Math.round(ox / g) * g;
            oy = Math.round(oy / g) * g;
          }
          view.setOverlay({
            view: state.view,
            ghost: { node: { x: box.x + ox, y: box.y + oy, w: box.w, h: box.h } }
          });
        }
        if (caption) caption.textContent = '松开把模板「' + draggingTemplate.name + '」放到这里';
      } else if (caption) {
        caption.textContent = '松开以放置组件';
      }
      veil.hidden = false;
    });
    wrap.addEventListener('dragleave', function (e) {
      if (e.relatedTarget && wrap.contains(e.relatedTarget)) return;
      el('dropVeil').hidden = true;
      view.setOverlay({ view: state.view });
    });
    wrap.addEventListener('drop', function (e) {
      e.preventDefault();
      el('dropVeil').hidden = true;
      view.setOverlay({ view: state.view });
      var pt = pointerWorld(e);
      var tplKey = e.dataTransfer.getData('text/fd-template-key') ||
        (draggingTemplate && draggingTemplate.key);
      draggingTemplate = null;
      if (tplKey) {
        var sample = window.FD.templates.build(tplKey);
        if (sample) {
          sample.name = (window.FD.templates.list.filter(function (t) {
            return t.key === tplKey;
          })[0] || {}).name || tplKey;
          insertTemplate(sample, pt.x, pt.y);
          return;
        }
      }
      var tplIdx = e.dataTransfer.getData('text/fd-template');
      if (tplIdx !== '' && tplIdx != null && !isNaN(parseInt(tplIdx, 10))) {
        var tpl = loadTemplates()[parseInt(tplIdx, 10)];
        if (tpl) { insertTemplate(tpl, pt.x, pt.y); return; }
      }
      var custom = e.dataTransfer.getData('text/fd-custom');
      if (custom !== '' && custom != null && !isNaN(parseInt(custom, 10))) {
        var item = loadCustomShapes()[parseInt(custom, 10)];
        if (item) { addShapeAt(item.shape, pt.x, pt.y, customOverrides(item)); return; }
      }
      var key = e.dataTransfer.getData('text/fd-shape') || e.dataTransfer.getData('text/plain');
      if (key && G.SHAPES[key]) addShapeAt(key, pt.x, pt.y);
    });

    editor.addEventListener('blur', function () { commitEdit(true); });
    editor.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); commitEdit(false); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit(true); }
    });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', function () { render(); });

    /* 顶部工具条 */
    el('btn-new').addEventListener('click', newBoard);
    el('btn-tab-add').addEventListener('click', newBoard);
    el('btn-open').addEventListener('click', openJsonFile);
    el('btn-save').addEventListener('click', saveJsonFile);
    el('fileInput').addEventListener('change', onFileChosen);
    el('btn-export').addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = el('menu-export');
      menu.hidden = !menu.hidden;
      el('btn-export').setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    });
    el('menu-export').addEventListener('click', function (e) {
      var kind = e.target && e.target.dataset ? e.target.dataset.export : null;
      hideMenus();
      if (kind === 'svg') exportSvg();
      else if (kind === 'png') exportPng();
      else if (kind === 'json') saveJsonFile();
    });
    document.addEventListener('click', function () { hideMenus(); });
    el('menu-export').addEventListener('click', function (e) { e.stopPropagation(); });

    el('btn-undo').addEventListener('click', function () { if (store.undo()) { view.invalidateChrome(); render(); } });
    el('btn-redo').addEventListener('click', function () { if (store.redo()) { view.invalidateChrome(); render(); } });
    el('btn-delete').addEventListener('click', function () {
      if (store.selectionCount()) { store.deleteSelection(); store.commit(); render(); }
    });
    el('btn-copy').addEventListener('click', function () { doCopy(); doPaste(); });
    el('btn-fit').addEventListener('click', fitView);
    el('btn-zoom-in').addEventListener('click', function () { zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1.2); });
    el('btn-zoom-out').addEventListener('click', function () { zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1 / 1.2); });
    el('btn-zoom-reset').addEventListener('click', function () { setZoom(1); });
    el('btn-theme').addEventListener('click', function () {
      var next = state.settings.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      setSetting('theme', next);
    });

    /* 工具组 */
    el('toolGroup').addEventListener('click', function (e) {
      var seg = closest(e.target, '.seg');
      if (seg) setTool(seg.dataset.tool);
    });

    /* 吸附开关（两处同步） */
    CHIP_MAP.forEach(function (pair) {
      var node = el(pair[1]);
      if (!node) return;
      node.addEventListener('click', function () { setSetting(pair[0], !state.settings[pair[0]]); });
    });
    el('sel-grid-size').addEventListener('change', function () { setSetting('gridSize', parseFloat(this.value)); });
    el('cs-gridSize').addEventListener('change', function () {
      var v = G.clamp(parseFloat(this.value) || 20, 4, 200);
      setSetting('gridSize', v);
    });
    el('sel-grid-style').addEventListener('change', function () { setSetting('gridStyle', this.value); });
    el('cs-gridStyle').addEventListener('change', function () { setSetting('gridStyle', this.value); });
    el('cs-threshold').addEventListener('change', function () {
      setSetting('threshold', G.clamp(parseFloat(this.value) || 8, 2, 40));
    });
    el('cs-tailMin').addEventListener('change', function () {
      setSetting('tailMin', G.clamp(parseFloat(this.value) || 16, 8, 120));
    });
    el('cs-edgeMode').addEventListener('change', function () { setSetting('edgeMode', this.value); });
    el('edgeModeGroup').addEventListener('click', function (e) {
      var seg = closest(e.target, '.seg');
      if (!seg) return;
      setSetting('edgeMode', seg.dataset.edgeMode);
      if (state.selection.edges.length) {
        store.selectedEdges().forEach(function (edge) { edge.mode = state.settings.edgeMode; });
        store.commit();
        render();
      }
    });

    /* 组件库 */
    el('shapeSearch').addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      var btns = el('shapeList').querySelectorAll('.shape-btn');
      for (var i = 0; i < btns.length; i++) {
        var key = btns[i].dataset.shape;
        var name = G.getShape(key).name;
        btns[i].style.display = (!q || key.indexOf(q) >= 0 || name.indexOf(q) >= 0) ? '' : 'none';
      }
    });
    el('btn-save-shape').addEventListener('click', saveCurrentAsCustom);
    el('btn-save-template').addEventListener('click', saveSelectionAsTemplate);
    el('btn-collapse-left').addEventListener('click', function () { togglePanel('left'); });
    el('btn-collapse-right').addEventListener('click', function () { togglePanel('right'); });
    ['panelLeft', 'panelRight'].forEach(function (id) {
      el(id).addEventListener('transitionend', function (e) {
        if (e.propertyName === 'width') render();
      });
    });
    document.querySelectorAll('[data-template]').forEach(function (btn) {
      var key = btn.dataset.template;
      var name = btn.textContent.trim();
      btn.draggable = true;
      btn.title = '当前画板是空的就放在本页；否则新开一个画板。也可以直接拖到画布上放进当前画板。';
      btn.addEventListener('click', function () {
        if (state.nodes.length === 0) {
          loadTemplate(key);
          renderTabs();
        } else {
          var tab = createTab(name);
          activateTab(tab.id);
          loadTemplate(key);
          renderTabs();
          msg('已在新画板中打开「' + name + '」');
        }
      });
      btn.addEventListener('dragstart', function (e) {
        draggingTemplate = { key: key, name: name };
        e.dataTransfer.setData('text/fd-template-key', key);
        e.dataTransfer.effectAllowed = 'copy';
      });
      btn.addEventListener('dragend', function () {
        draggingTemplate = null;
        el('dropVeil').hidden = true;
        view.setOverlay({ view: state.view });
      });
    });

    /* 属性面板 */
    bindNodeProps();
    bindEdgeProps();
  }

  function bindNodeProps() {
    bindNumber('np-x', function (v) { eachSelectedNode(function (n) { n.x = v; }); });
    bindNumber('np-y', function (v) { eachSelectedNode(function (n) { n.y = v; }); });
    bindNumber('np-w', function (v) { eachSelectedNode(function (n) { n.w = Math.max(MIN_SIZE, v); }); });
    bindNumber('np-h', function (v) { eachSelectedNode(function (n) { n.h = Math.max(MIN_SIZE, v); }); });
    bindColor('np-fill', function (v) { applyStyleToSelected('fill', v); });
    bindColor('np-stroke', function (v) { applyStyleToSelected('stroke', v); });
    bindColor('np-fontColor', function (v) { applyStyleToSelected('fontColor', v); });
    bindNumber('np-strokeWidth', function (v) { applyStyleToSelected('strokeWidth', Math.max(0, v)); });
    bindNumber('np-radius', function (v) { applyStyleToSelected('radius', Math.max(0, v)); });
    bindNumber('np-fontSize', function (v) { applyStyleToSelected('fontSize', G.clamp(v, 6, 96)); });
    bindSelect('np-dash', function (v) { applyStyleToSelected('dash', v); });
    bindSelect('np-align', function (v) { applyStyleToSelected('align', v); });
    bindSelect('np-shape', function (v) {
      eachSelectedNode(function (n) {
        n.shape = v;
        var shape = G.getShape(v);
        if (shape.radiusEditable && n.style.radius == null) n.style.radius = shape.defaultRadius;
        if (shape.noShape) {
          n.style.fill = 'none';
          n.style.stroke = 'none';
        }
      });
    });
    el('np-lockRatio').addEventListener('change', function () {
      var on = this.checked;
      eachSelectedNode(function (n) { n.lockRatio = on; });
      store.commit();
    });
    el('np-fit').addEventListener('click', function () {
      eachSelectedNode(fitNodeToText);
      store.commit();
      render();
    });
    el('np-size-1').addEventListener('click', function () {
      eachSelectedNode(function (n) { n.w = 140; n.h = 64; });
      store.commit();
      render();
    });
    el('np-size-2').addEventListener('click', function () {
      eachSelectedNode(function (n) { n.w = 200; n.h = 100; });
      store.commit();
      render();
    });
    bindToggle('np-bold', function () {
      var on = !(primaryNode() || { style: {} }).style.bold;
      eachSelectedNode(function (n) { n.style.bold = on; });
    });
    bindToggle('np-italic', function () {
      var on = !(primaryNode() || { style: {} }).style.italic;
      eachSelectedNode(function (n) { n.style.italic = on; });
    });
    bindToggle('np-shadow', function () {
      var on = !(primaryNode() || { style: {} }).style.shadow;
      eachSelectedNode(function (n) { n.style.shadow = on; });
    });
    bindToggle('np-lock', function () {
      var on = !(primaryNode() || {}).locked;
      eachSelectedNode(function (n) { n.locked = on; });
    });
    el('np-noFill').addEventListener('click', function () {
      applyStyleToSelected('fill', 'none');
      store.commit();
      render();
    });
    el('np-noStroke').addEventListener('click', function () {
      applyStyleToSelected('stroke', 'none');
      store.commit();
      render();
    });
    el('np-front').addEventListener('click', function () {
      store.bringForward(state.selection.nodes.slice());
      store.commit();
      render();
    });
    el('np-back').addEventListener('click', function () {
      store.sendBackward(state.selection.nodes.slice());
      store.commit();
      render();
    });
    el('alignRow').addEventListener('click', function (e) {
      var btn = closest(e.target, '[data-align]');
      if (btn) alignSelection(btn.dataset.align);
    });
  }

  function bindEdgeProps() {
    bindSelect('ep-mode', function (v) { store.selectedEdges().forEach(function (e) { e.mode = v; }); });
    bindColor('ep-color', function (v) { eachEdgeStyle('color', v); });
    bindNumber('ep-strokeWidth', function (v) { eachEdgeStyle('strokeWidth', Math.max(0.5, v)); });
    bindSelect('ep-dash', function (v) { eachEdgeStyle('dash', v); });
    bindSelect('ep-from-port', function (v) { applyEndpointChange('from', v); });
    bindSelect('ep-to-port', function (v) { applyEndpointChange('to', v); });
    var label = el('ep-label');
    label.addEventListener('input', function () {
      if (syncing) return;
      store.selectedEdges().forEach(function (e) { e.label = label.value; });
      render();
    });
    label.addEventListener('change', function () { store.commit(); });
    bindToggle('ep-arrowEnd', function () {
      var on = !(primaryEdge() || { style: {} }).style.arrowEnd;
      store.selectedEdges().forEach(function (e) { e.style.arrowEnd = on; });
    });
    bindToggle('ep-arrowStart', function () {
      var on = !(primaryEdge() || { style: {} }).style.arrowStart;
      store.selectedEdges().forEach(function (e) {
        e.style.arrowStart = on;
        // 手动去掉起始箭头时，双向箭头线的标记也跟着取消，避免状态打架
        if (!on && e.style.biMode === 'overlap') e.style.biMode = 'none';
      });
    });
    el('ep-reverse').addEventListener('click', function () {
      store.selectedEdges().forEach(function (e) {
        var f = e.from;
        e.from = e.to;
        e.to = f;
      });
      store.commit();
      render();
    });
    el('ep-bi-none').addEventListener('click', function () { setBiMode('none'); });
    el('ep-bi-overlap').addEventListener('click', function () { setBiMode('overlap'); });
    el('ep-bi-separate').addEventListener('click', function () { setBiMode('separate'); });
    el('ep-reset-bend').addEventListener('click', function () { resetBend(); });
  }

  /** 找出一条箭头的反向伙伴：必须是同一对端口上的反向箭头。 */
  function reverseEdgeOf(edge) {
    if (!edge || !edge.from.node || !edge.to.node) return null;
    var nodes = store.nodeMap();
    var key = R.groupKeyOf(edge, nodes);
    if (!key) return null;
    for (var i = 0; i < state.edges.length; i++) {
      var o = state.edges[i];
      if (o.id !== edge.id && o.from.node === edge.to.node && o.to.node === edge.from.node &&
        R.groupKeyOf(o, nodes) === key) return o;
    }
    return null;
  }

  /** 同一组（同一对端口）上的所有箭头。 */
  function groupEdgesOf(edge) {
    if (!edge) return [];
    var nodes = store.nodeMap();
    var key = R.groupKeyOf(edge, nodes);
    if (!key) return [edge];
    return state.edges.filter(function (o) { return R.groupKeyOf(o, nodes) === key; });
  }

  /** 多条箭头之间的画法：无 / 重合 / 分开（同步应用到反向那根）。 */
  function setBiMode(mode) {
    var edges = store.selectedEdges();
    if (!edges.length) return;
    var created = 0, merged = 0;
    edges.forEach(function (edge) {
      var usable = edge.from.node && edge.to.node && edge.from.node !== edge.to.node;
      var rev = usable ? reverseEdgeOf(edge) : null;

      if (mode === 'overlap') {
        // 合并成一条双向箭头线：删掉反向那根，本根两端都带箭头
        if (rev) {
          if (!edge.label && rev.label) edge.label = rev.label;
          store.removeEdges([rev.id]);
          merged++;
        }
        // 反向那根是用户自己连的 → 不能退回单向；是我们自动补的 → 可以退回
        edge.style.biAuto = !rev || rev.style.biAuto === true;
        edge.style.biMode = 'overlap';
        edge.style.arrowStart = true;
        edge.style.arrowEnd = true;
        return;
      }

      if (mode === 'separate') {
        if (usable && !rev) {
          // 只有单向箭头的：补一根反方向、走同一对端口的箭头
          rev = store.makeEdge(
            store.endpointNode(edge.to.node, edge.to.port),
            store.endpointNode(edge.from.node, edge.from.port),
            edge.mode
          );
          rev.style = JSON.parse(JSON.stringify(edge.style));
          rev.label = '';
          store.addEdge(rev);
          created++;
          rev.style.biAuto = true;
          edge.style.biAuto = true;
        }
        edge.style.biMode = 'separate';
        edge.style.arrowStart = false;
        edge.style.arrowEnd = true;
        if (rev) {
          rev.style.biMode = 'separate';
          rev.style.arrowStart = false;
          rev.style.arrowEnd = true;
        }
        return;
      }

      // 无：只有"双向关系是我们自动补出来的"才能退回单向
      if (edge.style.biAuto !== true) return;
      if (edge.style.biMode === 'overlap') {
        edge.style.biMode = 'none';
        edge.style.arrowStart = false;
        return;
      }
      if (rev) store.removeEdges([rev.id]);
      edge.style.biMode = 'none';
      edge.style.arrowStart = false;
    });
    store.commit();
    render();
    msg(mode === 'separate'
      ? (created ? '已补上反向箭头，' : '') + '两条箭头并排分开，可分别删除'
      : mode === 'overlap'
        ? (merged ? '已把两根合并成一条双向箭头线' : '已改为两端带箭头的双向箭头线')
        : '恢复普通单向箭头');
  }

  /** 端点连接方式：可以指定方向、脱离成自由位置。 */
  function applyEndpointChange(end, value) {
    var selectId = end === 'from' ? 'ep-from-port' : 'ep-to-port';
    var blocked = false;
    store.selectedEdges().forEach(function (edge) {
      var ref = edge[end];
      if (value === 'free') {
        if (ref.node) {
          var geo = geoOfEdge(edge);
          if (geo) {
            var p = end === 'from' ? geo.start : geo.end;
            edge[end] = store.endpointPoint(p.x, p.y);
          }
        }
      } else if (ref.node) {
        ref.port = value;
      } else {
        blocked = true;
      }
    });
    if (blocked) {
      el(selectId).value = 'free';
      msg('这个端点是自由位置，需要先把它拖到组件上才能指定连接方向', 'warn');
    }
  }

  function onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      var p = pointerScreen(e);
      var factor = Math.pow(0.999, e.deltaY * (e.deltaMode === 1 ? 16 : 1));
      zoomAt(p.x, p.y, factor);
      return;
    }
    e.preventDefault();
    var dx = e.shiftKey ? e.deltaY : e.deltaX;
    var dy = e.shiftKey ? 0 : e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
    state.view.x -= dx;
    state.view.y -= dy;
    render();
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    state.settings.theme = theme;
    view.invalidateTheme();
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    // 首屏应用布局状态时先禁用过渡，避免加载瞬间抖一下
    var dropPreload = function () { document.documentElement.classList.remove('preload'); };
    requestAnimationFrame(dropPreload);
    setTimeout(dropPreload, 60);
    settings = window.FD.defaultSettings();
    try {
      var raw = localStorage.getItem(STORAGE_SETTINGS);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var k in settings) {
          if (Object.prototype.hasOwnProperty.call(saved, k)) settings[k] = saved[k];
        }
      }
    } catch (err) { /* 忽略 */ }
    store.state.settings = settings;

    applyTheme(settings.theme || 'light');
    applyPanelState('left');
    applyPanelState('right');
    buildPalette();
    buildCustomList();
    buildTemplateList();
    buildShapeOptions();
    syncSettingsUI();
    bindUI();

    /* 恢复多画板；没有存档就建一个，并沿用旧版单画板存档 */
    var restored = false;
    try {
      var rawTabs = localStorage.getItem(STORAGE_TABS);
      if (rawTabs) {
        var parsed = JSON.parse(rawTabs);
        if (parsed && parsed.tabs && parsed.tabs.length) {
          parsed.tabs.forEach(function (t) { createTab(t.name, t.data, t.id); });
          activeTabId = tabById(parsed.active) ? parsed.active : tabs[0].id;
          restored = true;
        }
      }
    } catch (err) { /* 忽略 */ }

    if (!restored) {
      var legacy = null;
      try {
        var docRaw = localStorage.getItem(STORAGE_DOC);
        if (docRaw) {
          var data = JSON.parse(docRaw);
          if (data && data.nodes && data.nodes.length) legacy = data;
        }
      } catch (err) { /* 忽略 */ }
      var first = createTab('画板 1', legacy);
      activeTabId = first.id;
      restored = !!legacy;
    }

    view.invalidateChrome();
    activateTab(activeTabId);
    if (restored) {
      msg('已恢复上次编辑的内容');
    } else {
      loadTemplate('approval');
      renderTabs();
      pill('试试拖动组件：会吸附到网格并对齐其他组件', 4200);
    }

    // 调试/自动化测试钩子
    window.FD.__app = {
      // 用 getter 暴露，切换画板后始终指向当前画板
      get store() { return store; },
      get state() { return state; },
      get tabs() { return tabs; },
      view: view, render: render,
      setTool: setTool, setSetting: setSetting, addShapeAt: addShapeAt,
      fitView: fitView, zoomAt: zoomAt, contentBounds: contentBounds,
      buildExportSvg: buildExportSvg, applyTheme: applyTheme, msg: msg,
      newBoard: newBoard, clearBoard: clearBoard, activateTab: activateTab
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
