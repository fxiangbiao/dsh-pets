# 插件架构

代码在 **`dsh-pets\plugin\src\client\`**（下称 `client/`）—— 这是唯一主源。
`…\deepseek-harness\packages\client\ui-pet\` 只是 `sync-to-harness.mjs` 同步出来的**构建副本**，
改代码改主源，然后 `node sync-to-harness.mjs --build`（见根 `README.md`）。
本文只讲结构与扩展点；颜色规则、几何算法、语音链路分别在专门的小节里。

## 1. 怎么挂上去的

`client/index.ts`（浏览器半边）：

```ts
export const inject = ['slots', 'sessions', 'locale']
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('pet', { zh, en }), 'ui-pet: dictionaries')
  ctx.slots.inject('shell.overlay', () => {
    const monitor = new PetMonitor(ctx)                    // 跟随当前会话
    const dispose = ctx.slots.register({
      name: 'shell.overlay', id: 'pet', order: 60, locale: 'pet',
      store: createPetPrefsStore,
      inject: () => ({ hooks: { pet: monitor },
                       submitVoice: (text) => submitVoice(ctx, text),
                       cancelTurn: () => cancelTurn(ctx) }),
    }, PetWidget)
    return () => { dispose(); monitor.dispose() }
  })
}
```

- 槽位是 `shell.overlay`（layout 插件拥有），`order: 60` 让宠物压在其他状态浮标之上。
- 没有模块级单例：monitor 与 store 实例都归这个插件的 fiber 所有，插件重载不会复用旧句柄。
- `submitVoice` 走 `session.beginSubmission({ mode: 'queue' })` + `session.prompt(..., 'queue', …, requestId)`；失败时 `handle.abandon()`。
  `mode: 'queue'` 是刻意选的（不打断正在跑的回合），排查"语音没进去"时可以拿它当特征。
- 宠物 widget 拿到的是 `{ usePet, useStore, actions, t, submitVoice, cancelTurn }`。

## 2. 模块表

| 模块 | 职责 | 关键导出 |
|---|---|---|
| `index.ts` | 插件注册（上面的接线）、会话提交 | `inject`, `apply` |
| `contract.ts` | 客户端/宿主之间的契约类型 | `PetInjected`, `PetWidgetProps`, `PetPrefsStoreHandle` |
| `pet-types.ts` | 全部类型与默认值（`PetPose` 在 `sprite.ts`） | `AvatarId`, `PetSkin`, `PetState`, `PetStats`, `DEFAULT_STATS`, `PetPrefsState`, `PetStatCounter`, `PetPrefsActions` |
| `pet-store.ts` | 持久化偏好 store | `createPetPrefsStore` |
| `monitor.ts` | 监听会话事件，发布 `PetState` | `PetMonitor`, `textOfBlocks` |
| `personas.ts` | 形象/皮肤/音色/指令的人设数据 | `AVATARS`, `DEFAULT_AVATAR`, `nextAvatar`, `avatarVoice`, `SKINS`, `nextSkin`, `skinKey`, `bondLevel`, `BOND_PER_LEVEL` |
| `sprite.ts` | 姿势 → 帧表、轮廓、绘制尺寸 | `PetPose`, `IDLE_ANTICS`, `spriteSheet`, `spriteBox`, `figureContour`, `poseFrames`, `poseCycleMs`, `calcPose` |
| `ring.ts` | 环形按钮布局（纯函数） | `ringLayout`, `RING_BUTTON` 等常量 |
| `rail.ts` | 溢出按钮条落位（纯函数） | `railPlacement`, `RAIL_EDGE` |
| `skin.ts` | 换肤重新上色（HSV 窗口） | `skinRecipe`, `recolors`, `recolorPixels`, `recoloredSheet` |
| `voice.ts` | 浏览器识别/合成 + 音效播放 + 设备能力判定 | `createRecognizer`, `speak`, `cancelSpeech`, `requestMicPermission`, `onDeviceStatus`, `chineseVoiceOrWait` |
| `localStt.ts` | 本地转写（录音 + 上传） | `DEFAULT_STT_URL`, `startLocalRecording`, `transcribe`, `discoverEndpoint` |
| `localTts.ts` | 本地合成（分句 + 流式播放，每句向音频总线闪避） | `speechEndpoint`, `sentences`, `speakNeural`, `stopNeural` |
| `audioBus.ts` | 音频总线：共享 AudioContext、音乐增益（闪避）、分析器（节拍） | `resume`, `musicNode`, `mediaSource`, `duck`, `unduck`, `musicLevel` |
| `music.ts` | 本机音乐客户端：发现服务、歌单、播放/进度、持久化与窄校验 | `configure`, `getState`, `subscribe`, `play`, `skip`, `setVolume`, `setLoop`, `setShuffle`, `setRoots`, `nextRoots`, `sameRoot`, `toMusicPrefs`, `level` |
| `commands.ts` | 语音指令匹配 | `COMMANDS`, `matchCommand`, `normalizeCommand` |
| `achievements.ts` | 成就规则与迁移 | `ACHIEVEMENTS`, `toStats`, `toUnlocked`, `newlyEarned`, `nextGoal`, `bondTitleKey` |
| `clipboard.ts` | 复制（含无安全上下文回退） | `copyToClipboard` |
| `locales.ts` | 中英文案 | `NS='pet'`, `zh`, `en`, `PetKey` |
| `sfx.ts` / `arts/sprite-data.ts` | base64 音效 / 贴图数据（bundle 体积主要在这） | `playSfx`, `PET_ART` |
| `PetWidget.tsx` + `.module.css` | 控件本体：环形按钮、气泡、状态卡、输入条 | `PetWidget` |

## 3. 状态与数据流

```
会话事件 ──► PetMonitor ──► PetState ──(hooks.pet)──► PetWidget ──► 姿势/气泡/动作
                                             │
