---
description: "受管理的本地 llama.cpp 模型：从精选目录或 Hugging Face 下载并校验 GGUF、导入本地文件、估算硬件适配度，并监管内置的 jan-llama-worker，由它服务 llm-pi-ai 的 `local` 路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llama-cpp

[English](README.md) | 中文

## 概述

无需 API 密钥即可在本机运行对话模型。该服务从精选目录或 Hugging Face 仓库下载并校验 GGUF 模型，或导入本地文件，并通过内置的 `jan-llama-worker` 在回环端口上服务所有已安装模型。模型选择器把每个模型列为 `local/<model id>`，`local/local` 始终指向默认模型。模型在首次使用时加载，默认只常驻一个。带视觉投影器的模型也接受图片。适配度标记估算模型能否装入本机内存，但不阻止任何操作。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`web-app` bundle 在 Host 进程中挂载该服务；ACP、SDK 和 subagent 进程通过 base bundle 在 `llm-pi-ai` 中声明的 `local` 路由访问同一批模型。

### 何时选用

当部署需要在用户本机通过 llama.cpp 服务 GGUF 对话模型时选用本包。远程提供商只需 [llm-pi-ai](../llm-pi-ai/README.zh.md) 路由。每个 `dataRoot` 只在一个 Host 进程中挂载；该进程拥有 worker 和 `dataRoot` 下的文件。

### 最小配置

```yaml
- id: llama-cpp
  name: '@deepseek-ai/dsh-llama-cpp'
  config:
    dataRoot: !!js dshHomePath('llama-cpp')
    workerPath: !!js "process.env.JAN_LLAMA_WORKER || undefined"
```

