/* templates.js —— 示例模板。返回可直接交给 store.load 的数据结构。 */
(function () {
  'use strict';

  var G = window.FD.geom;

  function build(spec) {
    var idmap = {};
    var nodes = spec.nodes.map(function (raw) {
      var shape = G.getShape(raw.shape);
      var id = G.uid('n');
      idmap[raw.id] = id;
      return {
        id: id,
        shape: raw.shape,
        x: raw.x, y: raw.y,
        w: raw.w || shape.defaultW,
        h: raw.h || shape.defaultH,
        text: raw.text,
        style: Object.assign({
          fill: raw.fill || '#ffffff',
          stroke: '#3c4657', strokeWidth: 1.6, dash: '',
          radius: shape.radiusEditable ? (raw.radius == null ? shape.defaultRadius : raw.radius) : null,
          fontColor: '#1f2733', fontSize: raw.fontSize || 14,
          bold: !!raw.bold, italic: false, align: 'center', shadow: !!raw.shadow
        })
      };
    });
    var edges = spec.edges.map(function (raw) {
      return {
        id: G.uid('e'),
        from: { node: idmap[raw.from], port: raw.fromPort || 'auto' },
        to: { node: idmap[raw.to], port: raw.toPort || 'auto' },
        mode: raw.mode || 'orthogonal',
        label: raw.label || '',
        style: {
          color: raw.color || '#5d6779', strokeWidth: 1.8, dash: raw.dash || '',
          arrowEnd: true, arrowStart: !!raw.arrowStart, biMode: 'none'
        }
      };
    });
    return { nodes: nodes, edges: edges };
  }

  var approvalSpec = {
    nodes: [
      { id: 's', shape: 'terminator', x: 200, y: 40, w: 140, h: 60, text: '开始' },
      { id: 'a', shape: 'process', x: 190, y: 140, w: 160, h: 60, text: '提交报销单' },
      { id: 'b', shape: 'process', x: 190, y: 240, w: 160, h: 60, text: '主管审批' },
      { id: 'c', shape: 'decision', x: 190, y: 340, w: 160, h: 80, text: '金额 > 5000？', fontSize: 13 },
      { id: 'd', shape: 'process', x: 420, y: 340, w: 160, h: 80, text: '财务复核', fill: '#eef4ff' },
      { id: 'e', shape: 'process', x: 20, y: 340, w: 140, h: 80, text: '自动通过', fill: '#eefbf3' },
      { id: 'f', shape: 'database', x: 430, y: 480, w: 140, h: 80, text: '记账归档' },
      { id: 'g', shape: 'terminator', x: 200, y: 600, w: 140, h: 60, text: '结束' }
    ],
    edges: [
      { from: 's', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd', label: '是', fromPort: 'r', toPort: 'l' },
      { from: 'c', to: 'e', label: '否', fromPort: 'l', toPort: 'r' },
      { from: 'd', to: 'f' },
      { from: 'e', to: 'g' },
      { from: 'f', to: 'g' }
    ]
  };

  var loginSpec = {
    nodes: [
      { id: 's', shape: 'terminator', x: 200, y: 40, w: 140, h: 60, text: '开始' },
      { id: 'a', shape: 'process', x: 190, y: 140, w: 160, h: 60, text: '打开登录页' },
      { id: 'b', shape: 'data', x: 190, y: 240, w: 160, h: 60, text: '输入账号与密码' },
      { id: 'c', shape: 'decision', x: 190, y: 340, w: 160, h: 80, text: '校验通过？' },
      { id: 'd', shape: 'process', x: 420, y: 340, w: 160, h: 80, text: '进入首页', fill: '#eefbf3' },
      { id: 'e', shape: 'process', x: 20, y: 340, w: 140, h: 80, text: '提示错误信息', fill: '#fff1f1' },
      { id: 'f', shape: 'terminator', x: 430, y: 480, w: 140, h: 60, text: '结束' }
    ],
    edges: [
      { from: 's', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd', label: '是', fromPort: 'r', toPort: 'l' },
      { from: 'c', to: 'e', label: '否', fromPort: 'l', toPort: 'r' },
      { from: 'e', to: 'b', label: '重试' },
      { from: 'd', to: 'f' }
    ]
  };

  window.FD.templates = {
    list: [
      { key: 'approval', name: '审批流程图' },
      { key: 'login', name: '登录流程图' }
    ],
    spec: function (key) {
      if (key === 'approval') return approvalSpec;
      if (key === 'login') return loginSpec;
      return null;
    },
    build: function (key) {
      var spec = this.spec(key);
      return spec ? build(spec) : null;
    }
  };
})();
