// WE 渲染引擎 — 资源读取与纹理加载 (browser 版)
// pkg 访问与纹理解码改为浏览器实现:
//   - pkg.read/readJson 由 demo 注入 (来自 core/we-scene-bundle.js parsePkg/getEntry)
//   - .tex 解码复用 core/we-scene-bundle.js 的 parseTex/decodeMip0
//   - JPEG 用引擎自带纯 JS jpeg.js; PNG 用本包的纯 JS inflate 解码
import { parseTex, decodeMip0, FIF } from '../../we-scene-bundle.js';
import { decodePngBuffer } from './canvas.js';
import { decodeJpeg } from './jpeg.js';

// ── 纹理解码 (TEXV 容器 → {width, height, rgba}) ────────────────
export function loadTexImage(raw) {
  try {
    const tex = parseTex(raw);
    const m = decodeMip0(tex);
    if (m.rgba) return { width: m.width, height: m.height, rgba: m.rgba, frames: null };
    if (m.png !== undefined) {
      const img = decodePngBuffer(m.png);
      return { width: img.width, height: img.height, rgba: img.rgba, frames: null };
    }
    if (m.image !== undefined && m.fif === FIF.JPEG) {
      const img = decodeJpeg(m.image);
      return { width: img.width, height: img.height, rgba: img.rgba, frames: null };
    }
    // 视频 / GIF / WEBP / 未知 freeImage 格式 → 无法解码为静态帧
    return null;
  } catch (e) {
    throw e;
  }
}

export function loadPngFile(b) {
  // browser path: b is Uint8Array bytes of a PNG
  return decodePngBuffer(b);
}
