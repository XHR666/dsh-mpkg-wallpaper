// WE 渲染引擎 — puppet (从 core.js 拆分, 逻辑不变)
import { getVal, v3sub, v3cross, v3dot, v3norm } from './math.js';
import { Buffer } from '../buffer.js';
// ①(P-139 2026-09-19) MDLA 采样口径的**唯一实现处**（见下方 `_sampleAnimRT` 的注释）：
//   core 不 import elysia ⇒ 单向依赖，无循环。Node 侧（tests/*.mjs）与浏览器侧同一条路径。
import { sampleAnimRT } from '../../core/attach-transform.mjs';
// ①(P-152 2026-09-19) MDLS 骨骼布局校验的**判据**也在 core（`readMdlsLayoutABones` / `mdlBoneEntryOK` 是
//   唯一实现处；本文件与 `core/attach-transform.mjs::parseMdl` 共用同一份定步读骨逻辑，避免"改一处忘另一处"
//   的第二次分叉 —— 与 P-139 把 `_sampleAnimRT` 收敛到 core 同一条纪律）。
//   本文件是**实际运行**的解析器（`demo.html:3442` 的 `puppetHelper._parseMdl`），故必须同批落校验：
//   否则"防回归"只保护到附件锚点那条路径，蒙皮那条仍会静默吃错位骨。
import { readMdlsLayoutABones } from '../../core/attach-transform.mjs';
// ③(P-173 2026-09-24) **顶点块定位**同样收敛到 core（`findMdlVertexBlock` = 唯一实现处：旧 80 步长启发扫描
//   + `MDLV0016` 紧凑容器变体（顶点步长 52）分支）。为什么必须改本文件：这 5 个 `.mdl` 是**material json 的
//   `puppet` 字段**指向的蒙皮网格（`models/r ear1.json` → `models/r ear1_puppet.mdl` …），`demo.html:4190`
//   走的就是本文件的 `_parseMdl` —— 只改 core 等于"门禁绿、实际渲染路径仍然 null"。
//   属性偏移由 finder 的 `attr` 给出（80 步长 = 0/40/56/72；52 步长 = 0/12/28/44）⇒ 本文件不再各写一套。
import { findMdlVertexBlock, warnMdlV16MeshRefused } from '../../core/attach-transform.mjs';
// ── puppet mixin (从 core.js 拆分, 逻辑零改动) ──
export function installPuppet(proto) {
  Object.assign(proto, {
    renderPuppet(o, model, tr, t) {
        const mdlRaw = this.pkg.read(model.puppet);
        if (!mdlRaw) { this.log('跳过 puppet ' + (o.name || o.id) + ': 无 MDL'); return; }
        // MDL 解析缓存: 多帧渲染避免每帧重新解析 (骨骼/动画段引用原 buffer)
        if (!this._mdlCache) this._mdlCache = new Map();
        let mesh = this._mdlCache.get(model.puppet);
        if (!mesh) {
          mesh = this._parseMdl(mdlRaw);
          if (!mesh) { this.log('跳过 puppet ' + (o.name || o.id) + ': MDL 解析失败'); return; }
          this._mdlCache.set(model.puppet, mesh);
        }
        const tex = this.loadModelTexture(o.image);
        if (!tex) { this.log('跳过 puppet ' + (o.name || o.id) + ': 无纹理'); return; }
        // 骨骼蒙皮 (动画) 或绑定姿态 — 不用 cropoffset: 官方引擎忽略 cropoffset
        // (wallpaper64.exe 无该字符串), MDL raw bbox 对称 (中心=原点)
        // animationlayers 动画选择: 官方按动画层 (visible=true 层) 选动画, 且全部 visible 层
        // 参与合成: 普通层 final=mix(final, anim, blend), additive 层 final+=(anim−bind)×blend。
        // (旧实现只取第一个 visible 层 → 多 visible 层壁纸缺层错位: 眼(眨眼+高光运动)、
        //  上半身(呼吸1+呼吸2)/嘴巴/眼睛、N(7层)/十字架(3层)/nv(8层))
        // 层名匹配 MDLA 动画名; 名字匹配失败 (部分模型 MDLA 名字解析空) 时
        // fallback 按层在 animationlayers 中的索引 → 对应 MDL 动画索引
        let animLayers = null;
        if (mesh.animations && mesh.animations.length > 1 && o.animationlayers && o.animationlayers.length) {
          const layers = o.animationlayers
            .filter((l) => {
              const v = l && l.visible;
              return v === true || (v && typeof v === 'object' && v.value === true);
            })
            .map((l) => {
              const blend = typeof l.blend === 'number' && l.blend >= 0 && l.blend <= 1 ? l.blend : 1;
              const rate = typeof l.rate === 'number' && l.rate > 0 ? l.rate : 1;
              let idx = mesh.animations.findIndex((a) => a.name && l.name && a.name === l.name);
              if (idx < 0 && l.name) {
                // 数字后缀: "动画 N" → MDL 第 N 个动画 (层名带编号、动画本身无名时,
                // 名字不匹配按索引回退会选错动画 → 角色蒙皮飞走)
                const m = String(l.name).match(/(\d+)/);
                if (m) {
                  const n = parseInt(m[1], 10);
                  if (n >= 1 && n <= mesh.animations.length) idx = n - 1;
                }
              }
              if (idx < 0) {
                const layerIdx = o.animationlayers.indexOf(l);
                if (layerIdx >= 0 && layerIdx < mesh.animations.length) idx = layerIdx;
              }
              if (idx < 0) idx = 0;
              return { animIdx: idx, blend, rate, additive: !!l.additive };
            });
          if (layers.length) animLayers = layers;
        }
        let skinned = mesh.positions;
        if (mesh.bones && mesh.bones.length && mesh.animations && mesh.animations.length) {
          skinned = this._skinPuppet(mesh, t, 0, 0, animLayers);
        } else {
          skinned = mesh.positions;
        }
        const rawBounds = this._meshBounds(skinned);
        const W = Math.ceil(rawBounds.maxX - rawBounds.minX) + 1;
        const H = Math.ceil(rawBounds.maxY - rawBounds.minY) + 1;
        const flipY = (y) => rawBounds.maxY - y;
        const img = this._rasterizeMesh(mesh, tex, skinned, rawBounds, W, H, flipY);
        // 定位: puppet 网格顶点是相对对象中心的局部坐标 (lwe CImage.cpp:536 size/2+raw)。
        // 保持原实现 (origin + rawBounds, 用户实测 scale=1 正确), 仅修复 scale≠1
        // 的定位偏移 (sf39d): 官方模型矩阵 scale 同时缩放位置, 网格左/上边界应乘
        // scale — 旧实现 dx = origin + minX 未乘 scale → scale≠1 时整体偏移。
        const orthoP = this.scene.general && this.scene.general.orthogonalprojection;
        const ps = orthoP && orthoP.width ? [this.W / orthoP.width, this.H / (orthoP.height || 1080)] : null;
        const vs = this._viewShift(o, [W, H], ps);
        const dw = W * (ps ? ps[0] : 1) * tr.scale[0], dh = H * (ps ? ps[1] : 1) * tr.scale[1];
        // 网格左边界 (场景坐标) = origin + rawBounds.minX×scale (scale 缩放位置偏移)
        const leftX = tr.origin[0] + tr.scale[0] * rawBounds.minX;
        const topY = tr.origin[1] + tr.scale[1] * rawBounds.maxY;
        const dx = leftX * (ps ? ps[0] : 1) + vs[0];
        const dy = this.H - topY * (ps ? ps[1] : 1) + vs[1];
        // brightness: 官方 CImage 有 brightness (lwe CImage.cpp:952), puppet 是
        // image 子类 — 缺 brightness 导致暗色/过曝 puppet 组件颜色不对 (sf39f)
        this.canvas.blitScaled(img, dx, dy, dw, dh, getVal(o, 'alpha', 1) * getVal(o, 'brightness', 1));
      }
    
      // 骨骼蒙皮: 时间 → 动画帧 → 骨骼世界矩阵 → 顶点 × Σ w × (finalWorld × bindWorld⁻¹)
      // 引擎 model_vertex_v1.h ApplySkinningPosition: pos' = Σ w·(pos × g_Bones[bi])
      // 动画层合成 (官方 animationlayers 语义, 全部 visible 层参与):
      //   普通层: final = mix(final, layerWorld, blend)   (blend=1 → 替换)
      //   additive层: final += (layerWorld − refWorld) × blend, refWorld = 动画帧0世界 = bind 世界
      //   (已验证: 动画帧0 局部姿势链乘后 = bind 世界姿势)
      // 世界空间合成 (非局部空间 lerp): 多 additive 层各层 delta 在各自骨骼上叠加,
      // 丢失任何一层即组件错位 (眼/上半身/嘴/呼吸层等)
,
    _skinPuppet(mesh, t, cxs, cys, layers = null) {
        const bones = mesh.bones;
        if (!layers || !layers.length) layers = [{ animIdx: 0, blend: 1, rate: 1, additive: false }];
        const anim0 = mesh.animations[layers[0].animIdx] || mesh.animations[0];
        if (!anim0) return mesh.positions.map((p) => [p[0] + cxs, p[1] + cys, p[2]]);
        const nb = bones.length;
        // 蒙皮数据兼容性: 权重须 0..1 且索引 < 骨骼数 (部分 MDL 顶点布局不同, 蒙皮数据不可靠
        // → 回退绑定姿态, 避免垃圾权重把顶点炸飞)
        let skinOK = true;
        for (let i = 0; i < mesh.positions.length; i++) {
          for (let k = 0; k < 4; k++) {
            const w = mesh.blendWeights[i][k];
            const bi = mesh.blendIndices[i][k];
            if (w < -0.001 || w > 1.001 || !isFinite(w) || bi >= nb) { skinOK = false; break; }
          }
          if (!skinOK) break;
        }
        if (!skinOK) return mesh.positions.map((p) => [p[0] + cxs, p[1] + cys, p[2]]);
        // 绑定世界矩阵 (MDLS 层级累积, 行主序) + 逆
        const bindWorld = new Array(nb);
        const bindInv = new Array(nb);
        for (let b = 0; b < nb; b++) {
          const parent = bones[b].parent;
          const local = bones[b].bind; // 行主序 4x4 (平移在行3)
          bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? this._matMulRow(bindWorld[parent], local) : local;
        }
        for (let b = 0; b < nb; b++) bindInv[b] = this._matInvertRow(bindWorld[b]);
        // bind 世界 {angle, tx, ty} (additive 参考姿势 = 动画帧0世界 = bind 世界)
        const bindRT = new Array(nb);
        for (let b = 0; b < nb; b++) {
          const m = bindWorld[b];
          bindRT[b] = { angle: Math.atan2(m[1], m[0]), tx: m[12], ty: m[13] };
        }
        // final 世界 = bind, 逐层合成
        const final = bindRT.map((r) => ({ angle: r.angle, tx: r.tx, ty: r.ty }));
        const fps = 30; // 官方骨骼动画 30fps
        // additive 参考姿势缓存: 每动画帧0 世界 (部分模型骨骼帧0≠bind 数十单位,
        // 用 bind 作 ref 会让 additive 在帧0 就有常数偏移 → 角色蒙皮飞走数百单位;
        // 正确 ref = 层动画自己的帧0, 帧0=bind 的模型等价)
        const refCache = new Map();
        const animRef = (anim) => {
          if (!refCache.has(anim)) refCache.set(anim, this._sampleAnimRT(mesh, anim, 0, nb, bones));
          return refCache.get(anim);
        };
        for (const layer of layers) {
          const anim = mesh.animations[layer.animIdx] || mesh.animations[0];
          if (!anim) continue;
          // 帧: 30fps 循环; 层 rate 加速播放 (高光层 rate>1, 呼吸层 rate<1)
          const frame = Math.floor(t * fps * layer.rate) % Math.max(1, anim.frameCount);
          const lw = this._sampleAnimRT(mesh, anim, frame, nb, bones);
          const refRT = animRef(anim);
          for (let b = 0; b < nb; b++) {
            if (layer.additive) {
              // additive: final += (layerWorld − 层帧0)×blend (ref = 层动画帧0 世界)
              const ref = refRT[b];
              let da = lw[b].angle - ref.angle;
              while (da > Math.PI) da -= 2 * Math.PI;
              while (da < -Math.PI) da += 2 * Math.PI;
              final[b].angle += da * layer.blend;
              final[b].tx += (lw[b].tx - ref.tx) * layer.blend;
              final[b].ty += (lw[b].ty - ref.ty) * layer.blend;
            } else {
              // 普通层: final = mix(final, layerWorld, blend)
              let da = lw[b].angle - final[b].angle;
              while (da > Math.PI) da -= 2 * Math.PI;
              while (da < -Math.PI) da += 2 * Math.PI;
              final[b].angle += da * layer.blend;
              final[b].tx += (lw[b].tx - final[b].tx) * layer.blend;
              final[b].ty += (lw[b].ty - final[b].ty) * layer.blend;
            }
          }
        }
        // 蒙皮矩阵: g_Bones[b] = finalWorld[b] × bindInv[b]
        const gBones = new Array(nb);
        for (let b = 0; b < nb; b++) {
          const c = Math.cos(final[b].angle), s = Math.sin(final[b].angle);
          // [Rz | T]: [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1]
          const m = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, final[b].tx, final[b].ty, 0, 1];
          gBones[b] = this._matMulRow(m, bindInv[b]);
        }
        // 顶点蒙皮
        const out = new Array(mesh.positions.length);
        for (let i = 0; i < mesh.positions.length; i++) {
          const p = mesh.positions[i];
          const bi = mesh.blendIndices[i];
          const bw = mesh.blendWeights[i];
          let x = 0, y = 0, z = 0;
          for (let k = 0; k < 4; k++) {
            const w = bw[k];
            if (w === 0) continue;
            const m = gBones[bi[k]] || gBones[0];
            // 行向量右乘: [x,y,z,1] × M
            const px = p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12];
            const py = p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13];
            const pz = p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14];
            x += px * w; y += py * w; z += pz * w;
          }
          out[i] = [x + cxs, y + cys, z];
        }
        return out;
      }
    
      // 采样动画帧 → 每骨骼世界姿势 {angle, tx, ty}
      //
      // ①(P-139 2026-09-19) **不再在本文件实现取样**：本方法是"渲染网格 GPU 蒙皮"（demo.html
      //   `updateSkinBones` 每帧调用）与"附件锚点"（`core/attach-transform.mjs::puppetBoneFinal`）
      //   共用的那一份采样口径 —— 唯一实现处 = `core/attach-transform.mjs::sampleAnimRT`
      //   （内部 = `sampleBoneLocalsRT`（MDLA 逐骨寻址 + 官方 per-bone HasAuthoredTrack 作用域 +
      //   帧号规约不回绕）+ `localWorldChainRT`（`W[b] = L_b × W[parent]` 行主序世界链））。
      //
      //   为什么删掉旧实现（判据在 tests/kaltsit-puppet-anchor-test.mjs A-3）：旧实现用
      //     `posShift = floor(2b/9)`、`frame0 = ((frame + posShift) % totalFrames) * 36`、
      //     `o = segStart + frame0 + (2b%9)*4` —— 把"每骨行移位"折进**帧号**取模，于是
      //     **首帧（f=0）** 就按移位后的帧号读，落到轨头/邻轨垃圾上：实测单帧最大步长
      //     主体(6 骨) **699.4u @f0 bone5（头骨）**、眼睛组合(14 骨) **365.7u @f0 bone13**、
      //     左耳朵1(4 骨) **157.4u @f298 bone3**；换成唯一实现后同一量分别降到
      //     **1.6u / 7.1u / 31.9u**（旧式还是"轨尾回绕"与"作用域缺失"的同一处病灶）。
      //     旧注释里"9 列循环交错 / 段帧循环 (frameCount+1) 帧"的段布局猜测同时作废：
      //     官方布局是"每骨一条独立轨（u32 flags + u32 byteSize + rows×36B）"，
      //     见本文件 `_parseMdl` 的 MDLA 解析与 `core/attach-transform.mjs` 顶部注释。
      //
      //   本文件对 core/ 的依赖是**单向**的（core 不 import elysia），不构成循环。
