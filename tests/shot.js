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
  ,
  collapsed: 'var s=FD.__app; document.getElementById("btn-collapse-left").click();' +
    'document.getElementById("btn-collapse-right").click();',
  parallel: 'var s=FD.__app; s.store.reset();' +
    'var A=s.addShapeAt("process", 140, 110), B=s.addShapeAt("process", 520, 110);' +
    'var C=s.addShapeAt("process", 140, 360), D=s.addShapeAt("process", 520, 360);' +
    'function link(x,y,fs,ts){var e=s.store.makeEdge(s.store.endpointNode(x.id,fs),' +
    's.store.endpointNode(y.id,ts),"orthogonal"); s.store.addEdge(e); return e;}' +
    'link(A,B,"r","l"); link(A,B,"r","l");' +
    'var f=link(C,D,"r","l"), r=link(D,C,"l","r");' +
    'f.style.biSeparate=true; r.style.biSeparate=true;' +
    'f.style.color="#2f6bff"; r.style.color="#e5484d";' +
    's.store.commit(); s.render(); s.fitView();',
  bend: 'var s=FD.__app; var st=s.state;' +
    'var e=st.edges.filter(function(x){return x.from.node&&x.to.node;})[0];' +
    's.store.selectEdges([e.id]); s.render();',
  collapsed2: 'var s=FD.__app; document.getElementById("btn-collapse-left").click();' +
    'document.getElementById("btn-collapse-right").click();',
  topsplit: 'var s=FD.__app; s.store.reset();' +
    'var A=s.addShapeAt("process", 200, 320), B=s.addShapeAt("process", 640, 320);' +
    'function link(x,y,fs,ts){var e=s.store.makeEdge(s.store.endpointNode(x.id,fs),' +
    's.store.endpointNode(y.id,ts),"orthogonal"); s.store.addEdge(e); return e;}' +
    'var f=link(A,B,"t","t"), r=link(B,A,"t","t");' +
    'f.style.biMode="separate"; r.style.biMode="separate";' +
    'f.style.color="#2f6bff"; r.style.color="#e5484d";' +
    's.store.commit(); s.render(); s.fitView();',
  obstacle: 'var s=FD.__app; s.store.reset();' +
    'var A=s.addShapeAt("process", 120, 220), B=s.addShapeAt("process", 860, 220),' +
    'C=s.addShapeAt("process", 480, 220);' +
    'var e=s.store.makeEdge(s.store.endpointNode(A.id,"auto"),' +
    's.store.endpointNode(B.id,"auto"),"orthogonal");' +
    'e.style.color="#e5484d"; s.store.addEdge(e);' +
    's.store.commit(); s.render(); s.fitView();',
  zsplit: 'var s=FD.__app; s.store.reset();' +
    'var A=s.addShapeAt("process", 180, 160), B=s.addShapeAt("process", 620, 340);' +
    'function link(x,y,fs,ts){var e=s.store.makeEdge(s.store.endpointNode(x.id,fs),' +
    's.store.endpointNode(y.id,ts),"orthogonal"); s.store.addEdge(e); return e;}' +
    'var f=link(A,B,"r","l"), r=link(B,A,"l","r");' +
    'f.style.biMode="separate"; r.style.biMode="separate";' +
    'f.style.color="#2f6bff"; r.style.color="#e5484d";' +
    's.store.commit(); s.render(); s.fitView();',
  detour: 'var s=FD.__app; s.store.reset();' +
    'var A=s.addShapeAt("process", 120, 160), B=s.addShapeAt("process", 620, 300),' +
    'C=s.addShapeAt("process", 380, 220);' +
    'var e=s.store.makeEdge(s.store.endpointNode(A.id,"r"),' +
    's.store.endpointNode(B.id,"t"),"orthogonal");' +
    'e.style.color="#2e8b57"; e.style.strokeWidth=2; s.store.addEdge(e);' +
    's.store.commit(); s.render(); s.fitView();',
  topbot: 'var s=FD.__app; s.store.reset();' +
    'var A=s.addShapeAt("process", 200, 260), B=s.addShapeAt("process", 620, 260);' +
    'var e=s.store.makeEdge(s.store.endpointNode(A.id,"t"),' +
    's.store.endpointNode(B.id,"b"),"orthogonal");' +
    'e.style.color="#e5484d"; e.style.strokeWidth=2; s.store.addEdge(e);' +
    's.store.commit(); s.render(); s.fitView();',
  merged: 'var s=FD.__app; s.store.reset();' +
    'var A=s.addShapeAt("process", 180, 180), B=s.addShapeAt("process", 620, 180);' +
    'function link(x,y,fs,ts){var e=s.store.makeEdge(s.store.endpointNode(x.id,fs),' +
    's.store.endpointNode(y.id,ts),"orthogonal"); s.store.addEdge(e); return e;}' +
    'var m=link(A,B,"r","l"); m.style.arrowStart=true; m.style.biMode="overlap";' +
    'var C=s.addShapeAt("process", 180, 400), D=s.addShapeAt("process", 620, 520);' +
    'var f=link(C,D,"r","l"), r=link(D,C,"l","r");' +
    'f.style.biMode="separate"; r.style.biMode="separate";' +
    'f.style.color="#2f6bff"; r.style.color="#e5484d";' +
    's.store.commit(); s.render(); s.fitView();',
  multitab: 'var s=FD.__app; s.state.view={x:60,y:60,zoom:0.8}; s.render();' +
    's.newBoard(); s.addShapeAt("decision", 320, 240); s.addShapeAt("process", 320, 420);' +
    's.newBoard(); document.querySelectorAll("[data-template]")[1].click();',
  preview: 'var s=FD.__app; s.store.reset(); s.state.view={x:120,y:80,zoom:1}; s.render();' +
    'var board=document.getElementById("board"); var b=board.getBoundingClientRect();' +
    'var btn=document.querySelectorAll("[data-template]")[0];' +
    'var dt=new DataTransfer();' +
    'btn.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));' +
    'board.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,' +
    'clientX:b.left+b.width*0.45,clientY:b.top+b.height*0.4,dataTransfer:dt}));',
  stackpair: 'var s=FD.__app; s.store.reset();' +
    'var A=s.addShapeAt("terminator", 220, 160), B=s.addShapeAt("terminator", 220, 460);' +
    'function link(x,y,fs,ts){var e=s.store.makeEdge(s.store.endpointNode(x.id,fs),' +
    's.store.endpointNode(y.id,ts),"orthogonal"); e.style.biMode="separate"; s.store.addEdge(e); return e;}' +
    'link(A,B,"r","l"); link(B,A,"l","r");' +
    's.store.commit(); s.render(); s.fitView();',
  ulimit: 'var s=FD.__app; s.store.reset();' +
    'var A=s.addShapeAt("terminator", 200, 200), B=s.addShapeAt("process", 640, 200);' +
    'function link(x,y,fs,ts){var e=s.store.makeEdge(s.store.endpointNode(x.id,fs),' +
    's.store.endpointNode(y.id,ts),"orthogonal"); e.style.biMode="separate"; s.store.addEdge(e); return e;}' +
    'var f=link(A,B,"b","b"), r=link(B,A,"b","b");' +
    'f.bend={y:150}; r.bend={y:150};' +
    's.store.commit(); s.render(); s.fitView();'
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
