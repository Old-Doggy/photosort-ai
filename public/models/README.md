# 本地模型资源

在项目根目录执行 `npm run setup:models` 下载固定版本资源，`npm run verify:models` 复核文件大小与 SHA-256。基础视觉资源清单在 `tools/model-assets.js`；可选的 SigLIP2 语义资源使用 `npm run setup:semantic`，清单位于 `tools/semantic-assets.js`。

已有但不匹配的文件不会被静默覆盖；确认需要替换时执行 `npm run setup:models -- --repair`。下载失败可重新执行，已校验资源会跳过。模型权重不上传 GitHub；来源许可证由下载者复核。

MediaPipe 人脸检测/关键点资源也包含在清单中。Ollama 视觉模型不能直接放进 GitHub 仓库，但项目提供完整的本地准备路径：双击项目根目录的 `安装本地视觉模型.cmd`，脚本会在缺少时打开官方 Ollama 安装程序，默认下载并校验 `qwen3.5:4b`。也可运行 `npm run setup:vision -- --model=qwen3.5:9b` 选择更大的模型。旧 `legacy=1` 实验界面不属于默认安装支持范围；主入口为网页文件夹控制台。

SigLIP2 未安装时，语义模型“自动”会回退到现有 CLIP，不影响基础分类。SigLIP2 只作场景语义辅助，不是 NPU 证据，也不代表准确率提升。
