/* 浏览器端端到端自测：把 tests/harness.js 注入 index.html 副本，用无头 Chrome 运行。
   运行：node tests/browser.js */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var root = path.join(__dirname, '..');
var tmpPage = path.join(root, '.browser-check.html');
var sourcePage = process.argv[2] || 'index.html';

var CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

function findBrowser() {
  for (var i = 0; i < CHROME_CANDIDATES.length; i++) {
    if (fs.existsSync(CHROME_CANDIDATES[i])) return CHROME_CANDIDATES[i];
  }
  return null;
}

var browser = findBrowser();
if (!browser) {
  console.log('未找到 Chrome/Edge，跳过浏览器自测');
  process.exit(0);
}

console.log('被测页面：' + sourcePage);
var html = fs.readFileSync(path.join(root, sourcePage), 'utf8');
fs.writeFileSync(tmpPage, html.replace('</body>', '<script src="tests/harness.js"></script>\n</body>'), 'utf8');

var url = 'file:///' + tmpPage.replace(/\\/g, '/').split('/').map(function (seg, i) {
  return i === 0 ? seg : encodeURIComponent(seg);
}).join('/');

// 每次运行使用独立的临时 profile，保证 localStorage 不会把上一轮的数据带进来
var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-profile-'));
var args = [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--disable-extensions',
  '--hide-scrollbars',
  '--allow-file-access-from-files',
  '--user-data-dir=' + profile,
  '--window-size=1600,1000',
  '--virtual-time-budget=20000',
  '--dump-dom',
  url
];

console.log('使用浏览器：' + browser);
var stdout = '';
var stderr = '';
try {
  stdout = cp.execFileSync(browser, args, { encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  stdout = err.stdout ? String(err.stdout) : '';
  stderr = err.stderr ? String(err.stderr) : '';
  if (!stdout) {
    console.log('浏览器执行失败：' + (err.message || err));
    if (stderr) console.log(stderr.split('\n').slice(0, 20).join('\n'));
    cleanup();
    process.exit(1);
  }
}

function cleanup() {
  try { fs.unlinkSync(tmpPage); } catch (e) { /* 忽略 */ }
  // 只清理本次运行创建、且确实位于系统临时目录下的 profile
  var tmpRoot = fs.realpathSync(os.tmpdir());
  var resolved = fs.existsSync(profile) ? fs.realpathSync(profile) : null;
  if (resolved && resolved.indexOf(tmpRoot) === 0 && resolved.indexOf('fd-profile-') > 0) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}

var m = /<pre id="report">([A-Za-z0-9+/=]+)<\/pre>/.exec(stdout);
if (!m) {
  console.log('页面没有产出测试报告（脚本可能未执行完）');
  var errLine = /<pre id="report">([\s\S]{0,200})/.exec(stdout);
  console.log('stderr 摘要：' + stderr.split('\n').slice(0, 15).join('\n'));
  if (errLine) console.log('report 片段：' + errLine[1]);
  cleanup();
  process.exit(1);
}

var json = Buffer.from(m[1], 'base64').toString('utf8');
var report = JSON.parse(json);

var failed = report.checks.filter(function (c) { return !c.ok; });
console.log('');
report.checks.forEach(function (c) {
  if (!c.ok) console.log('  ✗ ' + c.name + (c.extra ? '  → ' + c.extra : ''));
});
if (report.errors.length) {
  console.log('');
  console.log('页面运行时错误：');
  report.errors.forEach(function (e) { console.log('  ! ' + e); });
}
console.log('');
console.log('浏览器自测：通过 ' + (report.checks.length - failed.length) + ' / ' + report.checks.length);
console.log('信息：' + JSON.stringify(report.info));
cleanup();

if (failed.length || report.errors.length) {
  console.log('存在失败项');
  process.exit(1);
}
console.log('浏览器自测全部通过');
