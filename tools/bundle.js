/* 把 index.html + styles.css + src/*.js 打包成单文件，便于分享。
   运行：npm run build  或  node tools/bundle.js */
'use strict';

var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var outFile = path.join(root, '流程图绘制器.html');
var SCRIPTS = ['geom', 'router', 'snap', 'store', 'view', 'templates', 'app'];

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

function guard(code, what) {
  if (/<\/script/i.test(code)) throw new Error(what + ' 里出现了 </script，无法安全内联');
  return code;
}

function build() {
  var html = read('index.html');
  var css = read('styles.css');
  var linkTag = '<link rel="stylesheet" href="styles.css">';
  if (html.indexOf(linkTag) < 0) throw new Error('index.html 中找不到样式引用');
  html = html.split(linkTag).join('<style>\n' + css.trim() + '\n</style>');

  SCRIPTS.forEach(function (name) {
    var tag = '<script src="src/' + name + '.js"></script>';
    if (html.indexOf(tag) < 0) throw new Error('index.html 中找不到 ' + tag);
    var code = guard(read('src/' + name + '.js'), name + '.js');
    html = html.split(tag).join('<script>\n' + code.trim() + '\n</script>');
  });

  var banner = '<!-- 流程图绘制器 · 单文件版（由 tools/bundle.js 自动生成，请勿直接编辑） -->\n';
  return banner + html;
}

if (require.main === module) {
  var out = build();
  fs.writeFileSync(outFile, out, 'utf8');
  console.log('已生成单文件：' + path.basename(outFile) + '  (' + Math.round(out.length / 1024) + ' KB)');
}

module.exports = { build: build, outFile: outFile };
