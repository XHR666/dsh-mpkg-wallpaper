// known-ledger-audit.mjs —— `known-issues.json`（KI 豁免台账）的**共用判据**：匹配 + 防腐烂
//
// 为什么单独一个文件：消费方 `parity-check.mjs` 是脚本（`import` 即执行整轮对账），判据没法被别的
// 门禁复用、也没法喂合成样本。本模块只导出**纯函数**（不读文件系统、不读环境变量、不打印）：
//   · `parity-check.mjs` 用 `makeKnownLedger(doc)` 真跑一遍（命中计数 + 台账审计 + 落进 --json）；
//   · `tests/portability-audit-fix-test.mjs` 用**合成台账**证明各种腐烂形态必红（哈希当 scene 键、
//     整口径豁免、条目 0 命中、结构性规则没人实现…），并把台账文件改回去 ⇒ 判据必红。
//
// ── 为什么要有防腐烂（可移植性审计 PA-34 / PA-38 的要求）─────────────────────────────
// 旧实现（`knownFor()`）：只在**命中**时豁免，不命中既不报红也不告警。于是：
//   · KI-7 用 mpkg **内容哈希**当 scene 键 ⇒ 重新打包换哈希后这条豁免**静默失效**，
//     对账结果悄悄变了（变红/变绿）都没有人知道；
//   · 条目写错拼写、场景改名、层名改了 ⇒ 同上。
// 本模块把纪律反过来（与两仓"白名单必须仍然命中"同一套）：
//   ① 键必须是**可复算的场景身份**：`*`（全局口径豁免）或工坊 id 形态（6~12 位数字）；
//      内容哈希 / 自由文本 / 路径一律判红 —— 这类键不可能长期等于真实 sceneId。
//   ② 对账过（`comparedScenes`）的场景，条目必须至少命中一次，否则判红（选择器已腐烂）。
//   ③ 豁免面不许是"整口径"：`scene:'*'` + `layer:'*'` + affects 含 `rect` ⇒ 判红
//      （px 允许全局豁免：CPU 跑不了 GPU 蒙皮、t 相位差属测量口径；rect 是三大事故的严格路径）。
//   ④ `scope:'structural'` 的条目**不豁免任何东西**（affects 必须为空），且它的 `classify.rule`
//      必须被消费方实现（`implementedRules`）—— 否则"写了条判据但没人用"这种腐烂也会被判红。
//
// 退出码/用法：本模块不执行任何东西，只有纯函数导出。

/** 检查器真的在用的两个口径（`affects` 只能取这两个）。 */
export const LIVE_ASPECTS = ['rect', 'px']
/** `kind` 取值（与 known-issues.json `$note` 第 3 条一致）。 */
export const KI_KINDS = ['official-semantics', 'fallback', 'hack', 'measurement']
/** 可复算的场景身份：`*`（全局）或工坊 id 形态。**内容哈希/路径/自由文本都不算**。 */
export const SCENE_ID_RE = /^\d{6,12}$/
/** 32~64 位十六进制 = 内容指纹形态（就是 PA-34 要杀掉的那种键）。 */
export const CONTENT_HASH_RE = /^[0-9a-f]{32,64}$/i

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0

/**
 * 建一个台账对象：匹配（= 旧 `knownFor()` 的行为，逐字保持）+ 命中计数 + 审计。
 * @param {object} doc `known-issues.json` 的内容（`{issues:[…]}` 或裸数组）
 * @param {{implementedRules?:string[]}} opts 消费方**已实现**的结构性判据名
 */
