# 本地语音服务（STT + TTS）

宠物的语音输入与说话都靠这台机器上的一个小服务，**不出本机**（edge 合成那一步会连微软，见下）。
本文记录组成、接线、配置键与排障。

## 1. 三个文件

| 文件 | 角色 |
|---|---|
| `local-stt-server.py` | 服务本体：faster-whisper 转写 + edge/piper 合成。OpenAI 兼容的两个端点 |
| `pet-stt-supervisor.mjs` | DSH **host 插件**：随宿主起停这个服务，负责占用判定、日志、dispose 时收干净 |
| `start-stt.cmd` | **手动**兜底：不装 DSH 时、想预下模型时、想看实时日志时用它 |

端点（默认 `http://127.0.0.1:8756`）：

- `POST /v1/audio/transcriptions` — 转写（宠物上传录音）
- `POST /v1/audio/speech` — 合成（宠物说话）

客户端侧：

- `localStt.DEFAULT_STT_URL = 'http://127.0.0.1:8756/v1/audio/transcriptions'`；
  店里 `sttUrl` 为空时走 `discoverEndpoint()` 自动探测（输入条里的齿轮可以手填并保存）。
- `localTts.speechEndpoint(transcriptionUrl)` 把转写地址的尾巴换成 `/v1/audio/speech` ——
  **一个地址填一次，两个方向都通**。
- `localTts.sentences()` 分句后流水线播放（首声更早）；`speakNeural` 失败会回退浏览器 `voice.speak`。

## 2. DSH 侧接线（改配置看这里）

`C:\Users\fxb_2\.dsh\profiles\web\cordis.patch.yml`：

```yaml
- insert:
    - id: pet-stt
      name: 'file:///D:/ALAN/Codes/dsh-pets/pet-stt-supervisor.mjs?v=6'
      # config: { port: 8756, model: small, ttsVoice: zh-CN-XiaoxiaoNeural, ... }
```

- **绝对路径**：`pet-stt-supervisor.mjs` 不能移动/改名。
- **`?v=6` 是缓存破坏串**：改完 supervisor 必须加一，否则 DSH 会继续用缓存里的旧模块（表现是"改了没用"）。
- 服务脚本默认取同目录的 `local-stt-server.py`（`new URL('./local-stt-server.py', import.meta.url)`），
  所以这两个文件必须在一起。

## 3. 配置键（`resolveConfig` 的白名单 + 默认值）

| 键 | 默认 | 说明 |
|---|---|---|
| `autoStart` | `true` | 随宿主启动；关掉就完全不碰服务 |
| `python` | `'python'` | 解释器；裸名走 PATH，**带分隔符的路径必须绝对**（subprocess seam 拒绝相对路径） |
| `model` | `'small'` | faster-whisper 模型名 |
| `modelDir` | `''` | 已下载快照的绝对路径；非空时优先于 `model` |
| `port` | `8756` | 回环端口；客户端自动探测同一个默认值 |
| `device` | `'auto'` | `auto` / `cpu` / `cuda` |
| `computeType` | `'int8'` | `int8` / `float16` / `float32` |
| `hfEndpoint` | `''` | 覆盖 HuggingFace 端点；空则自动挑一个可达的（本机走 `hf-mirror.com`） |
| `ttsEngine` | `'edge'` | `edge`（默认，中文明显比离线自然）/ `piper`（全离线）/ `auto`（先离线后在线）/ `off` |
| `ttsVoice` | `'zh-CN-XiaoxiaoNeural'` | edge 音色；也可 Xiaoyi/Yunxi/Yunyang/Yunjian/Yunxia |
| `script` | 同目录的 `.py` | 一般不用改 |

只传 `DEFAULTS` 里存在的键，空字符串/`undefined` 会被忽略；supervisor 组出的 argv 是
`--model --port --device --compute-type --tts-engine --tts-voice`（+ 可选 `--model-dir --hf-endpoint`）。

## 4. 行为细节（排障时会用到）

- **绝不抢别人的服务**：启动前先探端口，有人应答就再等 1.5s 确认，仍然应答就原样放着、什么都不改、退出时也不杀它。
  所以"服务已经在跑"和"服务起不来"要分开看日志。
- **首次运行下模型**（`small` 约 500 MB），日志里有一句 "the very first run downloads the model, which can take a while"。
  GitHub 下载被限速时脚本会自己换到 `hf-mirror.com`。
- **启动失败不抛异常**：找不到 python/端口非法/子进程起不来，都只写一条 warn 日志，宠物退化成"没有语音"而不是崩掉。
- **dispose 要收干净**：先 `terminate()`，再等子进程真的退出，再等端口真的静默。
  这台机器上实测：端口 ~3s 起来、dispose 后 ~0.5s 关掉（`_probe/test-supervisor.mjs` 就是测这个的）。
- 服务日志里那行 "offline models in `D:\ALAN\Codes\dsh-pets\models`" 只是它的**默认离线模型目录**；
  该目录当前不存在（用 edge，不需要离线模型）。要全离线就 `--tts-engine piper` 并把 piper 模型放进 `models/`。

## 5. 合成引擎的取舍（结论已固化成默认值）

当时评估过三条路线，脚本与实测结论都留档在 `_attic/tts-eval/`：

| 路线 | 结论 |
|---|---|
| **edge（微软神经语音）** | **采用（默认）**。免费、中文自然度明显最好；代价是需要联网 |
| piper（全离线） | 保留为 `--tts-engine piper`：完全离线，但中文更机械 —— 所以不是默认 |
| kokoro（`test-kokoro*.py`） | 未采用。int8 量化把下载压到 ~114 MB 且 CPU 延迟低，但 int8 动态量化在某些 CPU 上**比 fp32 还慢**；还要处理 espeak 中文音素路径与镜像站限速 |
| 其它神经 TTS（`test-neural-tts.py`） | 未采用 |

`find-500.py` / `make-ab-kit.py` 是当时追 HTTP 500 与做 A/B 试听的临时脚本，一并归档。

## 6. 常用命令

```powershell
# 手动起服务（默认 small，首次会下模型）
D:\ALAN\Codes\dsh-pets\start-stt.cmd
D:\ALAN\Codes\dsh-pets\start-stt.cmd --model base          # 更快，精度低一点
D:\ALAN\Codes\dsh-pets\start-stt.cmd --tts-engine piper    # 全离线合成

# 端到端探针（需要服务在跑）
node _probe\test-live-chunks.mjs
node _probe\test-chunk-latency.mjs

# 托管链路的集成测试（自己起一个服务在 8757，跑完关掉）
node _probe\test-supervisor.mjs
```
