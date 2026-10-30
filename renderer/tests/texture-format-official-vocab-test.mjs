// texture-format-official-vocab-test.mjs -- 官方纹理 format 枚举表一致性判据（2026-10-11）
//
// 官方依据（✅ 官方 APK 内 .so）：
//   Androidapk/壁纸引擎_2.8.8.apk -> lib/arm64-v8a/libscenejni.so
//   TextureFormat::FromString(std::string const&)  @ 0x256d9f8（符号 _ZN13TextureFormat10FromString…）
//   逐条 pair<string,TextureFormat_e> 构造读出 => 19 条 名字->枚举（证据与命令见
//   docs/reports/OFFICIAL-TEXTURE-FORMAT-TABLE.md §4；GL 三元组只证 6 条且官方 19/21 搭配可疑 ⇒ 不照抄）
//
// 本判据钉住两件事：
//  ① TEXTURE_FORMATS 覆盖官方 19 个枚举号，且名字与官方表**不分大小写**一致；
//  ② 未知枚举号报错时**必须带名字**（便于定位；不允许只报数字）。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'

const src = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
const rows = []
const ok = (why, cond, detail = '') => rows.push({ why, pass: !!cond, detail: String(detail) })

// 官方 19 条（名字->枚举），来自 .so 的 FromString
const OFFICIAL = {
  0: 'rgba8888', 1: 'rgb888', 2: 'rgb565', 4: 'dxt5', 6: 'dxt3', 7: 'dxt1', 8: 'rg88', 9: 'r8',
  10: 'rg1616f', 11: 'r16f', 12: 'bc7', 13: 'rgba1010102', 14: 'rgba16161616f', 15: 'rgb161616f',
  17: 'rgba16161616', 18: 'rgb161616', 19: 'rgba16161616S', 20: 'rgb161616S', 21: 'rgba8888s',
}

// 解析源码里的 TEXTURE_FORMATS 表
const m = /export const TEXTURE_FORMATS = \{([\s\S]*?)\n\}/.exec(src)
ok('源码里存在 TEXTURE_FORMATS 表', !!m)
const table = {}
if (m) {
  for (const line of m[1].split('\n')) {
    const mm = /^\s*(\d+)\s*:\s*'([^']+)'/.exec(line)
    if (mm) table[Number(mm[1])] = mm[2]
  }
}
ok('TEXTURE_FORMATS 至少 19 条（官方枚举数）', Object.keys(table).length >= 19, 'n=' + Object.keys(table).length)

// 例外：我方枚举 0 的历史名字是 ARGB8888，官方 FromString 的字符串是 rgba8888
// ⇒ 两者**名字不同**；官方该枚举的 GL 调用是 (GL_RGBA, GL_RGBA, GL_UNSIGNED_BYTE)
// ⇒ 2026-10-11 **已核**：官方该枚举的 GL 调用是 (GL_RGBA, GL_RGBA, GL_UNSIGNED_BYTE)（见证据文档 §8.2 的 0 号块），
//    与我方 fromARGB8888 的注释一致 ——“WE 的 ARGB8888 实际存储为 RGBA 字节序”（原样拷贝字节）⇒ **无字节序 bug** ✓，
//    且这是**从官方 .so 侧得到的独立验证** ✓。此处只断言“枚举号存在”，名字差异仅为历史命名。
const NAME_EXCEPTIONS = { 0: /argb8888|rgba8888/i }
for (const [k, name] of Object.entries(OFFICIAL)) {
  if (NAME_EXCEPTIONS[k]) { ok(`枚举 ${k} 存在（名字例外：我方=${JSON.stringify(table[Number(k)])}，官方=${name}）`, !!table[Number(k)]); continue }
  const v = table[Number(k)]
  ok(`枚举 ${k} 的名字与官方一致（不分大小写）：期望含 "${name}"`,
    !!v && v.toLowerCase().replace(/[^a-z0-9]/g, '').includes(name.toLowerCase().replace(/[^a-z0-9]/g, '')),
    'actual=' + JSON.stringify(v))
}

// ② 报错带名字：默认分支必须用 TEXTURE_FORMATS 取名（而不是只输出数字）
ok('未知枚举号的报错带名字（默认分支引用 TEXTURE_FORMATS）',
  /default:\s*throw new Error\([^)]*TEXTURE_FORMATS\[format\]/.test(src))
ok('格式 5 的语义注记仍在（DXT5 半分辨率，官方枚举表里无字符串名）', /5:\s*'DXT5/.test(src))

// 证据文档在位（防"结论无出处"）
ok('官方证据文档在位（docs/reports/OFFICIAL-TEXTURE-FORMAT-TABLE.md）',
  (() => { const c = [path.resolve(ROOT, '..', 'docs', 'reports', 'OFFICIAL-TEXTURE-FORMAT-TABLE.md'),
                            path.resolve(ROOT, '..', '..', 'docs', 'reports', 'OFFICIAL-TEXTURE-FORMAT-TABLE.md')]
             return c.some((f) => fs.existsSync(f)) })())  // 证据文档是**工作区级**资源（不在仓库内）⇒ 按脚本位置推算，禁止硬编码绝对路径

const fail = rows.filter((r) => !r.pass)
for (const r of rows) if (!r.pass) console.log('  FAIL ' + r.why + (r.detail ? ' — ' + r.detail : ''))
console.log(`===== texture-format-official-vocab: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)