,
    _sampleAnimRT(mesh, anim, frame, nb, bones) {
        return sampleAnimRT(mesh, anim, frame, nb, bones);
      }
    
      // 行主序 4x4 矩阵乘法 a × b
,
    _matMulRow(a, b) {
        const o = new Array(16);
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            o[r * 4 + c] = a[r * 4 + 0] * b[0 * 4 + c] + a[r * 4 + 1] * b[1 * 4 + c] + a[r * 4 + 2] * b[2 * 4 + c] + a[r * 4 + 3] * b[3 * 4 + c];
          }
        }
        return o;
      }
    
      // 行主序 4x4 仿射逆 (旋转转置 + 平移取反)
,
    _matInvertRow(m) {
        const o = new Array(16);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 4 + c] = m[c * 4 + r];
        o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1;
        o[12] = -(m[12] * o[0] + m[13] * o[4] + m[14] * o[8]);
        o[13] = -(m[12] * o[1] + m[13] * o[5] + m[14] * o[9]);
        o[14] = -(m[12] * o[2] + m[13] * o[6] + m[14] * o[10]);
        return o;
      }
    
,
    _parseMdl(buf, opts) {
        // ①(P-152 2026-09-19) `?mdls=legacy`（判定式 = 本文件模块级 `mdlsLegacy()`，同 `bindOrderLegacy` 形）
        const mdlsLegacyMode = (() => {
          try { return mdlsLegacy((typeof location !== 'undefined' && location && location.search) || ''); }
          catch (e) { return false; }
        })();
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        let mdlsOffset = buf.length;
        for (let off = 9; off + 4 < buf.length; off++) {
          if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
        }
        // ③(P-173 2026-09-24) 顶点块定位 = core 的**唯一实现处**（`findMdlVertexBlock`：旧 80 步长扫描逐字
        //   搬过去 + `MDLV0016` 紧凑变体（步长 52）分支；判据/失败路径见 core 内该函数的注释）。
        //   与 `core/attach-transform.mjs::parseMdl` 共用同一份 ⇒ 不再存在"两个真相"。
        //   ⚠ 与 core 侧**有意保留的不对称**：本函数的返回值里**没有** `mdlDiag`（`debug` 面只有 warn，
        //     见 `tests/mdl-bone-layout-test.mjs` 组 E 的现状登记）；这里只把"被拒原因"打一行同文案 warn。
        const vscan = findMdlVertexBlock(buf, dv, mdlsOffset);
        const found = vscan.block;
        if (!found) {
          if (vscan.diag) warnMdlV16MeshRefused(vscan.diag);
          return null;
        }
        const vertexCount = found.vertexBytes / found.stride;
        const indexCount = found.indexBytes / 2;
        const A = found.attr;   // ③(P-173) 属性偏移由 finder 给出（80 步长与 52 步长不同）
        const positions = [], uvs = [], blendIndices = [], blendWeights = [];
        for (let i = 0; i < vertexCount; i++) {
          const vo = found.verticesOffset + i * found.stride;
          positions.push([dv.getFloat32(vo + A.pos, true), dv.getFloat32(vo + A.pos + 4, true), dv.getFloat32(vo + A.pos + 8, true)]);
          uvs.push([dv.getFloat32(vo + A.uv, true), dv.getFloat32(vo + A.uv + 4, true)]);
          blendIndices.push([dv.getUint32(vo + A.blendIndices, true), dv.getUint32(vo + A.blendIndices + 4, true), dv.getUint32(vo + A.blendIndices + 8, true), dv.getUint32(vo + A.blendIndices + 12, true)]);
          blendWeights.push([dv.getFloat32(vo + A.blendWeights, true), dv.getFloat32(vo + A.blendWeights + 4, true), dv.getFloat32(vo + A.blendWeights + 8, true), dv.getFloat32(vo + A.blendWeights + 12, true)]);
        }
        const indices = [];
        for (let i = 0; i < indexCount; i++) indices.push(dv.getUint16(found.indicesOffset + i * 2, true));
        // 骨骼 (MDLS) + 动画 (MDLA): puppet 蒙皮
        let bones = [], animations = [];
        // ①(P-152 2026-09-19) 与 `core/attach-transform.mjs::parseMdl` **同契约**（判据/失败路径/回退开关
        //   一字不差；定步读骨本身复用 core 的 `readMdlsLayoutABones` —— 唯一实现处）。`opts.mdls === 'legacy'`
        //   或 `mdlsLegacyMode` ⇒ 逐位回到"无校验"旧行为（`?mdls=legacy`，见文件末 `mdlsLegacy()`）。
        const legacyMode = !!((opts && (opts.mdls === 'legacy' || opts.mdlsLegacy === true)) || mdlsLegacyMode);
        let mdlDiag = null;
        if (mdlsOffset < buf.length) {
          try {
            let p = mdlsOffset + 9;
            p += 4; // 段字节
            const boneCount = dv.getUint32(p, true); p += 4;
            if (legacyMode) {
              // ── 旧行为（无任何校验，P-152 之前逐字）──
              for (let b = 0; b < boneCount && p + 12 < buf.length; b++) {
                // 骨骼头变体: 大部分 tmp 为 u8 (9 字节头); 个别骨骼 (带旋转/特殊) tmp 为 u16 (10 字节头)
                // 用 entryLen 合理性 (0 < len <= 4096) 判断; 不合法则按 u16 tmp 重读
                let headExtra = 0;
                let tmp = buf[p];
                let type = dv.getUint32(p + 1, true);
                let parent = dv.getInt32(p + 5, true);
                let len = dv.getUint32(p + 9, true);
                if (len === 0 || len > 4096) {
                  tmp = dv.getUint16(p, true);
                  type = dv.getUint32(p + 2, true);
                  parent = dv.getInt32(p + 6, true);
                  len = dv.getUint32(p + 10, true);
                  headExtra = 1;
                  if (len === 0 || len > 4096) break; // 无法对齐
                }
                p += 9 + headExtra; // tmp + type + parent 之后 (len 字段起点)
                p += 4; // len 字段本身
                const m = new Array(16);
                for (let i = 0; i < 16; i++) m[i] = dv.getFloat32(p + i * 4, true);
                p += len;
                let je = p;
                while (je < buf.length && buf[je] !== 0) je++;
                p = je + 1;
                bones.push({ index: b, type, parent: parent === -1 ? -1 : parent, bind: m });
              }
            } else if (!(boneCount > 0 && boneCount <= 1024)) {
              // ① 声明骨数越界 ⇒ 直接拒绝（不读骨）；② 台账 + 一行 warn（机器可判的失败信号）
              mdlDiag = { declaredBones: boneCount, parsedBones: 0, layout: 'refused', rejected: true, reason: 'declared-bone-count-out-of-range', rejectedBones: 0, entryErrors: [] };
              warnMdlBoneLayout(mdlsOffset, boneCount, mdlDiag);
            } else {
              const r = readMdlsLayoutABones(buf, dv, mdlsOffset, boneCount, null);
              if (r.complete && !r.structErrors && !r.entryErrors.length) {
                bones = r.bones; // 布局 A 整体合法 ⇒ 逐位采用（= 改动前结果）
              } else {
                // 不许静默按 A 解：定步结果**不采用**（绝不返回残缺/错位骨架）
                bones = [];
                mdlDiag = {
                  declaredBones: boneCount, parsedBones: r.bones.length,
                  layout: (r.entryErrors.length || r.structErrors > 0 || r.bones.length !== boneCount) ? 'not-A' : 'refused', rejected: true,
                  reason: r.rejectReason || (r.entryErrors[0] && r.entryErrors[0].reason) || 'unknown',
                  rejectedBones: r.entryErrors.length, entryErrors: r.entryErrors.slice(0, 8),
                };
                warnMdlBoneLayout(mdlsOffset, boneCount, mdlDiag);
              }
            }
          } catch { bones = []; }
          // MDLA 动画
          // ①(N4 2026-09-14 第2项 Girl and cat) 记录游走修正 + fps 解析。
          //   官方头布局（对 3544152633/models/girl_puppet.mdl 原始字节逐字节核对）：
          //     [i32 id][i32 flags][name cstring][loop cstring][u16 pad=0][f32 fps][u16 frameCount]
          //     [u16 0][u32 0][u32 boneCount][u32 0][u32 segBytes][segBytes×boneCount 关键帧][记录尾部]
          //   **关键事实：每条记录的段数据之后还有一段长度不定的尾部**（girl 实测 131 字节：
          //   2×u32 0 + 3×(f32 + 3×1.0f + f32×2 + 3×u32 0)）。旧实现假定"段尾紧接下一记录头"，
          //   只对第 0 条成立 → animations[1..3] 的 id 读成 0、name 读成乱码（文件真实值
          //   id=71/73/94、name="Animation 2/3/4"，头在 132193/174961/259849），于是 demo 的
          //   animId 匹配永远失配，只能靠 P-42 的"数字后缀/层索引"回退猜；`an.fps` 也从未解析
          //   （demo 硬编码 30）。现在改为**结构定位下一条记录头**（严格校验：name/loop 无控制符、
          //   fps 合理、frameCount/u16·u32 零字段/boneCount/segBytes 自洽、骨骼数与 MDLS 一致），
          //   并把记录里的 fps 填进 an.fps。索引/名字回退链在 demo 与 elysia 侧保持不动
          //   （ids 仍缺失的模型继续走回退）。
          const mdla = buf.indexOf('MDLA');
          if (mdla >= 0) {
            const tokenOK = (s, maxLen) => {
              if (!s.length || s.length > maxLen) return false
              for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 0x20 || c === 0x7f) return false }
              return true
            }
            // at 处尝试读一条记录头；strict = fps ∈ [10,240] 且 boneCount 必须等于 MDLS 骨骼数
            const readHeader = (at, strict) => {
              if (at < 0 || at + 24 > buf.length) return null
              const id = dv.getInt32(at, true)
              const nameStart = at + 8
              const nameEnd = buf.indexOf(0, nameStart)
              if (nameEnd < 0 || nameEnd - nameStart > 128) return null
              const name = buf.toString('utf8', nameStart, nameEnd)
              if (!tokenOK(name, 128)) return null
              const loopStart = nameEnd + 1
              const loopEnd = buf.indexOf(0, loopStart)
              if (loopEnd < 0 || loopEnd - loopStart > 32) return null
              const loop = buf.toString('utf8', loopStart, loopEnd)
              if (!tokenOK(loop, 32)) return null
              // pad u16 + f32 fps（容忍 0~2 字节对齐差）
              let fpsOff = -1
              for (let d = 0; d <= 2; d++) {
                const v = dv.getFloat32(loopEnd + 1 + d, true)
                const lo = strict ? 10 : 0.5
                if (isFinite(v) && v >= lo && v <= 480) { fpsOff = loopEnd + 1 + d; break }
              }
              if (fpsOff < 0) return null
              const fp = fpsOff + 4
              if (fp + 20 > buf.length) return null
              const frameCount = dv.getUint16(fp, true)
              const z1 = dv.getUint16(fp + 2, true)
              const z2 = dv.getUint32(fp + 4, true)
              const boneCount = dv.getUint32(fp + 8, true)
              const z3 = dv.getUint32(fp + 12, true)
              const segBytes = dv.getUint32(fp + 16, true)
              if (!(frameCount >= 2)) return null
              if (z1 !== 0 || z2 !== 0 || z3 !== 0) return null
              if (!(boneCount >= 1 && boneCount <= 1024)) return null
              if (bones.length && (strict ? boneCount !== bones.length : boneCount > bones.length * 4)) return null
              if (!(segBytes >= 36 && segBytes <= (1 << 22))) return null
              const dataStart = fp + 20
              if (dataStart + segBytes * boneCount > buf.length) return null
              return { id, name, loop, fps: dv.getFloat32(fpsOff, true), frameCount, boneCount, segBytes, dataStart }
            }
            // 从 from 向后结构定位下一条记录头（尾部长度不定 → 逐字节试探，先严格后宽松）
            const findHeader = (from) => {
              const to = buf.length - 24
              for (const strict of [true, false]) {
                for (let at = Math.max(0, from); at <= to; at++) {
                  const h = readHeader(at, strict)
                  if (h) return h
                }
              }
              return null
            }
            // 旧实现的顺序游走（只在结构定位完全失败时兜底，保证不回归）
            const parseLegacy = () => {
              const out = []
              let p = mdla + 17
              const n = dv.getUint32(mdla + 13, true)
              for (let a = 0; a < n && p + 12 < buf.length; a++) {
                const animId = dv.getInt32(p, true); p += 8
                const ne = buf.indexOf(0, p); if (ne < 0) break
                const animName = buf.toString('utf8', p, ne); p = ne + 1
                const le = buf.indexOf(0, p); if (le < 0) break
                p = le + 1
                while (p + 1 < buf.length && !(buf[p] === 0xf0 && buf[p + 1] === 0x41)) p++
                p += 2
                const frameCount = dv.getUint16(p, true); p += 2
                p += 2; p += 4
                const boneCount = dv.getUint32(p, true); p += 4
                p += 4
                const segBytes = dv.getUint32(p, true); p += 4
                const segs = []
                for (let b = 0; b < boneCount && p + (b + 1) * segBytes <= buf.length; b++) segs.push(p + b * segBytes)
                out.push({ id: animId, name: animName, frameCount, boneCount, segBytes, segs })
                if (!(segBytes > 0) || !(boneCount > 0)) break
                p += segBytes * boneCount
              }
              return out
            }
            try {
              const animCount = dv.getUint32(mdla + 13, true)
              let p = mdla + 17                              // MDLA0006\0 + u32 总字节 + u32 动画数
              for (let a = 0; a < animCount; a++) {
                const hdr = (a === 0)
                  ? (readHeader(p, true) || readHeader(p, false) || findHeader(p + 1))
                  : findHeader(p)
                if (!hdr) break
                const segs = []
                for (let b = 0; b < hdr.boneCount && hdr.dataStart + (b + 1) * hdr.segBytes <= buf.length; b++) segs.push(hdr.dataStart + b * hdr.segBytes)
                animations.push({ id: hdr.id, name: hdr.name, loop: hdr.loop, fps: hdr.fps, frameCount: hdr.frameCount, boneCount: hdr.boneCount, segBytes: hdr.segBytes, segs })
                p = hdr.dataStart + hdr.segBytes * hdr.boneCount
              }
              if (!animations.length && animCount > 0) animations = parseLegacy()
            } catch {
              try { if (!animations.length) animations = parseLegacy() } catch { animations = [] }
            }
          }
          // MDLE0002 (骨骼扩展矩阵, 每骨骼 64B, IK/约束相关 — 逆向自 wallpaper64.exe)
          // 结构: [MDLE0002\0][u32 段尾偏移][u32 骨骼矩阵字节 = 骨数×64][每骨骼 64B 矩阵×骨数]
          const mdle = buf.indexOf('MDLE');
          if (mdle >= 0) {
            try {
              const tail = dv.getUint32(mdle + 9, true);
              const matBytes = dv.getUint32(mdle + 13, true);
              const n = matBytes > 0 ? matBytes / 64 : 0;
              const mats = [];
              for (let b = 0; b < Math.min(n, 256); b++) {
                const mo = mdle + 17 + b * 64;
                const m = new Array(16);
                for (let i = 0; i < 16; i++) m[i] = dv.getFloat32(mo + i * 4, true);
                mats.push(m);
              }
              bones.forEach((b, i) => { if (mats[i]) b.extend = mats[i]; });
            } catch { /* 扩展段解析失败不影响 */ }
          }
        }
        return { positions, uvs, indices, vertexCount, indexCount, blendIndices, blendWeights, bones, animations, raw: buf };
      }
    
      // ── 静态 MDL (MDLV0014 非 puppet 变体) 解析 ────────────────────────
      // 结构: "MDLV0014" + 头部 + "materials/....json\0" + u32 标志 + u32 顶点字节数
      //       + 顶点流 (stride 32: pos/normal/uv; stride 64: pos/normal/tangent/uv)
      //       + u32 索引字节数 + u16 索引流
