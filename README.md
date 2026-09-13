# dsh-pets — 电子宠物（DSH 插件 + 美术 + 探针 + 文档）

DSH（DeepSeek Harness）里那只浮动电子宠物的**全部内容**：插件源码、美术流水线、测试探针、本地语音服务、文档。
一个目录，可以直接 `git init`。

## 代码在哪：一份主源 + 一个构建副本

| 位置 | 角色 | 版本控制 |
|---|---|---|
| `dsh-pets\plugin\` | **主源**：插件的全部源码（TS/TSX + CSS + 美术数据） | ✅ 本仓库 |
| `dsh-pets\` 其余 | 美术、探针、语音服务、文档 | ✅ 本仓库 |
| `…\deepseek-harness\packages\client\ui-pet\` | **构建副本**：由 `sync-to-harness.mjs` 同步出来的，只为编译 | ❌ 可随时重建 |

为什么副本必须在 harness 里：`plugin/tsconfig.json` 继承工作区基础配置，并 project-reference 了
`ui-slots` / `ui-renderer` / `api-session-controller` 等兄弟包，**离开工作区无法编译**。

所以改插件的流程是三步：

```powershell
# 1. 编辑主源      D:\ALAN\Codes\dsh-pets\plugin\src\client\…
# 2. 同步 + 构建
node sync-to-harness.mjs --build
# 3. GUI 里 Ctrl+R（没生效就 Ctrl+Shift+R）
```

`sync-to-harness.mjs` 的用法：

| 命令 | 作用 |
|---|---|
| `node sync-to-harness.mjs` | 同步：补新文件、覆盖改动、**删除主源里已删掉的文件** |
| `node sync-to-harness.mjs --check` | 只报告漂移（缺失 / 不同 / 多余），不同步；有漂移退出码 1 |
| `node sync-to-harness.mjs --build` | 同步后重建 `lib/client.js`，并校验产物比所有主源文件都新 |

- 副本里的 `lib/`（构建产物）与 `node_modules/` **永不被碰**，也不会被删。
- 副本根目录上不认识的文件（比如临时放的笔记）只会被提示，不会被删。
- 换 checkout 就设环境变量：`$env:DSH_HARNESS='D:\其他路径\deepseek-harness'`。
- **探针读的是主源**（`dsh-pets/plugin/src/client`），所以"忘了同步"只会让 GUI 落后，不会让测试给出假绿灯。
- 整个副本目录都不见了（harness 重装 / 全新 clone）也能救：`node sync-to-harness.mjs --build`
  会先把源码与配置从主源重建出来。**但依赖链接不归它管** —— 新重建的包没有 `node_modules`，
  `tsc` 会报 `Cannot find module 'react'`，那时跑一次
  `cd <harness>; corepack pnpm install --no-frozen-lockfile --ignore-scripts`
  （本机 `pnpm-lock.yaml` 里没有 ui-pet 这一项 —— 这个包是手工加进工作区的 —— 所以 frozen 安装会拒绝）。
- `--build` 在**任一构建步骤退出码非 0 时判定失败**。bundle 仍会生成（打包器不做类型检查），
  但"类型检查没过"就是构建不干净，脚本不会把它报成成功。

## 目录地图

```
README.md                  你在这里
.gitignore                 只忽略生成物与常识噪音
sync-to-harness.mjs        主源 → 构建副本的同步器（--check / --build）
plugin\                    ★ 插件主源（= harness 里那个包的全部内容，除 lib/node_modules）
  src\index.ts             宿主半边入口（空实现）        src\client\  … 20 个模块 + CSS
  src\client\arts\sprite-data.ts   三只看板的条带（base64，1.79 MB，bundle 体积主要在这）
  package.json / tsconfig.json / tsdown.config.ts / README.md    包自己的元数据
docs\
  architecture.md          模块表、状态与数据流、持久化坑、皮肤/主题不变量、环几何、扩展配方
  art-pipeline.md          素材 → 抠图 → 条带 → sprite-data.ts 的完整流程与换美术仪式
  probe-harness.md         每个探针查什么、怎么跑、生成物怎么重建
  local-speech.md          本地语音服务（STT + TTS）、supervisor 接线与配置
  music.md                 本机音乐服务：端口、配置、协议、支持的格式与已知限制