用户操作 ──► prefs store（持久化）───────────┘
```

- `PetState` 是只读快照（`running`, `tool`, `lastAssistant`, `assistantTick`, `emotion` …），widget 订阅它决定姿势与文案。
- `PetStats` 是四个计数器 `pets | performs | voices | commands`；成就由 `newlyEarned(stats, unlocked)` 推导。
- 亲密度 `bond` 用 `addBond` 累加，`BOND_PER_LEVEL = 10` 一级，称号由 `bondTitleKey(level)` 给。

## 4. 持久化

持久化键 `dsh.pet.prefs`（root scope）。**整体替换**是这里最大的坑：

- 旧版本写下的 state 缺少新字段（例如加成就之前的 `stats`），所以读的时候一律过一遍校验：
  `toStats((draft as {stats?: unknown}).stats)` / `toUnlocked(draft.achievements)`。
  在解构/自增之前必须先校验，否则会在 `undefined` 上自增。
- 写动作：`setAvatar` `setSkin` `setMuted` `setOpen` `setCompact` `setPos` `setBond`(addBond) `bumpStat`
  `noteSkin` `noteAvatar` `unlockAchievement` `setSttUrl`。
- `noteSkin` / `noteAvatar` 只追加、不重复，用来支撑"全都试过"这类成就。**加新皮肤/新形象时这两个列表是历史记录，不要清空。**
- **形象 id 是持久化数据的一部分**：`whale` 这个 id 现在显示为"鲸鱼娘"，改成别的 id 会让老用户的选择失效。改显示名安全，改 id 需要迁移。
- **`open` / `compact` 是历史遗留字段**：环形改版之后没有面板了，widget 不再读也不再写它们，只剩 store 的动作与类型还留着（删掉要动老 store 的形状，暂不动）。新代码别再用这两个字段。

## 5. 美术与姿势

- 贴图是一整条横向 strip（`PET_ART[avatar] = { url, frameWidth, frameHeight, frameCount }`），
  在 168px（`SPRITE_SIZE`）下按 `frameHeight/frameWidth` 等比缩放（`spriteBox`）。
- 每个形象有自己的帧语义表（`sprite.ts` 顶部注释，人/机器人/银月各一套），`POSE_FRAMES` 把
  11 个姿势映射到帧号或两帧循环。**两帧循环只挑"读得出差别"的一对**（张嘴、起伏），
  260ms 一次的形状跳变会闪。
- `FIGURE_CONTOUR` 是环几何用的"美术轮廓"（36 个 10° 步进的半径，从正右起顺时针）。
  换美术必须重测（见 `art-pipeline.md`），且读表时**取本格的值，不要插值邻居**。
- `IDLE_ANTICS` 是闲着时随机摆的姿势；`calcPose(pet, listening, celebrating)` 是稳态姿势；
  表演 > 说话 > 摸头 > 实时工具 > 反应 > 稳态 的优先级在 `PetWidget.tsx` 里（`pose` 那段）。

## 6. 皮肤系统

两层，互不叠加：

1. **重上色（真换色）** — `skin.ts`：把像素转 HSV，**只旋转"角色调色板"那一段色相窗口**，
   生成新的 data URL 给精灵；一次算完缓存（LRU 4）。肤色、腮红、白色围裙、金色滚边、深色描边都在窗口外，因此不动。
   鲸鱼娘与机器人有配方；银月**故意没有**。
2. **CSS 替身** — `.pet[data-skin=…] { --pet-skin-filter: …; --pet-glow: … }`：
   彩色贴图就位前/失败时的无色调兜底，加上每个皮肤的**光晕**（`--pet-glow` 是宠物背后的光，不是对宠物本身加滤镜）。
   重上色成功时 widget 会给精灵内联 `filter: none` 关掉替身。

银月的例外：她的手绘立绘不适合色相窗口，所以她的皮肤只改**饱和度/亮度 + 边缘光**（CSS，调过眼睛的那套）。
给她加 `skin.ts` 配方会和这套 CSS 打架。

> 历史教训：第一版皮肤是给整只立绘套 `filter: hue-rotate()`。它分不清皮肤与衣服 —— 鲸鱼娘的脸变粉、薄荷直接变品红。
> 别再走这条路。

## 7. 主题与对比度不变量（重要）

DSH 的 alias token 会随明暗主题**反转极性**，而且不总是"彩色"：

| token | 浅色主题 | 深色主题 |
|---|---|---|
| `--dsw-alias-brand-primary`（鲸鱼的 `--pet-accent`） | `rgb(15,17,21)` 近黑 | `rgb(249,250,251)` 近白 |
| `--dsw-alias-label-primary-foreground` | 白 | 近黑 |
| `--dsw-alias-bg-layer-2` | 白 | `rgb(44,44,46)` |

所以：

- **实色强调底上的墨色只能来自 `--pet-on-accent`**（默认深墨；鲸鱼取 `label-primary-foreground` 跟着主题反转）。
  写死 `#10141c` 就会在浅色主题下得到黑底黑图标——这正是"全黑按钮"那次 bug（对比度 1.02:1）。
