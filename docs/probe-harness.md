# 测试探针

两条轨道：**Node 探针**（把真实模块转译后在 Node 里直接驱动，毫秒级、无需浏览器）和
**浏览器探针**（Playwright + Edge，量真实渲染出来的东西）。

当前基线：**Node 1130 项 + 浏览器 317 项，全过。**

探针读的是**主源** `dsh-pets/plugin/src/client`（不是 harness 里的构建副本），所以：
改了代码不跑 `sync-to-harness.mjs` 也能立刻测 —— 但 GUI 会落后；反过来，"测试通过"永远意味着**主源**是好的。

> 别和整个工作区构建同时跑。`test-live-chunks` / `test-chunk-latency` 打的是本机语音服务，
> 机器被 `tsdown` 占满时会超时（实测过一次：并行跑出 1 个 FAIL，单独跑全过）。

## 1. Node 探针

```powershell
cd D:\ALAN\Codes\dsh-pets
Get-ChildItem _probe\test-*.mjs | ForEach-Object { node $_.FullName }
```

| 探针 | 项数 | 检查什么 | 前置条件 |
|---|---|---|---|
| `test-ring.mjs` | 522 | 环形布局：净空、可用弧、间距、溢出、边界；**并写出 `ring-placements.json`** 给预览页用 | 无 |
| `test-rail.mjs` | 93 | 溢出条落位（左右选择、贴边、间隙） | 无 |
| `test-achievements.mjs` | 45 | 成就规则、旧 store 迁移、**每个成就都有中英文案** | 无 |
| `test-chunk-pipeline.mjs` | 41 | 真实 `localTts.ts` 对着假 `Audio` 跑分句流水线 | 无 |
| `test-commands.mjs` | 24 | 语音指令匹配（真实 `commands.ts`）：该匹配的匹配、不该匹配的不误伤 | 无 |
| `test-skin.mjs` | 24 | 换肤重上色：**窗口外像素逐字节不变**（肤色/白围裙/描边/金边） | 无 |
| `test-accent-ink.mjs` | 25 | 强调底墨色：解析宿主题 token 图算对比度 + 结构守卫（实色强调底必须声明主题感知墨色） | 读宿主题 CSS |
| `test-pet-store.mjs` | 33 | store 写动作 + 旧持久化数据的兼容（含音乐条偏移的窄校验） | 无 |
| `test-clipboard.mjs` | 12 | 复制成功与**无安全上下文时**的回退 | 无 |
| `test-sentences.mjs` | 12 | `sentences()`：从 `localTts.ts` **抽取真实源码**再求值 | 无 |
| `test-speakable.mjs` | 11 | `speakable()`：从 `PetWidget.tsx` 抽取真实源码（去代码块/链接/表格等） | 无 |
| `test-textofblocks.mjs` | 9 | `textOfBlocks`：从 `monitor.ts` 抽取（排除 reasoning、保留答案） | 无 |
| `test-supervisor.mjs` | 8 | **真起一个 python 服务**（测试端口 8757）：argv/cwd/stdio、占用判定、dispose 后端口释放；subprocess seam 是假的 | 本机 `python` + faster-whisper |
| `test-music-server.mjs` | 127 | 宿主音乐服务（**真扫 `D:\Musics` 27 首** + 合成 ID3/MP4 字节 + 真 HTTP：206/416/404/503/HEAD/OPTIONS**/PUT/DELETE**/端口占用） | `D:\Musics` |
| `test-music-client.mjs` | 139 | 客户端播放器（真实 `music.ts` 转译后跑在假 `Audio`/`fetch` 上）：歌单顺序/随机/循环、窄校验、失败分类、**换目录的纯决策与 PUT/DELETE 分支**、订阅身份稳定性 | 无 |
| `test-live-chunks.mjs` | 5 | 真实回复的每一句都要拿到音频（流水线不能在中间丢句子） | **本地语音服务在跑** |
| `test-chunk-latency.mjs` | — | 量"整段一次请求"vs"逐句"的首声延迟（打印表格，不做判定） | **本地语音服务在跑** |

判定输出约定：`ok  <描述>` / `FAIL <描述>`，退出码 0/1；信息型脚本直接打印表格。
`test-supervisor.mjs` 是唯一会拉起真实子进程的探针，端口 8757（避开正式服务的 8756），跑完自己关掉。

两个 Python 探针测的是**服务端**（需要本地服务在跑，且装了 `av`）：

| 探针 | 检查什么 |
|---|---|
| `test-tts-endpoint.py` | 按浏览器的方式调 `/v1/audio/speech`：JSON POST、响应体形态、JSON content-type 触发的 **CORS 预检** |
| `test-webm-path.py` | 复现点击录音的上传：**WebM/Opus**（Chrome/夸克实际发的容器）→ 本地 Whisper 能被解码（早期用 WAV 验证过，那不能证明浏览器的容器没问题） |

## 2. 浏览器探针

