/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // clean-room-effects-blend-test.mjs — P-100-R1 洁净室重写验收（CPU 效果链：混合模式 / HSL / 像素颜色效果 / 位移 / waterflow）
// 用法: node tests/clean-room-effects-blend-test.mjs
//
// 背景：`core/we-scene-bundle.js` 的 `src/render/effects.js` 节曾在文件头自述「逐行翻译自 WE shader 原文」，
//   节内另有 3 处自认（「逐字实现」「逐字」「全量字面翻译」）与 12 处上游 `文件:行号` 引注 ——
//   该节因此被列为许可合规风险点 **R1**（`docs/WER-REF-LICENSE-AUDIT.md` §3.5 记录，属
//   「WE 专有 shader（`wallpaper_engine/assets/**`）」轴，P-95 的 wer-ref 轴处置明确未覆盖它）。
//   本轮按行为规格 `docs/EFFECTS-COMPUTE-SPEC.md` 做洁净室重写：命名/控制流组织/常量表达/注释全改，
//   **数值逐位不变**（CPU 侧结果是 mock-GL 与对拍的基准，1 ulp 漂移都会改结论）。
//
// 六层断言：
//   ① 冻结真值 digest：期望 digest = **重写前**实现在 `tests/effects-corpus.mjs` 全部语料上的实测输出
//      （FNV-1a 64 over 每个数的 IEEE-754 位模式）；重写后必须逐位相同。
//   ② 冻结抽样值：逐条 `Object.is` 对拍（含 -0 / NaN / ±Infinity），并把"调用后入参状态"一并冻结
//      —— §3.4 的**原地改写**契约是可观测行为。
//   ③ 规格性质断言：只用公开标准/规格表能推出的独立性质（同义 id、交换操作数、opacity 无关族、
//      区间界、HSL 往返恒等、蒙版/alpha 恒等），不复述实现公式。
//   ④ 契约守卫：返回数组身份（新建 vs 原地）、未知 type 跳过、空表恒等、非可迭代输入抛 TypeError。
//   ⑤ 源码守卫：旧标识符 / 上游同名回响 / 上游 `文件:行号` 引注 / 自认措辞在该节内**归零**，新名在位。
//   ⑥ 血缘复测：与 WE 专有原件（`$MPW_ROOT/wallpaper_engine/assets/**`）做三项文本指标并卡阈值
//      （跨语言 JS↔GLSL 的文本相似度天然低 ⇒ 判据以 ⑤ 的四项为准，本层是辅助证据）。缺资产时 SKIP。
//
// 逐位比较一律 `Object.is`（能抓出 -0 与 NaN 的差异）。
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import * as C from './effects-corpus.mjs'
import { ROOT } from './_root.mjs'

let pass = 0, fail = 0
const fails = []
function chk(cond, label, detail) {
  if (cond) pass++
  else { fail++; fails.push(label + (detail !== undefined ? '  [' + detail + ']' : '')) }
}
const same = (a, b) => Object.is(a, b)
const sameVec = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
const show = (v) => Object.is(v, -0) ? '-0' : (typeof v === 'number' && !Number.isFinite(v) ? (Number.isNaN(v) ? 'NaN' : (v > 0 ? 'Infinity' : '-Infinity')) : String(v))
const showVec = (v) => '[' + v.map(show).join(', ') + ']'