桌面应用把 `JAN_LLAMA_WORKER` 设为其内置 worker；`pnpm run dev:web` 和 `pnpm run dev:desktop` 把它设为 `pnpm run stage:llama-worker` 的输出。没有可用 worker 时，服务在启动时报告 `failed` 阶段，不启动任何进程。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dataRoot` | 必填 | 存放模型、`install.json`、`run/preset.ini` 和 slot 状态的绝对目录 |
| `workerPath` | 未设置 | `jan-llama-worker` 的绝对路径，其 ggml 库位于同一目录 |
| `model` | `default` | 首次运行时安装的精选模型；`small` 选择 429 MB 的测试模型 |
| `modelsMax` | `1` | 常驻模型数；`0` 取消上限 |
| `ctxSize` | `32768` | 请求的上下文长度；`0` 交给 `fit` 选择，从训练上下文开始，不低于 `fitCtx`（`16384`） |
| `fit` | 开启；macOS 上关闭 | 让 llama.cpp 按设备内存确定 GPU 层数，以及 `ctxSize` 为 `0` 时的上下文 |
| `mmprojOffload` | `true` | 在 GPU 上运行视觉投影器；`false` 把它们留在系统内存中 |
| `slotCacheMiB` | `0` | `<dataRoot>/slots` 下按线程保存 KV 状态的磁盘预算；`0` 不保存 |
| `autoStart` | `true` | 已安装模型且用户未停止 worker 时，在启动时运行 worker |
| `provider`、`routeModelId` | `local`、`local` | 路由名称，以及默认模型的别名模型 id |
| `apiKeyRef`、`baseURLRef` | `LLAMA_CPP_API_KEY`、`LLAMA_CPP_BASE_URL` | 路由以 `apiKeyEnv` 和 `baseURLEnv` 读取的凭据引用 |
| `routeNamespace` | `llm-pi-ai` | 服务改写其 `providers.<provider>.models` 的设置命名空间；为空时不改写 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-llama-cpp)列出全部可用字段，包括 GPU、批大小和 KV cache 选项。

### 模型与选择器

服务把已安装模型记录在 `<dataRoot>/install.json`（版本 3）中，并保存从每个 GGUF 头部读取的信息：架构、训练上下文和 KV cache 维度。下载在记录前按 SHA-256 摘要和大小校验。导入的文件保留在原位置，不计算哈希。投影器（CLIP）和纯嵌入模型文件不能作为模型使用。移除下载的模型会删除其文件；移除导入的模型只会将其从列表中忘记。

第一个安装的模型成为默认模型并启动 worker。选择器把每个已安装模型列为 `local/<model id>`，`local/local` 始终选择默认模型，因此记录了 `local/local` 的已发布 Session 在默认模型变更后仍可使用。当设置分区声明了 `local` 提供商时，服务使其 `models` 列表与已安装模型一致：先是别名条目 `<name> (local default)`，然后每个模型一条 `<name> (local)`。每个 `contextWindow` 取 worker 最近为该模型确定的上下文，否则取计划上下文，且不超过训练上下文。模型带有能编码图片的投影器时，条目的 `input` 为 `['text', 'image']`，否则为 `['text']`；`llm-pi-ai` 只对前者接受图片附件。

当 agent 默认模型指向本路由不服务的模型，或指向没有可用模型的其他路由时，服务把它改为 `local/local`。**Make default** 还会把指向其他本地模型 id 的默认值改为 `local/local`。其他路由上可用的默认值保持不变。

### 视觉投影器

一个模型可以带一个多模态投影器（`mmproj`）GGUF 文件，使其能读取图片。投影器必须声明 `general.architecture = clip`；`clip.has_vision_encoder` 为 `true` 时它编码图片，没有该键时，除非 `clip.has_audio_encoder` 为 `true`，也视为编码图片。`install.json` 记录投影器的路径、大小、下载所得投影器的 SHA-256 摘要，以及它是否编码图片。

- 带投影器的精选条目在模型文件之后下载投影器；目录中的 **Qwen3 VL 2B Instruct** 带有投影器。
- Hugging Face 下载同时下载该仓库的投影器，且不能跳过：优先选文件名为 `mmproj-f16.gguf`（不区分大小写）的文件，否则选列表中第一个 `mmproj` 文件。投影器文件不作为模型列出。
- 下载的投影器与模型一样经过校验，保存为 `<dataRoot>/models/<id>/mmproj-<SHA-256 前 16 位十六进制>.gguf`。
- 导入时可以指定投影器路径；投影器保留在原位置，不计算哈希。对已导入的模型再次带投影器导入，会替换该模型的投影器。
- 移除模型会删除下载的投影器，导入的投影器文件保留在磁盘上。
- 启动时，投影器缺失或大小改变的模型仍保留在列表中，但不再带投影器，服务记录一条警告，并删除该模型下载的投影器。
- 取消下载会删除该下载的模型文件和投影器文件，包括已校验的模型文件。

### Worker 生命周期

启动时以 `--port 0` 运行 worker，由操作系统分配回环端口，并通过 `JAN_LLAMA_API_KEY` 环境变量传入新生成的 API 密钥。默认模型加载后，服务把端点存入 `LLAMA_CPP_BASE_URL`、把密钥存入 `LLAMA_CPP_API_KEY`；worker 停止时撤回两者，因此没有进程服务时路由不提供模型。停止操作关闭 worker 的 stdin，并在 `stopTimeoutMs` 后终止 worker。之后的启动只在用户未停止 worker 时运行它。

服务写入 `<dataRoot>/run/preset.ini`：每个已安装模型一个以模型 id 命名的分区，另加别名分区 `[local]`，内容为 `alias-of = <default model id>`。带投影器的模型在其分区中写入 `mmproj = <投影器绝对路径>`，`mmprojOffload` 为 `false` 时再写入 `mmproj-offload = false`。对 `local` 的请求直接到达默认模型的引擎，不会重复加载。安装、导入、移除或更改默认模型会改写 preset，并在运行中的 worker 上调用 `POST /models/reload`，无需重启；worker 只重新加载变化的分区，因此别名改指向不会重新加载任何模型。随后 **Make default** 和移除默认模型会把新的默认模型加载到运行中的 worker；加载失败时该请求以 worker 给出的原因失败，worker 继续运行，该模型仍为默认模型。

模型在首次请求或显式加载时加载。最多 `modelsMax` 个模型常驻：加载新模型会逐出最近最少使用的空闲模型，所有常驻模型都忙时 worker 返回 HTTP 503。移除会先卸载常驻模型，因为 Windows 无法删除 worker 映射中的文件；模型仍有进行中的请求时移除失败。

### 硬件适配度

启动时服务以 `--list-devices` 运行 worker 并读取系统内存。之后每个已安装模型、目录条目和 Hugging Face 文件都带有 `fits`、`tight` 或 `too-large` 适配度。已安装模型按权重和投影器加上计划上下文下估算的 KV cache 计算；目录条目和仓库文件按文件大小加上随之下载的投影器计算。显示的模型大小包含投影器。适配度只是提示，不阻止任何操作。设备列举失败时适配度未知。

### 状态

`follow()` 流式发送完整快照：阶段、Host 平台（`linux`、`macos` 或 `windows`）、默认模型、带 `status`（`loading`、`loaded` 或 `unloaded`）、`contextSize` 和 `vision` 的已安装模型、带进度的下载、每个条目带 `vision` 的目录以及硬件摘要。快照不含路径或密钥。[Remote 控制器](../../api/llama-cpp-controller/README.zh.md)把快照转发给浏览器。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

一个 `LlamaCpp` 服务通过任务队列串行执行安装记录和 worker 的变更。下载在单独的队列中逐个运行，并通过任务队列提交，因此下载期间启动和停止仍能及时响应。worker 的握手行给出端口和别名；服务随后订阅 `/models/sse` 以同步常驻状态，并在每次加载后从 `/props` 读取确定的上下文、改写路由列表。worker 运行期间该事件流出错或结束时，服务记录一条警告，每隔 `feedRetryMs` 重新订阅直到成功，并用新订阅建立后读取的 worker `GET /models` 列表替换同步状态；worker 停止或服务释放后不再重试。

| 文件 | 负责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务、安装记录、下载、worker 生命周期、路由列表、默认模型接管 |
| [`src/config.ts`](src/config.ts) | 经过校验的配置 |
| [`src/preset.ts`](src/preset.ts) | preset 渲染与计划上下文 |
| [`src/worker.ts`](src/worker.ts) | 握手与设备列表解析、worker HTTP 客户端 |
| [`src/gguf.ts`](src/gguf.ts) | GGUF 头部信息与 KV cache 估算 |
| [`src/memory.ts`](src/memory.ts) | 适配度评估 |
| [`src/catalog.ts`](src/catalog.ts)、[`src/huggingface.ts`](src/huggingface.ts)、[`src/download.ts`](src/download.ts) | 精选目录、仓库查询、可续传的校验下载 |
| [`src/types.ts`](src/types.ts) | 客户端可见的状态 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [jan-llama-worker](../../../native/llama-worker/README.zh.md)——worker 的命令行、握手和 HTTP API。
- [llm-pi-ai](../llm-pi-ai/README.zh.md)——服务 `local` 路由的适配器。
- [llama-cpp-controller](../../api/llama-cpp-controller/README.zh.md)——浏览器访问本服务的入口。
- [ui-settings-local-model](../../client/ui-settings-local-model/README.zh.md)——设置卡片和首次运行选项。
- [LLM 流式子系统](../../../docs/subsystems/llm-streaming.zh.md)——生成的 `ctx.llamaCpp` API。

-----

<a id="model-experience"></a>
## 模型体验

### 本地模型请求

#### What the model sees

对 `local/<model id>` 或 `local/local` 的请求经 `llm-pi-ai` 的 `openai-completions` 路由到达所选 GGUF 模型。服务不添加提示文本；llama.cpp 使用模型内嵌的对话模板格式化消息，文件没有模板时使用通用模板。对投影器能编码图片的模型，图片附件以 OpenAI `image_url` data URL 形式发送给 worker，由投影器编码进提示。

#### Token effect

服务不添加 token。它把每个路由条目的 `contextWindow` 设为 worker 实际服务的上下文（不超过训练上下文），把 `maxTokens` 设为 `routeMaxTokens`（`8192`）。harness 的提示和工具约占 12k token；模型确定的上下文低于 `fitCtx` 时，服务记录一条警告。

#### KV Cache effect

前缀复用发生在 worker 中常驻模型的 llama.cpp 提示缓存里。卸载、逐出或重新加载该模型、停止 worker 以及切换模型都会丢失这种复用；别名 `local` 改指向不会重新加载模型。按线程保存到磁盘的 KV 状态（`slotCacheMiB`）默认关闭。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

worker 以共享的启动选项服务对话模型，并通过投影器接受图片输入。

- preset 没有嵌入或推测解码分区；嵌入文件在安装时被拒绝。
- 服务自行选择仓库的投影器；没有投影器选择器，也不提供音频输入。
- 导入的投影器不会与其模型核对；不匹配的投影器可能导致模型加载失败。
- 失去投影器的下载模型只接受文本；移除后重新下载即可恢复图片输入。
- 启动选项作用于所有模型；没有按模型的设置，也没有对应的设置界面。
- 跨重启的 KV 状态复用默认关闭：`slotCacheMiB` 默认为 `0`，且 `llm-pi-ai` 路由不发送 worker 用于缓存的线程名。
- 适配度阈值是对驱动和操作系统开销的估算；标为 `fits` 的模型仍可能加载失败，标为 `too-large` 的模型也可能加载成功。
- `fit` 在 macOS 上默认关闭，因为 Metal 会把整个内存映射文件计入其工作集；该平台上的上下文取 `ctxSize`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
