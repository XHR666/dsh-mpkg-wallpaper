# 已移出文档里的事实留存

这些句子原来在未被 README 和插件引用的说明里。说明文件已移出仓库。句子留在这里，是为了让「含标记的删除必须还能找到事实」这条判据继续成立。

## docs/AUDIO-SOURCES.md

> 用户原话（判据来源）：
设置前提（用户真机当时的档）：`mute = true`（面板写着静音）、`npLinkWallpaper = true`、壁纸 = `custommpkg|小鸟游星野01_04.mpkg`（video 档）。
| 每条记录带 `el.owner`（`ours` / `whale-widget` / `frame` / `other`） | 用户问"这声音是谁放的"时一眼能分类；`whale-widget` 就是按 `src` 里的 `/dsh-whale/` 认出来的 |
用户原话：「不动别人的插件」「别人插件的音效**必须我去交互他才会出现，并不会自己出现**」。
owner 只有 `whale-widget`（第三方，且按用户要求**不由我们控制**）。要让下一次**可定案**，本轮补了
4. **鲸鱼音效开关属于用户的偏好**：默认只如实报告与给出做法，不替用户改（用户明确要求时再改，见 §5 A）。

## docs/FOG-MODEL.md

> 2026-10-02 用户拍板后，语义与旧版**方向相反**，并新增了"单独动过就独立"的归属规则 ——
## 0. 三条用户拍板的语义（判据钉死）
用户原话：「调整整屏虚化程度到 0px 时左侧边栏是正常的，但把整屏虚化程度调大时，左侧边栏会被
正是用户报的"变成白色不透明"与"标题栏固定白底"。
用户看到"设置一开左栏就变黑"；交还宿主后那层黑是宿主自己的行为。
  `follow=true / amt=30 / side=45`）。用户口径原话："如果是关闭的，那就还是跟随去调整"。

## docs/RETIRED-SWITCH-GLASSWINDOW.md

> 标**需用户拍板**）＋ 用户本轮给的政策与授权：**「不留"看得见却点不动"的死文案」**、

## docs/zcode-progress-main.md

> 背景：上一轮未提交改动经软链生效到真机后出现 §2 十二类回归（用户实测，有壁纸才出现）。
> 读数来源：`docs/PROBE-READINGS-ROUND3-FINAL.md`（用户真机 Firefox 四轮采样）。
- 真机验证要求（用户要求的实际层叠验证）：打开三点菜单 + 滚到代码块标题条贴住标题栏下方
## 修复（按用户要求的 wrapper/scroller 分层）
| 迭代 3（91ad8c9，最终形态） | 按用户要求的 wrapper/scroller 分层：<br>**面板 = wrapper**：`overflow:hidden`（不滚动）+ 磨砂 ::before 回退 `absolute; inset:0`（不参与滚动内容布局，恒覆盖可视区）；三条路径（rsblur/unify/fullscreen）同族<br>**pane (dockkit-pane) = 内层滚动容器**：`overflow-x:hidden + overflow-y:auto + max-height:100%`（从与 strip 合写的规则拆出）<br>**面板填满视高**：`height: calc(100vh-20px)`（auto 被内容撑成半截，真机截图 54%）<br>**flex 链 min-height:0**：面板 `display:flex + flex-direction:column + 子代 min-height:0`（D1 读数：_paneBody 长到 1276 > panelBody 817，标准 flexbox 滚动修复）；pane max-height 从视口近似(100vh-60px)改为面板相对(100%) |

## docs/zcode-progress-ui.md

  - ⇒ 收起态悬浮观感**本来就是我们自己的** `body[data-mpw-float] [data-sidebar-collapsed] [class*="sidebarCol"]` 外壳规则（margin 12px -12px 12px 12px + `--mpw-side-radius` 令牌圆角 + 边框 + `--mpw-float-shadow`）在画；c1a55a6 用 `!important` 把这三件套连同 padding 清零 = 用户看到的"悬浮效果消失"，且右栏面板（同命中 sidebarCol 子串）在左栏收起期间被误清。