// ═══════════════════════════════════════════════════════════════════════════
// FROZEN —— 冻结真值（重写前实测；生成方式见 docs/PATCHES.md P-100-R1）
// ═══════════════════════════════════════════════════════════════════════════
// 冻结真值：**重写前**实现在本语料上的实测输出（生成：node tests/effects-corpus.mjs 的语料 + 旧实现，见 docs/PATCHES.md P-100）。
// 比较一律 Object.is（含 -0 / NaN）。digest = FNV-1a 64 over 全部输出的 IEEE-754 位模式（见 effects-corpus.mjs digest()）。
export const FROZEN = {
  blendDigest: 'd2b90d19eae6d11a',
  colorDigest: '96b707f083a6fdcc',
  displaceDigest: '2a7cbeae9ed8e7b2',
  shakeDigest: '35f8d8364aeeb101',
  flowDigest: 'd8c5ea3a5e53399d',

  // [mode, blendCases() 下标, [r,g,b]]
  blendSpots: [
    [0, 0, [0.12600388124166187, 0.5845117701309223, 0.7392561652253937]],
    [0, 5, [0.5546172193696333, 0.581692408504471, 0.12602396111817732]],
    [0, 6, [0.43775922850573934, 0.8833790980121358, 0.7157528378171623]],
    [0, 8, [0.2570549181889216, 0.4115775221863619, 0.19181167900703935]],
    [0, 10, [0.7143724950729099, 0.20738558913443647, 0.3978614229170916]],
    [1, 0, [0.021141508361324668, 0.5845117701309223, 0.7392561652253937]],
    [1, 5, [0.4799709680955857, 0.581692408504471, 0.02581335185095668]],
    [1, 6, [0.43775922850573934, 0.2891519800759852, 0.4446447866503149]],
    [1, 8, [0.11365544749423862, 0.4115775221863619, 0.031779068056494]],
    [1, 10, [0.7143724950729099, 0.16871241084299982, 0.3978614229170916]],
    [3, 0, [0.01805573966048039, 0.5688860264164202, 0.7479871906494371]],
    [3, 5, [0.3729781831520045, 0.4763411445383809, 0.015329209294463537]],
    [3, 6, [0.07674834435656715, 0.253386511843288, 0.27288963919529713]],
    [3, 8, [0.08363279646812546, 0.3264698714002355, 0.023384469370464595]],
    [3, 10, [0.7697157017416975, 0.12552056398337455, 0.38180992978393835]],
    [5, 0, [0.021141508361324668, 0.10705656302161515, 0.5010192445479333]],
    [5, 5, [0.4799709680955857, 0.5373643634375185, 0.02581335185095668]],
    [5, 6, [0.42166546336375177, 0.2891519800759852, 0.4446447866503149]],
    [5, 8, [0.11365544749423862, 0.3221883412916213, 0.031779068056494]],
    [5, 10, [0.312207821989432, 0.16871241084299982, 0.06269901152700186]],
    [7, 0, [0.12680746340467813, 0.6713272762367063, 0.7960615996892911]],
    [7, 5, [0.6201642344754792, 0.6966892657509376, 0.13365070109779065]],
    [7, 6, [0.7445970844214828, 0.897159593309911, 0.818185494816652]],
    [7, 8, [0.26736720036545736, 0.4910148382437669, 0.19485381793546266]],
    [7, 10, [0.8645268082908503, 0.23676579023710329, 0.5210054031615954]],
    [10, 0, [0.7395844468846917, 0.6661099966149777, 0.7799714196007699]],
    [10, 5, [0.6637599559035152, 0.6120097937528044, 0.272545185405761]],
    [10, 6, [0.587555710459128, 0.9472213962581009, 0.7448800192214549]],
    [10, 8, [0.6565166024956852, 0.44366661040112376, 0.6376075805164874]],
    [10, 10, [0.8527580664958805, 0.31977437320165336, 0.5131913982331753]],
    [11, 0, [0.022620112736136407, 0.6278106952293092, 0.7800368854626463]],
    [11, 5, [0.5438180707343199, 0.6237857684274009, 0.021044014448223243]],
    [11, 6, [0.5292072597042288, 0.5226910247364924, 0.641287252194505]],
    [11, 8, [0.12305353416728027, 0.401988717287202, 0.03408938888567678]],
    [11, 10, [0.8386003324580948, 0.15314385549729148, 0.4041921653613967]],
    [12, 0, [0.029832038737789446, 0.6405984490986141, 0.7800021216267834]],
    [12, 5, [0.5082820072442501, 0.6171786287867842, 0.02116712703269593]],
    [12, 6, [0.5532727450216438, 0.48991952017012846, 0.542899561501773]],
    [12, 8, [0.13213425059209744, 0.420479806853716, 0.04242864915457967]],
    [12, 10, [0.8406849445918554, 0.15577046400300862, 0.4572539295093637]],
    [14, 0, [0.023980440900344395, 0.5688860264164202, 0.7802039612190452]],
    [14, 5, [0.5749137087948659, 0.632085248564157, 0.015329209294463537]],
    [14, 6, [0.5183676267476519, 0.9310374100671113, 0.8300369165495484]],
    [14, 8, [0.12733600198584777, 0.36256222827080115, 0.03496666347098347]],
    [14, 10, [0.8300844929326516, 0.12552056398337455, 0.38180992978393835]],
    [17, 0, [0.01805573966048039, 0.5688860264164202, 0.812086313915936]],
    [17, 5, [0.6911817606916251, 0.7695927630744742, 0.015329209294463537]],
    [17, 6, [0.9599869091387366, 0.9310374100671113, 0.9461224723543294]],
    [17, 8, [0.08363279646812546, 0.3264698714002355, 0.023384469370464595]],
    [17, 10, [0.8904532841236057, 0.12552056398337455, 0.38180992978393835]],
    [20, 0, [0.01805573966048039, 0.5688860264164202, 0.7071412709102276]],
    [20, 5, [0.3434064267735939, 0.42410943918280125, 0.015329209294463537]],
    [20, 6, [0.06532802982613081, 0.24149366802100963, 0.21427515211314768]],
    [20, 8, [0.08363279646812546, 0.3264698714002355, 0.023384469370464595]],
    [20, 10, [0.6766772774451847, 0.12552056398337455, 0.38180992978393835]],
    [21, 0, [0.01830625390208226, 0.6414122982696546, 0.812086313915936]],
    [21, 5, [0.5633015220910613, 0.6922668586877603, 0.015701233584133403]],
    [21, 6, [0.5960150584741114, 0.9310374100671113, 0.7429188918054843]],
    [21, 8, [0.09356701122822428, 0.4031818595676744, 0.02412061203959242]],
    [21, 10, [0.8904532841236057, 0.13623318686226715, 0.4537439619940559]],
    [22, 0, [0.09961683073289511, 0.573896174668155, 0.812086313915936]],
    [22, 5, [0.629128528241776, 0.6657180976332446, 0.046297937634726206]],
    [22, 6, [0.4462719750884366, 0.9310374100671113, 0.9452949068880574]],
    [22, 8, [0.21208679534232758, 0.3757581099828223, 0.13429971824238807]],
    [22, 10, [0.8039215819036862, 0.1570118763117176, 0.38387729825139866]],
    [26, 0, [0.13189867617299747, 0.5719717951172645, 0.7381980735976428]],
    [26, 5, [0.5335987913699552, 0.5350881810288421, 0.02581335185095668]],
    [26, 6, [0.3181014791476105, 0.5586062113875027, 0.46995019342154876]],
    [26, 8, [0.20082953546901372, 0.3348644700862649, 0.13442754952364422]],
    [26, 10, [0.8476036755833466, 0.34383405753350516, 0.4250017766435636]],
    [28, 0, [0.12019897481954403, 0.5836714964707179, 0.7353237274320737]],
    [28, 5, [0.4686762404298169, 0.5121166243215749, 0.09073590279109499]],
    [28, 6, [0.12320575184097099, 0.7535019386941423, 0.514774473053325]],
    [28, 8, [0.1678796359722102, 0.3678143695830684, 0.10520482745152827]],
    [28, 10, [0.8444308074919444, 0.3404627316036285, 0.42837310257344025]],
    [30, 0, [0.10225220489281941, 0.5810736599237382, 0.7231659851368725]],
    [30, 5, [0.45001995460153676, 0.49701293650633793, 0.08307548152761247]],
    [30, 6, [0.2807178545433847, 0.5306042979887587, 0.43833627938602593]],
    [30, 8, [0.1605744013805622, 0.36422929434371876, 0.09810999856924321]],
    [30, 10, [0.7026037532779401, 0.19533162454483075, 0.39549797003253806]],
    [31, 0, [0.12908964994250616, 0.6817357403294798, 0.8530991017379108]],
    [31, 5, [0.7495583522200595, 0.8302613646292669, 0.13650810367467048]],
    [31, 6, [0.9683134950733148, 1.1444791332681938, 1.1172606173603317]],
    [31, 8, [0.2870775692150348, 0.5287742611872502, 0.20020627769306876]],
    [31, 10, [0.9326859886230404, 0.25057743599406174, 0.5292428913663285]],
    [32, 0, [0.023423694899152674, 0.6765184607077512, 0.8370089216493896]],
    [32, 5, [0.609365085840166, 0.7455818926311337, 0.02867075442783653]],
    [32, 6, [0.8112721211109603, 0.5364715200342679, 0.7437199091939947]],
    [32, 8, [0.13336581634381603, 0.481426033344607, 0.03713152781410009]],
    [32, 10, [0.9209172468280706, 0.1825240565999583, 0.5214288864379084]],
    [33, 0, [0.12600388124166187, 0.5845117701309223, 0.7392561652253937]],
    [33, 5, [0.5546172193696333, 0.581692408504471, 0.12602396111817732]],
    [33, 6, [0.43775922850573934, 0.8833790980121358, 0.7157528378171623]],
    [33, 8, [0.2570549181889216, 0.4115775221863619, 0.19181167900703935]],
    [33, 10, [0.7143724950729099, 0.20738558913443647, 0.3978614229170916]],
  ],

  // [场景名, 返回值, 调用后**入参数组**的状态（检查原地改写契约）]
  colorSpots: [
    ["tint/无蒙版/mode2#0", [11.687500000000002, 89.5, 47.1225, 180], [12.5, 200, 77.25, 180]],
    ["tint/蒙版/mode0#0", [55.333995921568636, 168.07189474509804, 82.13544423529412, 255], [12.5, 200, 77.25, 180]],
    ["tint/蒙版缺贴图/mode30#0", [121.37500000000001, 89.5, 79.0375, 180], [12.5, 200, 77.25, 180]],
    ["tint/蒙版rg88/mode32#0", [15.496691176470588, 207.99117647058821, 85.48091176470588, 180], [12.5, 200, 77.25, 180]],
    ["tint/mode11/alpha0#0", [12.5, 200, 77.25, 180], [12.5, 200, 77.25, 180]],
    ["pulse/纯时间#0", [14.05730609163537, 219.17763148214402, 94.47075823153291, 180], [12.5, 200, 77.25, 180]],
    ["pulse/噪声#0", [14.942985514076506, 252.83344953490723, 121.83825238496404, 180], [12.5, 200, 77.25, 180]],
    ["pulse/噪声缺贴图#0", [15.274392023917208, 265.42689690885385, 132.07871353904167, 180], [12.5, 200, 77.25, 180]],
    ["pulse/masked+蒙版#0", [12.683153236545758, 197.39119553775842, 75.51767030338158, 150.12820950188282], [12.5, 200, 77.25, 180]],
    ["pulse/masked+缺贴图#0", [14.431220808194153, 233.38639071137783, 106.02472297319932, 139.04789818997904], [12.5, 200, 77.25, 180]],
    ["pulse/无pulseColor+alpha#0", [12.5, 200, 77.25, 91.75622572203889], [12.5, 200, 77.25, 91.75622572203889]],
    ["pulse/bounds退化#0", [15, 255, 123.59999999999998, 180], [12.5, 200, 77.25, 180]],
    ["pulse/mode31#0", [14.431220808194153, 299.0478981899791, 106.02472297319932, 180], [12.5, 200, 77.25, 180]],
    ["key/基本#0", [12.5, 200, 77.25, 180], [12.5, 200, 77.25, 180]],
    ["key/invert+flatten#0", [6.1764705882352935, 98.8235294117647, 38.17058823529411, 125.99999999999999], [6.1764705882352935, 98.8235294117647, 38.17058823529411, 125.99999999999999]],
    ["key/大fuzz#0", [12.5, 200, 77.25, 180], [12.5, 200, 77.25, 180]],
    ["key/fuzz0/tol0#0", [8.823529411764707, 141.1764705882353, 54.529411764705884, 180], [8.823529411764707, 141.1764705882353, 54.529411764705884, 180]],
    ["栈：tint→key#0", [8.686332179930798, 122.51764705882353, 49.442138408304494, 180], [12.5, 200, 77.25, 180]],
    ["栈：key→tint#0", [145.5529896907217, 87.29073863636363, 65.08306962025317, 180], [12.5, 200, 77.25, 180]],
    ["栈：pulse(masked)→key#0", [13.128885976439506, 204.15849847725028, 81.43406890727488, 34.11338287002877], [12.5, 200, 77.25, 180]],
    ["栈：key→pulse(pulseAlpha)#0", [2.5, 160, 46.349999999999994, 112.1260385977466], [12.5, 200, 77.25, 180]],
    ["栈：未知类型夹在中间#0", [11.687500000000002, 89.5, 47.1225, 180], [12.5, 200, 77.25, 180]],
    ["栈：空#0", [12.5, 200, 77.25, 180], [12.5, 200, 77.25, 180]],
  ],

  // [场景名, su, sv]
  displaceSpots: [
    ["scroll/基本", 0, 0.5],
    ["scroll/零与负", 0.37, 0.0990625],
    ["shake/基本(rgba流图)", -0.002017090196078347, 0.9353547999999998],
    ["shake/rg88流图+direction2", 1.4528335294117647, -0.32410764705882356],
    ["shake/direction1+相位缺贴图", 0.46336890543084885, 0.5265607367668776],
    ["waves/基本", 0.3900824535992667, 0.6453070689316893],
    ["waves/蒙版缺贴图", 0.011133332100756538, 0.8784202668824649],
    ["waves/负方向", 1.385314364026503, -0.4134522524046649],
    ["sway/带mip噪声", 0.5034505095976158, 0.4946743167683026],
    ["sway/无mip+蒙版", 0.37081358973891826, 0.6189029622142519],
    ["sway/蒙版缺贴图+noiseScale>1", 0.05548036749515249, 0.9430842271178548],
    ["组合：scroll→shake→waves→sway", 0.656192511277904, 0.4789383194429965],
    ["组合：未知类型夹在中间", 0.4494533060050263, 0.5351724364257584],
    ["空", 0.37, 0.62],
    ["单 shake/masked/蒙版", 0.3669482455133156, 0.5947623367191112],
    ["单 shake/masked/蒙版rg88", 0.03350725264172939, 0.9380156419844988],
    ["单 shake/masked/缺蒙版", 1.4105763772420892, -0.45565809715873673],
    ["shake/masked + 其它位移", 0.07765101934887865, 0.15147681631194],
    ["两条 shake（都 masked）", 0.3630226449791975, 0.5622980657931139],
    ["无 masked shake（应原样返回）", 0.05287074321268791, 0.9203112531823109],
    ["flow/基本", 0.06, 0.94],
    ["flow/rg88流图", 1.4, -0.4],
    ["flow/相位缺贴图", 0.5, 0.5],
    ["flow/流图缺贴图", 0.37, 0.62],
    ["flow/负strength+大speed", 0.06, 0.94],
    ["flow/多条", 1.4, -0.4],
    ["flow/无 flow 项（应原样返回）", 0.8429373959073865, 0.09897599027507815],
  ],

  // [场景名, [r,g,b,a]]（applyShakeMaskMix 原地改写入参后返回）
  shakeSpots: [
    ["单 shake/masked/蒙版", [60.709632829691266, 103.37146868927948, 73.84894390392748, 66.63287489519489]],
    ["单 shake/masked/蒙版rg88", [108.35681568627453, 70.21394509803929, 94.09929411764703, 133.4463215686274]],
    ["单 shake/masked/缺蒙版", [10, 20, 30, 40]],
    ["shake/masked + 其它位移", [64.22863953518647, 66.48169103015984, 67.83772743507748, 71.06934084647526]],
    ["两条 shake（都 masked）", [89.26593618448226, 150.3207526452765, 98.54176209318885, 81.6307443783294]],
    ["无 masked shake（应原样返回）", [10, 20, 30, 40]],
    ["flow/基本", [10, 20, 30, 40]],
    ["flow/rg88流图", [10, 20, 30, 40]],
    ["flow/相位缺贴图", [10, 20, 30, 40]],
    ["flow/流图缺贴图", [10, 20, 30, 40]],
    ["flow/负strength+大speed", [10, 20, 30, 40]],
    ["flow/多条", [10, 20, 30, 40]],
    ["flow/无 flow 项（应原样返回）", [10, 20, 30, 40]],
  ],

  // [场景名, 返回值, 调用后入参数组的状态]
  flowSpots: [
    ["单 shake/masked/蒙版", [10, 20, 30, 40], [10, 20, 30, 40]],
    ["单 shake/masked/蒙版rg88", [10, 20, 30, 40], [10, 20, 30, 40]],
    ["单 shake/masked/缺蒙版", [10, 20, 30, 40], [10, 20, 30, 40]],
    ["shake/masked + 其它位移", [10, 20, 30, 40], [10, 20, 30, 40]],
    ["两条 shake（都 masked）", [10, 20, 30, 40], [10, 20, 30, 40]],
    ["无 masked shake（应原样返回）", [10, 20, 30, 40], [10, 20, 30, 40]],
    ["flow/基本", [142.0034095514411, 87.42846474954447, 115.99474881247676, 165.46774612167155], [10, 20, 30, 40]],
    ["flow/rg88流图", [72, 133, 112, 124], [10, 20, 30, 40]],
    ["flow/相位缺贴图", [176.25, 162.5, 146, 135.25], [10, 20, 30, 40]],
    ["flow/流图缺贴图", [125.27217658786802, 213.73948097507517, 129.97560069832585, 105.68792111998324], [10, 20, 30, 40]],
    ["flow/负strength+大speed", [142.02394179098246, 87.4872425531291, 115.99539375797261, 165.51302000019953], [10, 20, 30, 40]],
    ["flow/多条", [72, 133, 112, 124], [10, 20, 30, 40]],
    ["flow/无 flow 项（应原样返回）", [10, 20, 30, 40], [10, 20, 30, 40]],
  ],
}

