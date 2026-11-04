// upload-policy.mjs —— **上传/导入文件的统一安全策略**（用户第 34 条：限制导入的文件类型）
//
// 为什么单独一个纯模块（而不是散在路由里）：
//   · 同一条策略要被**两处**用：测试台服务端（`/api/props-file`）与（后续）插件仓的同名路由；
//     散写两份必然漂移，而"能不能收这个文件"是**安全判据**，漂移等于留洞。
//   · 纯函数 ⇒ 可单测、可跨平台（不许出现本机路径/平台专有分支）、零依赖。
//
// 判据（三条一起成立才收）：
//   ① **文件名**是单个路径段（拒 `/`、`\`、`..`、控制字符、超长）——防目录穿越；
//   ② **扩展名**在白名单里，且**实际内容（magic/结构）与扩展名类别一致** —— 防"改个后缀就绕过"；
//   ③ 内容里**不含可执行/脚本特征**（PE `MZ`、ELF、`#!`、`<script`、`<?php`、HTML/JS 主动内容…）——
//      防"图片后缀的脚本"。
// 另外：**文本类**（json/txt/md/csv/ini/yaml…）只收"合法 UTF-8 且无 NUL/控制字符"的内容，
// 且大小上限单独更严（文本属性不该是几十 MB）。
//
// ⚠ 不认识的内容一律**拒**（deny-by-default）；报错信息里给"为什么拒 + 允许什么"，不做静默截断。

/** 默认上限：与 :8902 的 `LIMITS.propsFileBytes` 同值（64MB）。 */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
/** 文本类上限：属性里的文本/JSON 不该有几十 MB（防"用文本塞二进制"）。 */
export const MAX_TEXT_BYTES = 4 * 1024 * 1024;
/** 文件名长度上限（含扩展名）。 */
export const MAX_NAME_CHARS = 128;

/** 类别 → 允许的扩展名（**小写、含点**）。 */
export const ALLOWED_EXT = Object.freeze({
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif'],
  audio: ['.mp3', '.ogg', '.oga', '.opus', '.wav', '.flac', '.m4a', '.aac'],
  video: ['.mp4', '.webm', '.ogv', '.mov', '.m4v'],
  font: ['.ttf', '.otf', '.woff', '.woff2'],
  model: ['.mdl', '.mdls', '.json'],
  text: ['.txt', '.md', '.csv', '.ini', '.yaml', '.yml', '.log'],
});
/** 明确**拒**的扩展名（即使内容是文本也别收：它们语义上就是"能跑的东西"）。 */
export const DENIED_EXT = Object.freeze([
  '.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.com', '.msi', '.scr', '.ps1', '.psm1',
  '.sh', '.bash', '.zsh', '.fish', '.py', '.rb', '.pl', '.php', '.jsp', '.asp', '.aspx',
  '.jar', '.class', '.vbs', '.vbe', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.wasm',
  '.html', '.htm', '.xhtml', '.svg', '.xml', '.xsl', '.hta', '.lnk', '.url', '.desktop',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso', '.img', '.apk', '.deb', '.rpm',
]);

const has = (buf, bytes, at = 0) => {
  if (!buf || buf.length < at + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[at + i] !== bytes[i]) return false;
  return true;
};
const ascii = (buf, s, at = 0) => has(buf, Array.from(s, (c) => c.charCodeAt(0)), at);

/** 可执行/脚本类**内容**特征（与扩展名无关，一律拒）。返回命中原因或 null。 */
export function sniffDanger(buf) {
  if (!buf || !buf.length) return null;
  if (has(buf, [0x4d, 0x5a])) return 'PE 可执行（MZ）';                       // Windows exe/dll
  if (has(buf, [0x7f, 0x45, 0x4c, 0x46])) return 'ELF 可执行';               // Linux 可执行
  if (has(buf, [0xca, 0xfe, 0xba, 0xbe])) return 'Mach-O / Java class';      // mac 可执行 / class
  if (has(buf, [0xcf, 0xfa, 0xed, 0xfe])) return 'Mach-O 可执行';
  if (ascii(buf, '#!')) return '脚本 shebang（#!）';
  if (ascii(buf, '<?php') || ascii(buf, '<?=')) return 'PHP 脚本';
  const head = buf.subarray(0, 4096).toString('latin1').toLowerCase();
  if (/<script[\s>]/.test(head)) return '内嵌 <script>';
  if (/<html[\s>]|<iframe[\s>]|javascript:/.test(head)) return 'HTML/JS 主动内容';
  if (/^\s*<\?xml/.test(head) && /<svg[\s>]/.test(head)) return 'SVG（可含脚本）';
  return null;
}