```powershell
$env:NODE_PATH='D:\ALAN\Codes\deepseek-harness\apps\web\node_modules'
node _probe\shot-accent.cjs      # 42 项：强调色 on/off 状态、两主题三形象、像素回读
node _probe\shot-contrast.cjs    # 120 个图面：全量前景/背景对比度（78 受判 + 42 宿主题对照）
node _probe\probe-mp4-path.cjs   # .mp4 当音乐放（元数据/真出声/跨源 analyser/moov 在尾部）；项数随盘上的 mp4 数变
node _probe\probe-flac-path.cjs  # 15 项：.flac 到底能不能出声（自带一个 service 实例 + 可配页面 origin）
node _probe\shot-music.cjs       # 28 项：音乐服务 + 音频总线 + 闪避 + 客户端端到端
node _probe\shot-layout.cjs      # 87 项：真组件重叠/溢出 + 真鼠标拖动 + 真服务下换目录 + 关闭/重开 + 崩溃面
```

- Playwright 借用 harness 的安装（`apps/web/node_modules/playwright`），用系统 Edge（`channel: 'msedge'`），不下载浏览器。
- **为什么用静态页而不是实时 GUI**：真实 GUI 需要一次性的随机 token，探针拿不到；所以探针自己拼一份
  "忠实标记"（真实 CSS 模块 + 真实主题 token + 真实图标），在里面量。
- `probe-mp4-path.cjs` 的两个坑写在文件注释里，都曾把结论带偏成"编解码不支持"：
  页面必须由 `http://127.0.0.1` 提供（不透明源访问不了回环地址空间），且播放前必须有一次真实点击
  （自动播放策略会让 `play()` 直接 reject）。它验的是"音乐功能能不能吃 mp4"这条产品前提。
- `probe-flac-path.cjs` 自带一个 `pet-music.mjs` 实例（默认 8792，`--cors-origin` 由探针指定），
  因为"能不能解 flac"这件事**必须把 CORS 排除掉才能问**：宠物播放器带 `crossOrigin`，
  而服务端只回它启动时那个 origin —— origin 不匹配时媒体元素报的是
  `MEDIA_ELEMENT_ERROR: Format error`，一个纯网络拒绝，长得和解码失败一模一样。
  第一次用 `about:blank`（origin 为 `null`）跑就吃了这个假象。它因此分相位：
  无 CORS 解码 → 允许 origin 带 CORS → **故意**被拒 origin 复现那个 Format error → mp3 对照。
  它不碰用户正在跑的 8791 实例。
- `shot-music.cjs` **每个用例单开一个页面**（`tone` / `local` / `bus` / `client`）。原因是踩过的：
  同一个页面里，一次用户手势只够起一条可用的音频链，前一个用例消耗掉之后，
  后面所有 analyser 读数都是静音 —— 连页面内自己生成的测试音都是静音的，
  于是探针差点把"测量方法坏了"报成"代码坏了"。前两个用例（合成音、本地 mp3）是**对照**：
  它们不可能有 CORS 或编解码问题，只有它们绿了，第三条"跨源流式也有声音"才可信。
- `shot-layout.cjs` 挂的是**构建产物里的真组件**（`lib/client.js` 的 `factory(...)`，只喂 React），
  不是重新转译的副本，也不是手写的仿页面 —— 手写的仿页面会随 CSS 漂移，而它正是要量 CSS。
  它踩过两个坑，都写在文件注释里：① 量到了 CSS 动画中间帧（姿势切换会缩放到 1.04，
  于是"宠物"宽了 4%、高了 20px，报出一个并不存在的重叠）→ 现在等有限动画结束，无限动画跳过；
  ② 页面比窗口宽时 `position: fixed` 的宠物会跟着文档走，量到的其实是探针自己的布局
  → 现在先把宠物钉在离角 190px 处，并且**先断言在视口内、再断言重叠**。
- `shot-layout.cjs` 的后三个阶段（拖动、关闭、换目录）用**真鼠标**（`page.mouse`）+ **真音乐服务**：
  - `setPointerCapture` 对合成事件里的 pointerId 会抛 `NotFoundError`，所以拖拽没法用 `dispatchEvent` 假装；
  - "点一下才出声"必须是真手势 —— 页内 `element.click()` 没有 user activation，
    失败的样子和被自动播放策略拦住一模一样。服务用本进程里的 `pet-music.mjs`，和页面**同源**，
    于是"X 真的把音乐停了"这句话是对着**正在解码的音频**说的；
  - store 也从"no-op Proxy"换成了**真的订阅**（`useSyncExternalStore`）：拖动结束会写
    `musicBarOffset`，写完必须回到一次渲染里，条才会停在松手的地方。用 no-op store 时它会弹回锚点，
    看起来就像"拖动坏了"。
  - 换目录那一阶段会**临时造一个目录**（`os.tmpdir()` 下，放两份最小 mp3），让宿主选择器返回它：
    "库从 27 首变成 2 首"才是能证伪的断言，只改路径字符串不是。
  - 它的 store 默认就是**旧 store 的形状**（缺 `musicRoots`/`musicBarOffset`/`stats`），因为持久化是
    **整份替换**而不是合并：升级上来的宿主就是长的这样。第一版探针塞了一个字段齐全的 store，
    于是"面板直接读 `prefs.musicRoots.length`"这个必崩的写法一路绿灯 —— **测试夹具比用户数据新**
    是这类假绿最常见的来源。现在还有一条元断言守着这个前提本身。
  - 第三个页面（`?crash=1`）让 store 的字段**读取时抛异常**（`Object.defineProperty` 的 getter），
    验证崩溃面：角标出现、`title` 里有原始错误、点击重试不会把页面变白。这里抛的是真错，
    不是往组件里塞的测试开关。
  - 还踩过一次**探针自己挖的坑**：为了让播放跑起来，探针曾经直接调 `music.configure(...)` 并传了一个
    空 sink —— 那会把 widget 装好的持久化 sink 顶掉，于是之后所有写入（包括目录偏好）都悄悄消失。
    现在 URL 走 **store**：widget 自己的 effect 会重跑并把 sink 装回来，路径和真实运行一致。
  - 判断一个控件"能不能点到"必须用 `elementFromPoint(el)` 且只查
    `hit === el || el.contains(hit)`。第一版多写了一个 `hit.contains(el)`，于是**页面 body 装下了所有按钮**，
    关闭的抽屉按钮被报成"可点击"，点击当然落到了空白页上。
