/**
 * Vite 的 modulepreload polyfill —— 构建产物里 `assets/bench-*.js` 的第一行就是
 *   import "./modulepreload-polyfill-B5Qt9EMX.js";
 * 而本快照（vendor-ref/ww-pages/）**缺这个文件** ⇒ 该 import 404 ⇒ 整个 bench bundle
 * 求值失败 ⇒ 页面上所有由 bundle 驱动的交互（主题切换、壁纸库列表、工具条按钮、
 * 渲染器挂载…）全部失效。补齐此文件即恢复（详见 PATCH-NOTES.md 第四批 §7/§1）。
 *
 * 内容 = Vite 6.4.3 生成的标准 polyfill（MIT），逐行等价；在支持 modulepreload 的浏览器里
 * 第一段判断就 return，因此实际是 no-op —— 它的存在意义是让模块图能解析。
 */
(function () {
  const relList = document.createElement('link').relList
  if (relList && relList.supports && relList.supports('modulepreload')) return
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) processPreload(link)
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue
      for (const node of mutation.addedNodes) {
        if (node.tagName === 'LINK' && node.rel === 'modulepreload') processPreload(node)
      }
    }
  }).observe(document, { childList: true, subtree: true })
  function getFetchOpts(link) {
    const fetchOpts = {}
    if (link.integrity) fetchOpts.integrity = link.integrity
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy
    if (link.crossOrigin === 'use-credentials') fetchOpts.credentials = 'include'
    else if (link.crossOrigin === 'anonymous') fetchOpts.credentials = 'omit'
    else fetchOpts.credentials = 'same-origin'
    return fetchOpts
  }
  function processPreload(link) {
    if (link.ep) return
    link.ep = true
    const fetchOpts = getFetchOpts(link)
    fetch(link.href, fetchOpts)
  }
})()
