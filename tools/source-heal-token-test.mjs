// tools/source-heal-token-test.mjs —— 「只剩 image token、身份/类型全空」那条半残档的判据
// 真机症状：刷新页面偶尔壁纸加载不出来 ⇒ 类型显示 image、名字/图标空、预览框破图；
//           在自定义目录里重新点一次「使用」又好了。
// 根因：两处存储按字段合并 + 换档清 converted + image 粘性护栏 ⇒ 档里只剩 `host:?token=…&index=0`，
//       mpkgKey/mpkgName/converted 全空 ⇒ 旧判据（要求有 mpkgKey/source 线索）不算半残档
//       ⇒ 既不进自愈、也判不出类型 ⇒ 整段视频被塞进 <img>。
import { loadPlugin } from './_stub.mjs'
let pass = 0, fail = 0
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  ' + d : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }
const CLEAR = ['__mpwBuildCss', '__mpwPersist', '__mpwAppliedOnce', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwClientLoaded', '__mpwSectionTest', '__mpwHdrFrostTest', '__mpwGlobalWired']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch {} } }

console.log('== 真机那条半残档：只剩 image token ==')
{
  reset()
  loadPlugin({ quiet: true, settings: {
    enabled: true, image: 'host:?token=%E5%B0%8F%E9%B8%9F%E6%B8%B8%E6%98%9F%E9%87%8E01_04&index=0',
    srcRoot: 'container', mpkgKey: '', mpkgName: '', converted: '', source: '',
    sceneKey: 'scene|probe|/x/does-not-exist/scene.pkg', alphaSemantics: 2,
  } })
  const P = globalThis.__mpwPersist
  const half = { image: 'host:?token=%E5%B0%8F%E9%B8%9F%E6%B8%B8%E6%98%9F%E9%87%8E01_04&index=0', srcRoot: 'container', mpkgKey: '', mpkgName: '', converted: '', source: '' }
  ok('A1 该形状被判为半残档（旧判据要求有 mpkgKey/source 线索 ⇒ 漏判）', P.srcMissing(half) === true, 'srcMissing=' + P.srcMissing(half))
  ok('A2 身份判据：token 在 + 身份/类型空 ⇒ true', P.identityMissing(half) === true, '')
  ok('A3 身份判据不误伤完整档', P.identityMissing({ image: 'host:?token=X&index=0', mpkgKey: 'custommpkg|X.mpkg', mpkgName: 'X', converted: 'mp4' }) === false, '')
  ok('A4 身份判据不误伤"从没选过壁纸"的空档', P.identityMissing({}) === false && P.srcMissing({}) === false, '')
  ok('A5 从 token 反推出身份 key（mpkg：token 名就是包名 ⇒ custommpkg|<名>.mpkg）',
    P.keyFromImageToken(half.image) === 'custommpkg|小鸟游星野01_04.mpkg', P.keyFromImageToken(half.image))
  ok('A6 库条目 token（ltoken）与自定义目录（folder=）也各有对应 key 形状',
    P.keyFromImageToken('host:?ltoken=abc&web=1') === 'library|abc'
    && P.keyFromImageToken('host:?custom=1&folder=E%2F%E6%98%9F%E9%87%8E&file=a.mp4') === 'custom|E/星野', '')
  ok('A7 直链/无 token ⇒ 不反推（返回空，不许瞎猜）',
    P.keyFromImageToken('https://example.com/a.mp4') === '' && P.keyFromImageToken('') === '', '')
  const before = (() => { try { return P.healState() } catch { return {} } })()
  try { P.heal() } catch (e) { /* 桩里没有宿主 ⇒ 推导会失败，但"尝试"必须留痕 */ }
  const after = (() => { try { return P.healState() } catch { return {} } })()
  ok('A8 自愈链真的被这条档触发过（旧实现因 mpkgKey 为空直接 return false ⇒ attempted 恒 0；同一状态只试一次是既有去重，不算失败）',
    Number(after.attempted || 0) >= 1 && !!after.last, 'attempted=' + after.attempted + ' last.from=' + String((after.last || {}).from))
  ok('A10 自愈写回时清掉"与当前类型不符"的 sceneKey（真机残留：converted=mp4 却挂着上一个场景的 sceneKey；null 是唯一被粘性护栏尊重的删除语义）',
    (() => {
      const bad = { image: 'host:?token=X&index=0', converted: 'mp4', mpkgKey: 'custommpkg|X.mpkg', sceneKey: 'scene|probe|old-bundle/scene.pkg' }
      const fixed = P.stripForeignSceneKey(bad)
      const keep = P.stripForeignSceneKey({ image: 'host:?ltoken=L&scene=1', converted: 'scene', sceneKey: 'scene|L' })
      return fixed.sceneKey === null && keep.sceneKey === 'scene|L'
    })(), '')
  ok('A9 自愈用的是从 token 反推出来的 key（不是空 key）',
    String((after.last || {}).key || '') === 'custommpkg|小鸟游星野01_04.mpkg', JSON.stringify(after.last || {}))
}
console.log('\n===== source-heal-token: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
