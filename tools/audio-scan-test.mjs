// tools/audio-scan-test.mjs —— 音轨枚举回归门禁（唯一依据：docs/AUDIO-TRACK-SPEC.md）
//
// 用户第 1 条反馈「扫描音频的速度能否快些」的验收 + 2026-09-16 洁净室重写的规格断言。
// 层级（缺语料时只打印 SKIP，不假装通过）：
//   T1 规格 §1 后缀判定表（8 个后缀 / 大小写 / 无点 / 表外 / 原型键）
//   T2 规格 §2 路径规范化（反斜杠、开头 ./ 只剥一层）
//   T3 规格 §3 容器判定表 R1–R7（含 §3.3 短头、§3.4 ADTS 先于 MPEG 同步、§3.5 异常吞掉）
//   T4 规格 §4 收集与去重（条目 ∪ scene.json；同路径合并；refs 顺序/去重；缺失引用 size=0）
//   T5 规格 §5 读取约束（只读候选头、每条一次、≤16 字节、整条只读 scene.json、LZ4 取原始长度）
//   T6 规格 §6 返回结构与缓存（字段名与顺序、source、cacheHit、mtime 失效）
//   T7 边界（无音轨 / 多音轨 / 同名不同目录 / 损坏头 / 短条目 / 大写后缀）
//   T8 真包（11 个 scene.pkg）与**规格慢速参考实现**逐项一致
//
// **独立性声明**：本文件不读取、不切片、不执行渲染器仓库（we-scene-demo/**）的任何文件，
//   也不 import 渲染器的函数；所有期望值都来自 docs/AUDIO-TRACK-SPEC.md 的表格字面量
//   （洁净室处置记录见 THIRD-PARTY.md）。
// 复现: node tools/audio-scan-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePkg, readPkgEntry, scanSceneAudio, enumerateAudioTracks, isAudioPath, suffixAudioMime, sniffAudioMime,
  AUDIO_SUFFIX_MIME, AUDIO_CONTAINER_RULES,
  clearPkgAudioIndexCache, pkgAudioIndexStats,
} from '../lib/pkg-extract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
let pass = 0, fail = 0, skip = 0;
// 断言：cond 为假必须计 fail（旧版本这里写成"永远 pass"，ADTS 那条断言实际是假却显示 ✓）。
const ok = (n, cond, d) => {
  if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) }
  else { fail++; console.error('  ✗ ' + n + (d ? '  → ' + d : '')) }
};
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? '  → ' + d : '')) };
const sk = (n) => { skip++; console.log('  ⊘ SKIP ' + n) };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytesOf = (s) => Buffer.from(s, 'latin1');
const HEX = (u8) => Buffer.from(u8).toString('hex');

/* ═══════════ 夹具：现造 PKG 容器 ═══════════ */

/** 最小 LZ4 块链压缩器：一个 sequence = 16 字面量 + 一个 offset=16 的长 match。
 *  产出的 stored 远小于 original（才能被 probeCompressedEntry 认成 lz4）。
 *  LZ4 一个 sequence 只有**一个 token**（高 4 位字面量长、低 4 位 match 长；
 *  字面量 16 > 15 ⇒ 高 4 位写 15 再补一个扩展字节 16-15=1）。 */
function lz4Chain(original) {
  const lit = Buffer.from(original.subarray(0, 16));
  const matchLen = original.length - 16;
  const m = matchLen - 4;
  const parts = [Buffer.from([0xf0 | (m >= 15 ? 15 : m)]), Buffer.from([16 - 15]), lit, Buffer.from([16, 0])];
  if (m >= 15) {
    let rest = m - 15; const ext = [];
    while (rest >= 255) { ext.push(255); rest -= 255; }
    ext.push(rest); parts.push(Buffer.from(ext));
  }
  const comp = Buffer.concat(parts);
  const stored = Buffer.alloc(16 + comp.length);
  stored.writeUInt32LE(original.length, 0); stored.writeUInt32LE(0, 4);      // u64 原始长度
  stored.writeInt32LE(original.length, 8); stored.writeInt32LE(comp.length, 12); // [uncomp][comp]
  comp.copy(stored, 16);
  return stored;
}