- `shot-accent.cjs` 还会**回放旧声明**（`background: var(--pet-accent); color:#10141c`）证明当时确实是黑底黑字，
  并把 before/after 截图落到 `_probe/shots/`。
- `shot-contrast.cjs` 的填充色是**沿祖先链做 alpha 合成**得到的（rail 是半透明的），
  元素自身的 `opacity` 折进墨色（复制按钮 70% 不透明，那正好是一半对比度）。
  判据按 WCAG 分档：图标 3:1（1.4.11），文字 4.5:1（1.4.3）；两边都是宿主题自己的 token 的组合只记录不判分。

## 3. 预览/中间产物生成器

| 生成器 | 产出 | 谁需要它 |
|---|---|---|
| `dump-sheets.mjs` | `sprite-sheets.json`（三张表的 data URI + 帧几何） | `fit-ring.cjs` |
| `test-ring.mjs` | `ring-placements.json` | `make-ring-preview.mjs`、`shot-ring.cjs` |
| `make-ring-preview.mjs` | `ring-preview.html`（环形布局静态页） | `shot-ring.cjs` |
| `make-frames-page.mjs` | `frames.html`（每只形象的每一帧 × 用到它的姿势） | `shot-ring.cjs`；也是换美术时核对帧序的手段 |
| `make-skin-lab.mjs` | `skin-lab.html`（皮肤候选，页面里跑的是**转译后的 `skin.ts` 本体**） | `shot-lab.cjs` |
| `fit-ring.cjs` | 144 射线轮廓测量 + 自校验，打印 36 个半径 | 人工：把结果写回 `sprite.ts` 的 `FIGURE_CONTOUR` |
| `patch-whale.mjs` | 把 `art/out/whalegirl.json` 写进 `sprite-data.ts` 的 whale 行 | 美术流水线 |

完整重建顺序（这三条是链式的，缺一步就报错并提示该跑哪条）：

```
dump-sheets.mjs  ->  fit-ring.cjs
test-ring.mjs    ->  make-ring-preview.mjs  ┐
make-frames-page.mjs                        ├-> shot-ring.cjs
                                            ┘
make-skin-lab.mjs -> shot-lab.cjs
```

这些生成物（`*.json` / `*.html` / `shots/frames-all.png` / `shots/skin-lab*.png`）都**不入库**：
`shot-ring.cjs` 与 `fit-ring.cjs` 在缺输入时会直接打印该跑的命令，而不是丢个 ENOENT。

## 4. 约定（写新探针请遵守）

1. **不复制算法**。用 `ts.transpileModule` + `new Function` 把**真实模块**加载进来驱动；
   纯函数型（`sentences`/`speakable`/`textOfBlocks`）直接从源文件里**抽取源码**再求值 ——
   这样探针不可能对着一个已经漂移的副本通过。
2. **量"不该变"的东西**。`test-skin.mjs` 一半的断言是"这些像素必须逐字节不变"；
   对比度探针最有用的是它抓住了两处看不见的图标。
3. **探针自己也会错**，并且错过好几次，写断言时留意这些坑：
   - `color-mix()` 的**序列化不统一**：同一句 `in srgb` 有时返回 `color(srgb …)`，有时返回 `oklab(…)`，
     后者实际渲染值会和按 sRGB 手算差几个百分点。取色请**把颜色画到 1×1 canvas 再读像素**，不要解析字符串。
   - **动画未停**就测量：`.ring.ringOpen .bubble` 有 260ms 的弹入动画，中途测到的是 `opacity < 1`，
     对比度会莫名其妙偏低。等一下，或在页面上关掉动画。
   - **像素取样区**：圆形按钮的**抗锯齿边缘**与填充色的差远大于图标，整框取样会"测出一个图标"。
     只取中心区域。
4. 断言写"为什么"：失败时打印实际色值/坐标/端口，别只打印 false。
