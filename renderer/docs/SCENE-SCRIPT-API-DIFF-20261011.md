# 三方 API 面对照（scene-script）：本仓 vs wer-ref 参考实现

（2026-10-11 · 台账 §1.1 第 21 项 / P-279）

## 方法

从 wer-ref 的 C++ 场景脚本宿主/运行时 `references/wer-ref/src/backend/scene/internal/scenescript/*.cpp` 抽取
**字符串字面量形式的 API 名/属性名**（299 个候选），与本仓 `we-scene-demo/elysia/scene-scripts.js` 的字符串+标识符集合（676 个）求差。

## 结论

| 指标 | 值 |
|---|---|
| wer-ref 候选 | 299 |
| 本仓集合 | 676 |
| 交集 | 99 |
| **wer-ref 独有（缺口）** | **200** |

- **来源判定**：wer-ref 是**用 C++ 独立实现**同一套 API（宿主/运行时 C++、脚本仍由 JS 引擎执行）；本仓为 **JS 实现**
  ⇒ **不是副本**，逐字节 diff 无意义，**API 面 diff 才有意义**。
- **全仓复核（core / elysia / demo.html）**：`getBoneTransform`、`setBoneTransform`、`getBoneCount`、`getAttachmentMatrix`、`setParent`、`animationLayer` 命中均为 **0 个文件** ⇒ **真缺失**。
- **语料实测**：抽扫 6 个 mpkg 的全部 `.js` 脚本条目 ⇒ 使用者 = **0** ⇒ **当前零影响**；实现时机 = 出现真实使用档（跟进项 #27）。

## 缺口按族归类

### 骨骼 bone（12 项）

`applyBonePhysicsImpulse`, `getBoneCount`, `getBoneIndex`, `getBoneParentIndex`, `getBoneTransform`, `getLocalBoneAngles`, `getLocalBoneOrigin`, `getLocalBoneTransform`, `setBoneTransform`, `setLocalBoneAngles`, `setLocalBoneOrigin`, `setLocalBoneTransform`

### 挂点 attachment（4 项）

`getAttachmentAngles`, `getAttachmentIndex`, `getAttachmentMatrix`, `getAttachmentOrigin`

### 层操作/父子（5 项）

`parent`, `setParent`, `blend`, `destroy`, `animationLayer`

### g_* 全局常量（10 项）

`g_Color4`, `g_UserAlpha`, `g_Alpha`, `g_Color`, `g_Brightness`, `g_BloomStrength`, `g_BloomThreshold`, `g_BloomTint`, `g_LightAmbientColor`, `g_LightSkylightColor`

### 相机/特效参数（9 项）

`screen`, `bloomstrength`, `bloomthreshold`, `bloomtint`, `cameraparallax`, `cameraparallaxamount`, `cameraparallaxdelay`, `cameraparallaxmouseinfluence`, `screenPosition`

## 全部缺失名（200 项，按 wer-ref 出现次数降序）

`screen`, `g_Color4`, `parent`, `setParent`, `blend`, `destroy`, `g_UserAlpha`, `animationLayer`, `applyBonePhysicsImpulse`, `bloomstrength`, `bloomthreshold`, `bloomtint`, `cameraparallax`, `cameraparallaxamount`, `cameraparallaxdelay`, `cameraparallaxmouseinfluence`, `g_Alpha`, `g_Color`, `getAttachmentAngles`, `getAttachmentIndex`, `getAttachmentMatrix`, `getAttachmentOrigin`, `getBoneCount`, `getBoneIndex`, `getBoneParentIndex`, `getBoneTransform`, `getLocalBoneAngles`, `getLocalBoneOrigin`, `getLocalBoneTransform`, `setBoneTransform`, `setLocalBoneAngles`, `setLocalBoneOrigin`, `setLocalBoneTransform`, `unknown`, `__nodeId`, `__sceneScriptEnv`, `ambientcolor`, `brightness`, `clearcolor`, `farz`, `g_Brightness`, `hasThumbnail`, `nearz`, `skylightcolor`, `state`, `LogoShake`, `__currentValue`, `__dispatchMediaPlayback`, `__dispatchMediaProperties`, `__dispatchMediaThumbnail`, `__mediaState`, `__propertyName`, `__sceneLayerEvents`, `__sceneLayers`, `__videoTextureEvents`, `__videoTextureStates`, `addAnimationLayerEndedCallback`, `albumArtist`, `albumTitle`, `animationLayerCall`, `applyGeneralSettings`, `artist`, `clearTimer`, `contentType`, `createSceneLayer`, `cursorClick`, `cursorDown`, `cursorEnter`, `cursorLeave`, `cursorMove`, `cursorUp`, `destroySceneLayer`, `effect`, `enumerateSceneLayers`, `genres`, `getAnimationLayerProperty`, `getChildren`, `getEffectMaterialProperty`, `getEffectProperty`, `getInitialSceneLayerConfig`, `getLayerChildren`, `getLayerPropertyById`, `getLayerRelation`, `getPropertyAnimationProperty`, `getSceneLayer`, `getSceneLayerCount`, `getSceneLayerIndex`, `getSceneProperty`, `global_perspective`, `hasAnimationLayer`, `hasAnimationLayerMember`, `hasEffect`, `hasEffectMaterial`, `hasEffectMaterialMember`, `hasEffectMember`, `hasSceneMember`, `hasTextureAnimation`, `hasVideoTexture`, `highContrastColor`, `info`, `initialConfig`, `isDeferredRuntimeLayer`, `layerCall`, `localStorageClear`, `localStorageDelete`, `localStorageGet`, `localStorageSet`, `method`, `parentId`, `primaryColor`, `propertyAnimationCall`, `resizeScreen`, `resolveAnimationLayer`, `resolveEffect`, `resolveLayerAnimation`, `resolvePropertyAnimation`, `rotateLayerObjectSpace`, `rotateObjectSpace`, `secondaryColor`, `setAnimationLayerProperty`, `setEffectMaterialProperty`, `setEffectProperty`, `setLayerPropertyById`, `setPropertyAnimationProperty`, `setSceneProperty`, `setTimer`, `sortSceneLayer`, `sound`, `stack`, `subTitle`, `tertiaryColor`, `textColor`, `textureAnimationCall`, `textureAnimationGet`, `textureAnimationSet`, `timeOfDay`, `title`, `videoTextureCall`, `workshopId`, `JSON`, `LANG`, `LC_ALL`, `LC_MESSAGES`, `Text258`, `Text282`, `anchor`, `animationLayerEnded`, `backgroundbrightness`, `backgroundcolor`, `button`, `compile`, `compo1`, `compo2`, `compo3`, `currentTime`, `emitter`, `engineBase`, `evaluation`, `g_BloomStrength`, `g_BloomThreshold`, `g_BloomTint`, `g_LightAmbientColor`, `g_LightSkylightColor`, `generalSettings`, `genericimage3`, `hidden`, `instanceId`, `instantiate`, `isSound`, `language`, `layerId`, `limitrows`, `limitwidth`, `material`, `materialUniform`, `maxrows`, `maxwidth`, `native`, `nodeId`, `objectIndex`, `objectKind`, `opaquebackground`, `padding`, `paused`, `posix`, `propertyName`, `raythreshold`, `screenPosition`, `sort`, `soundPlaying`, `stopped`, `targetIndex`, `timer`, `u_enabled`, `u_strength`, `u_threshold`, `u_tint`, `unknown_id`, `workshop`, `worldPosition`
