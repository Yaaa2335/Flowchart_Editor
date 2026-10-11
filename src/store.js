/* store.js —— 数据模型、选中状态、撤销/重做、增删改查。 */
(function () {
  'use strict';

  var G = window.FD.geom;

  var NODE_DEFAULT_TEXT = {
    process: '处理', terminator: '开始', decision: '判断？', data: '数据',
    document: '文档', database: '数据库', prep: '准备', subprocess: '子流程',
    circle: 'A', text: '文本'
  };

  function defaultNodeStyle() {
    return {
      fill: '#ffffff', stroke: '#3c4657', strokeWidth: 1.6, dash: '',
      radius: null, fontColor: '#1f2733', fontSize: 14, bold: false, italic: false,
      align: 'center', shadow: false
    };
  }

  function defaultEdgeStyle() {
    return { color: '#5d6779', strokeWidth: 1.8, dash: '', arrowEnd: true, arrowStart: false };
  }

  function createStore() {
    var state = {
      nodes: [],
      edges: [],
      selection: { nodes: [], edges: [] },
      view: { x: 0, y: 0, zoom: 1 },
      settings: {
        grid: true, gridStyle: 'line', gridSize: 20,
        snapGrid: true, snapGuides: true, snapPorts: true,
        threshold: 8, edgeMode: 'orthogonal', theme: 'light'
      }
    };

    var past = [];
    var future = [];
    var baseline = snap();

    function snap() { return JSON.stringify({ nodes: state.nodes, edges: state.edges }); }

    function applySnapshot(s) {
      var data = JSON.parse(s);
      state.nodes = data.nodes;
      state.edges = data.edges;
      state.selection = { nodes: [], edges: [] };
    }

    /* -------- 撤销 / 重做 -------- */

    function commit() {
      var s = snap();
      if (s === baseline) return false;
      past.push(baseline);
      if (past.length > 100) past.shift();
      future.length = 0;
      baseline = s;
      return true;
    }

    function undo() {
      if (!past.length) return false;
      future.push(snap());
      var s = past.pop();
      applySnapshot(s);
      baseline = s;
      return true;
    }

    function redo() {
      if (!future.length) return false;
      past.push(snap());
      var s = future.pop();
      applySnapshot(s);
      baseline = s;
      return true;
    }

    function reset() {
      state.nodes = [];
      state.edges = [];
      state.selection = { nodes: [], edges: [] };
      past = [];
      future = [];
      baseline = snap();
    }

    /* -------- 查询 -------- */

    function nodeById(id) {
      for (var i = 0; i < state.nodes.length; i++) if (state.nodes[i].id === id) return state.nodes[i];
      return null;
    }

    function edgeById(id) {
      for (var i = 0; i < state.edges.length; i++) if (state.edges[i].id === id) return state.edges[i];
      return null;
    }

    function nodeMap() {
      var map = {};
      for (var i = 0; i < state.nodes.length; i++) map[state.nodes[i].id] = state.nodes[i];
      return map;
    }

    function selectedNodes() {
      var out = [];
      for (var i = 0; i < state.selection.nodes.length; i++) {
        var n = nodeById(state.selection.nodes[i]);
        if (n) out.push(n);
      }
      return out;
    }

    function selectedEdges() {
      var out = [];
      for (var i = 0; i < state.selection.edges.length; i++) {
        var e = edgeById(state.selection.edges[i]);
        if (e) out.push(e);
      }
      return out;
    }

    function selectionCount() { return state.selection.nodes.length + state.selection.edges.length; }

    function isNodeSelected(id) { return state.selection.nodes.indexOf(id) >= 0; }
    function isEdgeSelected(id) { return state.selection.edges.indexOf(id) >= 0; }

    function clearSelection() { state.selection.nodes = []; state.selection.edges = []; }

    function selectNodes(ids, add) {
      if (!add) clearSelection();
      for (var i = 0; i < ids.length; i++) {
        if (state.selection.nodes.indexOf(ids[i]) < 0) state.selection.nodes.push(ids[i]);
      }
    }

    function selectEdges(ids, add) {
      if (!add) clearSelection();
      for (var i = 0; i < ids.length; i++) {
        if (state.selection.edges.indexOf(ids[i]) < 0) state.selection.edges.push(ids[i]);
      }
    }

    function toggleNode(id) {
      var i = state.selection.nodes.indexOf(id);
      if (i >= 0) state.selection.nodes.splice(i, 1);
      else state.selection.nodes.push(id);
    }

    function toggleEdge(id) {
      var i = state.selection.edges.indexOf(id);
      if (i >= 0) state.selection.edges.splice(i, 1);
      else state.selection.edges.push(id);
    }

    function selectAll() {
      state.selection.nodes = state.nodes.map(function (n) { return n.id; });
      state.selection.edges = state.edges.map(function (e) { return e.id; });
    }

    /* -------- 增删 -------- */

    function makeNode(shapeKey, wx, wy, overrides) {
      var shape = G.getShape(shapeKey);
      var w = shape.defaultW, h = shape.defaultH;
      var node = {
        id: G.uid('n'),
        shape: G.SHAPES[shapeKey] ? shapeKey : 'process',
        x: Math.round(wx - w / 2),
        y: Math.round(wy - h / 2),
        w: w, h: h,
        text: NODE_DEFAULT_TEXT[shapeKey] || '组件',
        style: defaultNodeStyle()
      };
      node.style.radius = shape.radiusEditable ? shape.defaultRadius : null;
      if (shape.noShape) {
        node.style.fill = 'none';
        node.style.stroke = 'none';
        node.style.shadow = false;
      }
      if (overrides) for (var k in overrides) if (Object.prototype.hasOwnProperty.call(overrides, k)) node[k] = overrides[k];
      return node;
    }

    function addNode(node, atIndex) {
      if (atIndex == null) state.nodes.push(node);
      else state.nodes.splice(atIndex, 0, node);
      return node;
    }

    /** 端点：挂在组件上 */
    function endpointNode(nodeId, port) {
      return { node: nodeId, port: port || 'auto' };
    }

    /** 端点：自由位置 */
    function endpointPoint(x, y) {
      return { point: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 } };
    }

    function makeEdge(from, to, mode) {
      return {
        id: G.uid('e'),
        from: from,
        to: to,
        mode: mode || state.settings.edgeMode || 'orthogonal',
        label: '',
        style: defaultEdgeStyle()
      };
    }

    function addEdge(edge) { state.edges.push(edge); return edge; }

    function findEdge(fromId, toId) {
      for (var i = 0; i < state.edges.length; i++) {
        var e = state.edges[i];
        if (e.from.node && e.to.node && e.from.node === fromId && e.to.node === toId) return e;
      }
      return null;
    }

    function removeNodes(ids) {
      var set = {};
      ids.forEach(function (id) { set[id] = true; });
      state.nodes = state.nodes.filter(function (n) { return !set[n.id]; });
      state.edges = state.edges.filter(function (e) { return !set[e.from.node] && !set[e.to.node]; });
      state.selection.nodes = state.selection.nodes.filter(function (id) { return !set[id]; });
    }

    function removeEdges(ids) {
      var set = {};
      ids.forEach(function (id) { set[id] = true; });
      state.edges = state.edges.filter(function (e) { return !set[e.id]; });
      state.selection.edges = state.selection.edges.filter(function (id) { return !set[id]; });
    }

    function deleteSelection() {
      removeNodes(state.selection.nodes.slice());
      removeEdges(state.selection.edges.slice());
      clearSelection();
    }

    function duplicateSelection(offset) {
      var dx = offset == null ? 24 : offset;
      var map = {};
      var newIds = [];
      selectedNodes().forEach(function (n) {
        var copy = cloneNode(n);
        copy.id = G.uid('n');
        copy.x += dx;
        copy.y += dx;
        map[n.id] = copy.id;
        state.nodes.push(copy);
        newIds.push(copy.id);
      });
      var newEdgeIds = [];
      selectedEdges().forEach(function (e) {
        var copy = JSON.parse(JSON.stringify(e));
        copy.id = G.uid('e');
        if (map[e.from.node]) copy.from.node = map[e.from.node];
        if (map[e.to.node]) copy.to.node = map[e.to.node];
        state.edges.push(copy);
        newEdgeIds.push(copy.id);
      });
      state.selection.nodes = newIds;
      state.selection.edges = newEdgeIds;
      return { nodes: newIds, edges: newEdgeIds };
    }

    function cloneNode(n) { return JSON.parse(JSON.stringify(n)); }

    /* -------- 层级 -------- */

    function bringForward(ids, toFront) {
      var moving = state.nodes.filter(function (n) { return ids.indexOf(n.id) >= 0; });
      if (!moving.length) return;
      var rest = state.nodes.filter(function (n) { return ids.indexOf(n.id) < 0; });
      state.nodes = rest.concat(moving);
    }

    function sendBackward(ids) {
      var moving = state.nodes.filter(function (n) { return ids.indexOf(n.id) >= 0; });
      if (!moving.length) return;
      var rest = state.nodes.filter(function (n) { return ids.indexOf(n.id) < 0; });
      state.nodes = moving.concat(rest);
    }

    /* -------- 导入 / 导出 -------- */

    function serialize() {
      return {
        type: 'flowchart', version: 1,
        settings: JSON.parse(JSON.stringify(state.settings)),
        nodes: JSON.parse(JSON.stringify(state.nodes)),
        edges: JSON.parse(JSON.stringify(state.edges)),
        view: JSON.parse(JSON.stringify(state.view))
      };
    }

    function load(data, keepView) {
      if (!data || typeof data !== 'object') throw new Error('数据格式不正确');
      var nodes = Array.isArray(data.nodes) ? data.nodes : [];
      var edges = Array.isArray(data.edges) ? data.edges : [];
      var cleanNodes = [];
      var seen = {};
      nodes.forEach(function (raw) {
        if (!raw) return;
        var shape = G.SHAPES[raw.shape] ? raw.shape : 'process';
        var def = defaultNodeStyle();
        var style = raw.style || {};
        var node = {
          id: raw.id ? String(raw.id) : G.uid('n'),
          shape: shape,
          x: num(raw.x, 0), y: num(raw.y, 0),
          w: Math.max(16, num(raw.w, G.getShape(shape).defaultW)),
          h: Math.max(16, num(raw.h, G.getShape(shape).defaultH)),
          text: raw.text == null ? '' : String(raw.text),
          style: {
            fill: style.fill == null ? def.fill : style.fill,
            stroke: style.stroke == null ? def.stroke : style.stroke,
            strokeWidth: num(style.strokeWidth, def.strokeWidth),
            dash: style.dash == null ? '' : style.dash,
            radius: style.radius == null ? null : num(style.radius, 0),
            fontColor: style.fontColor == null ? def.fontColor : style.fontColor,
            fontSize: num(style.fontSize, def.fontSize),
            bold: !!style.bold, italic: !!style.italic,
            align: style.align || 'center',
            shadow: !!style.shadow
          }
        };
        if (seen[node.id]) node.id = G.uid('n');
        seen[node.id] = true;
        cleanNodes.push(node);
      });
      var cleanEdges = [];
      edges.forEach(function (raw) {
        if (!raw || !raw.from || !raw.to) return;
        var from = normalizeEndpoint(raw.from, seen);
        var to = normalizeEndpoint(raw.to, seen);
        if (!from || !to) return;
        var def = defaultEdgeStyle();
        var style = raw.style || {};
        cleanEdges.push({
          id: raw.id ? String(raw.id) : G.uid('e'),
          from: from,
          to: to,
          mode: ['orthogonal', 'straight', 'curve'].indexOf(raw.mode) >= 0 ? raw.mode : 'orthogonal',
          label: raw.label == null ? '' : String(raw.label),
          style: {
            color: style.color == null ? def.color : style.color,
            strokeWidth: num(style.strokeWidth, def.strokeWidth),
            dash: style.dash == null ? '' : style.dash,
            arrowEnd: style.arrowEnd === undefined ? true : !!style.arrowEnd,
            arrowStart: !!style.arrowStart
          }
        });
      });
      state.nodes = cleanNodes;
      state.edges = cleanEdges;
      if (data.settings) {
        for (var k in state.settings) {
          if (Object.prototype.hasOwnProperty.call(data.settings, k)) state.settings[k] = data.settings[k];
        }
      }
      if (keepView && data.view) {
        state.view = {
          x: num(data.view.x, 0), y: num(data.view.y, 0),
          zoom: G.clamp(num(data.view.zoom, 1), 0.1, 5)
        };
      }
      clearSelection();
      past = [];
      future = [];
      baseline = snap();
    }

    function normalizePort(p) {
      return ['t', 'r', 'b', 'l', 'auto'].indexOf(p) >= 0 ? p : 'auto';
    }

    /** 端点规范化：挂在存在的组件上，或是带坐标的自由端点，否则丢弃。 */
    function normalizeEndpoint(raw, seen) {
      if (!raw) return null;
      if (raw.node != null && seen[String(raw.node)]) {
        return { node: String(raw.node), port: normalizePort(raw.port) };
      }
      var px = num(raw.point && raw.point.x, NaN);
      var py = num(raw.point && raw.point.y, NaN);
      if (isFinite(px) && isFinite(py)) return { point: { x: px, y: py } };
      return null;
    }

    function num(v, fallback) {
      var n = parseFloat(v);
      return isFinite(n) ? n : fallback;
    }

    return {
      state: state,
      commit: commit, undo: undo, redo: redo, reset: reset,
      canUndo: function () { return past.length > 0; },
      canRedo: function () { return future.length > 0; },
      nodeById: nodeById, edgeById: edgeById, nodeMap: nodeMap,
      selectedNodes: selectedNodes, selectedEdges: selectedEdges, selectionCount: selectionCount,
      isNodeSelected: isNodeSelected, isEdgeSelected: isEdgeSelected,
      clearSelection: clearSelection, selectNodes: selectNodes, selectEdges: selectEdges,
      toggleNode: toggleNode, toggleEdge: toggleEdge, selectAll: selectAll,
      makeNode: makeNode, addNode: addNode, makeEdge: makeEdge, addEdge: addEdge, findEdge: findEdge,
      endpointNode: endpointNode, endpointPoint: endpointPoint,
      removeNodes: removeNodes, removeEdges: removeEdges, deleteSelection: deleteSelection,
      duplicateSelection: duplicateSelection, cloneNode: cloneNode,
      bringForward: bringForward, sendBackward: sendBackward,
      serialize: serialize, load: load, defaultNodeStyle: defaultNodeStyle, defaultEdgeStyle: defaultEdgeStyle,
      nodeDefaultText: NODE_DEFAULT_TEXT
    };
  }

  window.FD.createStore = createStore;
  window.FD.defaultNodeStyle = defaultNodeStyle;
  window.FD.defaultEdgeStyle = defaultEdgeStyle;
})();
