// 示例扩展钩子（默认不会被 /ext 索引加载：文件名以 _ 开头）。
// 想启用：改名去掉下划线，或用 ?exthooks=http://127.0.0.1:8899/ext/_example-hook.mjs
export default {
  // 纹理缺失时的接管：返回 1×1 洋红，便于一眼看出"哪一层缺纹理"
  resolveTexture(name, ctx) {
    if (!name) return null
    try {
      const gl = ctx && ctx.textures && ctx.textures.gl
      if (!gl) return null
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 255, 255]))
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      return { glTex: tex, width: 1, height: 1 }
    } catch { return null }
  },
  postFrame(stats) {
    if (!globalThis.__mpwExtFrameLogged) { globalThis.__mpwExtFrameLogged = 1; console.log('[ext] postFrame 已接入', stats) }
  },
}