,
    _parseMdlStatic(buf) {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        // MDLV0004 / MDLV0014 等版本均适用 (布局相同, 仅版本号不同)
        if (buf.length < 16 || buf.toString('ascii', 0, 4) !== 'MDLV') return null;
        const matStart = this._indexOfBytes(buf, 'materials/', 8);
        if (matStart < 0) return null;
        let matEnd = matStart;
        while (matEnd < buf.length && buf[matEnd] !== 0) matEnd++;
        const materialPath = buf.toString('utf8', matStart, matEnd);
        const f0 = dv.getUint32(matEnd + 1, true);
        const vertBytes = dv.getUint32(matEnd + 5, true);
        const vertStart = matEnd + 9;
        if (vertBytes <= 0 || vertBytes > buf.length || vertStart + vertBytes > buf.length) return null;
        // stride 探测: 优先 64/32 (pos+normal+uv); 无法线布局 (如 bgfade: pos+uv, stride 20) 走宽松回退
        const cands = [];
        for (const stride of [64, 48, 32, 40, 44, 56]) {
          if (vertBytes % stride !== 0) continue;
          const vc = vertBytes / stride;
          if (vc < 3 || vc > 100000) continue;
          let normOk = 0, n = 0;
          for (let i = 0; i < Math.min(vc, 300); i++) {
            const o = vertStart + i * stride;
            const nx = dv.getFloat32(o + 12, true), ny = dv.getFloat32(o + 16, true), nz = dv.getFloat32(o + 20, true);
            const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (Math.abs(l - 1) < 0.1) normOk++;
            n++;
          }
          if (normOk < n * 0.6) continue;
          // 索引范围检查
          const idxBytesPos = vertStart + vertBytes;
          const idxBytesT = dv.getUint32(idxBytesPos, true);
          const idxStartT = idxBytesPos + 4;
          let idxAllOk = false;
          if (idxBytesT > 0 && idxBytesT % 2 === 0 && idxStartT + idxBytesT <= buf.length + 1) {
            const ic = idxBytesT / 2;
            if (ic > 0 && ic % 3 === 0 && ic < 300000) {
              let ok = 0;
              for (let k = 0; k < Math.min(ic, 400); k++) {
                if (dv.getUint16(idxStartT + k * 2, true) < vc) ok++;
              }
              idxAllOk = ok > Math.min(ic, 400) * 0.98;
            }
          }
          // 法线-面法线对齐 (平滑网格判别)
          let align = 0, an = 0;
          if (idxAllOk) {
            for (let k = 0; k + 2 < Math.min(idxBytesT / 2, 3000); k += 3) {
              const a = dv.getUint16(idxStartT + k * 2, true), b = dv.getUint16(idxStartT + k * 2 + 2, true), c = dv.getUint16(idxStartT + k * 2 + 4, true);
              if (a >= vc || b >= vc || c >= vc) continue;
              const pa = [dv.getFloat32(vertStart + a * stride, true), dv.getFloat32(vertStart + a * stride + 4, true), dv.getFloat32(vertStart + a * stride + 8, true)];
              const pb = [dv.getFloat32(vertStart + b * stride, true), dv.getFloat32(vertStart + b * stride + 4, true), dv.getFloat32(vertStart + b * stride + 8, true)];
              const pc = [dv.getFloat32(vertStart + c * stride, true), dv.getFloat32(vertStart + c * stride + 4, true), dv.getFloat32(vertStart + c * stride + 8, true)];
              const e1 = v3sub(pb, pa), e2 = v3sub(pc, pa);
              const fn = v3norm(v3cross(e1, e2));
              const vn = [dv.getFloat32(vertStart + a * stride + 12, true), dv.getFloat32(vertStart + a * stride + 16, true), dv.getFloat32(vertStart + a * stride + 20, true)];
              const vl = Math.sqrt(v3dot(vn, vn)) || 1;
              align += Math.abs(v3dot(fn, [vn[0] / vl, vn[1] / vl, vn[2] / vl]));
              an++;
            }
            if (an > 0) align /= an;
          }
          cands.push({ stride, vc, idxAllOk, align });
        }
        cands.sort((a, b) => (b.idxAllOk - a.idxAllOk) || (b.align - a.align));
        let chosen = cands[0];
        // 无法线回退: pos+uv 布局 (stride 20 等), 用位置界 + 索引范围 + UV 覆盖率判别
        if (!chosen) {
          const idxBytesPos = vertStart + vertBytes;
          const idxBytesT = dv.getUint32(idxBytesPos, true);
          const idxStartT = idxBytesPos + 4;
          let ic = 0;
          if (idxBytesT > 0 && idxBytesT % 2 === 0 && idxStartT + idxBytesT <= buf.length + 1) ic = idxBytesT / 2;
          for (const stride of [20, 16, 24, 28, 36, 40, 44, 48, 56]) {
            if (vertBytes % stride !== 0) continue;
            const vc = vertBytes / stride;
            if (vc < 3 || vc > 100000) continue;
            if (ic === 0 || ic % 3 !== 0) continue;
            let idxOk = 0;
            for (let k = 0; k < Math.min(ic, 400); k++) if (dv.getUint16(idxStartT + k * 2, true) < vc) idxOk++;
            if (idxOk < Math.min(ic, 400) * 0.98) continue;
            // UV 覆盖率 (uv 在 stride 末尾)
            const uvOff = stride - 8;
            let uvOk = 0, uvN = 0;
            let minX = 1e9, maxX = -1e9;
            for (let i = 0; i < Math.min(vc, 300); i++) {
              const o = vertStart + i * stride;
              const x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true);
              if (!isFinite(x) || !isFinite(y) || !isFinite(z) || Math.abs(x) > 10000 || Math.abs(y) > 10000) continue;
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              const u = dv.getFloat32(o + uvOff, true), v = dv.getFloat32(o + uvOff + 4, true);
              if (u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05) uvOk++;
              uvN++;
            }
            if (uvN > 0 && uvOk > uvN * 0.6) { chosen = { stride, vc, hasNormals: false }; break; }
          }
        }
        if (!chosen) return null;
        const { stride, vc, hasNormals } = chosen;
        const positions = [], normals = [], uvs = [], uv2s = [];
        const hasN = hasNormals !== false;
        // UV 布局 (引擎 vertex): 主纹理 UV1 在 stride 末尾 (stride-8);
        // 第 2 UV (lightmap) 仅 stride 56 有 (pos12+normal12+uv2 8+uv1 8+tangent16 → uv2@stride-16)
        const uvOff = stride === 64 ? 36 : stride - 8;
        let uv2Off = -1;
        if (stride === 56) {
          const p = stride - 16;
          let ok = 0, n = 0;
          for (let i = 0; i < Math.min(vc, 150); i++) {
            const o = vertStart + i * stride;
            const u = dv.getFloat32(o + p, true), v = dv.getFloat32(o + p + 4, true);
            if (u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05) ok++;
            n++;
          }
          if (ok / n > 0.7) uv2Off = p;
        }
        for (let i = 0; i < vc; i++) {
          const o = vertStart + i * stride;
          positions.push([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]);
          normals.push(hasN ? [dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true)] : null);
          uvs.push([dv.getFloat32(o + uvOff, true), dv.getFloat32(o + uvOff + 4, true)]);
          uv2s.push(uv2Off >= 0 ? [dv.getFloat32(o + uv2Off, true), dv.getFloat32(o + uv2Off + 4, true)] : null);
        }
        const idxBytesPos = vertStart + vertBytes;
        const idxBytes = dv.getUint32(idxBytesPos, true);
        const idxStart = idxBytesPos + 4;
        if (idxBytes <= 0 || idxBytes % 2 !== 0 || idxStart + idxBytes > buf.length + 1) return null;
        const indices = [];
        for (let i = 0; i < idxBytes / 2; i++) indices.push(dv.getUint16(idxStart + i * 2, true));
        return { positions, normals, uvs, uv2s, indices, materialPath, stride, vertexCount: vc, indexCount: indices.length };
      }
    