- **强调底的配方统一**：`color-mix(in srgb, var(--pet-accent) 88%, var(--dsw-alias-bg-layer-2))`，
  用在 `.bubbleActive` / `.inputIcon` / `.sttSave`。混入 12% 表面色不是装饰，它让**文字按钮**在任何强调色下都够对比度
  （银月浅色主题的品牌蓝，原来 4.35:1，混后 5.27:1）。
- **强调色不能当"卡片上的图标色"**：卡片的底色是主题 overlay（浅色主题浅、深色主题深），与强调色极性无关。
  状态卡的"已复制 ✓"原来用强调色画，机器人浅色主题只有 1.87:1（等于看不见）。现在它用卡片自己的墨色 + 强调色描边。
- 三道防线：`_probe/test-accent-ink.mjs`（解析宿主题 token 图算对比度 + 结构守卫）、
  `_probe/shot-accent.cjs`（像素回读）、`_probe/shot-contrast.cjs`（全部 120 个图面）。改动颜色后跑它们。

## 8. 环形按钮几何

- 常量：`RING_BUTTON=40`、`RING_CLEARANCE=6`（按钮与美术的净空）、`RING_MIN_SPACING=54`、`RING_MAX_SPACING=84`、`RING_EDGE=8`。
- `ringLayout({ pet, view, figure, actions })` → `{ slots, toggle, hidden, overhang }`，纯函数、可测：
  对每个候选角度解"到轮廓的欧氏距离 ≥ 净空"，找出**最宽的一段可用弧**，把按钮摆上去；
  闭合环按 `总数/动作数` 均匀铺，展开弧按 `总数/(动作数-1)` 截断到 `RING_MAX_SPACING`。
