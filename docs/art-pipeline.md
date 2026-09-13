# 美术流水线

从"一张带背景的立绘"到"插件里的一条 base64 贴图条"要经过抠图 → 切片 → 拼条 → 写入 `sprite-data.ts`。
本文记录这条链、每一步的脚本、以及**换美术时不能跳过的收尾动作**。

## 1. 素材在哪

| 位置 | 内容 |
|---|---|
| `D:\Pictures\pets\ 卡通鲸鱼 / Robot / 银月 / DeepSeek鲸鱼娘` | 原始渲染图（本轮工作用的是这四个目录） |
| `art/sources\*.png` | 已经整理进工作区的输入：透明底板（单姿势 450×600、分解动作 600×450）、姿势渲染、`watermark.png` |
| `art/out\*.png` | 已发布的条带（与 `sprite-data.ts` 几何一致的那份）、接触表、上一代卡通鲸鱼条带 |
| `art/out/whalegirl.json` | 抠图产物 → `sprite-data.ts` 的桥（`patch-whale.mjs` 读它） |

原始渲染图的通病（抠图要处理的就是这些）：

- 近白背景，部分图还是**棋盘格**（假透明，实际是画上去的格子）；
- 角色下方有一片**柔和地面阴影**，抠背景时会被当成角色留下；
- 右下角有 **豆包AI生成** 水印；三张图的这枚水印**逐像素相同**（`gen-strip.ps1` 就是靠这点只清零水印、不伤角色）；
- 边缘有少量**标注文字**（`gen-arts2.ps1` / `silver-clean.ps1` 用小连通域识别 + 邻近背景色填充来擦）。

## 2. 链条与脚本

| 脚本 | 做什么 |
|---|---|
| `art/pipeline/gen-pics.ps1` | 第一代抠图：按颜色投射 + 亮度分类背景，字节数组级别 flood-remove 近白背景 |
| `art/pipeline/gen-arts2.ps1` | 擦标注文字：去掉裁剪外圈里的小暗连通域，填成邻近背景色 |
| `art/pipeline/gen-arts3.ps1` | 第二代背景分类（色彩投射 + 亮度），更稳的抠图 |
| `art/pipeline/gen-cutout.ps1` | 把**已经透明**的分解动作网格切成 12 帧并拼条 |
| `art/pipeline/gen-final.ps1` | 拼条/收尾步骤（具体行为见脚本内注释） |
| `art/pipeline/gen-strip.ps1` | 三图共用水印的逐像素清零 + 拼条 |
| `art/pipeline/gen-silver.ps1` | 银月专用重建（从两张大图重建 12 帧，去掉所有头部特写） |
| `art/pipeline/gen-whalegirl.ps1` | **鲸鱼娘专用（当前路线）**：两遍 flood fill 抠图（C# via `Add-Type`）、12 张源图 → 槽位计划 → 拼条 → 接触表 → `whalegirl.json` |
| `art/pipeline/gen-sfx.ps1` | 音效：按 `avatar → name → {src, ss, t}` 定义用 ffmpeg 切 18 段 `.m4a` 到 `art/sfx`，并写出 `sfx.ts` |

> `gen-pics → gen-arts2 → gen-arts3` 是前三只形象的迭代过程，属于历史步骤（保留用于复现）；
> 条带以 `art/out` 里与 `sprite-data.ts` 几何一致的那份为准。
> `gen-sfx.ps1` 里的 ffmpeg 是硬编码路径（`D:\Apps\JianyingPro\…\ffmpeg.exe`），换机器要改。
> `gen-whalegirl.ps1` 刻意写成**纯 ASCII**：Windows PowerShell 5.1 会把无 BOM 的脚本按 ANSI 读，内嵌 CJK 路径会乱码 ——
> 所以源目录走参数传进来（参数不受脚本编码影响）。

## 3. 鲸鱼娘这条链（当前主线）

```
D:\Pictures\pets\DeepSeek鲸鱼娘\*.png (11 张单姿势 + 1 张坐姿, 2048×2048 平涂 RGB)
   │  gen-whalegirl.ps1  <源目录> <输出目录>
   │    第 1 遍 flood fill：从四角+边缘洪泛近白/棋盘格 → 去掉背景
   │    第 2 遍（更松）：再去掉地面阴影与残留水印
   │    槽位计划 → 12 帧 → 横向条带 2160×180 → 接触表
   ▼
art/out/whalegirl-strip.png        拼好的条带（也是嵌进 sprite-data.ts 的那份）
art/out/whalegirl-frames.png       接触表：一帧一格，用来肉眼确认"哪一格是哪个姿势"
art/out/whalegirl.json             { Url(base64), FrameWidth, FrameHeight, FrameCount }
   │  node _probe/patch-whale.mjs
   ▼
…\dsh-pets\plugin\src\client\arts\sprite-data.ts   只替换 'whale': 那一行，另两只逐字节不动（脚本会读回校验）
```