/** 按 magic/结构判**实际类别**；认不出返回 null（= 由调用方按"拒"处理）。 */
export function sniffKind(buf) {
  if (!buf || buf.length < 4) return null;
  if (has(buf, [0x89, 0x50, 0x4e, 0x47])) return 'image';                        // PNG
  if (has(buf, [0xff, 0xd8, 0xff])) return 'image';                              // JPEG
  if (ascii(buf, 'GIF87a') || ascii(buf, 'GIF89a')) return 'image';              // GIF
  if (ascii(buf, 'RIFF') && ascii(buf, 'WEBP', 8)) return 'image';               // WebP
  if (ascii(buf, 'BM')) return 'image';                                          // BMP
  if (ascii(buf, 'ftyp', 4)) {                                                   // ISO-BMFF：按 brand 分
    const brand = buf.subarray(8, 12).toString('latin1').toLowerCase();
    if (/^m4[ab]/.test(brand) || brand === 'mp41') return 'audio';               // M4A/M4B = 音频容器
    return 'video';                                                             // isom/mp42/qt/avc1… = 视频
  }
  if (has(buf, [0x1a, 0x45, 0xdf, 0xa3])) return 'video';                        // Matroska/WebM
  if (ascii(buf, 'OggS')) return 'audio';                                        // Ogg/Opus/Oga
  if (ascii(buf, 'fLaC')) return 'audio';                                        // FLAC
  if (ascii(buf, 'ID3') || has(buf, [0xff, 0xfb]) || has(buf, [0xff, 0xf3]) || has(buf, [0xff, 0xf2])) return 'audio'; // MP3
  if (ascii(buf, 'RIFF') && ascii(buf, 'WAVE', 8)) return 'audio';               // WAV
  if (ascii(buf, 'wOFF')) return 'font';                                         // WOFF
  if (ascii(buf, 'wOF2')) return 'font';                                         // WOFF2
  if (has(buf, [0x00, 0x01, 0x00, 0x00]) || ascii(buf, 'true') || ascii(buf, 'OTTO')) return 'font';  // TTF/OTF
  // 文本类：合法 UTF-8 且没有 NUL/控制字符
  if (!buf.subarray(0, 8192).includes(0)) {
    let s = '';
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, Math.min(buf.length, 64 * 1024))) } catch { s = '' }
    if (s && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) return 'text';
  }
  return null;
}

/** 文件名安全校验（单段、无穿越、无控制字符、长度受限）。返回 `{ok, ext, reason}`。 */
export function checkName(rawName) {
  const name = String(rawName == null ? '' : rawName);
  if (!name) return { ok: false, reason: '文件名缺失（X-Filename 头）' };
  if (name.length > MAX_NAME_CHARS) return { ok: false, reason: `文件名过长（>${MAX_NAME_CHARS} 字符）` };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, reason: '文件名含控制字符' };
  if (/[\\/]/.test(name)) return { ok: false, reason: '文件名含路径分隔符（只收单个文件，不收路径）' };
  if (name === '.' || name === '..' || name.startsWith('.')) return { ok: false, reason: '文件名不许以点开头（含 . / ..）' };
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  if (!m) return { ok: false, reason: '文件名没有扩展名（无法判定类型）' };
  return { ok: true, ext: '.' + m[1].toLowerCase() };
}

/**
 * 统一入口：`checkUpload({ filename, buf, maxBytes })` ⇒ `{ ok, kind, mime, reason }`。
 * `ok:false` 时 `reason` 是**给人读的**拒绝原因（路由层原样回给调用方，4xx）。
 */
export function checkUpload({ filename, buf, maxBytes = MAX_UPLOAD_BYTES } = {}) {
  const n = checkName(filename);
  if (!n.ok) return { ok: false, reason: n.reason };
  const { ext } = n;
  if (DENIED_EXT.includes(ext)) {
    return { ok: false, reason: `该类型一律拒收（${ext}）——属性文件只收图片/音频/视频/字体/文本` };
  }
  const size = buf && buf.length ? buf.length : 0;
  if (!size) return { ok: false, reason: '空文件（body 为空）' };
  const danger = sniffDanger(buf);
  if (danger) return { ok: false, reason: `内容含可执行/脚本特征：${danger}` };
  const magicKind = sniffKind(buf);
  const extKind = Object.keys(ALLOWED_EXT).find((k) => ALLOWED_EXT[k].includes(ext)) || null;
  if (!extKind) {
    const allowAll = Object.values(ALLOWED_EXT).flat().join(' ');
    return { ok: false, reason: `扩展名不在白名单（${ext}）——允许：${allowAll}` };
  }
  // 扩展名与内容必须同类（JSON 例外：`.json` 归 model，也是文本 ⇒ 两边都认）
  const kindOk = magicKind === extKind
    || (magicKind === 'text' && (extKind === 'text' || extKind === 'model'))
    || (extKind === 'model' && magicKind === 'text');
  if (!kindOk) return { ok: false, reason: `内容与扩展名不符（扩展名 ${ext} 属 ${extKind}，实际内容是 ${magicKind || '无法识别'}）` };
  if ((extKind === 'text' || extKind === 'model') && size > MAX_TEXT_BYTES) {
    return { ok: false, reason: `文本类文件过大（${size} > ${MAX_TEXT_BYTES} 字节）` };
  }
  if (size > maxBytes) return { ok: false, reason: `文件过大（${size} > ${maxBytes} 字节）` };
  return { ok: true, kind: extKind, magicKind, mime: mimeForKind(extKind, ext) };
}

/** 按类别/扩展名给 MIME（**不采信**客户端传的 content-type）。 */
export function mimeForKind(kind, ext) {
  const M = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.bmp': 'image/bmp', '.avif': 'image/avif',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav',
    '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  };
  if (M[ext]) return M[ext];
  if (kind === 'text' || kind === 'model') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}