// 语料规模（自证用）：blend 27 组 × 34 模式 = 918 次；color 92 次；displace 27 次；shake 13 次；flow 13 次

// 语料与贴图集（与冻结时逐位相同的一份）
const CASES = C.blendCases()
const TEX = C.makeTexture(32, 18, 0x9999)
const TEXTURES = C.makeTextures()

// ⑥ 层要用的 WE 专有原件根（只在本机；缺失时该层 SKIP，且标记必须落在输出前 3 行内供 runner 识别）
const WE_ASSETS = path.join(process.env.MPW_ROOT || path.resolve(ROOT, '..'), 'wallpaper_engine', 'assets')
const HAS_ASSETS = fs.existsSync(WE_ASSETS)
if (!HAS_ASSETS) console.log('SKIP clean-room-effects-blend（缺少 WE 资产根；血缘复测层跳过，①②③④⑤ 照跑）')

function blendOutputs() {
  const vals = []
  for (const mode of C.BLEND_MODES) {
    for (const c of CASES) {
      const o = lib.blendRgbByMode(mode, c.A, c.B, c.opacity)
      vals.push(o[0], o[1], o[2])
    }
  }
  return vals
}
function colorOutputs() {
  const vals = []
  for (const run of C.colorRuns()) {
    const ret = lib.composeColorEffectStack(run.items, run.t, TEXTURES, run.time, run.u0, run.v0)
    vals.push(ret[0], ret[1], ret[2], ret[3], run.t[0], run.t[1], run.t[2], run.t[3])
  }
  return vals
}
function displaceOutputs() {
  const vals = []
  for (const run of C.displaceRuns()) {
    const r = lib.resolveDisplacedUv(run.items, run.u0, run.v0, TEX, TEXTURES, run.time)
    vals.push(r.su, r.sv)
  }
  return vals
}
function shakeOutputs() {
  const vals = []
  for (const run of C.displaceRuns()) {
    if (!run.t) continue
    const t = run.t.slice()
    const r = lib.resolveDisplacedUv(run.items, run.u0, run.v0, TEX, TEXTURES, run.time)
    const out = lib.applyShakeMaskMix(run.items, run.u0, run.v0, r.su, r.sv, TEX, TEXTURES, run.time, t)
    vals.push(out[0], out[1], out[2], out[3])
  }
  return vals
}
function flowOutputs() {
  const vals = []
  for (const run of C.displaceRuns()) {
    if (!run.t) continue
    const t = run.t.slice()
    const r = lib.resolveDisplacedUv(run.items, run.u0, run.v0, TEX, TEXTURES, run.time)
    const out = lib.applyWaterFlowOverlay(run.items, run.u0, run.v0, r.su, r.sv, TEX, TEXTURES, run.time, t)
    vals.push(out[0], out[1], out[2], out[3], t[0], t[1], t[2], t[3])
  }
  return vals
}

