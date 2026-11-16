# Agent Note: Local models read images through vision projectors

Status: implemented

[English](2026-11-16-local-model-vision-projectors.md) | 中文

## 问题

[内置 worker](../architecture/2026-11-13-bundled-llama-worker.zh.md) 只服务文本：`llama-cpp` 插件拒绝多模态投影器（`mmproj`）文件，也不在 preset 中写入投影器。视觉语言 GGUF 模型只有在 llama.cpp 同时加载其投影器时才能读取图片，因此图片附件无法到达任何本地模型，而 Jan 能以图片输入服务同样的模型。

## 决策

投影器从属于一个已安装模型。`install.json` 中的 `ModelRecord.mmproj` 记录其文件、大小、下载所得投影器的 SHA-256 摘要，以及 `vision` 标志；记录保持第 3 版，因为该字段可选，没有该字段的记录描述的就是纯文本模型。投影器文件必须具有 `general.architecture = clip`；`vision` 取 `clip.has_vision_encoder`，没有该键时，除非 `clip.has_audio_encoder` 为 true，否则为 true，与 Jan 相同。`clip` 文件仍不能作为模型文件。

投影器的选择沿用 Jan。Hugging Face 下载同时下载该仓库的投影器：优先选 `mmproj-f16.gguf`（不区分大小写），否则选列表中第一个 `mmproj` 文件，且不能跳过；精选条目在模型文件旁固定其投影器。下载的投影器经过校验，保存在 `models/<id>/mmproj-<sha256 前缀>.gguf`；导入的投影器留在原位置。preset 在模型分区中写入 `mmproj = <path>`，`mmprojOffload` 为 false 时写入 `mmproj-offload = false`。

只有投影器带 `vision` 的模型，其路由条目才声明 `input: ['text', 'image']`，否则为 `['text']`，因此 `llm-pi-ai` 在请求发出前就接受或拒绝图片附件；被接受的图片以 OpenAI `image_url` data URL 形式到达 worker。启动时，缺失或大小改变的投影器会从其模型上移除并记录警告，模型作为纯文本模型保留在列表中。

## 考虑过的替代方案

**把投影器作为独立条目安装并提供选择器。** 这能让用户选择投影器的量化版本，但多数用户无法判断该选择，而 Jan 会自动配对投影器。没有选择器时，选择规则是固定的。

**把投影器下载作为可选项。** 这能为纯文本用户省下投影器的大小，但会给每次 Hugging Face 下载增加一个 Jan 不会询问的选择；纯文本用户可以从没有投影器的仓库下载。

**为每个本地模型声明图片输入。** 路由将不需要投影器信息，但纯文本模型会收到图片，并在 worker 中途失败，而不是在发送前拒绝附件。

**投影器缺失时移除整个模型。** 这能让记录与最初的下载保持一致，但会移除一个仍能服务文本的模型。

**把 `install.json` 升级到第 4 版。** 没有现有字段改变含义，读取器看不到 `mmproj` 时按文本服务，因此改版本只会阻止降级，而不能防止误读。

## 影响

用户可以向本地视觉模型附加图片，选择器、适配度估算和显示的大小都计入投影器。从带投影器的仓库进行 Hugging Face 下载，总会占用投影器的磁盘和内存。导入的投影器不会与其模型核对；不匹配表现为加载失败。纯音频投影器以 `vision` 为 false 记录，不增加输入类型。`mmprojOffload` 作用于所有模型。