,
    _indexOfBytes(buf, str, from) {
        const needle = Buffer.from(str, 'ascii');
        for (let i = from; i + needle.length <= buf.length; i++) {
          let ok = true;
          for (let k = 0; k < needle.length; k++) if (buf[i + k] !== needle[k]) { ok = false; break; }
          if (ok) return i;
        }
        return -1;
      }
    
      // ── Model 对象渲染: MDL 静态网格 + 相机 + 光照 + CPU shader ────────
,
    _meshBounds(positions) {
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (const p of positions) {
          if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        }
        return { minX, maxX, minY, maxY };
      }
    
,
    _rasterizeMesh(mesh, tex, skinned, bounds, W, H, flipY) {
        const { uvs, indices } = mesh;
        const tw = tex.width, th = tex.height, tdata = tex.rgba;
        const ALPHA_CUTOFF = 8;
        const sample = (u, v) => {
          const fx = u * tw - 0.5, fy = v * th - 0.5;
          const x0 = Math.max(0, Math.min(tw - 1, Math.floor(fx)));
          const y0 = Math.max(0, Math.min(th - 1, Math.floor(fy)));
          const x1 = Math.min(tw - 1, x0 + 1), y1 = Math.min(th - 1, y0 + 1);
          const tx = fx - x0, ty = fy - y0;
          const i00 = (y0 * tw + x0) * 4, i10 = (y0 * tw + x1) * 4;
          const i01 = (y1 * tw + x0) * 4, i11 = (y1 * tw + x1) * 4;
          const pm = [
            [tdata[i00] * tdata[i00+3], tdata[i00+1] * tdata[i00+3], tdata[i00+2] * tdata[i00+3], tdata[i00+3]],
            [tdata[i10] * tdata[i10+3], tdata[i10+1] * tdata[i10+3], tdata[i10+2] * tdata[i10+3], tdata[i10+3]],
            [tdata[i01] * tdata[i01+3], tdata[i01+1] * tdata[i01+3], tdata[i01+2] * tdata[i01+3], tdata[i01+3]],
            [tdata[i11] * tdata[i11+3], tdata[i11+1] * tdata[i11+3], tdata[i11+2] * tdata[i11+3], tdata[i11+3]],
          ];
          const out = [0, 0, 0, 0];
          for (let c = 0; c < 4; c++) {
            const top = pm[0][c] * (1 - tx) + pm[1][c] * tx;
            const bot = pm[2][c] * (1 - tx) + pm[3][c] * tx;
            out[c] = top * (1 - ty) + bot * ty;
          }
          if (out[3] < ALPHA_CUTOFF) return [0, 0, 0, 0];
          const a = out[3];
          return [Math.min(255, Math.round(out[0] / a)), Math.min(255, Math.round(out[1] / a)), Math.min(255, Math.round(out[2] / a)), Math.round(a)];
        };
        const rgba = new Uint8Array(W * H * 4);
        for (let t = 0; t < indices.length; t += 3) {
          const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
          const a = [skinned[i0][0] - bounds.minX, flipY(skinned[i0][1])];
          const b = [skinned[i1][0] - bounds.minX, flipY(skinned[i1][1])];
          const c = [skinned[i2][0] - bounds.minX, flipY(skinned[i2][1])];
          const bx0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
          const bx1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
          const by0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
          const by1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
          if (bx1 < bx0 || by1 < by0) continue;
          const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          if (Math.abs(area) < 1e-9) continue;
          const w0 = uvs[i0], w1 = uvs[i1], w2 = uvs[i2];
          for (let y = by0; y <= by1; y++) {
            for (let x = bx0; x <= bx1; x++) {
              const px = x + 0.5, py = y + 0.5;
              const la = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
              const lb = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
              const lc = ((a[0] - px) * (b[1] - py) - (a[1] - py) * (b[0] - px)) / area;
              if (la < -1e-4 || lb < -1e-4 || lc < -1e-4) continue;
              const di = (y * W + x) * 4;
              const u = la * w0[0] + lb * w1[0] + lc * w2[0];
              const v = la * w0[1] + lb * w1[1] + lc * w2[1];
              const s = sample(u, v);
              const srcA = s[3] / 255;
              if (srcA <= 0) continue;
              const dstA = rgba[di + 3] / 255;
              const outA = srcA + dstA * (1 - srcA);
              if (outA <= 0) continue;
              rgba[di] = Math.round((s[0] * srcA + rgba[di] * dstA * (1 - srcA)) / outA);
              rgba[di + 1] = Math.round((s[1] * srcA + rgba[di + 1] * dstA * (1 - srcA)) / outA);
              rgba[di + 2] = Math.round((s[2] * srcA + rgba[di + 2] * dstA * (1 - srcA)) / outA);
              rgba[di + 3] = Math.round(outA * 255);
            }
          }
        }
        return { width: W, height: H, rgba };
      }
    
      // ── 效果链 (CPU 实现 shader) ──────────────────────────────────────
  });
}