// ───────────────────────────── ① digest ─────────────────────────────
console.log('── ① 冻结真值 digest（期望 = 重写前实测）──')
{
  const rows = [
    ['blend（918 次调用）', C.digest(blendOutputs()), FROZEN.blendDigest],
    ['color（92 次调用）', C.digest(colorOutputs()), FROZEN.colorDigest],
    ['displace（27 次调用）', C.digest(displaceOutputs()), FROZEN.displaceDigest],
    ['shake-mask（13 次调用）', C.digest(shakeOutputs()), FROZEN.shakeDigest],
    ['waterflow（13 次调用）', C.digest(flowOutputs()), FROZEN.flowDigest],
  ]
  for (const [name, got, want] of rows) {
    chk(same(got, want), `digest 逐位一致：${name}`, `${got} ≠ ${want}`)
    console.log(`   ${got === want ? '✓' : '✗'} ${name}  digest=${got}`)
  }
}

// ───────────────────────── ② 冻结抽样值 ─────────────────────────
console.log('── ② 冻结抽样值（Object.is 逐值对拍）──')
{
  let n = 0
  for (const [mode, caseIdx, exp] of FROZEN.blendSpots) {
    const c = CASES[caseIdx]
    const got = lib.blendRgbByMode(mode, c.A, c.B, c.opacity)
    chk(sameVec(got, exp), `blendSpot id=${mode} case=${caseIdx}`, `${showVec(got)} ≠ ${showVec(exp)}`)
    n++
  }
  const runs = C.colorRuns()
  const byName = new Map(runs.map((r) => [r.name, r]))
  for (const [name, expRet, expAfter] of FROZEN.colorSpots) {
    const run = byName.get(name)
    chk(!!run, `colorSpot 语料存在：${name}`)
    if (!run) continue
    const input = run.t.slice()
    const got = lib.composeColorEffectStack(run.items, input, TEXTURES, run.time, run.u0, run.v0)
    chk(sameVec(got, expRet), `colorSpot 返回值：${name}`, `${showVec(got)} ≠ ${showVec(expRet)}`)
    chk(sameVec(input, expAfter), `colorSpot 入参状态：${name}`, `${showVec(input)} ≠ ${showVec(expAfter)}`)
    n += 2
  }
  const dispRuns = C.displaceRuns()
  const dispByName = new Map()
  for (const r of dispRuns) if (!dispByName.has(r.name)) dispByName.set(r.name, r)
  for (const [name, expSu, expSv] of FROZEN.displaceSpots) {
    const run = dispByName.get(name)
    const got = lib.resolveDisplacedUv(run.items, run.u0, run.v0, TEX, TEXTURES, run.time)
    chk(same(got.su, expSu) && same(got.sv, expSv), `displaceSpot：${name}`, `(${show(got.su)}, ${show(got.sv)}) ≠ (${show(expSu)}, ${show(expSv)})`)
    n++
  }
  const shakeByName = new Map()
  const flowByName = new Map()
  for (const run of dispRuns) if (run.t) { if (!shakeByName.has(run.name)) shakeByName.set(run.name, run); if (!flowByName.has(run.name)) flowByName.set(run.name, run) }
  for (const [name, exp] of FROZEN.shakeSpots) {
    const run = shakeByName.get(name)
    const t = run.t.slice()
    const r = lib.resolveDisplacedUv(run.items, run.u0, run.v0, TEX, TEXTURES, run.time)
    const got = lib.applyShakeMaskMix(run.items, run.u0, run.v0, r.su, r.sv, TEX, TEXTURES, run.time, t)
    chk(sameVec(got, exp), `shakeSpot：${name}`, `${showVec(got)} ≠ ${showVec(exp)}`)
    n++
  }
  for (const [name, expRet, expAfter] of FROZEN.flowSpots) {
    const run = flowByName.get(name)
    const t = run.t.slice()
    const r = lib.resolveDisplacedUv(run.items, run.u0, run.v0, TEX, TEXTURES, run.time)
    const got = lib.applyWaterFlowOverlay(run.items, run.u0, run.v0, r.su, r.sv, TEX, TEXTURES, run.time, t)
    chk(sameVec(got, expRet), `flowSpot 返回值：${name}`, `${showVec(got)} ≠ ${showVec(expRet)}`)
    chk(sameVec(t, expAfter), `flowSpot 入参状态（不得原地改写）：${name}`, `${showVec(t)} ≠ ${showVec(expAfter)}`)
    n += 2
  }
  console.log(`   冻结抽样条目 ${n} 条（含 digest 之外的逐值对拍）`)
}

