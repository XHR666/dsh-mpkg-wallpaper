// tools/renderer-legacy-base-test.mjs — 同源内置渲染器落点迁移判据
// 目标：旧存量的 :8899 根 / :8902/webloader 在读取时迁到同源 /webloader/；
// 显式 sceneRendererUrl 与 sceneBaseLegacy 回退位不动；查询串逐字保留。
import { loadPlugin, cancelWorldTimers } from './_stub.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); } else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); } };
const eq = (name, got, want) => ok(name, got === want, got === want ? '' : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);

for (const k of ['__mpwClientLoaded', '__mpwRegistered', '__mpwSceneTest', '__mpwWebTest', '__mpwSceneUrlGuard']) {
  try { delete globalThis[k] } catch {}
}
loadPlugin({ quiet: true, settings: { enabled: true, image: 'data:image/png;base64,AAA' } });
const S = globalThis.__mpwSceneTest;
if (!S || typeof S.migrateLegacyBase !== 'function') {
  console.log('  ✗ __mpwSceneTest.migrateLegacyBase 未暴露');
  process.exit(1);
}

eq('A0 默认 base = 同源 /webloader/', S.defaultBase(), '/webloader/');
eq('A1 8899 根 → 同源（保留查询串）', S.migrateLegacyBase('http://127.0.0.1:8899/?pkgurl=x&embed=1'), '/webloader/?pkgurl=x&embed=1');
eq('A2 localhost:8899 根 → 同源', S.migrateLegacyBase('http://localhost:8899/?pkgurl=x'), '/webloader/?pkgurl=x');
eq('A3 8902/webloader → 同源', S.migrateLegacyBase('http://127.0.0.1:8902/webloader/?pkgurl=x&embed=1'), '/webloader/?pkgurl=x&embed=1');
eq('A4 8902/webloader（无尾斜杠）→ 同源', S.migrateLegacyBase('http://127.0.0.1:8902/webloader'), '/webloader/');
eq('A5 8902 测试台根不动', S.migrateLegacyBase('http://127.0.0.1:8902/'), 'http://127.0.0.1:8902/');
eq('A6 其它端口不动', S.migrateLegacyBase('http://127.0.0.1:9000/webloader/?x=1'), 'http://127.0.0.1:9000/webloader/?x=1');
eq('A7 显式 sceneRendererUrl 时不动', S.migrateLegacyBase('http://127.0.0.1:8902/webloader/?pkgurl=x', { sceneRendererUrl: 'http://127.0.0.1:8902/webloader/' }), 'http://127.0.0.1:8902/webloader/?pkgurl=x');
eq('A8 sceneBaseLegacy 回退位不动', S.migrateLegacyBase('http://127.0.0.1:8899/?pkgurl=x', { sceneBaseLegacy: true }), 'http://127.0.0.1:8899/?pkgurl=x');
eq('A9 非 http(s) 不动', S.migrateLegacyBase('file:///tmp/renderer/?x=1'), 'file:///tmp/renderer/?x=1');

cancelWorldTimers();
console.log(`\n===== renderer-legacy-base: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