**帧序会错位**：条带里的格子顺序 *不等于* 槽位编号。第一次做完就踩过这个坑（姿势表整体偏了一格），
所以 `whalegirl-frames.png` + `_probe/frames.html` 是必需的检查步骤，不要跳。

鲸鱼娘当前的帧语义（`sprite.ts` 顶部注释同步）：

| 帧 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 姿势 | 开心(合掌) | 紧张(手放嘴边) | 欢呼(举拳) | 平静站姿 | 工作(全息面板) | 惬意(端碗) | 挥手 | 托腮 | 跳 | 坐 | 哭 | 托腮(重复) |

## 4. 换美术的完整仪式（漏一步就会出现"按钮压在身上"或"姿势对不上"）

> 所有写入都落在**主源** `dsh-pets\plugin\src\client\`。改完必须
> `node sync-to-harness.mjs --build`（同步到 harness 并重建 bundle），否则 GUI 还是旧图。

1. **出图 → 条带**：跑对应 pipeline 脚本，得到 `frameWidth × frameCount` 的条带。
2. **写进 `sprite-data.ts`**：`{ url, frameWidth, frameHeight, frameCount }`（鲸鱼娘走 `patch-whale.mjs`）。
   改完可以拿 `art/out/whalegirl.json` 与 `sprite-data.ts` 的对应行**逐字节比一次**，确认桥文件没有过期。
3. **重测轮廓（必做）**：
   ```powershell
   node _probe/dump-sheets.mjs     # 从 sprite-data.ts 导出三张表 → sprite-sheets.json
   node _probe/fit-ring.cjs        # 量 144 条射线的轮廓 → 打印 36 个半径（含自校验）
   ```
   把结果写回 `sprite.ts` 的 `FIGURE_CONTOUR`（36 个值，从正右起顺时针）。
   **轮廓不对的后果**：环上的按钮会压在立绘上，或者白白浪费可用弧。
4. **核对帧序**：`node _probe/make-frames-page.mjs` → 打开 `_probe/frames.html`（或跑 `shot-ring.cjs`）
   对照上表逐格确认，然后更新 `sprite.ts` 的 `POSE_FRAMES`。
5. **跑探针**：`test-ring.mjs`（几何）、`shot-ring.cjs`（截图 + 面板尺寸）、`shot-contrast.cjs`（配色）全过。
6. **同步 + 重建 + 刷新**：`node sync-to-harness.mjs --build`，然后 GUI 里 Ctrl+R 肉眼确认。

## 5. 音效

- 输入是**原始语音渲染**（按参数传，见 `gen-sfx.ps1` 的 `param(...)`），输出 18 段剪辑：
  `{whale,robot,silvermoon}_{voice,avatar,perform0..3}.m4a`，落在 `art/sfx/`。
- 剪辑规则在脚本里：`voice`/`avatar` 是"一整口气"，留长一点带淡入淡出；`perform0..3` 跟着 1.4s 的表演步进，
  两端交叉淡化盖住接缝。
- 这些 base64 也内联在 `sfx.ts`（247 KB），所以换音效要同时更新 `sfx.ts`（`gen-sfx.ps1` 的 `$OutTs` 参数就是它）。

## 6. `art/out` 里为什么留着这几张

| 文件 | 为什么留 |
|---|---|
| `whalegirl-strip.png` / `strip_robot.png` / `strip_silver-moon.png` | 与线上 `sprite-data.ts` 几何一致的全尺寸条带：换美术时用来 diff，出问题时用来确认线上到底是哪版 |
| `whalegirl-frames.png` | 鲸鱼娘的接触表（帧序核对的证据） |
| `whalegirl.json` | 抠图 → `patch-whale.mjs` 的桥；删了就得重跑一次完整抠图 |
| `strip_whale-cartoon-legacy-2160x162.png` | **上一代"卡通小鲸鱼"的唯一副本**：它的原始数据只存在于（无版本控制的）`sprite-data.ts`，换形象时被覆盖了。想换回去就靠它 |
| `skins-whale-before-filter-era.png` | 皮肤还是"整只 hue-rotate"时代的对照图（解释为什么改成重上色） |
| `scan/` | `art/tools/scan-strips.ps1` 的放大裁剪，随用随删 |

`_preview/`、`_clean/`（半成品与清洗底板）已在收尾时删除：它们都能由上面的脚本从 `art/sources` 重新生成。

## 7. 工具（`art/tools/`）

| 工具 | 用途 |
|---|---|
| `scan-strips.ps1` | 把条带放大成左右两半，肉眼查接缝/糊边（输出到 `art/out/scan/`） |
| `verify-alpha.ps1` / `verify-contact.ps1` | 校验透明通道与接触表是否完整 |
| `silver-analyze.ps1` / `silver-clean.ps1` / `silver-contact.ps1` | 银月专用：分析、清洗底板、生成接触表 |
| `scan-text.ps1` | 扫描残留标注文字 |
| `skin-preview.ps1` | 皮肤候选配色预览 |
