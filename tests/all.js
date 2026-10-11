/* 一次跑完全部自测：node tests/all.js（等价于 npm test） */
'use strict';

var cp = require('child_process');
var path = require('path');

var suites = [
  { name: '静态检查（元素 id / 选择器 / 资源）', file: 'domcheck.js' },
  { name: '核心算法单测（几何 / 吸附 / 路由）', file: 'selftest.js' },
  { name: '浏览器端到端自测（真实渲染与交互）', file: 'browser.js' }
];

var failed = 0;
suites.forEach(function (suite) {
  console.log('\n========== ' + suite.name + ' ==========');
  var res = cp.spawnSync(process.execPath, [path.join(__dirname, suite.file)], { stdio: 'inherit' });
  if (res.status !== 0) failed++;
});

console.log('');
if (failed) {
  console.log(failed + ' 个测试套件未通过');
  process.exit(1);
}
console.log('全部测试套件通过');