// ───────────────────── ③ 规格性质断言（独立于实现表述） ─────────────────────
console.log('── ③ 规格性质断言 ──')
{
  const rnd = C.mulberry32(0x5eed)
  const trials = []
  for (let i = 0; i < 240; i++) trials.push({ A: [rnd(), rnd(), rnd()], B: [rnd(), rnd(), rnd()], op: rnd() })
  const blend = (m, A, B, op) => lib.blendRgbByMode(m, A, B, op)
  let bad = 0
  for (const { A, B, op } of trials) {
    // 同义 id；以及"交换操作数"族 —— 注意：交换恒等只在 op=1（返回核本身）时成立，
    // 加权族的插值起点永远是第一个实参（lerp(A, K, op)），所以 op<1 时两条式子不同（规格 §1.3）
    if (!sameVec(blend(20, A, B, op), blend(4, A, B, op))) bad++
    if (!sameVec(blend(13, A, B, 1), blend(11, B, A, 1))) bad++
    if (!sameVec(blend(22, A, B, 1), blend(21, B, A, 1))) bad++
    // opacity 无关族：换一个权重结果必须不变
    for (const m of [5, 10]) if (!sameVec(blend(m, A, B, op), blend(m, A, B, 1 - op))) bad++
    // id 31：权重写在算子里
    const b31 = blend(31, A, B, op)
    if (!sameVec(b31, [A[0] + B[0] * op, A[1] + B[1] * op, A[2] + B[2] * op])) bad++
    // 缺省行 = Normal（0 与未知 id 必须一致）
    if (!sameVec(blend(0, A, B, op), blend(12345, A, B, op))) bad++
    // opacity = 0 的加权族必须逐位回到 A
    for (const m of [1, 2, 3, 4, 7, 11, 12, 18, 24, 30, 32]) if (!sameVec(blend(m, A, B, 0), A)) bad++
  }
  chk(bad === 0, '同义 id / 交换操作数 / opacity 无关族 / 缺省行 / op=0 恒等（240 组随机输入）', `违例 ${bad} 次`)

  // 区间界（只用定义可推出的界，容差 1e-12）
  let out = 0
  const EPS = 1e-12
  for (const { A, B, op } of trials) {
    const chkRange = (m, lo, hi) => { for (const v of blend(m, A, B, op)) if (!(v >= lo - EPS && v <= hi + EPS)) out++ }
    chkRange(1, Math.min(...A, ...B), Math.max(...A, ...B))    // Darken ≤ 两侧
    chkRange(6, Math.min(...A, ...B), Math.max(...A, ...B))    // Lighten ≥ 两侧
    chkRange(2, 0, 1)                                          // Multiply ∈ [0,1]
    chkRange(7, 0, 1)                                          // Screen ∈ [0,1]
    chkRange(18, 0, 1)                                         // Difference ∈ [0,1]
    chkRange(19, 0, 1)                                         // Exclusion ∈ [0,1]
    chkRange(17, 0, 1)                                         // HardMix ∈ [0,1]
    chkRange(24, 0, 1)                                         // Average ∈ [0,1]
  }
  chk(out === 0, '区间界：Darken/Lighten 夹在 A、B 之间；乘/滤色/差/排除/硬混合/平均 ∈ [0,1]', `越界 ${out} 次`)

  // HSL 往返恒等：A == B 时，色相/饱和度/颜色/明度四种混合必须回到自身
  let rt = 0
  for (const { A } of trials) {
    for (const m of [26, 27, 28, 29]) {
      const got = blend(m, A, A, 1)
      for (let i = 0; i < 3; i++) if (!(Math.abs(got[i] - A[i]) <= 1e-9)) rt++
    }
  }
  chk(rt === 0, 'HSL 往返：A == B 时 id 26–29 必须回到自身（|Δ| ≤ 1e-9）', `违例 ${rt} 次`)

  // 灰输入：四个通道相等 ⇒ 色相/饱和度都无定义，26–29 必须原样返回该灰值
  let grey = 0
  for (const g of [0, 0.25, 0.5, 0.75, 1]) {
    for (const m of [26, 27, 28, 29]) {
      const got = blend(m, [g, g, g], [g, g, g], 1)
      for (let i = 0; i < 3; i++) if (!(Math.abs(got[i] - g) <= 1e-9)) grey++
    }
  }
  chk(grey === 0, '灰输入（r=g=b）：HSL 四模式原样返回', `违例 ${grey} 次`)

  // 像素颜色效果：只依据"权重/alpha 恒等"推得的行为
  const pixel = () => [12.5, 200, 77.25, 180]
  {
    const tintZero = lib.composeColorEffectStack([{ type: 'tint', alpha: 0, masked: false, mask: '', blendMode: 2, color: [0.9, 0.15, 0.4] }], pixel(), TEXTURES, 0, 0.5, 0.5)
    chk(sameVec(tintZero, [12.5, 200, 77.25, 180]), 'tint：alpha=0 ⇒ 像素不变（逐位）', showVec(tintZero))
    const tintMode0 = lib.composeColorEffectStack([{ type: 'tint', alpha: 0.3, masked: false, mask: '', blendMode: 0, color: [0.1, 0.2, 0.3] }], pixel(), TEXTURES, 0, 0.5, 0.5)
    chk(same(tintMode0[3], 255), 'tint：blendMode=0 ⇒ alpha 写 255', show(tintMode0[3]))
    const unknownOnly = [{ type: 'no-such-effect', alpha: 1 }]
    const p1 = pixel()
    const ret1 = lib.composeColorEffectStack(unknownOnly, p1, TEXTURES, 0, 0.5, 0.5)
    chk(ret1 === p1, '颜色栈：未知 type 一律跳过且返回同一数组（身份相等）')
    const p2 = pixel()
    const ret2 = lib.composeColorEffectStack([], p2, TEXTURES, 0, 0.5, 0.5)
    chk(ret2 === p2, '颜色栈：空表 ⇒ 返回同一数组（身份相等）')

    // key：keyAlpha=1 ⇒ alpha 不变；keyAlpha=0 且远离 key 色 ⇒ alpha 归 0
    const keyBase = { type: 'key', key: [0.2, 0.4, 0.6], tol: 0.1, fuzz: 0.35, invert: false, flatten: false }
    const keepAlpha = lib.composeColorEffectStack([Object.assign({}, keyBase, { keyAlpha: 1 })], pixel(), TEXTURES, 0, 0.5, 0.5)
    chk(same(keepAlpha[3], 180), 'colorkey：keyAlpha=1 ⇒ alpha 不变', show(keepAlpha[3]))
    // 抠掉的是"与 key 色重合"的像素：距离 0 ⇒ 掩码 0 ⇒ alpha *= keyAlpha
    const dropAlpha = lib.composeColorEffectStack([Object.assign({}, keyBase, { keyAlpha: 0, key: [1, 1, 1], tol: 0, fuzz: 0 })], [255, 255, 255, 200], TEXTURES, 0, 0.5, 0.5)
    chk(same(dropAlpha[3], 0), 'colorkey：颜色与 key 重合 + keyAlpha=0 ⇒ alpha 归 0', show(dropAlpha[3]))
    const keepFar = lib.composeColorEffectStack([Object.assign({}, keyBase, { keyAlpha: 0, key: [0, 0, 0], tol: 0, fuzz: 0 })], [255, 255, 255, 200], TEXTURES, 0, 0.5, 0.5)
    chk(same(keepFar[3], 200), 'colorkey：颜色远离 key 色 ⇒ alpha 不受 keyAlpha 影响', show(keepFar[3]))

    // pulse：amount=0 且 noiseAmount=0 ⇒ 脉冲为 0；pulseAlpha 时 alpha 归 0、rgb 不变（再取 max(0,·)）
    const pulseZero = { type: 'pulse', masked: false, mask: '', bounds: [0.2, 0.9], speed: 1.3, phase: 0.7, amount: 0, noiseAmount: 0, noise: '', noiseSpeed: 0.5, power: 1, pulseColor: false, tintLow: [1, 1, 1], tintHigh: [0, 0, 0], blendMode: 9, pulseAlpha: true }
    const p3 = pixel()
    const ret3 = lib.composeColorEffectStack([pulseZero], p3, TEXTURES, 0.4, 0.5, 0.5)
    chk(sameVec(ret3, [12.5, 200, 77.25, 0]), 'pulse：amount=0 + pulseAlpha ⇒ alpha 归 0、rgb 不变', showVec(ret3))
    chk(ret3 === p3, 'pulse（pulseColor=false）⇒ 原地改写入参（身份相等，规格 §3.4）')
  }

  // 位移：零强度 / 空表 / 只有未知效果的恒等性
  {
    const id = { type: 'scroll', sx: 0, sy: 0, rx: 1, ry: 1 }
    const noop = lib.resolveDisplacedUv([id], 0.31, 0.77, TEX, TEXTURES, 2)
    chk(same(noop.su, 0.31) && same(noop.sv, 0.77), '位移：scroll 零位移 ⇒ 坐标不变（逐位）', `(${show(noop.su)}, ${show(noop.sv)})`)
    const empty = lib.resolveDisplacedUv([], 0.31, 0.77, TEX, TEXTURES, 2)
    chk(same(empty.su, 0.31) && same(empty.sv, 0.77), '位移：空表 ⇒ 坐标不变（逐位）')
    const unknown = lib.resolveDisplacedUv([{ type: 'nope' }], 0.31, 0.77, TEX, TEXTURES, 2)
    chk(same(unknown.su, 0.31) && same(unknown.sv, 0.77), '位移：未知 type 跳过 ⇒ 坐标不变（逐位）')
    // scroll 的公开定义：frac((u0 + sign(s)*s²*t) * r)
    const sc = { type: 'scroll', sx: -0.4, sy: 0.25, rx: 2, ry: 3 }
    const t0 = 1.75
    const got = lib.resolveDisplacedUv([sc], 0.2, 0.6, TEX, TEXTURES, t0)
    const expSu = lib.frac((0.2 + Math.sign(sc.sx) * sc.sx * sc.sx * t0) * sc.rx)
    const expSv = lib.frac((0.6 + Math.sign(sc.sy) * sc.sy * sc.sy * t0) * sc.ry)
    chk(same(got.su, expSu) && same(got.sv, expSv), '位移：scroll = frac((uv + 保号平方位移) × 重复次数)', `(${show(got.su)}, ${show(got.sv)}) vs (${show(expSu)}, ${show(expSv)})`)
    // 零强度 ⇒ 零位移（waves / sway / shake）
    const zeroWave = lib.resolveDisplacedUv([{ type: 'waves', mask: 'mask', direction: 0.9, speed: 0.7, scale: 8, perspective: 0, strength: 0 }], 0.4, 0.4, TEX, TEXTURES, 1)
    chk(same(zeroWave.su, 0.4) && same(zeroWave.sv, 0.4), '位移：waves 零强度 + 零透视 ⇒ 坐标不变')
    const zeroSway = lib.resolveDisplacedUv([{ type: 'sway', noise: 'noise', noiseScale: 0.6, ratio: 0.8, direction: 1.2, strength: 0, masked: false, mask: '', phase: 2.1, speed: 1.4, power: 1.3 }], 0.4, 0.4, TEX, TEXTURES, 1)
    chk(same(zeroSway.su, 0.4) && same(zeroSway.sv, 0.4), '位移：sway 零强度 ⇒ 坐标不变')
    const zeroShake = lib.resolveDisplacedUv([{ type: 'shake', phase: 'phase', flow: 'flow_rgba', speed: 1, fx: 1, fy: 1, bounds: [0, 1], direction: 1, amp: 0, masked: false, mask: '' }], 0.4, 0.4, TEX, TEXTURES, 1)
    chk(same(zeroShake.su, 0.4) && same(zeroShake.sv, 0.4), '位移：shake 零幅度 ⇒ 坐标不变')
  }

  // waterflow：无 flow 项 ⇒ 返回同一数组；有 flow 项 ⇒ 返回新数组（不改写入参）
  {
    const p = pixel()
    const sameIdentity = lib.applyWaterFlowOverlay([{ type: 'scroll' }], 0.5, 0.5, 0.5, 0.5, TEX, TEXTURES, 1, p)
    chk(sameIdentity === p, 'waterflow：无 flow 项 ⇒ 返回同一数组（身份相等）')
    const q = pixel()
    const flowItem = { type: 'flow', phase: 'phase', phaseScale: 1.5, flow: 'flow_rgba', speed: 0.6, strength: 0.45 }
    const outFlow = lib.applyWaterFlowOverlay([flowItem], 0.37, 0.62, 0.37, 0.62, TEX, TEXTURES, 0.75, q)
    chk(outFlow !== q, 'waterflow：有 flow 项 ⇒ 返回新数组')
    chk(sameVec(q, pixel()), 'waterflow：不得原地改写入参', showVec(q))
  }
}