- 宠物默认停靠 `right:18px; bottom:14px` → 右侧与下侧不可用，可用弧有限。**最坏情况容量是 7**，
  所以 6 个动作永远不触发折叠；折叠（`toggle` + rail）是用合成 12 个动作的场景测的。
- 溢出条只画"环里放不下的"，位置来自 `railPlacement`；`ring.overhang` 会通过 `--rail-gap`
  把 rail 推到环的外侧，避免压在环的按钮上。
- 环未展开时按钮 `pointer-events: none`（否则会吞掉"摸头"的点击）。

## 9. 语音与音效链路

- **输入**：`localStt.startLocalRecording(url)` 录音 → `transcribe(url, blob)` 上传；
  `discoverEndpoint()` 在店里 `sttUrl` 为空时自动探测 `http://127.0.0.1:8756`。
  失败会走"打字回退"（输入条），并且**一定给出一句说明**（以前静默失败看不出任何反应）。
- **识别（浏览器侧）**：`voice.createRecognizer`（Web Speech）。设备能力判定
  （`recognitionSupported` / `onDeviceStatus` / `requestMicPermission`）决定走哪条路。
- **输出**：优先本地合成 `localTts.speakNeural`（`speechEndpoint()` 把转写地址换成 `/v1/audio/speech`），
  按 `sentences()` 分句流水线播放（第一声更早）；不可用时回退浏览器 `voice.speak`。
- **音效**：`sfx.playSfx(avatar, name)`，`name ∈ {voice, avatar, perform0..3}`，数据是 base64 m4a。
- 排障提示里带的 `UI_REV`（`PetWidget.tsx` 顶部）是给用户截图对版本用的：动过语音相关逻辑就 bump 一下。

## 9b. 音乐链路（详见 `docs/music.md`）

- **服务**：`pet-music.mjs`（宿主插件，**进程内** `node:http`，默认 `127.0.0.1:8791`）扫描目录、
  出歌单、按 id 流式发送文件（支持 Range —— 没有它 `.mp4` 连时长都拿不到）。
- **客户端**：`music.ts` 发现服务 → `GET /v1/music/tracks` → `<audio crossOrigin>` 指向
  `/v1/music/stream/<id>`；进度节流到 4 Hz 发布，歌单顺序/随机/循环都在客户端。
- **总线**：`audioBus.ts` 是语音和音乐**共用**的那一层。`localTts` 每句话 `duck('speech')`、
  结束（含取消）`unduck('speech')`；`musicLevel()` 取 40–180 Hz **最强 bin**（不是平均）
  给 `PetWidget` 的 rAF 循环写 sprite 的 `transform`。
- **音乐条**：由 `PetWidget` 直接渲染（不是 rail 的一部分），位置 = 宠物中心上方 + `musicBarOffset`
  （拖动写入 `pet-store`，窄校验读 `toBarOffset`），再加一个**每次渲染重算的平移量**把条留在视口内。
  整条是把手，按在按钮上不算拖；`X` = 停止 + 收起，收起后**不会自己回来** ——
  只有浮动音乐按钮（`barPinned`，只打开不发声）和"关掉之后新出现的失败"能让它回来。
- **换播放目录**：条上的 📁 打开绝对定位的面板，`换目录…/添加目录…/恢复默认` 三个动作经
  `nextRoots` 算出新列表 → `music.setRoots`（列表走 PUT，空列表走 DELETE）→ 服务重扫 → 新库。
  目录名的来源是**服务回报的 `roots`**（`MusicState.roots`），不是偏好：偏好为空表示"听服务的"。
  选择器来自宿主 `ctx.uiWorkspace.pickDirectory()`，通过**可选** prop `pickFolder` 注入
  （`ctx.get('uiWorkspace')` + 结构化接口，不新增包依赖）：没有它就禁用按钮并写明原因。
  细节与"别再改回去"清单见 `docs/music.md` 第 6 节。
