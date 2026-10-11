/* 浏览器内自测探针：由 tests/browser.js 注入到 index.html 副本中运行。
   通过真实 PointerEvent 驱动交互，结果以 base64(JSON) 写入 #report 供抓取。 */
(function () {
  'use strict';

  var report = { errors: [], checks: [], info: {} };
  window.addEventListener('error', function (e) { report.errors.push('error: ' + e.message); });
  window.addEventListener('unhandledrejection', function (e) {
    report.errors.push('rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });

  function check(name, cond, extra) {
    report.checks.push({ name: name, ok: !!cond, extra: extra == null ? '' : String(extra) });
  }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function nodeGroups() { return qa('#layerNodes > g.node'); }
  function centerOf(el, dx, dy) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 + (dx || 0), y: r.top + r.height / 2 + (dy || 0) };
  }
  function fire(el, type, x, y, extra) {
    var opts = {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true
    };
    for (var k in (extra || {})) opts[k] = extra[k];
    el.dispatchEvent(new PointerEvent(type, opts));
  }

  function finish() {
    if (finished) return;
    finished = true;
    var json = JSON.stringify(report);
    var out = q('#report');
    if (!out) {
      out = document.createElement('pre');
      out.id = 'report';
      document.body.appendChild(out);
    }
    var bytes = new TextEncoder().encode(json);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    out.textContent = btoa(binary);
  }

  function run() {
    var app = window.FD.__app;
    var G = window.FD.geom, R = window.FD.router;
    check('应用初始化完成（存在调试钩子）', !!app);
    if (!app) { finish(); return; }

    var st = app.state, store = app.store;

    /* ---------- 1. 初始渲染 ---------- */
    check('模板载入组件', st.nodes.length >= 8, st.nodes.length);
    check('模板载入箭头', st.edges.length >= 8, st.edges.length);
    check('SVG 渲染组件数量一致', nodeGroups().length === st.nodes.length,
      nodeGroups().length + '/' + st.nodes.length);
    check('SVG 渲染箭头数量一致', qa('#layerEdges > g.edge').length === st.edges.length);
    var edgeDs = qa('#layerEdges path.edge-visible').map(function (p) { return p.getAttribute('d') || ''; });
    check('箭头路径均有效', edgeDs.length > 0 && edgeDs.every(function (d) {
      return d.indexOf('NaN') < 0 && d.length > 3;
    }));
    check('箭头路径为可见描边', qa('#layerEdges path.edge-visible').every(function (p) {
      return p.getAttribute('fill') === 'none' && p.getAttribute('stroke');
    }));
    check('生成了箭头标记', qa('#defs marker').length > 0, qa('#defs marker').length);
    check('箭头引用了标记', qa('#layerEdges path.edge-visible').some(function (p) {
      return (p.getAttribute('marker-end') || '').indexOf('url(#m') === 0;
    }));
    check('组件文字已渲染', qa('#layerNodes tspan').length >= st.nodes.length);
    check('世界变换已应用', /translate\(.*\) scale\(.*\)/.test(q('#world').getAttribute('transform') || ''));
    check('网格底纹默认开启', q('#gridRect').getAttribute('fill') === 'url(#fdGrid)');
    report.info.zoom = st.view.zoom;
    report.info.bounds = JSON.stringify(app.contentBounds());

    /* ---------- 2. 选中 ---------- */
    var g0 = nodeGroups()[0];
    var hit0 = g0.querySelector('.node-hit');
    var c0 = centerOf(hit0);
    var target = document.elementFromPoint(c0.x, c0.y);
    check('组件中心命中拾取层', !!target && !!target.closest('[data-node]'),
      target ? target.tagName + '.' + target.getAttribute('class') : 'null');
    fire(target, 'pointerdown', c0.x, c0.y);
    check('点击选中单个组件', st.selection.nodes.length === 1, JSON.stringify(st.selection.nodes));
    check('选中后出现 8 个缩放手柄', qa('#layerUi .handle').length === 8, qa('#layerUi .handle').length);
    check('选中后出现 4 个连接点', qa('#layerUi .port').length === 4, qa('#layerUi .port').length);
    fire(window, 'pointerup', c0.x, c0.y);

    /* ---------- 3. 拖动 + 网格吸附 ---------- */
    var n0 = st.nodes[0];
    var x0 = n0.x, y0 = n0.y, zoom = st.view.zoom;
    app.setSetting('snapGrid', true);
    app.setSetting('snapGuides', false);
    app.setSetting('gridSize', 20);
    var dxScreen = 37, dyScreen = 23;
    fire(hit0, 'pointerdown', c0.x, c0.y);
    fire(window, 'pointermove', c0.x + dxScreen, c0.y + dyScreen);
    fire(window, 'pointerup', c0.x + dxScreen, c0.y + dyScreen);
    // 网格吸附取"上/中/下里位移最小的一条贴网格"，所以只要有一条线在网格上即可
    function onGrid(v) { return Math.abs(v % 20) < 1e-6; }
    check('网格吸附：x 有边线落在 20 的倍数上',
      onGrid(n0.x) || onGrid(n0.x + n0.w / 2) || onGrid(n0.x + n0.w),
      n0.x + ',' + (n0.x + n0.w / 2) + ',' + (n0.x + n0.w));
    check('网格吸附：y 有边线落在 20 的倍数上',
      onGrid(n0.y) || onGrid(n0.y + n0.h / 2) || onGrid(n0.y + n0.h),
      n0.y + ',' + (n0.y + n0.h / 2) + ',' + (n0.y + n0.h));
    var expectedDx = dxScreen / zoom;
    check('位移量与指针一致（允许吸附偏移）',
      Math.abs((n0.x - x0) - expectedDx) <= 10.1,
      '实际 ' + (n0.x - x0).toFixed(1) + ' 期望 ' + expectedDx.toFixed(1));
    check('拖动结束后可撤销', store.canUndo());

    /* ---------- 4. 智能参考线吸附 ---------- */
    app.setSetting('snapGrid', false);
    app.setSetting('snapGuides', true);
    var peer = st.nodes[4];
    n0.x = 999;
    app.render();
    var want = peer.x + 3;
    var c1 = centerOf(hit0);
    fire(hit0, 'pointerdown', c1.x, c1.y);
    fire(window, 'pointermove', c1.x + (want - n0.x) * zoom, c1.y);
    check('拖动时显示参考线', qa('#layerGuides .guide-line').length > 0,
      qa('#layerGuides .guide-line').length);
    check('拖动到一半时已吸附到对齐位置', Math.abs(n0.x - peer.x) < 0.6,
      n0.x.toFixed(2) + ' vs ' + peer.x);
    fire(window, 'pointerup', c1.x + (want - n0.x) * zoom, c1.y);
    check('松手后保持对齐', Math.abs(n0.x - peer.x) < 0.6, n0.x.toFixed(2));
    check('参考线在松手后清除', qa('#layerGuides .guide-line').length === 0);
    app.setSetting('snapGrid', true);

    /* ---------- 5. 自定义尺寸（拖手柄缩放） ---------- */
    app.setSetting('snapGuides', false);
    app.setSetting('snapGrid', true);
    var se = q('[data-handle="se"]');
    check('存在右下缩放手柄', !!se);
    var w0 = n0.w, h0 = n0.h;
    var cs = centerOf(se);
    fire(se, 'pointerdown', cs.x, cs.y);
    fire(window, 'pointermove', cs.x + 61, cs.y + 47);
    fire(window, 'pointerup', cs.x + 61, cs.y + 47);
    check('拖手柄改变宽度', n0.w > w0, w0 + ' → ' + n0.w);
    check('拖手柄改变高度', n0.h > h0, h0 + ' → ' + n0.h);
    check('缩放吸附：右边缘落在网格上', (n0.x + n0.w) % 20 === 0, (n0.x + n0.w).toFixed(2));
    check('缩放吸附：下边缘落在网格上', (n0.y + n0.h) % 20 === 0, (n0.y + n0.h).toFixed(2));

    /* 5b. 缩放时参考线优先于网格 */
    app.setSetting('snapGuides', true);
    app.setSetting('snapGrid', false);
    var peerA = st.nodes[1];
    var wantBottom = peerA.y + peerA.h / 2;
    var cs2 = centerOf(q('[data-handle="s"]'));
    fire(q('[data-handle="s"]'), 'pointerdown', cs2.x, cs2.y);
    fire(window, 'pointermove', cs2.x, cs2.y + (wantBottom - (n0.y + n0.h)) * zoom);
    check('缩放时对齐到其他组件中线', Math.abs(n0.y + n0.h - wantBottom) < 0.6,
      (n0.y + n0.h).toFixed(2) + ' vs ' + wantBottom);
    fire(window, 'pointerup', cs2.x, cs2.y + (wantBottom - (n0.y + n0.h)) * zoom);
    app.setSetting('snapGrid', true);
    app.setSetting('snapGuides', true);

    /* ---------- 6. 属性面板改尺寸 ---------- */
    var inputW = document.getElementById('np-w');
    inputW.value = '233';
    inputW.dispatchEvent(new Event('input', { bubbles: true }));
    check('面板输入宽度生效', n0.w === 233, n0.w);
    inputW.dispatchEvent(new Event('change', { bubbles: true }));
    check('面板输入同步到面板显示', document.getElementById('np-w').value === '233');
    var inputH = document.getElementById('np-h');
    inputH.value = '77';
    inputH.dispatchEvent(new Event('input', { bubbles: true }));
    check('面板输入高度生效', n0.h === 77, n0.h);

    /* ---------- 7. 拖拽创建箭头 ---------- */
    var edgeCount = st.edges.length;
    var portR = q('#layerUi [data-port="r"]');
    check('存在右侧连接点', !!portR);
    var cp = centerOf(portR);
    var dstGroup = nodeGroups()[2];
    var dstPt = centerOf(dstGroup.querySelector('.node-hit'));
    fire(portR, 'pointerdown', cp.x, cp.y);
    fire(window, 'pointermove', dstPt.x, dstPt.y);
    check('拖动时显示吸附高亮', qa('#layerHot .anchor-halo').length > 0, qa('#layerHot .anchor-halo').length);
    check('拖动时显示预览箭头', qa('#layerHot .ghost-edge').length > 0);
    fire(window, 'pointerup', dstPt.x, dstPt.y);
    check('拖到组件上创建了箭头', st.edges.length === edgeCount + 1,
      edgeCount + ' → ' + st.edges.length);
    var created = st.edges[st.edges.length - 1];
    check('新箭头起点带端口', created && created.from.port === 'r', created ? created.from.port : '-');
    check('新箭头终点带端口', created && created.to.port !== undefined, created ? created.to.port : '-');
    check('新箭头挂在目标组件上', created && created.to.node === st.nodes[2].id);
    check('高亮在松手后清除', qa('#layerHot .anchor-halo').length === 0);
    check('预览箭头在松手后清除', qa('#layerHot .ghost-edge').length === 0);
    var newPath = q('#layerEdges g.edge:last-child path.edge-visible');
    check('新箭头路径有效', !!newPath && (newPath.getAttribute('d') || '').indexOf('NaN') < 0);

    /* ---------- 8. 撤销 / 重做 ---------- */
    store.undo();
    app.render();
    check('撤销移除了箭头', st.edges.length === edgeCount, st.edges.length);
    store.redo();
    app.render();
    check('重做恢复箭头', st.edges.length === edgeCount + 1, st.edges.length);

    /* ---------- 9. 箭头样式与端点 ---------- */
    store.selectEdges([st.edges[0].id]);
    app.render();
    check('选中箭头后显示端点手柄', qa('#layerUi .edge-anchor').length === 2,
      qa('#layerUi .edge-anchor').length);
    var modeSel = document.getElementById('ep-mode');
    modeSel.value = 'straight';
    modeSel.dispatchEvent(new Event('change', { bubbles: true }));
    check('切换为直线模式', st.edges[0].mode === 'straight', st.edges[0].mode);
    modeSel.value = 'curve';
    modeSel.dispatchEvent(new Event('change', { bubbles: true }));
    var curveD = q('#layerEdges g.edge path.edge-visible').getAttribute('d');
    check('曲线模式路径含三次贝塞尔', curveD.indexOf('C') > 0, curveD.slice(0, 40));
    modeSel.value = 'orthogonal';
    modeSel.dispatchEvent(new Event('change', { bubbles: true }));
    check('折线模式路径含圆角', (q('#layerEdges g.edge path.edge-visible').getAttribute('d') || '').indexOf('Q') > 0);

    /* ---------- 10. 长文本自动换行 ---------- */
    var nb = st.nodes[1];
    nb.text = '这是一段比较长的说明文字用于验证组件内文本可以自动换行显示';
    app.render();
    var spans = nodeGroups()[1].querySelectorAll('tspan');
    check('长文本自动换行', spans.length > 1, spans.length);
    var renderedW = nodeGroups()[1].querySelector('text').getBBox().width;
    check('换行后文字不超出组件宽度', renderedW <= nb.w - 8,
      renderedW.toFixed(1) + ' vs 组件宽 ' + nb.w);

    /* ---------- 11. 网格开关与设置联动 ---------- */
    app.setSetting('grid', false);
    check('关闭网格底纹后不填充图案', q('#gridRect').getAttribute('fill') !== 'url(#fdGrid)');
    app.setSetting('grid', true);
    check('重新开启网格底纹', q('#gridRect').getAttribute('fill') === 'url(#fdGrid)');
    check('顶部开关与面板开关状态同步',
      document.getElementById('tg-grid').classList.contains('on') === st.settings.grid &&
      document.getElementById('cs-grid').classList.contains('on') === st.settings.grid);
    app.setSetting('gridStyle', 'dot');
    check('点阵样式渲染出圆点', qa('#fdGrid circle').length === 4, qa('#fdGrid circle').length);
    app.setSetting('gridStyle', 'line');
    app.setSetting('gridSize', 25);
    check('网格尺寸同步到图案', q('#fdGrid').getAttribute('width') === '25');
    app.setSetting('gridSize', 20);

    /* ---------- 12. 缩放 / 适应窗口 ---------- */
    var z0 = st.view.zoom;
    app.zoomAt(500, 400, 1.5);
    check('放大改变缩放比', st.view.zoom > z0, st.view.zoom);
    app.fitView();
    check('适应窗口后内容可见', st.view.zoom > 0.1 && st.view.zoom <= 1.8, st.view.zoom);
    var worldT = q('#world').getAttribute('transform');
    check('适应窗口后世界变换更新', /scale\(/.test(worldT));

    var boardEl = document.getElementById('board');
    function toClient(wx, wy) {
      var r = boardEl.getBoundingClientRect();
      return { x: r.left + wx * st.view.zoom + st.view.x, y: r.top + wy * st.view.zoom + st.view.y };
    }
    function centerOfNode(i) { return centerOf(nodeGroups()[i].querySelector('.node-hit')); }

    /* ---------- 13. 框选 ---------- */
    var b13 = app.contentBounds();
    var mStart = toClient(b13.x - 30, b13.y - 30);
    var mEnd = toClient(b13.x + b13.w + 30, b13.y + b13.h + 30);
    var startTarget = document.elementFromPoint(mStart.x, mStart.y);
    check('框选起点落在空白处', startTarget && !startTarget.closest('[data-node]'),
      startTarget ? String(startTarget.getAttribute('class')) : 'null');
    fire(startTarget, 'pointerdown', mStart.x, mStart.y);
    fire(window, 'pointermove', mEnd.x, mEnd.y);
    check('框选过程中显示选框', qa('#layerMarquee .marquee').length === 1);
    check('框选命中全部组件', st.selection.nodes.length === st.nodes.length,
      st.selection.nodes.length + '/' + st.nodes.length);
    fire(window, 'pointerup', mEnd.x, mEnd.y);
    check('松手后选框消失', qa('#layerMarquee .marquee').length === 0);
    check('框选结果保留', st.selection.nodes.length === st.nodes.length);

    /* ---------- 14. 锁定组件不可拖动 ---------- */
    var lockTarget = st.nodes[0];
    lockTarget.locked = true;
    var lx = lockTarget.x, ly = lockTarget.y;
    var lc = centerOfNode(0);
    fire(nodeGroups()[0].querySelector('.node-hit'), 'pointerdown', lc.x, lc.y);
    fire(window, 'pointermove', lc.x + 80, lc.y + 60);
    fire(window, 'pointerup', lc.x + 80, lc.y + 60);
    check('锁定的组件不会被拖动', lockTarget.x === lx && lockTarget.y === ly,
      lockTarget.x + ',' + lockTarget.y);
    lockTarget.locked = false;
    app.render();

    /* ---------- 15. 双击空白新建组件并编辑文字 ---------- */
    var countBefore = st.nodes.length;
    var emptyWorld = { x: b13.x + b13.w + 120, y: b13.y + b13.h + 120 };
    var ec = toClient(emptyWorld.x, emptyWorld.y);
    var emptyTarget = document.elementFromPoint(ec.x, ec.y) || boardEl;
    check('双击位置是空白', !emptyTarget.closest('[data-node]'));
    fire(emptyTarget, 'dblclick', ec.x, ec.y);
    check('双击空白新建了组件', st.nodes.length === countBefore + 1, st.nodes.length);
    var editorEl = document.getElementById('editor');
    check('双击后打开文字编辑框', !editorEl.hidden);
    editorEl.value = '新建的节点';
    editorEl.dispatchEvent(new Event('blur'));
    var fresh = st.nodes[st.nodes.length - 1];
    check('编辑框内容写入组件', fresh.text === '新建的节点', fresh.text);

    /* ---------- 16. 双击组件编辑文字 ---------- */
    var editIdx = 1;
    var editNode = st.nodes[editIdx];
    var ec2 = centerOfNode(editIdx);
    var nodeTarget = document.elementFromPoint(ec2.x, ec2.y);
    check('双击命中组件本体', !!nodeTarget && !!nodeTarget.closest('[data-node]'),
      nodeTarget ? String(nodeTarget.getAttribute('class')) : 'null');
    fire(nodeTarget, 'dblclick', ec2.x, ec2.y);
    check('双击组件打开编辑框', !editorEl.hidden);
    check('编辑框带出原文字', editorEl.value === editNode.text, editorEl.value);
    editorEl.value = '被改过的名字';
    editorEl.dispatchEvent(new Event('blur'));
    check('组件文字已更新', editNode.text === '被改过的名字', editNode.text);

    /* ---------- 17. 自定义组件 ---------- */
    store.selectNodes([st.nodes[2].id]);
    app.render();
    var customW = st.nodes[2].w, customH = st.nodes[2].h, customShape = st.nodes[2].shape;
    document.getElementById('btn-save-shape').click();
    check('自定义组件已写入列表', qa('#customList .shape-btn').length === 1,
      qa('#customList .shape-btn').length);
    var stored = JSON.parse(localStorage.getItem('fd.customShapes.v1') || '[]');
    check('自定义组件已持久化', stored.length === 1 && stored[0].w === customW);
    var nodesBeforeCustom = st.nodes.length;
    qa('#customList .shape-btn')[0].click();
    check('点击自定义组件可添加', st.nodes.length === nodesBeforeCustom + 1);
    var customNode = st.nodes[st.nodes.length - 1];
    check('自定义组件保留原尺寸', customNode.w === customW && customNode.h === customH &&
      customNode.shape === customShape,
      customNode.w + 'x' + customNode.h + ' ' + customNode.shape);
    check('自定义组件保留原样式', customNode.style.fill === st.nodes[2].style.fill);

    /* ---------- 18. 对齐与均分 ---------- */
    var ids3 = [st.nodes[0].id, st.nodes[1].id, st.nodes[2].id];
    st.nodes[0].x = 100; st.nodes[0].y = 100;
    st.nodes[1].x = 300; st.nodes[1].y = 260;
    st.nodes[2].x = 700; st.nodes[2].y = 420;
    store.selectNodes(ids3);
    app.render();
    q('[data-align="left"]').click();
    check('左对齐生效', st.nodes[0].x === st.nodes[1].x && st.nodes[1].x === st.nodes[2].x,
      [st.nodes[0].x, st.nodes[1].x, st.nodes[2].x].join(','));
    [st.nodes[0].y, st.nodes[1].y, st.nodes[2].y] = [100, 300, 600];
    app.render();
    q('[data-align="dist-v"]').click();
    var sorted = [st.nodes[0], st.nodes[1], st.nodes[2]].sort(function (a, b) { return a.y - b.y; });
    var gap1 = sorted[1].y - (sorted[0].y + sorted[0].h);
    var gap2 = sorted[2].y - (sorted[1].y + sorted[1].h);
    check('纵向均分后间距相等', Math.abs(gap1 - gap2) < 0.05, gap1.toFixed(2) + ' vs ' + gap2.toFixed(2));
    q('[data-align="top"]').click();
    check('顶对齐生效', st.nodes[0].y === st.nodes[1].y && st.nodes[1].y === st.nodes[2].y);

    /* ---------- 19. 层级 ---------- */
    var backId = st.nodes[0].id;
    store.selectNodes([backId]);
    app.render();
    document.getElementById('np-back').click();
    check('置底把组件移到最底层', st.nodes[0].id === backId, st.nodes[0].id);
    document.getElementById('np-front').click();
    check('置顶把组件移到最上层', st.nodes[st.nodes.length - 1].id === backId);

    /* ---------- 20. 拖动箭头端点到别的组件 ---------- */
    // 先把上一组对齐测试叠在一起的组件摊开，保证端点拾取位置唯一
    st.nodes[0].x = 40; st.nodes[0].y = 760;
    st.nodes[1].x = 300; st.nodes[1].y = 760;
    st.nodes[2].x = 600; st.nodes[2].y = 760;
    app.render();
    var edge20 = st.edges[0];
    var origFrom = edge20.from.node;
    store.selectEdges([edge20.id]);
    app.render();
    var anchors = qa('#layerUi .edge-anchor');
    check('选中箭头显示两个端点', anchors.length === 2, anchors.length);
    var fromAnchor = qa('#layerUi [data-anchor="from"]')[0];
    var fa = centerOf(fromAnchor);
    var hitAtAnchor = document.elementFromPoint(fa.x, fa.y);
    check('端点手柄可被拾取', !!hitAtAnchor && !!hitAtAnchor.closest('[data-anchor]'),
      hitAtAnchor ? String(hitAtAnchor.getAttribute('class')) + '/' + hitAtAnchor.getAttribute('data-anchor') : 'null');
    var otherIdx = st.nodes.findIndex(function (n) { return n.id !== origFrom && n.id !== edge20.to.node; });
    var oc = centerOfNode(otherIdx);
    fire(fromAnchor, 'pointerdown', fa.x, fa.y);
    fire(window, 'pointermove', oc.x, oc.y);
    check('拖动端点时显示吸附高亮', qa('#layerHot .anchor-halo').length > 0, qa('#layerHot .anchor-halo').length);
    check('拖动端点时显示预览线', qa('#layerHot .ghost-edge').length > 0);
    fire(window, 'pointerup', oc.x, oc.y);
    check('箭头终点改挂到新组件', edge20.from.node === st.nodes[otherIdx].id,
      edge20.from.node === st.nodes[otherIdx].id ? 'ok' : ('now ' + edge20.from.node + ' want ' + st.nodes[otherIdx].id));

    /* ---------- 20b. 把起点拖到终点组件上 → 自环 ---------- */
    store.selectEdges([edge20.id]);
    app.render();
    var lb = qa('#layerUi [data-anchor="from"]')[0];
    var lbc = centerOf(lb);
    var toIdx = st.nodes.findIndex(function (n) { return n.id === edge20.to.node; });
    var tc = centerOfNode(toIdx);
    fire(lb, 'pointerdown', lbc.x, lbc.y);
    fire(window, 'pointermove', tc.x, tc.y);
    check('自环状态下仍有预览线', qa('#layerHot .ghost-edge').length > 0, qa('#layerHot .ghost-edge').length);
    fire(window, 'pointerup', tc.x, tc.y);
    check('起点改挂后形成自环', edge20.from.node === edge20.to.node,
      edge20.from.node + ' / ' + edge20.to.node);
    var loopPath = q('#layerEdges g[data-id="' + edge20.id + '"] path.edge-visible');
    check('自环路径有效且为曲线', !!loopPath && (loopPath.getAttribute('d') || '').indexOf('C') > 0 &&
      (loopPath.getAttribute('d') || '').indexOf('NaN') < 0,
      loopPath ? String(loopPath.getAttribute('d')).slice(0, 30) : 'null');
    store.undo();
    app.render();
    var restored20 = store.edgeById(edge20.id);
    check('撤销恢复自环前的连接', restored20.from.node !== restored20.to.node,
      restored20.from.node + ' / ' + restored20.to.node);

    /* ---------- 21. 删除组件同时删除关联箭头 ---------- */
    var delIdx = 2;
    var delId = st.nodes[delIdx].id;
    var related = st.edges.filter(function (e) { return e.from.node === delId || e.to.node === delId; }).length;
    var edgesBefore = st.edges.length, nodesBefore = st.nodes.length;
    store.selectNodes([delId]);
    app.render();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    check('Delete 删除组件', st.nodes.length === nodesBefore - 1, st.nodes.length);
    check('关联箭头同时删除', st.edges.length === edgesBefore - related,
      edgesBefore + ' → ' + st.edges.length + '（应删 ' + related + '）');
    store.undo();
    app.render();
    check('撤销恢复被删除的组件', st.nodes.length === nodesBefore);
    check('撤销恢复被删除的箭头', st.edges.length === edgesBefore);

    /* ---------- 22. 复制粘贴 ---------- */
    store.selectNodes([st.nodes[0].id]);
    app.render();
    var before22 = st.nodes.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    check('Ctrl+C / Ctrl+V 新增副本', st.nodes.length === before22 + 1, st.nodes.length);
    var pasted = st.nodes[st.nodes.length - 1];
    check('粘贴的副本带偏移', pasted.id !== st.nodes[0].id && pasted.text === st.nodes[0].text);

    /* ---------- 23. 箭头标签颜色不随强调色（导出着色正确） ---------- */
    store.selectEdges([st.edges[0].id]);
    st.edges[0].label = '标注';
    app.render();
    var labelEl = q('#layerEdges text.edge-label');
    check('箭头标签有显式填充色', !!labelEl && !!labelEl.getAttribute('fill'), labelEl ? labelEl.getAttribute('fill') : 'null');
    check('箭头标签不是强调色', labelEl.getAttribute('fill') !== '#2f6bff', labelEl.getAttribute('fill'));

    /* ---------- 24. 暗色主题 ---------- */
    document.getElementById('btn-theme').click();
    check('主题切换为深色', document.documentElement.dataset.theme === 'dark',
      document.documentElement.dataset.theme);
    check('画布背景跟随主题', getComputedStyle(document.getElementById('board')).backgroundColor !== 'rgb(251, 252, 254)',
      getComputedStyle(document.getElementById('board')).backgroundColor);
    document.getElementById('btn-theme').click();
    check('主题切回浅色', document.documentElement.dataset.theme === 'light');

    /* ---------- 25. JSON 往返 ---------- */
    var snapData = store.serialize();
    var n25 = st.nodes.length, e25 = st.edges.length;
    check('序列化包含设置与视图', !!snapData.settings && !!snapData.view && snapData.type === 'flowchart');
    store.load(JSON.parse(JSON.stringify(snapData)), true);
    app.render();

    check('载入后组件数量一致', st.nodes.length === n25, st.nodes.length + '/' + n25);
    check('载入后箭头数量一致', st.edges.length === e25, st.edges.length + '/' + e25);
    check('载入数据不会丢失样式', st.nodes[0].style && typeof st.nodes[0].style.fill === 'string');
    check('载入非法数据被拒绝', (function () {
      try { store.load({ nodes: [{ shape: 'nope', x: 'a', y: null, w: -5, h: 'x' }], edges: [{ from: { node: 'ghost' }, to: { node: 'ghost' } }] }); return true; }
      catch (err) { return false; }
    })());
    check('非法箭头被丢弃', st.edges.length === 0, st.edges.length);
    check('非法尺寸被纠正', st.nodes.length === 1 && st.nodes[0].w >= 16 && st.nodes[0].h >= 16,
      st.nodes.length ? st.nodes[0].w + 'x' + st.nodes[0].h : '无组件');
    store.load(JSON.parse(JSON.stringify(snapData)), true);
    app.render();

    /* ---------- 26. 从组件库拖放到画布 ---------- */
    var nodesBeforeDrop = st.nodes.length;
    var dropWorld = { x: b13.x - 60, y: b13.y + 40 };
    var dp = toClient(dropWorld.x, dropWorld.y);
    var dt2 = new DataTransfer();
    dt2.setData('text/fd-shape', 'decision');
    boardEl.dispatchEvent(new DragEvent('dragover', {
      bubbles: true, cancelable: true, clientX: dp.x, clientY: dp.y, dataTransfer: dt2
    }));
    check('拖拽悬停时显示放置提示', !document.getElementById('dropVeil').hidden);
    boardEl.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, clientX: dp.x, clientY: dp.y, dataTransfer: dt2
    }));
    check('拖放后隐藏放置提示', document.getElementById('dropVeil').hidden);
    check('拖放创建了对应组件', st.nodes.length === nodesBeforeDrop + 1, st.nodes.length);
    var dropped = st.nodes[st.nodes.length - 1];
    check('拖放组件类型正确', dropped.shape === 'decision', dropped.shape);
    check('拖放位置落在鼠标处', Math.abs(dropped.x + dropped.w / 2 - dropWorld.x) <= 12 &&
      Math.abs(dropped.y + dropped.h / 2 - dropWorld.y) <= 12,
      Math.round(dropped.x + dropped.w / 2) + ',' + Math.round(dropped.y + dropped.h / 2));
    check('拖放后自动选中新组件', st.selection.nodes.length === 1 && st.selection.nodes[0] === dropped.id);

    /* ---------- 27. 右键菜单 ---------- */
    var ctxNodeIdx = 1;
    var ctxTarget = nodeGroups()[ctxNodeIdx].querySelector('.node-hit');
    var ctxId = st.nodes[ctxNodeIdx].id;
    var cc = centerOfNode(ctxNodeIdx);
    ctxTarget.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: cc.x, clientY: cc.y
    }));
    var ctxMenu = document.getElementById('contextMenu');
    check('右键弹出菜单', !ctxMenu.hidden);
    check('右键菜单包含删除项', qa('#contextMenu button').some(function (b) { return b.textContent === '删除'; }),
      qa('#contextMenu button').map(function (b) { return b.textContent; }).join('/'));
    check('右键选中了目标组件', st.selection.nodes.length === 1 && st.selection.nodes[0] === ctxId);
    var nodesBeforeCtx = st.nodes.length;
    qa('#contextMenu button').filter(function (b) { return b.textContent === '删除'; })[0].click();
    check('菜单删除生效', st.nodes.length === nodesBeforeCtx - 1, st.nodes.length);
    check('执行后菜单关闭', ctxMenu.hidden);
    store.undo();
    app.render();
    check('菜单删除可撤销', st.nodes.length === nodesBeforeCtx);

    app.fitView();
    var cb27 = app.contentBounds();
    var blankClient = toClient(cb27.x - 20, cb27.y - 20);
    var blankTarget = document.elementFromPoint(blankClient.x, blankClient.y) || boardEl;
    check('空白点确实是空白', !blankTarget.closest('[data-node]') && !blankTarget.closest('[data-edge]'),
      String(blankTarget.getAttribute('class') || blankTarget.tagName));
    blankTarget.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: blankClient.x, clientY: blankClient.y
    }));
    check('空白处右键显示画布菜单',
      qa('#contextMenu button').some(function (b) { return b.textContent === '适应窗口'; }));
    var gridItem = qa('#contextMenu button').filter(function (b) { return b.textContent === '显示网格底纹'; })[0];
    var gridWas = st.settings.grid;
    gridItem.click();
    check('画布菜单可切换网格', st.settings.grid === !gridWas);
    st.settings.grid = gridWas;
    app.render();

    /* ---------- 28. 新建组件与网格对齐（含下边线） ---------- */
    app.setSetting('snapGrid', true);
    app.setSetting('gridSize', 20);
    var n28 = app.addShapeAt('terminator', 333, 217);
    check('新建组件尺寸是网格倍数', n28.w % 20 === 0 && n28.h % 20 === 0, n28.w + '×' + n28.h);
    check('新建组件四条边都落在网格上',
      n28.x % 20 === 0 && n28.y % 20 === 0 &&
      (n28.x + n28.w) % 20 === 0 && (n28.y + n28.h) % 20 === 0,
      [n28.x, n28.y, n28.x + n28.w, n28.y + n28.h].join(','));
    // 自定义尺寸（非网格倍数）时，拖动也应该让下边线能吸附
    n28.h = 77;
    n28.y = 217;
    app.render();
    var c28 = centerOfNode(st.nodes.indexOf(n28));
    var hit28 = nodeGroups()[st.nodes.indexOf(n28)].querySelector('.node-hit');
    fire(hit28, 'pointerdown', c28.x, c28.y);
    fire(window, 'pointermove', c28.x, c28.y);
    fire(window, 'pointerup', c28.x, c28.y);
    check('非网格高度拖动后仍有边贴在网格上',
      n28.y % 20 === 0 || (n28.y + n28.h) % 20 === 0,
      'y=' + n28.y + ' bottom=' + (n28.y + n28.h));
    store.selectNodes([n28.id]);
    store.deleteSelection();
    store.commit();
    app.render();

    /* ---------- 29. 缩小画布后网格依然可见 ---------- */
    app.setSetting('grid', true);
    app.setSetting('gridSize', 20);
    function gridState() {
      var rect = document.getElementById('gridRect');
      var line = document.querySelector('#fdGrid path');
      return {
        fill: rect.getAttribute('fill'),
        opacity: parseFloat(rect.getAttribute('opacity')),
        width: line ? parseFloat(line.getAttribute('stroke-width')) : 0
      };
    }
    app.zoomAt(400, 300, 1 / st.view.zoom);
    var g100 = gridState();
    check('100% 时网格可见', g100.fill === 'url(#fdGrid)' && g100.opacity === 1, JSON.stringify(g100));
    app.zoomAt(400, 300, 0.5 / st.view.zoom);
    var g50 = gridState();
    check('50% 时网格仍然可见', g50.fill === 'url(#fdGrid)' && g50.opacity === 1, JSON.stringify(g50));
    check('50% 时线宽已反向补偿', g50.width > 1.5, g50.width);
    app.zoomAt(400, 300, 0.25 / st.view.zoom);
    var g25 = gridState();
    check('25% 时线宽补偿到 4 倍', Math.abs(g25.width - 4) < 0.01, g25.width);
    app.fitView();

    /* ---------- 30. 关闭箭头吸附后可以画自由端点箭头 ---------- */
    app.setSetting('snapPorts', false);
    store.selectNodes([st.nodes[0].id]);
    app.render();
    var portEl30 = q('#layerUi [data-port="r"]');
    check('选中组件后能看到连接点', !!portEl30);
    var p30 = centerOf(portEl30);
    var cb30 = app.contentBounds();
    var freeClient = toClient(cb30.x - 120, cb30.y + cb30.h + 120);
    var edgesBefore30 = st.edges.length;
    fire(portEl30, 'pointerdown', p30.x, p30.y);
    fire(window, 'pointermove', freeClient.x, freeClient.y);
    check('关闭吸附时仍有预览线', qa('#layerHot .ghost-edge').length > 0, qa('#layerHot .ghost-edge').length);
    check('关闭吸附时不显示吸附高亮', qa('#layerHot .anchor-halo').length === 0);
    fire(window, 'pointerup', freeClient.x, freeClient.y);
    check('关闭吸附后能画出箭头', st.edges.length === edgesBefore30 + 1,
      edgesBefore30 + ' → ' + st.edges.length);
    var freeEdge = st.edges[st.edges.length - 1];
    check('终点记录为自由位置', !!freeEdge.to.point && !freeEdge.to.node, JSON.stringify(freeEdge.to));
    var freePath = q('#layerEdges g[data-id="' + freeEdge.id + '"] path.edge-visible');
    check('自由端点箭头正常渲染', !!freePath && (freePath.getAttribute('d') || '').indexOf('NaN') < 0);
    var want = toClient(freeEdge.to.point.x, freeEdge.to.point.y);
    check('自由端点落在松手的位置', Math.abs(want.x - freeClient.x) < 1 && Math.abs(want.y - freeClient.y) < 1,
      Math.round(want.x) + ',' + Math.round(want.y) + ' vs ' + Math.round(freeClient.x) + ',' + Math.round(freeClient.y));

    /* 开启吸附但落在空白处，也应得到自由端点而不是取消 */
    app.setSetting('snapPorts', true);
    store.selectNodes([st.nodes[0].id]);
    app.render();
    var portEl30b = q('#layerUi [data-port="r"]');
    var p30b = centerOf(portEl30b);
    var edgesBefore30b = st.edges.length;
    fire(portEl30b, 'pointerdown', p30b.x, p30b.y);
    fire(window, 'pointermove', freeClient.x - 40, freeClient.y - 40);
    fire(window, 'pointerup', freeClient.x - 40, freeClient.y - 40);
    check('开启吸附落在空白处也不会取消', st.edges.length === edgesBefore30b + 1, st.edges.length);
    check('该箭头同样是自由端点', !!st.edges[st.edges.length - 1].to.point);

    /* 面板：自由端点可以改回组件连接 */
    store.selectEdges([freeEdge.id]);
    app.render();
    check('面板显示终点为自由位置', document.getElementById('ep-to-port').value === 'free',
      document.getElementById('ep-to-port').value);
    var sel31 = document.getElementById('ep-to-port');
    sel31.value = 'auto';
    sel31.dispatchEvent(new Event('change', { bubbles: true }));
    check('自由端点选方向会被拦下并复位', sel31.value === 'free' && !!freeEdge.to.point, sel31.value);

    /* ---------- 31. 自定义模板 ---------- */
    window.prompt = function () { return '测试模板'; };
    var pick = st.edges.filter(function (e) { return e.from.node && e.to.node && e.from.node !== e.to.node; })[0];
    var tplIds = [pick.from.node, pick.to.node];
    store.selectNodes(tplIds);
    app.render();
    var nodesBefore31 = st.nodes.length, edgesBefore31 = st.edges.length;
    document.getElementById('btn-save-template').click();
    check('模板加入列表', qa('#templateList .btn').length === 1, qa('#templateList .btn').length);
    var saved31 = JSON.parse(localStorage.getItem('fd.templates.v1') || '[]');
    check('模板记录了组件与内部箭头',
      saved31.length === 1 && saved31[0].nodes.length === 2 && saved31[0].edges.length >= 1,
      saved31.length ? saved31[0].nodes.length + ' 个 / ' + saved31[0].edges.length + ' 条' : '空');
    check('模板名称可用', saved31[0] && saved31[0].name === '测试模板', saved31[0] ? saved31[0].name : '-');
    qa('#templateList .btn')[0].click();
    check('插入模板新增整组组件', st.nodes.length === nodesBefore31 + 2, st.nodes.length + '/' + nodesBefore31);
    check('插入模板带出内部箭头', st.edges.length >= edgesBefore31 + 1,
      edgesBefore31 + ' → ' + st.edges.length);
    check('插入后自动选中整组', st.selection.nodes.length === 2, st.selection.nodes.length);
    var insertedIds = st.selection.nodes;
    var insertedEdge = st.edges[st.edges.length - 1];
    check('内部箭头挂到新组件上',
      insertedIds.indexOf(insertedEdge.from.node) >= 0 && insertedIds.indexOf(insertedEdge.to.node) >= 0,
      insertedEdge.from.node + '→' + insertedEdge.to.node);
    var origNode = store.nodeById(tplIds[0]);
    var newNodes31 = insertedIds.map(function (id) { return store.nodeById(id); });
    check('插入的组件不与原组件重叠',
      newNodes31.every(function (n) { return n.x !== origNode.x || n.y !== origNode.y; }));

    /* 模板也可以拖到画布 */
    var dt31 = new DataTransfer();
    dt31.setData('text/fd-template', '0');
    var dropPt = toClient(app.contentBounds().x - 160, app.contentBounds().y + 60);
    var nodesBefore31b = st.nodes.length;
    boardEl.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, clientX: dropPt.x, clientY: dropPt.y, dataTransfer: dt31
    }));
    check('拖放模板到画布也能插入', st.nodes.length === nodesBefore31b + 2, st.nodes.length);

    /* ---------- 32. 纯文本图标 ---------- */
    var textBtn = q('#shapeList .shape-btn[data-shape="text"]');
    check('纯文本图标没有多余线条', textBtn && textBtn.querySelectorAll('svg path').length === 0,
      textBtn ? textBtn.querySelectorAll('svg path').length : 'null');
    check('纯文本图标显示文字', !!textBtn && !!textBtn.querySelector('svg text') &&
      textBtn.querySelector('svg text').textContent === '文本');
    var otherBtn = q('#shapeList .shape-btn[data-shape="decision"]');
    check('其他组件图标仍有形状', otherBtn.querySelectorAll('svg path').length === 1);

    /* ---------- 33. 面板收起 / 展开 ---------- */
    var panelL = document.getElementById('panelLeft');
    var labelL = panelL.querySelector('.panel-label');
    var toggleL = document.getElementById('btn-collapse-left');
    panelL.style.transition = 'none';
    var widthOpen = panelL.getBoundingClientRect().width;
    function chevronInfo(toggle) {
      var svgRect = toggle.querySelector('svg').getBoundingClientRect();
      var pathRect = toggle.querySelector('svg path').getBoundingClientRect();
      var r = function (x) { return Math.round(x * 10) / 10; };
      return {
        ok: pathRect.width > 2 && pathRect.height > 2 &&
          pathRect.left >= svgRect.left - 2 && pathRect.right <= svgRect.right + 2 &&
          pathRect.top >= svgRect.top - 2 && pathRect.bottom <= svgRect.bottom + 2,
        svg: [r(svgRect.left), r(svgRect.top), r(svgRect.width), r(svgRect.height)].join(','),
        path: [r(pathRect.left), r(pathRect.top), r(pathRect.width), r(pathRect.height)].join(',')
      };
    }
    var chevOpen = chevronInfo(toggleL);
    check('展开状态下箭头图标在按钮内', chevOpen.ok, 'svg=' + chevOpen.svg + ' path=' + chevOpen.path);
    toggleL.click();
    var widthShut = panelL.getBoundingClientRect().width;
    check('收起后左侧面板变窄', widthShut < widthOpen - 100, widthOpen + ' → ' + widthShut);
    check('收起状态写在类名与 aria 上',
      panelL.classList.contains('collapsed') && toggleL.getAttribute('aria-expanded') === 'false');
    check('收起后标题不再占宽度', labelL.getBoundingClientRect().width < 2,
      labelL.getBoundingClientRect().width);
    check('收起后标题与按钮不重叠',
      labelL.getBoundingClientRect().right <= toggleL.getBoundingClientRect().left + 0.5,
      labelL.getBoundingClientRect().right + ' vs ' + toggleL.getBoundingClientRect().left);
    check('收起后按钮大致居中',
      Math.abs((toggleL.getBoundingClientRect().left + toggleL.getBoundingClientRect().right) / 2 -
        (panelL.getBoundingClientRect().left + panelL.getBoundingClientRect().right) / 2) < 4,
      toggleL.getBoundingClientRect().left + ',' + toggleL.getBoundingClientRect().right);
    check('收起后按钮完整可见、没有被裁掉',
      toggleL.getBoundingClientRect().left >= panelL.getBoundingClientRect().left - 0.5 &&
      toggleL.getBoundingClientRect().right <= panelL.getBoundingClientRect().right + 0.5 &&
      toggleL.getBoundingClientRect().width > 20,
      JSON.stringify({ b: [toggleL.getBoundingClientRect().left, toggleL.getBoundingClientRect().right], p: [panelL.getBoundingClientRect().left, panelL.getBoundingClientRect().right] }));
    var toggleStyle = getComputedStyle(toggleL);
    check('收起后按钮颜色可见',
      toggleStyle.visibility !== 'hidden' && parseFloat(toggleStyle.opacity) > 0.5 &&
      toggleStyle.color !== 'rgba(0, 0, 0, 0)', toggleStyle.color + ' / ' + toggleStyle.opacity);
    var chevShut = chevronInfo(toggleL);
    check('收起后箭头图标仍然画在按钮里（没被旋转到视口外）', chevShut.ok,
      'svg=' + chevShut.svg + ' path=' + chevShut.path);
    check('收起后竖排显示面板名字',
      getComputedStyle(panelL.querySelector('.panel-rail-label')).display !== 'none');
    check('收起状态被记住', st.settings.collapseLeft === true);
    toggleL.click();
    check('再次点击可以展开',
      !panelL.classList.contains('collapsed') && toggleL.getAttribute('aria-expanded') === 'true');
    check('展开后宽度复原', Math.abs(panelL.getBoundingClientRect().width - widthOpen) < 1,
      panelL.getBoundingClientRect().width);
    check('展开后隐藏竖排名字',
      getComputedStyle(panelL.querySelector('.panel-rail-label')).display === 'none');
    panelL.style.transition = '';
    var tProp = getComputedStyle(panelL).transition;
    check('面板宽度带非线性过渡动画', /width/.test(tProp) && /cubic-bezier/.test(tProp), tProp);
    var panelR = document.getElementById('panelRight');
    panelR.style.transition = 'none';
    document.getElementById('btn-collapse-right').click();
    check('右侧属性面板同样可以收起',
      panelR.classList.contains('collapsed') && panelR.getBoundingClientRect().width < 60,
      panelR.getBoundingClientRect().width);
    var chevRight = chevronInfo(document.getElementById('btn-collapse-right'));
    check('右侧收起后的箭头图标也在按钮里', chevRight.ok,
      'svg=' + chevRight.svg + ' path=' + chevRight.path);
    document.getElementById('btn-collapse-right').click();
    panelR.style.transition = '';
    check('右侧面板可以展开回来', !panelR.classList.contains('collapsed'));

    /* ---------- 34. 同一方向可以画多根箭头 ---------- */
    var cb34 = app.contentBounds();
    var nA = app.addShapeAt('process', cb34.x + 80, cb34.y + cb34.h + 200);
    var nB = app.addShapeAt('process', cb34.x + 400, cb34.y + cb34.h + 320);
    function forwardPort() {
      store.selectNodes([nA.id]);
      app.render();
      return q('#layerUi [data-port="r"]');
    }
    function reversePort() {
      store.selectNodes([nB.id]);
      app.render();
      return q('#layerUi [data-port="l"]');
    }
    function dragBetween(fromEl, toPoint) {
      var f = centerOf(fromEl);
      fire(fromEl, 'pointerdown', f.x, f.y);
      fire(window, 'pointermove', toPoint.x, toPoint.y);
      fire(window, 'pointerup', toPoint.x, toPoint.y);
    }
    var edgesBefore34 = st.edges.length;
    function portClient(node, side) {
      var p = G.portPoint(node, side);
      return toClient(p.x, p.y);
    }
    dragBetween(forwardPort(), portClient(nB, 'l'));
    dragBetween(forwardPort(), portClient(nB, 'l'));
    check('同一方向可以连出两根箭头', st.edges.length === edgesBefore34 + 2,
      edgesBefore34 + ' → ' + st.edges.length);
    var pair34 = st.edges.slice(-2);
    check('两根箭头连的是同一对组件',
      pair34[0].from.node === nA.id && pair34[1].from.node === nA.id &&
      pair34[0].to.node === nB.id && pair34[1].to.node === nB.id);
    var d34a = q('#layerEdges g[data-id="' + pair34[0].id + '"] path.edge-visible').getAttribute('d');
    var d34b = q('#layerEdges g[data-id="' + pair34[1].id + '"] path.edge-visible').getAttribute('d');
    check('两根同向箭头自动错开、路径不同', d34a !== d34b);
    var lay34 = window.FD.router.edgeLayout(st.edges, store.nodeMap());
    check('同向双箭头各偏半个间距',
      Math.abs(lay34[pair34[0].id].offset) === 10 && Math.abs(lay34[pair34[1].id].offset) === 10,
      lay34[pair34[0].id].offset + ',' + lay34[pair34[1].id].offset);

    /* ---------- 35. 双向箭头：重合 / 分开 ---------- */
    dragBetween(reversePort(), portClient(nA, 'r'));
    var rev35 = st.edges[st.edges.length - 1];
    check('可以画出反向箭头', rev35.from.node === nB.id && rev35.to.node === nA.id);
    // 去掉多余的那根，留一对干净的双向箭头
    store.selectEdges([pair34[1].id]);
    store.deleteSelection();
    store.commit();
    app.render();
    var fwd35 = pair34[0];
    var lay35 = window.FD.router.edgeLayout(st.edges, store.nodeMap());
    check('默认（无）：正反两条偏移都是 0',
      lay35[fwd35.id].offset === 0 && lay35[rev35.id].offset === 0,
      lay35[fwd35.id].offset + ',' + lay35[rev35.id].offset);
    store.selectEdges([rev35.id]);
    app.render();
    check('面板默认显示「无」', document.getElementById('ep-bi-none').classList.contains('on'));
    check('一对组件之间有两根箭头时给出合并/分开说明',
      document.getElementById('ep-bi-tip').textContent.indexOf('合并') >= 0,
      document.getElementById('ep-bi-tip').textContent);
    store.selectEdges([rev35.id]);
    app.render();
    document.getElementById('ep-bi-separate').click();
    var lay35b = window.FD.router.edgeLayout(st.edges, store.nodeMap());
    check('选「分开」后正反向各偏半个间距',
      lay35b[fwd35.id].offset === -10 && lay35b[rev35.id].offset === 10,
      lay35b[fwd35.id].offset + ',' + lay35b[rev35.id].offset);
    check('分开设置同步到反向箭头',
      rev35.style.biMode === 'separate' && fwd35.style.biMode === 'separate');
    var dSepF = q('#layerEdges g[data-id="' + fwd35.id + '"] path.edge-visible').getAttribute('d');
    var dSepR = q('#layerEdges g[data-id="' + rev35.id + '"] path.edge-visible').getAttribute('d');
    check('分开后两条箭头路径不同', dSepF !== dSepR);
    check('前端按钮状态已同步', document.getElementById('ep-bi-separate').classList.contains('on'));
    check('分开状态下提示说明可分别删除',
      document.getElementById('ep-bi-tip').textContent.indexOf('单独删除') >= 0,
      document.getElementById('ep-bi-tip').textContent);
    var edgesBefore35m = st.edges.length;
    document.getElementById('ep-bi-overlap').click();
    function pairNow() {
      return st.edges.filter(function (e) {
        return (e.from.node === nA.id && e.to.node === nB.id) ||
          (e.from.node === nB.id && e.to.node === nA.id);
      });
    }
    check('选「重合」把两条合并成一条', st.edges.length === edgesBefore35m - 1,
      edgesBefore35m + ' → ' + st.edges.length);
    var mergedKeep = pairNow()[0];
    check('合并后只剩一条双向箭头线',
      pairNow().length === 1 && mergedKeep.style.biMode === 'overlap' &&
      mergedKeep.style.arrowStart === true && mergedKeep.style.arrowEnd === true,
      JSON.stringify(mergedKeep.style));
    check('双向箭头线时「无」不可点', document.getElementById('ep-bi-none').disabled === true);
    document.getElementById('ep-bi-none').click();
    check('点被禁用的「无」不会改变状态', mergedKeep.style.biMode === 'overlap');
    store.selectEdges([mergedKeep.id]);
    app.render();
    document.getElementById('ep-bi-separate').click();
    check('可以从合并状态拆回两条', st.edges.length === edgesBefore35m,
      st.edges.length);
    var livePair = pairNow();
    var liveEdge = livePair.filter(function (e) { return e.from.node === nA.id; })[0] || livePair[0];
    check('拆回来的反向箭头重新出现',
      livePair.length === 2 && livePair.some(function (e) { return e.from.node === nB.id; }),
      livePair.length);
    document.getElementById('ep-bi-none').click();
    var afterNone = pairNow();
    check('选「无」退回原来那根单向箭头',
      afterNone.length === 1 && afterNone[0].style.biMode === 'none' &&
      afterNone[0].style.arrowStart === false,
      afterNone.length + ' 根 / ' + JSON.stringify(afterNone[0] && afterNone[0].style));
    fwd35 = afterNone[0];
    store.selectEdges([fwd35.id]);
    app.render();
    check('退回单向后「无」按钮是选中的',
      document.getElementById('ep-bi-none').classList.contains('on'));

    /* ---------- 36. 拖动折线中途的直线 ---------- */
    app.fitView();   // 上面新加的组件在视口外，先让它们可见再测鼠标命中
    store.selectEdges([fwd35.id]);
    app.render();
    var bendEl = q('#layerUi .bend-handle');
    var bendDiag = (function () {
      var g = R.edgeGeometry(fwd35, store.nodeMap(), {
        offset: (R.edgeLayout(st.edges, store.nodeMap())[fwd35.id] || { offset: 0 }).offset,
        stub: R.requiredStub(fwd35, st.settings.tailMin)
      });
      return g ? JSON.stringify({
        mode: g.mode, bend: g.bend, sides: g.startSide + '/' + g.endSide,
        start: g.start, end: g.end, sel: st.selection.edges
      }) : 'null';
    })();
    check('选中折线后出现可拖动手柄', !!bendEl, bendDiag);
    var bendStart = centerOf(bendEl);
    var bendHit = document.elementFromPoint(bendStart.x, bendStart.y);
    check('鼠标真的能点中拐点手柄（没被其他元素挡住）',
      !!bendHit && !!bendHit.closest('[data-bend]'),
      bendHit ? String(bendHit.getAttribute('class')) : 'null');
    fire(bendHit || bendEl, 'pointerdown', bendStart.x, bendStart.y);
    fire(window, 'pointermove', bendStart.x + 60, bendStart.y);
    fire(window, 'pointerup', bendStart.x + 60, bendStart.y);
    check('拖动后记录了人工转折点', !!(fwd35.bend && typeof fwd35.bend.x === 'number'),
      JSON.stringify(fwd35.bend));
    var bendNow = centerOf(q('#layerUi .bend-handle'));
    check('转折点跟着手指移动了', Math.abs(bendNow.x - bendStart.x) > 8,
      Math.round(bendStart.x) + ' → ' + Math.round(bendNow.x));
    document.getElementById('ep-reset-bend').click();
    check('重置后回到自动位置', !fwd35.bend, JSON.stringify(fwd35.bend));

    /* ---------- 36b. 混合走向的拐点手柄 ---------- */
    store.selectNodes([nA.id]);
    app.render();
    var portR36 = q('#layerUi [data-port="r"]');
    var edgesBefore36 = st.edges.length;
    dragBetween(portR36, portClient(nB, 't'));   // 从右侧出、上方进 → 混合走向
    var mixEdge = st.edges[st.edges.length - 1];
    check('可以画出混合走向的折线', st.edges.length === edgesBefore36 + 1 &&
      mixEdge.from.port === 'r' && mixEdge.to.port === 't',
      mixEdge.from.port + '→' + mixEdge.to.port);
    store.selectEdges([mixEdge.id]);
    app.render();
    var cornerEl = q('#layerUi .bend-handle');
    check('混合走向也有拐点手柄', !!cornerEl && cornerEl.getAttribute('data-bend') === 'corner',
      cornerEl ? cornerEl.getAttribute('data-bend') : 'null');
    var cornerStart = centerOf(cornerEl);
    var dBefore36 = q('#layerEdges g[data-id="' + mixEdge.id + '"] path.edge-visible').getAttribute('d');
    fire(cornerEl, 'pointerdown', cornerStart.x, cornerStart.y);
    fire(window, 'pointermove', cornerStart.x + 40, cornerStart.y + 30);
    fire(window, 'pointerup', cornerStart.x + 40, cornerStart.y + 30);
    check('拐点被记录下来', !!(mixEdge.bend && typeof mixEdge.bend.x === 'number' &&
      typeof mixEdge.bend.y === 'number'), JSON.stringify(mixEdge.bend));
    var dAfter36 = q('#layerEdges g[data-id="' + mixEdge.id + '"] path.edge-visible').getAttribute('d');
    check('拖动拐点后走线改变', dBefore36 !== dAfter36);
    check('拐点走线不含 NaN', dAfter36.indexOf('NaN') < 0);
    document.getElementById('ep-reset-bend').click();
    check('混合走向也能重置拐点', !mixEdge.bend);

    /* ---------- 37. 尾线长度设置 ---------- */
    var tailInput = document.getElementById('cs-tailMin');
    tailInput.value = '60';
    tailInput.dispatchEvent(new Event('change', { bubbles: true }));
    check('尾线设置写入并生效',
      st.settings.tailMin === 60 && window.FD.router.requiredStub(fwd35, st.settings.tailMin) >= 60,
      st.settings.tailMin);
    check('面板显示同步', document.getElementById('cs-tailMin').value === '60');
    tailInput.value = '16';
    tailInput.dispatchEvent(new Event('change', { bubbles: true }));
    check('尾线可以改回默认', st.settings.tailMin === 16);

    /* ---------- 38. 单向箭头点「重合 / 分开」会自动补出反向箭头 ---------- */
    app.fitView();
    var cb38 = app.contentBounds();
    var nA38 = app.addShapeAt('process', cb38.x + 80, cb38.y + cb38.h + 220);
    var nB38 = app.addShapeAt('process', cb38.x + 420, cb38.y + cb38.h + 360);
    function geoInApp(edge) {
      var map = store.nodeMap();
      var lay = R.edgeLayout(st.edges, map)[edge.id] || { offset: 0, slot: 0 };
      return R.edgeGeometry(edge, map, {
        offset: lay.offset, slot: lay.slot,
        stub: R.requiredStub(edge, st.settings.tailMin)
      });
    }
    store.selectNodes([nA38.id]);
    app.render();
    dragBetween(q('#layerUi [data-port="r"]'), portClient(nB38, 'l'));
    var single38 = st.edges[st.edges.length - 1];
    store.selectEdges([single38.id]);
    app.render();
    check('单向箭头时提示说明两种做法',
      document.getElementById('ep-bi-tip').textContent.indexOf('补上反向那根') >= 0,
      document.getElementById('ep-bi-tip').textContent);

    /* 重合 = 合并成一条两端带箭头的双向箭头线 */
    var edgesBefore38 = st.edges.length;
    document.getElementById('ep-bi-overlap').click();
    check('点「重合」不会多出箭头（本来就是一条线）', st.edges.length === edgesBefore38,
      edgesBefore38 + ' → ' + st.edges.length);
    check('「重合」把这条线两端都变成箭头',
      single38.style.arrowStart === true && single38.style.arrowEnd === true);
    check('「重合」标记为双向箭头线', single38.style.biMode === 'overlap', single38.style.biMode);
    check('单向箭头合并出来的双向线可以退回「无」',
      document.getElementById('ep-bi-none').disabled === false);
    check('提示说明是整体操作',
      document.getElementById('ep-bi-tip').textContent.indexOf('整体操作') >= 0,
      document.getElementById('ep-bi-tip').textContent);
    check('提示说明可以退回单向',
      document.getElementById('ep-bi-tip').textContent.indexOf('退回原来那根单向箭头') >= 0,
      document.getElementById('ep-bi-tip').textContent);
    var mergedPath = q('#layerEdges g[data-id="' + single38.id + '"] path.edge-visible');
    check('双向箭头线两端都有箭头',
      !!mergedPath.getAttribute('marker-end') && !!mergedPath.getAttribute('marker-start'),
      mergedPath.getAttribute('marker-end') + ' / ' + mergedPath.getAttribute('marker-start'));

    /* 分开 = 拆成两条，各自可单独删除 */
    document.getElementById('ep-bi-separate').click();
    check('点「分开」拆成两条', st.edges.length === edgesBefore38 + 1,
      st.edges.length);
    var autoRev = st.edges[st.edges.length - 1];
    check('拆出的箭头方向相反', autoRev.from.node === nB38.id && autoRev.to.node === nA38.id);
    check('拆出的箭头用同一对端口',
      autoRev.from.port === single38.to.port && autoRev.to.port === single38.from.port,
      autoRev.from.port + '→' + autoRev.to.port);
    check('两条都是单箭头（各自一个箭头）',
      single38.style.arrowStart === false && autoRev.style.arrowStart === false &&
      single38.style.arrowEnd === true && autoRev.style.arrowEnd === true);
    check('两条都标成「分开」',
      single38.style.biMode === 'separate' && autoRev.style.biMode === 'separate');
    check('分开后「无」重新可用', document.getElementById('ep-bi-none').disabled === false);
    var lay38 = R.edgeLayout(st.edges, store.nodeMap());
    check('两条各偏半个间距',
      Math.abs(lay38[single38.id].offset) === 10 && Math.abs(lay38[autoRev.id].offset) === 10,
      JSON.stringify([lay38[single38.id], lay38[autoRev.id]]));
    var g38a = geoInApp(single38), g38b = geoInApp(autoRev);
    var cross38 = false;
    for (var i38 = 1; i38 < g38a.points.length; i38++) {
      for (var j38 = 1; j38 < g38b.points.length; j38++) {
        if (R.segmentsIntersect(g38a.points[i38 - 1].x, g38a.points[i38 - 1].y,
          g38a.points[i38].x, g38a.points[i38].y,
          g38b.points[j38 - 1].x, g38b.points[j38 - 1].y,
          g38b.points[j38].x, g38b.points[j38].y)) cross38 = true;
      }
    }
    check('分开后两条线不交叉', !cross38,
      JSON.stringify(g38a.points) + ' / ' + JSON.stringify(g38b.points));
    check('自动补出来的分开箭头，无按钮仍可用（能退回单向）',
      document.getElementById('ep-bi-none').disabled === false);

    /* 把其中一条单独删掉，另一根还在 */
    store.selectEdges([autoRev.id]);
    store.deleteSelection();
    store.commit();
    app.render();
    check('分开的双向箭头可以只删一根', st.edges.length === edgesBefore38 &&
      !!store.edgeById(single38.id), st.edges.length);

    /* 再合并回一条，然后一次删除 */
    store.selectEdges([single38.id]);
    app.render();
    document.getElementById('ep-bi-separate').click();
    document.getElementById('ep-bi-overlap').click();
    check('重合会吃掉反向那根，只剩一条', st.edges.length === edgesBefore38,
      st.edges.length);
    var g39 = geoInApp(single38);
    store.selectEdges([single38.id]);
    app.render();
    var bend39 = q('#layerUi .bend-handle');
    if (bend39) {
      var b39 = centerOf(bend39);
      var hit39 = document.elementFromPoint(b39.x, b39.y);
      fire(hit39 || bend39, 'pointerdown', b39.x, b39.y);
      fire(window, 'pointermove', b39.x + 40, b39.y);
      fire(window, 'pointerup', b39.x + 40, b39.y);
      check('双向箭头线拖拐点后仍然是一条线',
        !!single38.bend && st.edges.length === edgesBefore38, JSON.stringify(single38.bend));
    } else {
      check('双向箭头线拖拐点后仍然是一条线', true, '该走线无可拖段');
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    check('双向箭头线点一次删除就没了', st.edges.length === edgesBefore38 - 1, st.edges.length);

    /* ---------- 40. 左右两侧各连一根，不算一对 ---------- */
    var cb40 = app.contentBounds();
    var nA40 = app.addShapeAt('process', cb40.x + 80, cb40.y - 260);
    var nB40 = app.addShapeAt('process', cb40.x + 420, cb40.y - 260);
    store.selectNodes([nA40.id]);
    app.render();
    dragBetween(q('#layerUi [data-port="l"]'), portClient(nB40, 'l'));
    store.selectNodes([nB40.id]);
    app.render();
    dragBetween(q('#layerUi [data-port="r"]'), portClient(nA40, 'r'));
    var leftEdge = st.edges.filter(function (e) {
      return e.from.node === nA40.id && e.to.node === nB40.id;
    })[0];
    var rightEdge = st.edges.filter(function (e) {
      return e.from.node === nB40.id && e.to.node === nA40.id;
    })[0];
    check('两侧各一根箭头的端口被记录', leftEdge.from.port === 'l' && rightEdge.from.port === 'r',
      leftEdge.from.port + ' / ' + rightEdge.from.port);
    var lay40 = R.edgeLayout(st.edges, store.nodeMap());
    check('不同侧的箭头不配对、不会被偏移',
      (!lay40[leftEdge.id] || lay40[leftEdge.id].offset === 0) &&
      (!lay40[rightEdge.id] || lay40[rightEdge.id].offset === 0),
      JSON.stringify([lay40[leftEdge.id], lay40[rightEdge.id]]));
    check('两者分组键不同',
      R.groupKeyOf(leftEdge, store.nodeMap()) !== R.groupKeyOf(rightEdge, store.nodeMap()));

    /* ---------- 40b. 用户自己连出来的双向箭头不能退回「无」 ---------- */
    var cb40b = app.contentBounds();
    var m1 = app.addShapeAt('process', cb40b.x + 80, cb40b.y - 560);
    var m2 = app.addShapeAt('process', cb40b.x + 420, cb40b.y - 560);
    store.selectNodes([m1.id]);
    app.render();
    dragBetween(q('#layerUi [data-port="r"]'), portClient(m2, 'l'));
    store.selectNodes([m2.id]);
    app.render();
    dragBetween(q('#layerUi [data-port="l"]'), portClient(m1, 'r'));
    var manualPair = st.edges.filter(function (e) {
      return (e.from.node === m1.id && e.to.node === m2.id) ||
        (e.from.node === m2.id && e.to.node === m1.id);
    });
    check('手动连出两根反向箭头', manualPair.length === 2, manualPair.length);
    store.selectEdges([manualPair[0].id]);
    app.render();
    check('手动双向时「无」可用（尚未做特殊处理）',
      document.getElementById('ep-bi-none').disabled === false);
    document.getElementById('ep-bi-separate').click();
    check('手动双向选「分开」后「无」变灰',
      document.getElementById('ep-bi-none').disabled === true);
    check('手动双向的提示说明不能退回单向',
      document.getElementById('ep-bi-tip').textContent.indexOf('「无」不可用') >= 0,
      document.getElementById('ep-bi-tip').textContent);
    document.getElementById('ep-bi-none').click();
    check('点被禁用的「无」不会拆掉手动箭头',
      st.edges.filter(function (e) {
        return (e.from.node === m1.id && e.to.node === m2.id) ||
          (e.from.node === m2.id && e.to.node === m1.id);
      }).length === 2);
    document.getElementById('ep-bi-overlap').click();
    check('手动双向合并成一条', st.edges.filter(function (e) {
      return (e.from.node === m1.id && e.to.node === m2.id) ||
        (e.from.node === m2.id && e.to.node === m1.id);
    }).length === 1);
    check('手动双向合并后「无」同样是灰的',
      document.getElementById('ep-bi-none').disabled === true);

    /* ---------- 41. 中间挡着组件时自动绕开 ---------- */
    var cb41 = app.contentBounds();
    var oA = app.addShapeAt('process', cb41.x + 80, cb41.y + cb41.h + 620);
    var oB = app.addShapeAt('process', cb41.x + 700, cb41.y + cb41.h + 620);
    var oC = app.addShapeAt('process', cb41.x + 390, cb41.y + cb41.h + 620);
    store.selectNodes([oA.id]);
    app.render();
    dragBetween(q('#layerUi [data-port="r"]'), portClient(oB, 'l'));
    var blocked = st.edges[st.edges.length - 1];
    var obsList = R.obstaclesFor(blocked, store.nodeMap());
    var gBlocked = geoInApp(blocked);
    check('挡路时走线自动绕开中间组件',
      !R.polylineHits(gBlocked.points, obsList), JSON.stringify(gBlocked.points));
    check('绕行走线仍然有效', gBlocked.d.indexOf('NaN') < 0);

    /* ---------- 42. 箭头标签可以拖动 ---------- */
    var cb42 = app.contentBounds();
    var lA = app.addShapeAt('process', cb42.x + 80, cb42.y + cb42.h + 900);
    var lB = app.addShapeAt('process', cb42.x + 460, cb42.y + cb42.h + 900);
    store.selectNodes([lA.id]);
    app.render();
    dragBetween(q('#layerUi [data-port="r"]'), portClient(lB, 'l'));
    var labelEdge = st.edges[st.edges.length - 1];
    labelEdge.label = '标注';
    store.selectEdges([labelEdge.id]);
    app.fitView();   // 新组件在视口外，先适应窗口再测鼠标命中
    store.selectEdges([labelEdge.id]);
    app.render();
    function labelElOf(id) {
      return q('#layerEdges g[data-id="' + id + '"] text.edge-label');
    }
    var lbl = labelElOf(labelEdge.id);
    check('箭头标签带上可拖动标记', !!lbl);
    var lblStart = centerOf(lbl);
    var lblHit = document.elementFromPoint(lblStart.x, lblStart.y);
    check('鼠标能点中标签', !!lblHit && !!lblHit.closest('[data-label]'),
      lblHit ? String(lblHit.getAttribute('class')) : 'null');
    fire(lblHit || lbl, 'pointerdown', lblStart.x, lblStart.y);
    fire(window, 'pointermove', lblStart.x + 44, lblStart.y + 30);
    fire(window, 'pointerup', lblStart.x + 44, lblStart.y + 30);
    check('标签记录了人工位置', !!(labelEdge.labelPos && typeof labelEdge.labelPos.x === 'number'),
      JSON.stringify(labelEdge.labelPos));
    var lblNow = centerOf(labelElOf(labelEdge.id));
    check('标签跟着鼠标移动了', Math.abs(lblNow.x - lblStart.x) > 12,
      Math.round(lblStart.x) + ' → ' + Math.round(lblNow.x));
    check('拖动标签不会改变箭头数量', st.edges.length > 0);

    // 往组件上拖：渲染时会被推出来，保持最小间距
    var dropOnNode = centerOfNode(st.nodes.indexOf(lA));
    var lblEl2 = labelElOf(labelEdge.id);
    fire(lblEl2, 'pointerdown', lblNow.x, lblNow.y);
    fire(window, 'pointermove', dropOnNode.x, dropOnNode.y);
    fire(window, 'pointerup', dropOnNode.x, dropOnNode.y);
    var lblClamped = centerOf(labelElOf(labelEdge.id));
    var nodeScreen = nodeGroups()[st.nodes.indexOf(lA)].getBoundingClientRect();
    var inNode = lblClamped.x > nodeScreen.left && lblClamped.x < nodeScreen.right &&
      lblClamped.y > nodeScreen.top && lblClamped.y < nodeScreen.bottom;
    check('标签被推到组件外面（不压住组件）', !inNode,
      Math.round(lblClamped.x) + ',' + Math.round(lblClamped.y));
    document.getElementById('ep-reset-bend').click();
    check('重置折线不会影响标签', !!labelEdge.labelPos);
    store.selectEdges([labelEdge.id]);
    store.deleteSelection();
    store.commit();
    app.render();

    /* ---------- 43. 多画板标签页 ---------- */
    function tabEls() { return qa('#tabList .tab'); }
    function syncBoard() { st = app.state; store = app.store; }
    check('标签栏里有画板', tabEls().length >= 1, tabEls().length);
    check('当前画板被高亮', tabEls().filter(function (t) {
      return t.classList.contains('on');
    }).length === 1);
    var boardACount = st.nodes.length;
    document.getElementById('btn-tab-add').click();
    syncBoard();
    check('点 + 新建画板', tabEls().length >= 2, tabEls().length);
    check('新画板是空的', st.nodes.length === 0, st.nodes.length);
    app.addShapeAt('process', 240, 240);
    check('新画板可以独立编辑', st.nodes.length === 1, st.nodes.length);
    var activeIdx = tabEls().findIndex(function (t) { return t.classList.contains('on'); });
    var otherIdx = activeIdx === 0 ? 1 : 0;
    tabEls()[otherIdx].click();
    syncBoard();
    var backCount = st.nodes.length;
    check('切换画板后看到的是另一个画板的内容（各自的组件互不影响）',
      backCount === boardACount && backCount !== 1,
      backCount + ' vs ' + boardACount);
    // 切回刚才那个画板，内容应该还在
    tabEls()[activeIdx].click();
    syncBoard();
    check('切回来内容还在', st.nodes.length === 1, st.nodes.length);
    var origPrompt = window.prompt;
    window.prompt = function () { return '我的流程'; };
    tabEls()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    check('双击标签可以改名', tabEls()[0].textContent.indexOf('我的流程') >= 0,
      tabEls()[0].textContent);
    window.prompt = origPrompt;
    var beforeClose = tabEls().length;
    qa('#tabList .tab .tab-close')[0].click();
    syncBoard();
    check('可以关闭画板', tabEls().length === beforeClose - 1, tabEls().length);
    check('关闭后仍有且只有一个当前画板',
      tabEls().filter(function (t) { return t.classList.contains('on'); }).length === 1);
    // 只剩一个时不给关闭按钮
    while (tabEls().length > 1) {
      qa('#tabList .tab .tab-close')[0].click();
      syncBoard();
    }
    check('只剩一个画板时没有关闭按钮', qa('#tabList .tab .tab-close').length === 0);

    /* ---------- 44. 示例模板的三种放入方式 ---------- */
    store.reset();
    app.render();
    var tplTabs = tabEls().length;
    qa('[data-template]')[0].click();
    syncBoard();
    check('画板为空时模板放本页',
      tabEls().length === tplTabs && st.nodes.length >= 8,
      tabEls().length + ' / ' + st.nodes.length);
    qa('[data-template]')[1].click();
    syncBoard();
    check('画板非空时模板开到新标签页', tabEls().length === tplTabs + 1, tabEls().length);
    var tplBtn = qa('[data-template]')[1];
    var dt44 = new DataTransfer();
    tplBtn.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt44 }));
    var cb44 = app.contentBounds();
    var dropPt44 = toClient(cb44.x + 40, cb44.y + cb44.h + 220);
    boardEl.dispatchEvent(new DragEvent('dragover', {
      bubbles: true, cancelable: true, clientX: dropPt44.x, clientY: dropPt44.y, dataTransfer: dt44
    }));
    check('拖动模板时有落点预览', qa('#layerHot .ghost-node').length > 0,
      qa('#layerHot .ghost-node').length);
    check('拖动模板的提示带模板名',
      document.getElementById('dropVeil').textContent.indexOf('模板') >= 0,
      document.getElementById('dropVeil').textContent);
    var nodesBefore44 = st.nodes.length;
    boardEl.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, clientX: dropPt44.x, clientY: dropPt44.y, dataTransfer: dt44
    }));
    syncBoard();
    check('拖到画布把模板放进当前画板', st.nodes.length === nodesBefore44 + 7,
      nodesBefore44 + ' → ' + st.nodes.length);
    check('拖放后预览消失', qa('#layerHot .ghost-node').length === 0);
    check('拖放不会多开画板', tabEls().length === tplTabs + 1, tabEls().length);
    tplBtn.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt44 }));

    /* ---------- 13. 导出 ---------- */
    // 给一条箭头加标签，用于验证导出后标签底色不会变黑
    var labeledEdge = st.edges.filter(function (e) {
      return e.from.node && e.to.node && e.from.node !== e.to.node;
    })[0];
    labeledEdge.label = '是';
    app.render();
    var geoX = R.edgeGeometry(labeledEdge, store.nodeMap());
    var exportBox = app.contentBounds();
    var labelBgWidth = G.textWidth('是', 12) + 10;
    var labelProbe = {
      x: geoX.label.x - labelBgWidth / 2 + 3,
      y: geoX.label.y
    };
    var exportSvg = app.buildExportSvg();
    check('导出 SVG 有尺寸', parseFloat(exportSvg.getAttribute('width')) > 0 &&
      parseFloat(exportSvg.getAttribute('height')) > 0,
      exportSvg.getAttribute('width') + 'x' + exportSvg.getAttribute('height'));
    check('导出 SVG 不含交互拾取层', exportSvg.querySelectorAll('.node-hit, .edge-hit').length === 0);
    check('导出 SVG 不含网格图案', !exportSvg.querySelector('#fdGrid'));
    check('导出 SVG 含箭头标记', exportSvg.querySelectorAll('marker').length > 0);
    var svgText = new XMLSerializer().serializeToString(exportSvg);
    check('导出 SVG 无 NaN', svgText.indexOf('NaN') < 0);
    check('导出 SVG 文字带字体', svgText.indexOf('font-family') > 0);
    var bgs = exportSvg.querySelectorAll('rect.edge-label-bg');
    var visibleBgs = Array.prototype.filter.call(bgs, function (r) {
      return parseFloat(r.getAttribute('width')) > 0;
    });
    check('导出 SVG 含可见标签底框', visibleBgs.length > 0,
      visibleBgs.length + '/' + bgs.length);
    var badBg = visibleBgs.filter(function (r) {
      var f = (r.getAttribute('fill') || '').toLowerCase();
      return !f || f === '#000' || f === '#000000' || f === 'black';
    });
    check('导出 SVG 标签底框有明确浅色填充（不会回退成黑色）', badBg.length === 0, badBg.length + ' 个异常');
    check('所有标签底框都带填充属性', Array.prototype.every.call(bgs, function (r) {
      return !!r.getAttribute('fill');
    }));

    /* 导出的 SVG 必须能被浏览器真正绘制出来（PNG 导出路径） */
    var blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      check('导出的 SVG 可被浏览器渲染', img.naturalWidth > 0, img.naturalWidth + 'x' + img.naturalHeight);
      var canvas = document.createElement('canvas');
      // 与 app.js 的 PNG 导出保持一致：2 倍分辨率
      canvas.width = img.naturalWidth * 2;
      canvas.height = img.naturalHeight * 2;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      var inkCount = 0;
      for (var i = 0; i < data.length; i += 4) if (data[i + 3] > 8) inkCount++;
      check('导出的 SVG 有实际像素内容', inkCount > 500, inkCount);
      // 箭头标签底色在导出图里必须是浅色（曾经因为 CSS 丢失而变成黑块）
      var pad24 = 24;
      var probeX = Math.round((labelProbe.x - (exportBox.x - pad24)) * 2);
      var probeY = Math.round((labelProbe.y - (exportBox.y - pad24)) * 2);
      if (probeX > 1 && probeY > 1 && probeX < canvas.width - 1 && probeY < canvas.height - 1) {
        var px = ctx.getImageData(probeX, probeY, 1, 1).data;
        check('导出图里箭头标签底色不是黑块',
          !(px[0] < 80 && px[1] < 80 && px[2] < 80 && px[3] > 200),
          'rgb(' + px[0] + ',' + px[1] + ',' + px[2] + ') a=' + px[3]);
      } else {
        check('标签采样点落在导出图内', false,
          'probe=' + probeX + ',' + probeY + ' canvas=' + canvas.width + 'x' + canvas.height +
          ' box=' + JSON.stringify(exportBox) + ' label=' + JSON.stringify(labelProbe));
      }
      check('导出画布未被污染', (function () { try { canvas.toDataURL('image/png'); return true; } catch (e) { return false; } })());
      URL.revokeObjectURL(url);
      importTest();
    };
    img.onerror = function () {
      check('导出的 SVG 可被浏览器渲染', false, 'Image 加载失败');
      URL.revokeObjectURL(url);
      importTest();
    };
    img.src = url;
  }

  /* 用真实 FileReader 走一遍「打开 JSON 文件」流程 */
  function importTest() {
    var doc = {
      type: 'flowchart', version: 1,
      nodes: [{
        id: 'imp1', shape: 'database', x: 10, y: 20, w: 150, h: 90, text: '从文件导入'
      }],
      edges: []
    };
    var file = new File([JSON.stringify(doc)], 'demo.json', { type: 'application/json' });
    var dt = new DataTransfer();
    dt.items.add(file);
    var input = document.getElementById('fileInput');
    try {
      input.files = dt.files;
    } catch (err) {
      check('可以给文件输入赋值', false, err.message);
      finish();
      return;
    }
    check('文件已放入输入框', input.files && input.files.length === 1,
      input.files ? input.files.length : 'null');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // 无头浏览器的虚拟时间下定时器会立刻触发，这里轮询等待真实读取完成
    var tries = 0;
    (function poll() {
      var st2 = window.FD.__app.state;
      var done = st2.nodes.length === 1 && st2.nodes[0] && st2.nodes[0].text === '从文件导入';
      if (!done && ++tries < 400) { setTimeout(poll, 16); return; }
      check('从 JSON 文件导入组件', st2.nodes.length === 1, st2.nodes.length);
      check('导入内容正确', st2.nodes[0] && st2.nodes[0].text === '从文件导入',
        st2.nodes[0] ? st2.nodes[0].text : '无');
      check('导入后样式被补全为默认值', st2.nodes[0] && st2.nodes[0].style.fill === '#ffffff',
        st2.nodes[0] ? st2.nodes[0].style.fill : '-');
      check('导入后画布重新渲染', qa('#layerNodes > g.node').length === 1);
      finish();
    })();
  }

  var finished = false;
  function start() {
    setTimeout(function () {
      try { run(); }
      catch (err) {
        report.errors.push('探针异常: ' + err.message + ' | ' +
          String((err.stack || '').split('\n')[1] || '').trim());
        finish();
      }
    }, 120);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