// ───────────────────────── ④ 契约守卫 ─────────────────────────
console.log('── ④ 契约守卫（身份 / 异常语义）──')
{
  let threw = false
  try { lib.composeColorEffectStack(undefined, [1, 2, 3, 4], TEXTURES, 0, 0.5, 0.5) } catch (e) { threw = e instanceof TypeError }
  chk(threw, '颜色栈：非可迭代输入按 JS 语义抛 TypeError（既有行为，未被"顺手加固"改掉）')
  threw = false
  try { lib.resolveDisplacedUv(undefined, 0.5, 0.5, TEX, TEXTURES, 0) } catch (e) { threw = e instanceof TypeError }
  chk(threw, '位移：非可迭代输入抛 TypeError（既有行为）')
  const p = pixel0()
  const tintRet = lib.composeColorEffectStack([{ type: 'tint', alpha: 0.5, masked: false, mask: '', blendMode: 3, color: [0.1, 0.2, 0.3] }], p, TEXTURES, 0, 0.5, 0.5)
  chk(tintRet !== p, 'tint 分支返回新数组（不改写入参）')
  chk(sameVec(p, pixel0()), 'tint 分支不得改写入参', showVec(p))
  function pixel0() { return [12.5, 200, 77.25, 180] }
}

// ───────────────────────── ⑤ 源码守卫 ─────────────────────────
console.log('── ⑤ 源码守卫（旧名/引注/自认措辞归零，新名在位）──')
{
  const src = fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'), 'utf8')
  const from = src.indexOf('// ===== src/render/effects.js =====')
  const to = src.indexOf('// ===== src/render/renderer.js =====')
  const block = src.slice(from, to)
  chk(from > 0 && to > from, 'bundle 分节锚点存在（src/render/effects.js → src/render/renderer.js）')
  const OLD_NAMES = ['applyBlending', 'applyColorChain', 'applyDisplacements', 'applyShakeMasks', 'applyFlowMix', 'rgbToHsl', 'hslToRgb', 'hueToRgb', 'hueBlend', 'satBlend', 'colorBlend', 'lumBlend', 'overlay3', 'softLight3', 'mix3']
  for (const name of OLD_NAMES) chk(!new RegExp('\\b' + name + '\\b').test(block), `旧名已从该节删除：${name}`)
  const NEW_NAMES = ['blendRgbByMode', 'composeColorEffectStack', 'resolveDisplacedUv', 'applyShakeMaskMix', 'applyWaterFlowOverlay', 'hslFromRgb', 'rgbFromHsl', 'hueToChannel', 'lerpRgb']
  for (const name of NEW_NAMES) chk(new RegExp('\\b' + name + '\\b').test(block), `新名在位：${name}`)
  // 上游同名回响（大小写不敏感）：这是审计维度 3b 的判据
  for (const name of ['ApplyBlending', 'RGBToHSL', 'HSLToRGB', 'HueToRGB']) {
    chk(!new RegExp('\\b' + name + '\\b', 'i').test(block), `上游函数名回响归零（大小写不敏感）：${name}`)
  }
  chk(!/[A-Za-z_0-9]+\.(?:frag|vert|h)\s*:\s*\d+/.test(block), '上游 `文件:行号` 引注归零')
  chk(!/逐行翻译|逐字实现|逐字取自|字面翻译|逐字/.test(block), '自认措辞（"逐行翻译/逐字/字面翻译"）归零')
  chk(!/WE_RENDER_CONVENTIONS/.test(block), '悬空文档引用（WE_RENDER_CONVENTIONS）已从该节删除')
  chk(/EFFECTS-COMPUTE-SPEC/.test(block), '该节指向行为规格 docs/EFFECTS-COMPUTE-SPEC.md')
  // 公开标准标注在位（重写后必须能自证"公式来自公开标准"）
  chk(/Compositing and Blending|PDF 1\.7/.test(block), '公开标准出处标注在位（W3C Compositing and Blending / PDF 1.7）')
}