- **崩溃面**：`PetWidget` 是包在 `PetCrashFace`（class error boundary）里的薄壳，
  boundary **必须在 widget 本体之外** —— 渲染期 hook 抛的错只有祖先能接住。
  没接住时 slot renderer 会给这个 entry 画一个空 `div`：宠物凭空消失、只剩 console 里一行。
  现在换成一个 34px 的角标，`title` 里带错误原文，点一下重试。
  （起因：面板直接读了旧 store 里不存在的 `musicRoots`，见 `docs/music.md` 第 6 节。）
- **不做的事**：曲库浏览器、加目录的 UI、封面、视频画面 —— 清单见 `docs/music.md` 第 7 节。

## 10. 扩展配方

**加一个动作按钮**：`ACTION_ORDER` 里加 id → `actionSpecs` 里写 `{ label, active?, icon, run }` → 写个 `XxxIcon`。
环形位置不够会自动折进 rail，不用自己排版；但超过 7 个之后要顺便看 rail 的实测截图。

**加一个形象**：
1. 出美术 → 条带 → `arts/sprite-data.ts` 加一项（`docs/art-pipeline.md`）；
2. `pet-types.ts` 的 `AvatarId`、`personas.ts` 的 `AVATARS`/`avatarVoice`/`avatarAccent`；
3. `sprite.ts` 的 `FIGURE_CONTOUR`（**必须实测**）与 `POSE_FRAMES`；
4. CSS `.pet[data-avatar='…'] { --pet-accent; --pet-on-accent }`；
5. `locales.ts` 的 `avatar.*` / `greeting.*` / `perform.*`；
6. 探针：`test-ring.mjs`（把新形象加进场景）与 `shot-contrast.cjs`（`SURFACES` 里的头像循环）。

**加一个皮肤**：`personas.ts` 的 `SKINS`/`skinKey` + `locales.ts` 的 `skin.*` + `skin.ts` 配方（可选）
+ CSS `[data-skin='…']` 的 `--pet-glow`/替身滤镜 + `test-skin.mjs` 的窗口断言。

**加一个成就**：`achievements.ts` 的 `ACHIEVEMENTS` 加 `{ id, key, reached(stats) }`，必要时扩
`PetStatCounter`；`locales.ts` 加 `ach.<id>` 与标题；`test-achievements.mjs` 有一条"每个成就都有文案"的检查。

**加一条语音指令**：`commands.ts` 的 `COMMANDS` 加 `{ id, phrases }`（以及 `PetCommandId` 联合类型；
前置噪声与唤醒词的正则也在该文件）+ `locales.ts` 的 `cmd.*` + `PetWidget.tsx` 的 `switch (command)` 分支。
`test-commands.mjs` 检查"匹配得准且不误伤"。**措辞不要跨语义复用**：`别说了`（让宠物闭嘴）和
`别放了`（关音乐）必须保持不同，否则用户在最需要被听懂的时候得到一个硬币抛掷。

**动音乐**：`music.ts`（客户端播放/歌单/持久化）、`audioBus.ts`（混音、闪避、节拍）、
`pet-music.mjs`（服务端扫描与流式）。三个都有专属探针；改 `pet-music.mjs` 后记得 bump
profile patch 里的 `?v=`。协议、端口、格式与未做清单见 `docs/music.md`。

**调姿态/节奏**：`sprite.ts` 的 `POSE_FRAMES` 与 `poseCycleMs`；widget 顶部的
`SPRITE_SIZE`（168）、`STAGGER_MS`（26，按钮逐个弹出的间隔）、`STATUS_MS`（12000，状态卡停留）、
`COPIED_MS`（1600，复制确认）、`HINT_MS`（3200，提示停留）、`RING_GAP`、`CARD_MARGIN`。

## 11. 验证入口

见 `docs/probe-harness.md`。最短路径：改完 → 构建 → `node _probe/test-*.mjs` →
两个浏览器探针 → GUI 刷新肉眼确认。