function buildPkg(entries, opts = {}) {
  const magic = opts.magic || 'PKGV0022';
  const parts = []; let off = 0;
  const table = [];
  for (const e of entries) {
    const stored = e.lz4 ? lz4Chain(e.data) : Buffer.from(e.data);
    table.push({ name: e.name, offset: off, size: stored.length });
    parts.push(stored); off += stored.length;
  }
  const names = table.map((t) => { const n = Buffer.from(t.name, 'utf8'); const b = Buffer.alloc(4); b.writeUInt32LE(n.length, 0); return Buffer.concat([b, n]); });
  const head = Buffer.alloc(4 + magic.length + 4);
  head.writeUInt32LE(magic.length, 0); Buffer.from(magic).copy(head, 4);
  head.writeUInt32LE(table.length, 4 + magic.length);
  const idx = table.map((t, i) => { const b = Buffer.alloc(8); b.writeUInt32LE(t.offset, 0); b.writeUInt32LE(t.size, 4); return Buffer.concat([names[i], b]); });
  return { buf: Buffer.concat([head, ...idx, ...parts]), dataStart: head.length + idx.reduce((a, b) => a + b.length, 0) };
}

/* ═══════════ T8 用：规格的慢速参考实现（本文件局部） ═══════════
 * 故意用最笨的读法（整包读满 + 每条候选整条读），并**只**按规格表格的字面量写；
 * 不用 lib 的内部辅助函数 —— 用来证明"只读目录表 + ≤16 字节头"的快路径没有偷改结论。
 * 与本文件 T1/T3 的表是同一份规格字面量的第二种写法（测试内自证一致性）。 */