pet-stt-supervisor.mjs     ★ DSH host 插件：随宿主启停本地语音服务（绝对路径被引用，别移动）
pet-music.mjs              ★ DSH host 插件：给宠物放本机音乐（扫描 + HTTP Range 流式）
local-stt-server.py        ★ 本地服务本体：faster-whisper 转写 + edge 语音合成
start-stt.cmd              ★ 手动启动服务（%~dp0 找同目录的 py）
pet.patch.yml              ★ 给未安装插件包的 harness 用的浏览器插件补丁
art\
  pipeline\  gen-*.ps1         生成脚本（条带、音效、鲸鱼娘抠图）
  tools\     silver-*/scan-*/verify-*/skin-preview.ps1   分析与 QA 工具
  sources\   各形象透明底板、水印样本、姿势渲染            ← 美术的输入
  out\       已发布的条带、鲸鱼娘接触表、whalegirl.json、上一代卡通鲸鱼  ← 美术的输出
  sfx\       18 个 .m4a 音效剪辑（gen-sfx.ps1 的产物，也内联在 sfx.ts）
_probe\     Node 探针 + 浏览器探针 + 静态预览生成器 + shots\（截图证据）
_attic\     已废弃的实验脚本（proto-*、crop-*、tts-eval\ 的引擎评估），保留仅作参考
```

`★` = 被运行中的 DSH 按绝对路径引用，**不要移动/改名**（见下）。

## 跑测试

```powershell
# Node 探针：1130 项，毫秒级，读的是主源
Get-ChildItem _probe\test-*.mjs | ForEach-Object { node $_.FullName }