// ①(P-152 2026-09-19) `?mdls=legacy` 的**判定式**（与 `core/puppet-skin.js::bindOrderLegacy`
//   同形：正则字面量，由 `tests/diag-flag-check.mjs` 的规则 c 抓取）。缺省/任何其它值 = 走校验。
//   为什么在这里解析而不是 demo.html：demo.html 是**别的并行线的在改文件**（本任务禁碰），
//   而本文件是**实际运行**的 MDLS 解析器（`demo.html:3442` 的 `puppetHelper._parseMdl`）⇒
//   把解析点挂在真正消费它的模块上，`?mdls=legacy` 就能端到端生效，不必等接线。
export function mdlsLegacy(search) {
  const s = (search === undefined || search === null) ? '' : String(search);
  return /[?&]mdls=legacy/.test(s);
}

// ①(P-152) 一行可读 warn（只在**真的拒绝**时打；合法语料一个字都不打 ⇒ 日志面也逐位不变）。
//   与 `core/attach-transform.mjs::warnMdlBoneLayout` 同文案（同一契约的两个解析器应当报同一句话）。
function warnMdlBoneLayout(mdlsOffset, boneCount, diag) {
  try {
    const w = (typeof console !== 'undefined' && typeof console.warn === 'function') ? console.warn : null;
    if (!w) return;
    const first = diag.entryErrors.length ? (' bone#' + diag.entryErrors[0].b + '=' + diag.entryErrors[0].reason) : '';
    const cnt = diag.entryErrors.length ? (' entryErrors=' + diag.entryErrors.length + first) : '';
    const tail = diag.rejectReason ? (' rejectReason=' + diag.rejectReason) : '';
    w('[P-152] MDLS bone layout rejected @+' + mdlsOffset + ': declared=' + boneCount + ' parsed=' + diag.parsedBones
      + ' layout=' + diag.layout + cnt + tail + ' -> bones=[] (?mdls=legacy = 逐位回到无校验旧行为)');
  } catch (e) { /* 日志失败不影响解析 */ }
}