export function makeKnownLedger(doc, opts = {}) {
  const entries = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.issues) ? doc.issues : [])
  const implementedRules = new Set(opts.implementedRules || [])
  const hitCounts = new Map()          // KI id → 真的豁免掉了几条
  const consulted = new Map()          // KI id → 被问过几次（用于区分"没命中"与"没被问"）
  const structuralHits = new Map()     // rule → {hits, misses, whys[]}
  const comparedScenes = new Set()

  const isExempting = (k) => k && k.scope !== 'structural' && Array.isArray(k.affects) && k.affects.length > 0

  /** 与旧实现逐字同语义的匹配：scene（`*` 或等值）→ aspect ∈ affects → layer 段匹配。 */
  function knownFor(sceneId, layerName, aspect) {
    for (const k of entries) {
      if (!isExempting(k)) continue
      if (k.scene !== '*' && k.scene !== sceneId) continue
      if (!(k.affects || []).includes(aspect)) continue
      const pats = String(k.layer).split('|')
      if (pats.some((p) => p === '*' || String(layerName).includes(p))) {
        hitCounts.set(k.id, (hitCounts.get(k.id) || 0) + 1)
        return k
      }
      consulted.set(k.id, (consulted.get(k.id) || 0) + 1)
    }
    return null
  }

  const markCompared = (sceneId) => { comparedScenes.add(String(sceneId)) }
  const markStructural = (rule, hit, why) => {
    if (!structuralHits.has(rule)) structuralHits.set(rule, { hits: 0, misses: 0, whys: [] })
    const r = structuralHits.get(rule)
    if (hit) r.hits++
    else r.misses++
    if (why && r.whys.length < 3) r.whys.push(why)
  }

  /**
   * 台账审计。**errors = 判红**（调用方负责把它变成退出码 1）；warnings/notes 只打印。
   * @param {{knownSceneIds?:Iterable<string>, structuralHits?:Map}} ctx
   *   `knownSceneIds` = 本机能看到的场景 id（上报索引 ∪ 本地语料目录）；为空 ⇒ 场景键可复算性"未判定"
   */
  function audit(ctx = {}) {
    const errors = []
    const warnings = []
    const notes = []
    const knownSceneIds = new Set([...(ctx.knownSceneIds || [])].map(String))
    const seen = new Set()
    for (const k of entries) {
      const id = k && k.id
      const at = 'known-issues.json[' + (id || '?') + ']'
      if (!isNonEmptyString(id)) { errors.push({ id: String(id || ''), rule: 'id', msg: at + ' 缺 id' }); continue }
      if (seen.has(id)) errors.push({ id, rule: 'duplicate-id', msg: at + ' id 重复（豁免台账必须一条一 id）' })
      seen.add(id)
      if (!KI_KINDS.includes(k.kind)) errors.push({ id, rule: 'kind', msg: at + ' kind 非法：' + JSON.stringify(k.kind) + '（允许 ' + KI_KINDS.join(' / ') + '）' })
      if (!isNonEmptyString(k.layer)) errors.push({ id, rule: 'layer', msg: at + ' 缺 layer（豁免必须点名层；整包用 scene/layer 的显式写法并说明）' })
      if (!isNonEmptyString(k.reason) || k.reason.trim().length < 20) errors.push({ id, rule: 'reason', msg: at + ' reason 缺失或过短（豁免必须写清理由）' })
      if (!Array.isArray(k.evidence) || !k.evidence.some(isNonEmptyString)) errors.push({ id, rule: 'evidence', msg: at + ' evidence 缺失（每条豁免必须有证据出处）' })
      if (!isNonEmptyString(k.owner)) errors.push({ id, rule: 'owner', msg: at + ' 缺 owner' })
      if (!isNonEmptyString(k.since)) errors.push({ id, rule: 'since', msg: at + ' 缺 since' })

      // ① 键必须是可复算的场景身份
      if (k.scene !== '*' && !SCENE_ID_RE.test(String(k.scene || ''))) {
        errors.push({
          id, rule: 'scene-key-unreproducible',
          msg: at + ' scene 键 ' + JSON.stringify(k.scene) + ' 不是可复算的场景身份'
            + (CONTENT_HASH_RE.test(String(k.scene || '')) ? '（**这是文件内容哈希**：重新打包就换哈希 ⇒ 豁免会静默失效）' : '')
            + '；只允许 `*`（全局口径豁免）或工坊 id 形态（6~12 位数字）',
        })
      } else if (k.scene !== '*' && knownSceneIds.size && !knownSceneIds.has(String(k.scene))) {
        warnings.push({ id, rule: 'scene-key-unknown', msg: at + ' scene=' + k.scene + ' 不在本机上报/语料索引里（场景改名？语料被裁剪？—— 不判红，但请复核）' })
      }

      // ④ 结构性条目：不豁免任何东西，且 rule 必须有人实现
      if (k.scope === 'structural') {
        if (!Array.isArray(k.affects) || k.affects.length) errors.push({ id, rule: 'structural-exempts', msg: at + ' scope=structural 的条目 affects 必须为空（分类 ≠ 豁免；否则又是整包豁免）' })
        const rule = k.classify && k.classify.rule
        if (!isNonEmptyString(rule)) errors.push({ id, rule: 'structural-rule', msg: at + ' scope=structural 必须给 classify.rule' })
        else if (implementedRules.size && !implementedRules.has(rule)) errors.push({ id, rule: 'structural-rule-unimplemented', msg: at + ' classify.rule="' + rule + '" 没有任何消费方实现（写了判据但没人用 = 腐烂）' })
        const sh = structuralHits.get(rule) || (ctx.structuralHits && ctx.structuralHits.get(rule))
        notes.push({ id, rule: 'structural', msg: at + ' 结构性判据 ' + rule + '：本次命中 ' + ((sh && sh.hits) || 0) + ' 次 / 未命中 ' + ((sh && sh.misses) || 0) + ' 次（不豁免任何一层）' })
        if (sh && sh.hits === 0 && sh.misses > 0) warnings.push({ id, rule: 'structural-never-hit', msg: at + ' 结构性判据 ' + rule + ' 本次一次都没命中（复核判据是否还成立）：' + (sh.whys || []).join('；') })
        continue
      }

      // ③ 豁免面：affects 必须非空且落在真在用的口径上；rect 不许全局豁免
      if (!Array.isArray(k.affects) || !k.affects.length) { errors.push({ id, rule: 'affects-empty', msg: at + ' affects 为空（既不豁免也不分类的条目没有意义；要记录分类请用 scope:"structural"）' }); continue }
      for (const a of k.affects) if (!LIVE_ASPECTS.includes(a)) errors.push({ id, rule: 'affects-unknown', msg: at + ' affects 含未知口径 ' + JSON.stringify(a) + '（检查器只认 ' + LIVE_ASPECTS.join('/') + '）' })
      if (k.scene === '*' && k.layer === '*' && k.affects.includes('rect')) {
        errors.push({ id, rule: 'global-rect-exemption', msg: at + ' 全局豁免了 **rect** 口径（scene/layer 都是 *）⇒ 严格路径整个被关掉；rect 只在具体场景/层上豁免（px 允许全局：测量口径限制）' })
      }

      // ② 命中防腐烂：对账过的场景里必须真的命中过
      if (k.scene !== '*' && comparedScenes.has(String(k.scene))) {
        const hits = hitCounts.get(id) || 0
        if (!hits) {
          errors.push({ id, rule: 'never-hit', msg: at + ' 场景 ' + k.scene + ' 本次**真的对账过**，但这条豁免一次都没命中 ⇒ 选择器已腐烂（层名改了？场景变了？）—— 要么修选择器，要么删条目' })
        }
      }
    }
    const exempting = entries.filter(isExempting)
    const structural = entries.filter((k) => k.scope === 'structural')
    const applied = [...hitCounts.entries()].map(([id, n]) => ({ id, n }))
    if (!knownSceneIds.size) notes.push({ rule: 'scene-key-check', msg: '本机既无上报索引也无本地语料目录 ⇒ 场景键可复算性**未判定**（只做了形态检查：哈希/自由文本已判红）' })
    if (!comparedScenes.size) notes.push({ rule: 'hit-check', msg: '本次没有任何场景真的对账过 ⇒ "条目必须仍然命中"这一条**未判定**（不是通过）' })
    return { errors, warnings, notes, exempting, structural, applied, consulted: [...consulted.entries()] }
  }

  return { entries, knownFor, audit, markCompared, markStructural, hitCounts, consulted, structuralHits, comparedScenes, implementedRules }
}