# 浏览器探针：借 harness 里的 playwright + 系统 Edge
$env:NODE_PATH='D:\ALAN\Codes\deepseek-harness\apps\web\node_modules'
node _probe\shot-accent.cjs      # 42 项：强调色墨色（含像素回读）
node _probe\shot-contrast.cjs    # 120 个图面：全量对比度
node _probe\probe-mp4-path.cjs   # mp4 当音乐放（真出声 + 跨源 analyser；项数随盘上的 mp4 数变）
node _probe\shot-music.cjs       # 28 项：音乐服务 + 音频总线 + 闪避（4 个独立页面）
node _probe\shot-layout.cjs      # 87 项：真组件重叠/溢出 + 拖动 + 关闭/重开 + 换播放目录 + 崩溃面
```

当前基线：**Node 1130 + 浏览器 302，全过**。各项含义与前置条件见 `docs/probe-harness.md`。

> 探针别和"整个工作区构建"同时跑：`test-live-chunks` / `test-chunk-latency` 打的是本机语音服务，
> 机器被构建占满时会超时（不是代码坏了）。
> `shot-music.cjs` 每个用例都**单开一个页面**：Chromium 里一次用户手势只够起一条音频链，前一个用例
> 用掉之后后面的 analyser 全是静音 —— 这会伪装成"代码有问题"。
> `shot-layout.cjs` 挂的是**构建产物里的真组件**，量之前会等 CSS 动画结束并把宠物钉在固定位置：
> 动画中间帧和"页面比窗口宽"这两种情况都曾让它报出并不存在的重叠。
> 它后两个阶段用**真鼠标** + 本进程里的**真音乐服务**（`pet-music.mjs`）：`setPointerCapture` 对
> 合成的 pointerId 会抛异常，而"点一下才出声"这条也必须是真的手势 —— 脚本里的 `element.click()`
> 没有 user activation，和真的被自动播放策略拦住长得一样。

## 运行接线（易踩）

- `C:\Users\fxb_2\.dsh\profiles\web\cordis.patch.yml` 里写着
  `name: 'file:///D:/ALAN/Codes/dsh-pets/pet-stt-supervisor.mjs?v=6'`。
  → 位置不能改；**改完 supervisor 要把 `?v=` 加一**，否则 DSH 拿缓存里的旧模块，改动看起来"没生效"。
- `pet-stt-supervisor.mjs` 用 `new URL('./local-stt-server.py', import.meta.url)` 找服务脚本 →
  两个文件必须同目录；`start-stt.cmd` 同理用 `%~dp0`。
- 端口默认 8756；宠物客户端会自己探测（店里 `sttUrl` 留空 = 自动探测）。
- **音乐**：`pet-music.mjs` 同样按绝对路径写进 profile patch（`?v=` 一样要 bump），
  默认监听 **8791**、默认扫 `D:\Musics`。它是**进程内**的 Node HTTP 服务（不是子进程），
  所以在宿主里改了配置要**重启 `dsh web`** 才生效；不想重启就手工跑
  `node pet-music.mjs --port 8791`（客户端会连上它）。详见 `docs/music.md`。
- 插件包若没装进 harness，用 `dsh web --patch D:\ALAN\Codes\dsh-pets\pet.patch.yml` 挂浏览器半边。
- 构建命令（`--build` 内部就是这两条，需要手工时用）：
  ```powershell
  cd D:\ALAN\Codes\deepseek-harness
  node --max-old-space-size=4096 node_modules/typescript/bin/tsc -b tsconfig.client.json
  node node_modules/tsdown/dist/run.mjs --env.DSH_BUILD_FACE client
  ```
  tsdown/rollup 的 stderr 警告会让 PowerShell 报非零退出码，**看产物时间戳判断成败**。

## 我想做 X，从哪开始

| 任务 | 入口 |
|---|---|
| 改插件逻辑 / UI | `plugin\src\client\…` → `node sync-to-harness.mjs --build` → 刷新 GUI |
| 换美术 / 加姿势 | `docs/art-pipeline.md`。改完 `sprite-data.ts` **必须重测轮廓**（`_probe/dump-sheets.mjs` → `_probe/fit-ring.cjs`）并更新 `plugin\src\client\sprite.ts` 的 `FIGURE_CONTOUR` 与 `POSE_FRAMES` |
| 加皮肤 | `plugin\src\client\skin.ts` 配方 + `personas.ts`(`SKINS`/`skinKey`) + `locales.ts`(`skin.*`) + `PetWidget.module.css` 的 `[data-skin=…] { --pet-glow }` |
| 加浮动动作按钮 | `PetWidget.tsx`(`ACTION_ORDER` / `actionSpecs` / 图标)。环形只有 7 个位置，超了会自动折进 rail — 见 `docs/architecture.md` |
| 加成就 | `achievements.ts`(`ACHIEVEMENTS`) + `pet-types.ts`(`PetStatCounter`) + `locales.ts` |
| 改文案 | `locales.ts`（`zh` 和 `en` 都要；`PetKey` 由 `zh` 推导，漏了会编译报错） |
| 加语音指令 | `commands.ts`(`COMMANDS`) + `locales.ts`(`cmd.*`) |
| 改音乐功能 | `plugin\src\client\music.ts`（播放/歌单/持久化）+ `audioBus.ts`（混音与闪避）+ `pet-music.mjs`（服务端）→ `docs/music.md` |
| 改语音服务 | `local-stt-server.py` / `pet-stt-supervisor.mjs` → `docs/local-speech.md` |
| 颜色 / 对比度问题 | 先跑 `_probe/shot-contrast.cjs`，规则见 `docs/architecture.md` 的「主题与对比度不变量」 |
| 加测试 | `docs/probe-harness.md` 的约定一节 |

## 已知约束（别撞）

1. **美术只能是 base64 内联**：`/plugins/` 只发 JS bundle，没有静态资源目录，所以贴图/音效都塞在
   `sprite-data.ts` / `sfx.ts` 里（bundle 2.27 MB 基本都是它们）。
2. **`plugin/` 不能独立构建**：见上面「为什么副本必须在 harness 里」。真要独立构建，就得把 tsconfig 的
   project references 换成对已发布包的依赖 —— 那是另一件事。
3. **主题 token 会随明暗反转**：`--dsw-alias-brand-primary` 在浅色主题下是近黑 `rgb(15,17,21)`、深色下是近白。
   任何"实色强调底 + 写死深色文字"都会在某个主题下变成黑底黑字。用 `--pet-on-accent`，别写死。
4. **看不到实时 GUI 的截图**：真实 GUI 要一次性随机 token，探针登不进去 → 视觉验证都靠 `_probe` 里的
   静态预览页（内联真实 CSS + 真实美术）。
5. **环形容量 7**：宠物默认停靠右下角，可用弧只够 7 个 40px 按钮；7 个动作刚好放下，
   折叠路径是用合成 12 个动作测的。再加第 8 个动作就会折进 rail。
6. **PowerShell 读 CJK**：`Get-Content -Raw` 会把 UTF-8 当 GBK；`Set-Content -Encoding utf8` 会写 BOM。
   改文件用编辑器或 Node（`sync-to-harness.mjs` 就是 Node 写的，不吃这个亏），
   `.ps1` 里不要内嵌 CJK 路径（走参数传）。
7. **音乐服务默认对回环放开 CORS**（`corsOrigin: '*'`）：音乐要接 WebAudio 做节拍分析，
   就必须带 `crossOrigin` + `Access-Control-Allow-Origin`。代价是**本机任何网页都能读到你的曲目和音频字节**；
   要收紧就把 `corsOrigin` 改成 `http://127.0.0.1:3080`。
8. **浏览器解不了的格式就是解不了**：走系统编解码器（Edge = Windows Media Foundation），
   mp3/m4a/mp4/wav/flac 实测可用，wma/ape 之类大概率不行 —— 失败会给出可读原因，不会转圈。