// ───────────────────────── ⑥ 血缘复测（缺资产 SKIP）─────────────────────────
console.log('── ⑥ 血缘复测（与 WE 专有原件对照；仅辅助证据）──')
{
  const assetsRoot = WE_ASSETS
  if (!HAS_ASSETS) {
    console.log('   血缘复测层已跳过（缺 WE 资产根，见首行 SKIP 标记）')
  } else {
    // 与 metrics 同口径：去注释 → 取 token / 归一化字符流
    const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    const tokensRaw = (t) => (stripComments(t).match(/[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*(?:e[-+]?\d+)?|[+\-*/<>=!&|^%?:.,;()\[\]{}]+/gi) || [])
    const tokens = (t) => tokensRaw(t)
    // 去数字变体：数值常量是公开数学（三角级数系数等，规格 §7.3 明确不改写），
    // 表达判据不该被它们主导 ⇒ 另算一份**剔除数字 token**的指标并以此卡阈值
    // （注意：折成 `#` 反而会把不同的数字串成伪造的长匹配，所以是剔除而不是掩码）。
    const tokensMasked = (t) => tokensRaw(t).filter((x) => !/^\d/.test(x))
    const normChars = (t) => stripComments(t).replace(/\s+/g, ' ').trim().toLowerCase()
    function lcsLen(a, b) {
      const n = a.length, m = b.length
      if (!n || !m) return 0
      let best = 0
      let prev = new Uint32Array(m + 1), cur = new Uint32Array(m + 1)
      for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
          cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : 0
          if (cur[j] > best) best = cur[j]
        }
        const t = prev; prev = cur; cur = t; cur.fill(0)
      }
      return best
    }
    const identOverlap = (a, b) => {
      const A = new Set(tokens(a).filter((x) => /^[A-Za-z_]/.test(x)).map((x) => x.toLowerCase()))
      const B = new Set(tokens(b).filter((x) => /^[A-Za-z_]/.test(x)).map((x) => x.toLowerCase()))
      let same = 0
      for (const x of A) if (B.has(x)) same++
      return A.size ? same / A.size : 0
    }
    const src = fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'), 'utf8')
    const slice = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i + a.length); return (i >= 0 && j > i) ? src.slice(i, j) : '' }
    const readAsset = (rel) => { const p = path.join(assetsRoot, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }
    const REGIONS = [
      {
        name: 'blending+HSL',
        body: slice('// ---------- 混合模式（公开标准的分离式混合公式）+ HSL ----------', '// ---------- 像素级颜色效果栈'),
        files: ['shaders/common_blending.h'],
        limit: { token: 6, ident: 0.30 },
        before: { token: 9, noNum: 10, chars: 22, ident: 0.529 },
      },
      {
        name: 'color-chain',
        body: slice('// ---------- 像素级颜色效果栈', '// ===== src/render/renderer.js ====='),
        files: ['effects/tint/shaders/effects/tint.frag', 'effects/pulse/shaders/effects/pulse.frag', 'effects/colorkey/shaders/effects/colorkey.frag'],
        limit: { token: 6, ident: 0.30 },
        before: { token: 8, noNum: 6, chars: 36, ident: 0.303 },
      },
      {
        // 位移 + 水波流整段（含通用工具与共享常量）：与改前的"位移类效果 → 颜色类效果"同语义范围
        name: 'displacement+waterflow',
        body: slice('// ---------- 通用标量与向量工具', '// ---------- 混合模式（公开标准的分离式混合公式）+ HSL ----------'),
        files: ['effects/scroll/shaders/effects/scroll.vert', 'effects/scroll/shaders/effects/scroll.frag', 'effects/shake/shaders/effects/shake.frag', 'effects/waterwaves/shaders/effects/waterwaves.frag', 'effects/foliagesway/shaders/effects/foliagesway.vert', 'effects/foliagesway/shaders/effects/foliagesway.frag'],
        limit: { token: 6, ident: 0.30 },
        before: { token: 9, noNum: 5, chars: 48, ident: 0.180 },
      },
      {
        name: 'waterflow',
        body: slice('// ---------- waterflow：四相循环采样叠加 ----------', '// ---------- 混合模式（公开标准的分离式混合公式）+ HSL ----------'),
        files: ['effects/waterflow/shaders/effects/waterflow.frag'],
        limit: { token: 6, ident: 0.30 },
        before: { token: 8, noNum: 6, chars: 34, ident: 0.145 },
      },
    ]
    let missing = 0
    for (const region of REGIONS) {
      const originals = []
      for (const f of region.files) { const t = readAsset(f); if (t === null) missing++; else originals.push(t) }
      chk(region.body.length > 0, `血缘复测：节内区域可定位（${region.name}）`)
      if (!region.body.length || !originals.length) continue
      const merged = originals.join('\n')
      const tk = lcsLen(tokens(region.body), tokens(merged))
      const ch = lcsLen(normChars(region.body), normChars(merged))
      const tkM = lcsLen(tokensMasked(region.body), tokensMasked(merged))
      const id = identOverlap(region.body, merged)
      const b = region.before
      console.log(`   ${region.name}: LCS-token ${b.token} → ${tk} · 去数字 ${b.noNum} → ${tkM} · LCS-char ${b.chars} → ${ch} · 标识符重合 ${(b.ident * 100).toFixed(1)}% → ${(id * 100).toFixed(1)}%`)
      if (region.name === 'displacement+waterflow') {
        // 这一段的原始字符指标不会下降：最长公共子串就是 sin/cos 级数的公开系数串
        // （`-0.5, 0.041666666, -0.0013888889, 0.000024801587`）。系数是数学常量、值不可改
        // （规格 §7.3），故本段以"去数字"指标 + ⑤ 的四项硬判据为准。
        console.log('     ↳ 说明：本段 LCS-char 的公共子串 = 公开三角级数系数串（数学常量，规格 §7.3 排除）')
      }
      chk(tkM <= region.limit.token, `血缘：${region.name} 最长公共 token 串（去数字）≤ ${region.limit.token}`, String(tkM))
      chk(id <= region.limit.ident, `血缘：${region.name} 标识符重合率 ≤ ${(region.limit.ident * 100).toFixed(0)}%`, (id * 100).toFixed(1) + '%')
      // 原始字符指标只做记录（跨语言 + 共享数学常量 ⇒ 不作判据，见文件头说明）
      chk(ch <= 64, `血缘：${region.name} 最长公共字符子串 ≤ 64（记录性上限）`, String(ch))
    }
    if (missing) console.log(`   （${missing} 个对照原件在本机缺失，已跳过对应项；不影响上述已测项）`)
  }
}

// ───────────────────────── 汇总 ─────────────────────────
console.log(`\n===== clean-room-effects-blend: ${pass} 通过 / ${fail} 失败 =====`)
if (fail) {
  console.log('失败项：')
  for (const f of fails.slice(0, 40)) console.log('  ✗ ' + f)
  if (fails.length > 40) console.log(`  … 其余 ${fails.length - 40} 项略`)
}
process.exit(fail ? 1 : 0)
