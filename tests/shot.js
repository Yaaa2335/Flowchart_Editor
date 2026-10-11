/* 截图工具：node tests/shot.js <场景> [输出路径]
   场景：default | selected | dots | empty */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var root = path.join(__dirname, '..');
var scenario = process.argv[2] || 'default';
var outPng = process.argv[3] || path.join(os.tmpdir(), 'fd-shot-' + scenario + '.png');

var SETUPS = {
  default: '',
  selected: 'var s=FD.__app; s.store.selectNodes([s.state.nodes[2].id]); s.render();',
  dots: 'var s=FD.__app; s.setSetting("gridStyle","dot"); s.state.nodes[3].style.fill="#fff7e6";' +
    's.store.selectNodes([s.state.nodes[3].id]); s.store.selectEdges([s.state.edges[3].id],true); s.render();',
  empty: 'var s=FD.__app; s.store.reset(); s.state.view={x:420,y:260,zoom:1}; s.setSetting("grid",false); s.render();',
  dark: 'var s=FD.__app; document.getElementById("btn-theme").click(); s.store.selectNodes([s.state.nodes[2].id]); s.render();',
  menu: 'var s=FD.__app; var st=s.state; st.selection.nodes=[st.nodes[2].id]; s.render();' +
    'var b=document.getElementById("board").getBoundingClientRect();' +
    'var el=document.querySelector("#layerNodes g.node:nth-child(3) .node-hit").getBoundingClientRect();' +
    'var ev=new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:el.left+el.width/2,clientY:el.top+el.height/2});' +
    'document.elementFromPoint(ev.clientX,ev.clientY).dispatchEvent(ev);',
  loop: 'var s=FD.__app; var st=s.state; var e=st.edges[0]; e.from=e.to; s.store.commit(); s.render();' +
    's.fitView();',
  zoom50: 'var s=FD.__app; s.setSetting("gridStyle","line");' +
    's.zoomAt(600,420, 0.5/s.state.view.zoom);',
  free: 'var s=FD.__app; var st=s.state;' +
    'var n=st.nodes.filter(function(x){return x.shape==="process";})[0];' +
    'st.edges.push({id:"e_parent",from:{node:n.id,port:"a"},to:{point:{x:60,y:60}},mode:"orthogonal",' +
    'label:"",style:{color:"#5d6779",strokeWidth:1.8,dash:"",arrowEnd:true,arrowStart:false}});' +
    'st.edges[st.edges.length-1].from={node:n.id,port:"auto"};' +
    'st.edges[st.edges.length-1].to={point:{x:n.x+n.w+260,y:n.y+n.h+300}};' +
    'st.edges[st.edges.length-1].label="自由终点";' +
    's.store.selectEdges([st.edges[st.edges.length-1].id]); s.render(); s.fitView();'
};

var CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome'
].filter(function (p) { return fs.existsSync(p); })[0];

if (!CHROME) { console.log('未找到浏览器'); process.exit(1); }

var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var setup = SETUPS[scenario] || '';
var injected = '<script>window.addEventListener("load",function(){setTimeout(function(){try{' + setup +
  '}catch(e){document.title="ERR:"+e.message;}},150);});</script>';
var tmpPage = path.join(root, '.shot-' + scenario + '.html');
fs.writeFileSync(tmpPage, html.replace('</body>', injected + '\n</body>'), 'utf8');

var url = 'file:///' + tmpPage.replace(/\\/g, '/').split('/').map(function (seg, i) {
  return i === 0 ? seg : encodeURIComponent(seg);
}).join('/');

var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-shot-profile-'));
try {
  cp.execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
    '--user-data-dir=' + profile, '--window-size=1500,940', '--virtual-time-budget=8000',
    '--screenshot=' + outPng, url
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  console.log('截图失败：' + (err.message || err));
}
fs.unlinkSync(tmpPage);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }

if (fs.existsSync(outPng) && fs.statSync(outPng).size > 1000) {
  console.log('已生成截图：' + outPng + '  (' + Math.round(fs.statSync(outPng).size / 1024) + ' KB)');
} else {
  console.log('截图未生成');
  process.exit(1);
}
