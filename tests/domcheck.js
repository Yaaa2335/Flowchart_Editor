/* 静态交叉检查：JS 里引用的元素 id / 选择器 / 脚本文件 / CSS 变量是否真实存在。
   运行：node tests/domcheck.js */
'use strict';

var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
var sources = {};

['geom', 'router', 'snap', 'store', 'view', 'templates', 'app'].forEach(function (name) {
  sources[name] = fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8');
});

var fail = 0;
function ok(cond, msg) {
  if (cond) return;
  fail++;
  console.log('  ✗ ' + msg);
}

/* 1. HTML 里的 id 集合 */
var ids = new Set();
var reId = /\sid="([^"]+)"/g;
var m;
while ((m = reId.exec(html))) ids.add(m[1]);
console.log('index.html 中定义 id：' + ids.size + ' 个');

/* 2. app.js 里 el('x') 引用的 id */
var refs = [];
Object.keys(sources).forEach(function (name) {
  var src = sources[name];
  var reEl = /\bel\(\s*'([^']+)'\s*\)/g;
  var mm;
  while ((mm = reEl.exec(src))) refs.push({ file: name, id: mm[1] });
  var reGet = /getElementById\(\s*'([^']+)'\s*\)/g;
  while ((mm = reGet.exec(src))) refs.push({ file: name, id: mm[1] });
});
refs.forEach(function (r) {
  ok(ids.has(r.id), r.file + '.js 引用了不存在的元素 id："' + r.id + '"');
});
console.log('元素引用检查：' + refs.length + ' 处');

/* 3. view.js 的 querySelector('#x') */
var reSel = /querySelector\(\s*'(#[A-Za-z][\w-]*)'\s*\)/g;
while ((m = reSel.exec(sources.view))) {
  ok(ids.has(m[1].slice(1)), 'view.js 查询了不存在的元素 "' + m[1] + '"');
}

/* 4. script / link 引用的文件是否存在 */
var reScript = /<script src="([^"]+)"><\/script>/g;
var count = 0;
while ((m = reScript.exec(html))) {
  count++;
  ok(fs.existsSync(path.join(root, m[1])), '缺少脚本文件 ' + m[1]);
}
ok(count >= 5, '脚本标签数量异常：' + count);
var reLink = /<link[^>]+href="([^"]+)"/g;
while ((m = reLink.exec(html))) {
  ok(fs.existsSync(path.join(root, m[1])), '缺少样式文件 ' + m[1]);
}

/* 5. JS 中注入的内联样式引用的 CSS 变量必须已定义 */
var definedVars = new Set();
var reVarDef = /(--[\w-]+)\s*:/g;
while ((m = reVarDef.exec(css))) definedVars.add(m[1]);
var allJs = Object.keys(sources).map(function (k) { return sources[k]; }).join('\n');
var reVarUse = /var\((--[\w-]+)\)/g;
var used = new Set();
while ((m = reVarUse.exec(allJs))) used.add(m[1]);
used.forEach(function (v) {
  ok(definedVars.has(v), 'JS 里使用了未定义的 CSS 变量 ' + v);
});
console.log('CSS 变量检查：JS 使用 ' + used.size + ' 个，样式表定义 ' + definedVars.size + ' 个');

/* 6. JS 里用到的关键 CSS 类必须存在 */
var clsUses = ['node-hit', 'edge-hit', 'edge-visible', 'sel-outline', 'hover-outline', 'guide-line',
  'marquee', 'ghost-edge', 'ghost-node', 'anchor-dot', 'anchor-halo', 'edge-anchor',
  'node-shape', 'node-text', 'edge-label', 'shape-btn', 'drop-veil', 'status-pill', 'inline-editor'];
clsUses.forEach(function (c) {
  ok(new RegExp('\\.' + c + '\\b').test(css) || new RegExp('class="' + c + '"').test(html),
    'CSS 中缺少 .' + c + ' 样式');
});

/* 7a. 渲染层产出、事件层消费的属性：两边都必须出现 */
['data-node', 'data-edge', 'data-handle', 'data-port', 'data-anchor'].forEach(function (attr) {
  ok(sources.view.indexOf(attr) >= 0, '渲染层没有产出属性 ' + attr);
  ok(sources.app.indexOf(attr) >= 0, '事件层没有消费属性 ' + attr);
});

/* 7b. HTML 声明、JS 通过 dataset 读取的属性 */
function camel(attr) {
  return attr.replace(/^data-/, '').replace(/-([a-z])/g, function (s, c) { return c.toUpperCase(); });
}
['data-tool', 'data-edge-mode', 'data-export', 'data-template', 'data-align', 'data-shape'].forEach(function (attr) {
  var key = camel(attr);
  ok(html.indexOf(attr) >= 0 || allJs.indexOf(attr) >= 0 ||
    allJs.indexOf('dataset.' + key + ' ') >= 0 || allJs.indexOf('dataset.' + key + '=') >= 0 ||
    allJs.indexOf('dataset[' + "'" + key + "'") >= 0,
    '没有任何地方产出属性 ' + attr);
  var read = allJs.indexOf(attr) >= 0 || allJs.indexOf('dataset.' + key) >= 0;
  ok(read, 'JS 中没有读取 ' + attr + '（dataset.' + key + '）');
});

/* 8. 反向检查：HTML 中声明了但 JS 从未使用的 id（提示性，不算失败） */
var unused = [];
ids.forEach(function (id) {
  if (allJs.indexOf("'" + id + "'") < 0 && !/^(defs|world|board|overlay)/.test(id)) unused.push(id);
});
if (unused.length) console.log('提示：未被 JS 直接引用的 id → ' + unused.join(', '));

console.log('');
if (fail === 0) {
  console.log('静态检查通过');
  process.exit(0);
}
console.log('静态检查发现 ' + fail + ' 个问题');
process.exit(1);
