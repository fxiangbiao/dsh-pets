# _attic — 已废弃的脚本

这里的东西**都被取代了**，保留只为"当时到底怎么试的"有据可查。不要在它们之上继续开发，
也不要指望它们能直接跑：它们引用的一些目录（`_clean/`、`_preview/`、`_audio/`）在收尾整理时已经删掉。

| 文件 | 曾经是什么 | 现在用什么 |
|---|---|---|
| `proto.ps1`、`proto-bg.ps1` | 最初的原型：背景 = 四角小块均值 + 亮度/色彩投射分类，字节数组级去背 | `art/pipeline/gen-pics.ps1` → `gen-arts2/3.ps1`（抠图），`gen-strip.ps1`（水印 + 拼条） |
| `crop-susp.ps1`、`crop-wm.ps1` | 一次性诊断：把"可疑像素"和水印区域放大出来看 | `art/tools/scan-strips.ps1`（条带放大）、`art/tools/verify-alpha.ps1`/`verify-contact.ps1`（透明度与接触表校验） |
| `tts-eval/*.py` | 合成引擎选型的实测脚本：kokoro（int8 量化、镜像站、espeak 中文音素路径、线程数）、piper、其它神经 TTS，以及追 HTTP 500 与 A/B 试听的临时脚本 | 结论已固化：`ttsEngine` 默认 `edge`，离线走 `piper`。见 `docs/local-speech.md` 第 5 节 |

删除它们之前请先确认 `docs/local-speech.md` 与 `docs/art-pipeline.md` 里的结论已经足够——
那两份文档就是为了让这些脚本可以被安全遗忘。