const SPEC_SUFFIX_FALLBACK = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/mp4' };
function specSuffix(p) {
  const i = String(p).lastIndexOf('.');
  return i < 0 ? '' : (SPEC_SUFFIX_FALLBACK[String(p).slice(i + 1).toLowerCase()] || '');
}
function specSniff(b) {
  if (!b || b.length < 2) return '';
  const ascii = (at, s) => { if (b.length < at + s.length) return false; for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false; return true };
  if (ascii(4, 'ftyp')) return 'audio/mp4';                                     // R1
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';                  // R2
  if (ascii(0, 'OggS')) return 'audio/ogg';                                      // R3
  if (ascii(0, 'fLaC')) return 'audio/flac';                                     // R4
  if (ascii(0, 'ID3')) return 'audio/mpeg';                                      // R5
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'audio/aac';               // R6（先于 R7）
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';              // R7
  return '';
}
/** 慢路径：整包读满 → 全量目录 → 每条候选整条读（或按 §5.5 回落后缀）。 */
function specTracksFullRead(pkgPath) {
  const buf = new Uint8Array(fs.readFileSync(pkgPath));
  const entries = parsePkg(buf);
  const sceneJson = (() => {
    const e = entries.find((x) => /(^|\/)scene\.json$/i.test(x.path));
    if (!e) return null;
    try { return JSON.parse(Buffer.from(readPkgEntry(buf, e)).toString('utf8')) } catch { return null }
  })();
  const records = new Map();
  const note = (raw, layer, size) => {
    let p = String(raw == null ? '' : raw).replace(/\\/g, '/');
    if (p.startsWith('./')) p = p.slice(2);
    if (!p || !specSuffix(p)) return;
    let r = records.get(p);
    if (!r) { r = { path: p, size: 0, entry: null, refs: [] }; records.set(p, r) }
    if (typeof size === 'number' && size > 0) r.size = size;
    if (layer && r.refs.indexOf(layer) < 0) r.refs.push(layer);
  };
  for (const e of entries) {
    let key = String(e.path || '').replace(/\\/g, '/');
    if (key.startsWith('./')) key = key.slice(2);
    note(e.path, null, e.size);
    const r = records.get(key);
    if (r && !r.entry) r.entry = e;      // 规格 §4.3：同路径只有第一条参与读头
  }
  const visit = (list) => {
    for (const o of list || []) {
      if (!o || typeof o !== 'object') continue;
      const raw = (o.name !== undefined && o.name !== null && o.name !== '') ? o.name : o.id;
      const layer = (raw === undefined || raw === null) ? '' : String(raw);
      if (o.sound !== undefined && o.sound !== null) for (const f of (Array.isArray(o.sound) ? o.sound : [o.sound])) if (typeof f === 'string') note(f, layer, 0);
      if (o.objects) visit(o.objects);
    }
  };
  try { visit(sceneJson && sceneJson.objects) } catch { /* 规格 §4.4 */ }
  const out = [];
  for (const r of records.values()) {
    let mime = '';
    if (r.entry) {
      const e = r.entry;
      if (e.flags & 1) mime = '';                                  // 规格 §5.5：压缩条目回落后缀
      else {
        const head = buf.subarray(e.offset, Math.min(e.offset + 16, e.offset + e.compressedSize));
        mime = specSniff(head);
      }
    }
    out.push({ path: r.path, size: r.size, mime: mime || specSuffix(r.path), refs: r.refs.slice() });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { tracks: out, bytesRead: buf.length, entries: entries.length };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-audio-'));
try {
  /* ── 夹具数据：8 类头 + 故意说谎的扩展名 + 损坏头 + 短条目 + 大写后缀 + 重复路径 ── */
  const ogg = Buffer.alloc(4096); ogg.write('OggS', 0); for (let i = 4; i < ogg.length; i++) ogg[i] = 0x40 + (i % 32);
  const flac = Buffer.alloc(2048); flac.write('fLaC', 0); flac[4] = 0x80;
  const id3 = Buffer.alloc(3000); id3.write('ID3\x03\x00', 0); for (let i = 5; i < id3.length; i++) id3[i] = (i * 7) & 0xff;
  const id3dup = Buffer.alloc(2600); id3dup.write('ID3\x04\x00', 0);            // 同路径第二条：size 更小、头仍是 ID3
  const wavWrong = Buffer.alloc(2600); wavWrong.write('ID3\x04\x00', 0);        // 后缀 .wav，内容 MP3
  const mp3Wrong = Buffer.alloc(2600); mp3Wrong.write('fLaC', 0);               // 后缀 .mp3，内容 FLAC
  const m4a = Buffer.alloc(1800); m4a.write('....ftypM4A ', 0, 'latin1');
  const adts = Buffer.alloc(1500); adts[0] = 0xff; adts[1] = 0xf1; adts[2] = 0x50;
  const flacUpper = Buffer.alloc(1200); flacUpper.write('fLaC', 0); flacUpper[4] = 0x80;
  const brokenHead = Buffer.alloc(512); for (let i = 0; i < brokenHead.length; i++) brokenHead[i] = 0x00 + (i % 7);  // 非任何魔数
  const tiny = Buffer.from([0x01, 0x02, 0x03]);                                  // 短于 16 字节的条目
  const fillerTex = Buffer.alloc(300 * 1024, 7);                                 // 大条目：把后面的条目挤出 64KB 头
  const lz4ogg = Buffer.alloc(64 * 1024); lz4ogg.write('OggS', 0); for (let i = 4; i < lz4ogg.length; i++) lz4ogg[i] = 0x5a;
  const sceneJson = Buffer.from(JSON.stringify({
    version: 1,
    objects: [
      { name: 'bgm-main', sound: ['sounds/a.mp3'], id: 1 },
      { name: 'bgm-loop', sound: ['sounds/b.flac', 'sounds/notaudio.txt'], id: 2, objects: [{ name: 'nested', sound: 'sounds/c.ogg' }] },
      { name: 'orphan', sound: ['sounds/ghost.mp3'], id: 3 },
      { id: 4, sound: ['./sounds/a.mp3'] },                    // 无 name → 层名用 id；同路径重复引用
      { name: 'bgm-main', sound: ['sounds\\a.mp3'] },          // 同层名 + 反斜杠写法 → refs 去重
      { name: '', id: 5, sound: ['sounds/empty-name.mp3'] },   // name 空串 = 没有 name → 用 id
      { sound: ['sounds/no-layer.mp3'] },                      // 无 name/id → 不记 refs
    ],
  }), 'utf8');
  const entries = [
    { name: 'scene.json', data: sceneJson },
    { name: 'textures/big.tex', data: fillerTex },
    { name: 'sounds/a.mp3', data: id3 },
    { name: 'sounds/b.flac', data: flac },
    { name: 'sounds/c.ogg', data: ogg },
    { name: 'sounds/d.wav', data: wavWrong },
    { name: 'sounds/e.mp3', data: mp3Wrong },
    { name: 'sounds/f.m4a', data: m4a },
    { name: 'sounds/g.aac', data: adts },
    { name: 'sounds/h.opus', data: ogg },
    { name: 'sounds/broken.flac', data: brokenHead },
    { name: 'sounds/tiny.mp3', data: tiny },
    { name: 'sounds/UPPER.MP3', data: id3 },
    { name: 'sounds/lz4.ogg', data: lz4ogg, lz4: true },
    { name: 'music/a.mp3', data: flacUpper },                                      // 同名不同目录
    { name: './sounds/a.mp3', data: id3dup },                                      // 重复路径（规范化后同一键）
    { name: 'sounds/notaudio.txt', data: Buffer.from('not audio at all') },
  ];
  const built = buildPkg(entries);
  const pkgPath = path.join(tmp, 'scene.pkg');
  fs.writeFileSync(pkgPath, built.buf);
  const fileSize = built.buf.length;
  const AEXT_PATHS = entries.map((e) => e.name).filter((n) => specSuffix(n));
  const DISTINCT_AUDIO_ENTRY_PATHS = [...new Set(AEXT_PATHS.map((n) => (n.startsWith('./') ? n.slice(2) : n)))];

  console.log('== A 自造夹具（' + fileSize + ' 字节 / ' + entries.length + ' 条目 / ' + DISTINCT_AUDIO_ENTRY_PATHS.length + ' 条不同音频路径）==');
  clearPkgAudioIndexCache();
  const fast = scanSceneAudio(pkgPath);
  console.log('  快路径读 ' + fast.bytesRead + ' 字节（目录表头 ' + fast.tableBytes + ' + 候选头 ×' + fast.headReads + '）；整包 ' + fileSize + ' 字节');

  console.log('\n== T1 规格 §1 后缀判定表 ==');
  {
    const cases = [
      ['sounds/a.mp3', true, 'audio/mpeg'], ['sounds/a.MP3', true, 'audio/mpeg'], ['sounds/a.ogg', true, 'audio/ogg'],
      ['sounds/a.oga', true, 'audio/ogg'], ['sounds/a.opus', true, 'audio/ogg'], ['sounds/a.wav', true, 'audio/wav'],
      ['sounds/a.flac', true, 'audio/flac'], ['sounds/a.m4a', true, 'audio/mp4'], ['sounds/a.aac', true, 'audio/mp4'],
      ['sounds/a.txt', false, ''], ['sounds/a.mp4', false, ''], ['sounds/a.tex', false, ''],
      ['sounds/mp3', false, ''], ['sounds/a.', false, ''], ['', false, ''],
      ['a.constructor', false, ''], ['a.__proto__', false, ''], ['a.toString', false, ''],
    ];
    let allOk = true;
    for (const [p, wantAudio, wantMime] of cases) {
      const gotAudio = isAudioPath(p), gotMime = suffixAudioMime(p);
      if (gotAudio !== wantAudio || gotMime !== wantMime) { allOk = false; bad('后缀判定 ' + JSON.stringify(p), 'isAudio=' + gotAudio + '/' + wantAudio + ' mime=' + JSON.stringify(gotMime) + '/' + JSON.stringify(wantMime)) }
    }
    ok('18 条后缀用例（含大写/无点/表外/原型键）', allOk);
    ok('表内 8 个后缀都有非空兜底 MIME', ['mp3', 'ogg', 'oga', 'opus', 'wav', 'flac', 'm4a', 'aac'].every((s) => suffixAudioMime('x.' + s)));
  }

  console.log('\n== T2 规格 §2 路径规范化（反斜杠 / 开头 ./）==');
  {
    const t = enumerateAudioTracks({ entries: [{ path: 'sounds\\b.mp3', size: 20 }, { path: './c.mp3', size: 30 }, { path: '././d.mp3', size: 40 }], readHead: () => null, readEntry: () => null, withRefs: false }).tracks;
    ok('反斜杠 → 正斜杠', t.some((x) => x.path === 'sounds/b.mp3'));
    ok('开头 ./ 去掉一层', t.some((x) => x.path === 'c.mp3'));
    ok('././d.mp3 只剥一层 → ./d.mp3', t.some((x) => x.path === './d.mp3'), t.map((x) => x.path).join(','));
  }

  console.log('\n== T3 规格 §3 容器判定表 R1–R7 ==');
  {
    const pad = (head, n = 16) => Buffer.concat([Buffer.from(head, 'latin1'), Buffer.alloc(Math.max(0, n - head.length))]);
    const cases = [
      ['R1 ftyp@4', pad('\x00\x00\x00\x20ftypM4A '), 'audio/mp4'],
      ['R2 RIFF/WAVE', pad('RIFF\x00\x00\x00\x00WAVE'), 'audio/wav'],
      ['R3 OggS', pad('OggS\x00\x02'), 'audio/ogg'],
      ['R4 fLaC', pad('fLaC\x00\x00\x00\x22'), 'audio/flac'],
      ['R5 ID3', pad('ID3\x04\x00\x00\x00'), 'audio/mpeg'],
      ['R6 ADTS 0xFFF1', Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'audio/aac'],
      ['R6 ADTS 0xFFF9', Buffer.from([0xff, 0xf9, 0x4c, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'audio/aac'],
      ['R7 MPEG 0xFFFB', Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'audio/mpeg'],
      ['R7 MPEG 0xFFE0', Buffer.from([0xff, 0xe0, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'audio/mpeg'],
      ['非容器（0x00 起）', Buffer.alloc(16), ''],
      ['RIFF 但非 WAVE', pad('RIFF\x00\x00\x00\x00AVI '), ''],
      ['ftyp 越界（4 字节头）', Buffer.from([0x00, 0x00, 0x00, 0x20]), ''],
      ['短头 2 字节 0xFFFB（§3.3 不得整体放弃）', Buffer.from([0xff, 0xfb]), 'audio/mpeg'],
      ['短头 1 字节（不足 2 字节）', Buffer.from([0xff]), ''],
      ['长度不足时 R6 仍可命中', Buffer.from([0xff, 0xf1]), 'audio/aac'],
    ];
    let allOk = true;
    for (const [name, head, want] of cases) {
      const got = sniffAudioMime(new Uint8Array(head));
      if (got !== want) { allOk = false; bad('容器判定 ' + name, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want) + ' hex=' + HEX(head)) }
    }
    ok('15 条容器用例（含 §3.3 短头 / §3.4 ADTS 先于 MPEG）', allOk);
    ok('§3.4 ADTS 0xFFF1 归 audio/aac（不是 audio/mpeg）', sniffAudioMime(Uint8Array.from([0xff, 0xf1])) === 'audio/aac');
    ok('§3.5 传入 null/undefined/数字不抛异常', (() => { try { return sniffAudioMime(null) === '' && sniffAudioMime(undefined) === '' && sniffAudioMime(3) === '' } catch { return false } })());
    ok('后缀表 = 规格 §1.2 的 8 项（且无多余项）', AUDIO_SUFFIX_MIME.size === 8 && ['mp3', 'ogg', 'oga', 'opus', 'wav', 'flac', 'm4a', 'aac'].every((s) => AUDIO_SUFFIX_MIME.has(s)));
    ok('§3.2 容器规则表顺序 = R1…R7（ADTS 在 MPEG 同步之前）',
      AUDIO_CONTAINER_RULES.map((r) => r.mime).join(',') === 'audio/mp4,audio/wav,audio/ogg,audio/flac,audio/mpeg,audio/aac,audio/mpeg',
      AUDIO_CONTAINER_RULES.map((r) => r.mime).join(','));
  }

  console.log('\n== T4 规格 §4 收集与去重 ==');
  {
    const byPath = new Map(fast.tracks.map((t) => [t.path, t]));
    ok('清单条数 = 13 条包内 + 3 条 scene 引用缺失 = 16', fast.tracks.length === 16, 'n=' + fast.tracks.length);
    ok('重复路径合并为一条（sounds/a.mp3）', fast.tracks.filter((t) => t.path === 'sounds/a.mp3').length === 1);
    ok('同名不同目录各自独立（sounds/a.mp3 与 music/a.mp3）', byPath.has('sounds/a.mp3') && byPath.has('music/a.mp3'));
    ok('路径升序（码元序）', eq(fast.tracks.map((t) => t.path), fast.tracks.map((t) => t.path).slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))));
    ok('§4.2 size 取最后一次正数（重复条目 3000 → 2600）', byPath.get('sounds/a.mp3').size === 2600, 'size=' + byPath.get('sounds/a.mp3').size);
    ok('§4.2 refs 顺序 + 去重（bgm-main, 4）', eq(byPath.get('sounds/a.mp3').refs, ['bgm-main', '4']), JSON.stringify(byPath.get('sounds/a.mp3').refs));
    ok('嵌套层引用也收（c.ogg ← nested）', eq(byPath.get('sounds/c.ogg').refs, ['nested']));
    ok('name 为空串 → 层名回落 id（empty-name.mp3 ← 5）', eq(byPath.get('sounds/empty-name.mp3').refs, ['5']));
    ok('无 name/id 的 sound 对象不记 refs（no-layer.mp3）', eq(byPath.get('sounds/no-layer.mp3').refs, []));
    ok('§4.5 scene 引用但包内不存在 → size=0（ghost/empty-name/no-layer）', ['ghost', 'empty-name', 'no-layer'].every((k) => (fast.tracks.find((t) => t.path.includes(k)) || {}).size === 0));
    ok('scene 引用的非音频不列（notaudio.txt）', !fast.tracks.some((t) => /notaudio/.test(t.path)));
  }

  console.log('\n== T5 规格 §5 读取约束 ==');
  {
    // 夹具里那 300KB 的"大条目"是故意的（把后面的条目挤出 64KB 头 → 走 partial 路径），
    // 所以这里不能用"占整包百分比"当判据；按规格算预算：目录表头（≤64KB 起步值）
    // + 每条候选 ≤16 字节 + scene.json 整条。
    const headBudget = 64 * 1024 + 16 * DISTINCT_AUDIO_ENTRY_PATHS.length + sceneJson.length;
    ok('读量 ≤ 规格预算（64KB 目录表 + 16×候选 + scene.json）', fast.bytesRead <= headBudget, fast.bytesRead + ' ≤ ' + headBudget);
    ok('读量远小于整包', fast.bytesRead < fileSize, fast.bytesRead + '/' + fileSize);
    const spy = { heads: [], full: [] };
    const core = enumerateAudioTracks({
      entries: parsePkg(new Uint8Array(built.buf)),
      readHead: (e, n) => { spy.heads.push([e.path, n]); const b = built.buf.subarray(e.offset, e.offset + Math.min(n, e.size)); return b; },
      readEntry: (e) => { spy.full.push(e.path); const s = built.buf.subarray(e.offset, e.offset + e.compressedSize); return e.flags & 1 ? readPkgEntry(Buffer.from(s), { path: e.path, offset: 0, compressedSize: s.length, size: e.size, flags: 1 }) : Buffer.from(s); },
    });
    ok('readHead 调用次数 = 有条目头的候选数（非候选 0 次）', spy.heads.length === core.tracks.length - 3, 'heads=' + spy.heads.length + ' tracks=' + core.tracks.length);
    ok('每次只读 ≤16 字节（§5.3）', spy.heads.every(([, n]) => n <= 16));
    ok('同路径重复条目只读第一条（sounds/a.mp3 出现一次）', spy.heads.filter(([p]) => /(^|\/)a\.mp3$/.test(p)).length === 2, 'a.mp3 相关读头 ' + spy.heads.filter(([p]) => /(^|\/)a\.mp3$/.test(p)).map(([p]) => p).join('|'));
    ok('整条读只发生在 scene.json 上（§7.2）', eq(spy.full, ['scene.json']), 'full=' + spy.full.join(','));
    ok('桩清单与快路径逐项一致', eq(core.tracks, fast.tracks));
    ok('§5.5 LZ4：size 取块链原始长度 65536', (fast.tracks.find((t) => /lz4\.ogg$/.test(t.path)) || {}).size === 64 * 1024);
    ok('§5.5 LZ4：MIME 回落后缀（audio/ogg）', (fast.tracks.find((t) => /lz4\.ogg$/.test(t.path)) || {}).mime === 'audio/ogg');
    const partial = scanSceneAudio(pkgPath, { headBytes: 1024, cache: false });
    ok('头只给 1KB（条目全 partial）时同结论', eq(partial.tracks, fast.tracks));
    const fullHead = scanSceneAudio(pkgPath, { headBytes: 64 * 1024 * 1024, cache: false });
    ok('整文件当头（无 partial）时同结论', eq(fullHead.tracks, fast.tracks));
  }

  console.log('\n== T6 规格 §6 返回结构与缓存 ==');
  {
    ok('单条字段名与顺序 = path,size,mime,refs', eq(Object.keys(fast.tracks[0]), ['path', 'size', 'mime', 'refs']));
    ok('source=pkg / indexEntries=条目数', fast.source === 'pkg' && fast.indexEntries === entries.length, fast.source + '/' + fast.indexEntries);
    clearPkgAudioIndexCache();
    const c1 = scanSceneAudio(pkgPath);
    const c2 = scanSceneAudio(pkgPath);
    ok('第一次未命中，第二次命中', c1.cacheHit === false && c2.cacheHit === true);
    ok('命中时读 0 字节 / 0 次头（§6.4）', c2.bytesRead === 0 && c2.headReads === 0);
    ok('命中结果与冷启动逐项一致', eq(c1.tracks, c2.tracks));
    const st1 = pkgAudioIndexStats();
    ok('计数器 hits=' + st1.hits + ' misses=' + st1.misses, st1.hits === 1 && st1.misses === 1);
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(pkgPath, past, past);
    ok('mtime 变化 → 失效重扫', scanSceneAudio(pkgPath).cacheHit === false);
    fs.utimesSync(pkgPath, new Date(), new Date());
    scanSceneAudio(pkgPath);
    ok('切回后仍能命中（键含 mtime）', scanSceneAudio(pkgPath).cacheHit === true);
  }

  console.log('\n== T7 边界（无音轨 / 多音轨 / 同名不同目录 / 损坏头 / 短条目 / 大写后缀）==');
  {
    const byPath = new Map(fast.tracks.map((t) => [t.path, t]));
    ok('多音轨：一次列出 16 条', fast.tracks.length === 16);
    ok('无音轨包 → tracks=[] 且 headReads=0', (() => {
      const sj = Buffer.from(JSON.stringify({ version: 1, objects: [{ name: 'bg', texture: 'x' }] }), 'utf8');
      const b = buildPkg([{ name: 'scene.json', data: sj }, { name: 'textures/a.tex', data: Buffer.alloc(64, 3) }]);
      const p = path.join(tmp, 'silent', 'scene.pkg');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, b.buf);
      clearPkgAudioIndexCache();
      const r = scanSceneAudio(p);
      return r.tracks.length === 0 && r.headReads === 0;
    })());
    ok('损坏头 → 后缀兜底（broken.flac → audio/flac）', byPath.get('sounds/broken.flac').mime === 'audio/flac');
    ok('短条目（3 字节）→ 后缀兜底（tiny.mp3 → audio/mpeg）', byPath.get('sounds/tiny.mp3').mime === 'audio/mpeg' && byPath.get('sounds/tiny.mp3').size === 3);
    ok('大写后缀 UPPER.MP3 也收（audio/mpeg）', byPath.get('sounds/UPPER.MP3').mime === 'audio/mpeg');
    ok('扩展名说谎：.wav 实为 MP3 → audio/mpeg', byPath.get('sounds/d.wav').mime === 'audio/mpeg');
    ok('扩展名说谎：.mp3 实为 FLAC → audio/flac', byPath.get('sounds/e.mp3').mime === 'audio/flac');
    ok('ftyp → audio/mp4', byPath.get('sounds/f.m4a').mime === 'audio/mp4');
    ok('ADTS 0xFFF1 → audio/aac（规格 §3.4）', byPath.get('sounds/g.aac').mime === 'audio/aac', byPath.get('sounds/g.aac').mime);
    ok('OggS 容器 → audio/ogg（.opus 也是）', byPath.get('sounds/h.opus').mime === 'audio/ogg' && byPath.get('sounds/c.ogg').mime === 'audio/ogg');
    ok('ID3 → audio/mpeg', byPath.get('sounds/a.mp3').mime === 'audio/mpeg');
    ok('fLaC → audio/flac（.flac 与 music/a.mp3 都按字节）', byPath.get('sounds/b.flac').mime === 'audio/flac' && byPath.get('music/a.mp3').mime === 'audio/flac');

    const loose = path.join(tmp, 'loose');
    fs.mkdirSync(path.join(loose, 'sounds'), { recursive: true });
    fs.writeFileSync(path.join(loose, 'scene.json'), sceneJson);
    fs.writeFileSync(path.join(loose, 'sounds', 'a.mp3'), id3);
    fs.writeFileSync(path.join(loose, 'sounds', 'c.ogg'), ogg);
    fs.writeFileSync(path.join(loose, 'sounds', 'nope.txt'), 'x');
    const dirOut = scanSceneAudio(loose);
    ok('松散目录：source=dir / cacheHit=false / bytesRead=0', dirOut.source === 'dir' && dirOut.cacheHit === false && dirOut.bytesRead === 0);
    // 共用同一份 scene.json ⇒ 目录里 2 条实体 + 4 条"scene 引用了但目录里没有"（size=0）
    ok('松散目录列出 6 条（2 实体 + 4 缺失引用；nope.txt 不算）', dirOut.tracks.length === 6, dirOut.tracks.map((t) => t.path).join(','));
    ok('缺失引用 size=0 / 实体 size>0', dirOut.tracks.filter((t) => t.size === 0).length === 4 && dirOut.tracks.filter((t) => t.size > 0).length === 2);
    ok('松散目录每条字段齐备（mime 非空 / refs 数组）', dirOut.tracks.every((t) => typeof t.mime === 'string' && t.mime && Array.isArray(t.refs)));
    ok('松散目录 refs 与包内一致（a.mp3 ← bgm-main,4）', eq((dirOut.tracks.find((t) => t.path === 'sounds/a.mp3') || {}).refs, ['bgm-main', '4']));

    // 干净夹具：只有一条 scene 引用 + 两个实体文件 → 恰好 2 条
    const loose2 = path.join(tmp, 'loose2');
    fs.mkdirSync(path.join(loose2, 'sounds'), { recursive: true });
    fs.writeFileSync(path.join(loose2, 'scene.json'), Buffer.from(JSON.stringify({ version: 1, objects: [{ name: 'bgm', sound: ['sounds/a.mp3'] }] }), 'utf8'));
    fs.writeFileSync(path.join(loose2, 'sounds', 'a.mp3'), id3);
    fs.writeFileSync(path.join(loose2, 'sounds', 'c.ogg'), ogg);
    fs.writeFileSync(path.join(loose2, 'sounds', 'nope.txt'), 'x');
    const dirOut2 = scanSceneAudio(loose2);
    ok('松散目录（无缺失引用）恰好 2 条且按 path 升序', dirOut2.tracks.length === 2 && eq(dirOut2.tracks.map((t) => t.path), ['sounds/a.mp3', 'sounds/c.ogg']), dirOut2.tracks.map((t) => t.path + ':' + t.mime).join(','));
  }

  console.log('\n== T8 真包 + 规格慢速参考实现（逐项一致）==');
  const corpusRoots = [process.env.MPW_SCENE_ROOT,
    '/root/Desktop/DSHarea/allwallpaper/dd',
    path.join(ROOT, 'samples', 'wallpapers')].filter(Boolean);
  const corpus = corpusRoots.find((d) => { try { return fs.existsSync(d) && fs.statSync(d).isDirectory() } catch { return false } });
  if (!corpus) sk('真包语料（设 MPW_SCENE_ROOT 或放 allwallpaper/dd）');
  else {
    const pkgs = fs.readdirSync(corpus).map((d) => path.join(corpus, d, 'scene.pkg')).filter((p) => fs.existsSync(p));
    console.log('  语料 ' + corpus + '：' + pkgs.length + ' 个 scene.pkg');
    let sameAll = true, withAudio = 0, totalTracks = 0;
    for (const p of pkgs.sort()) {
      clearPkgAudioIndexCache();
      const mine = scanSceneAudio(p);
      const ref = specTracksFullRead(p);
      const id = path.basename(path.dirname(p));
      if (mine.tracks.length) withAudio++;
      totalTracks += mine.tracks.length;
      const same = eq(ref.tracks, mine.tracks);
      if (!same) { sameAll = false; bad(id + ' 与规格慢速参考不一致', '参考=' + JSON.stringify(ref.tracks) + ' 快路径=' + JSON.stringify(mine.tracks)) }
      else console.log('  ✓ ' + id.padEnd(11) + ' n=' + String(mine.tracks.length).padEnd(2) + ' 快路径读 ' + String(mine.bytesRead).padStart(8) + ' / 整包 ' + String(ref.bytesRead).padStart(9) + ' 字节' + (mine.tracks.length ? '  ' + mine.tracks.map((t) => t.path.split('/').pop().slice(0, 26) + '(' + t.size + ',' + t.mime + ')').join(' ') : ''));
    }
    ok('全部真包与规格慢速参考逐项一致（' + pkgs.length + ' 个包 / ' + withAudio + ' 个有音轨 / ' + totalTracks + ' 条）', sameAll);
    const lazy = pkgs.map((p) => { clearPkgAudioIndexCache(); const r = scanSceneAudio(p); return { p, r, size: fs.statSync(p).size } });
    ok('真包全部命中惰性路径（读字节 < 整包的 3%）', lazy.every(({ r, size }) => r.bytesRead < size * 0.03),
      lazy.map(({ p, r, size }) => path.basename(path.dirname(p)) + ' ' + (100 * r.bytesRead / size).toFixed(2) + '%').join(' '));
    ok('除目录表外只多读 scene.json（< 1MB）', lazy.every(({ r }) => r.bytesRead - r.tableBytes - 16 * r.indexEntries < 1024 * 1024),
      lazy.map(({ r }) => r.bytesRead - r.tableBytes - 16 * r.indexEntries).join(','));
  }
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 忽略 */ }
}

console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过') + '  （pass=' + pass + ' fail=' + fail + ' skip=' + skip + '）');
process.exit(fail ? 1 : 0);
