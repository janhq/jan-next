---
description: "设置 Models 页面上的本地模型卡片和首次运行设置中的本地选项：下载、导入、加载和选择 GGUF 模型，查看硬件适配度，并启动或停止本地 llama.cpp worker。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-local-model

[English](README.md) | 中文

## 概述

用户可以在“设置 → Models”和首次运行设置中，在自己的电脑上运行模型。本地模型卡片负责启动、停止和移除本地 worker，列出已安装模型及其适配度、上下文和常驻状态，并可从精选列表、Hugging Face 仓库或 `.gguf` 路径添加模型。首次运行设置把推荐模型作为首选项提供，并显示其下载进度。实际工作由 Host 上的 [dsh-llama-cpp](../../llm/llama-cpp/README.zh.md) 服务完成。

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

将该行与 [ui-settings-models](../ui-settings-models/README.zh.md) 以及 Host 行 `llama-cpp` 和 `llama-cpp-controller` 一起挂载；该插件没有配置项，也没有 Host 行为。

```yaml
- id: ui-settings-local-model
  name: '@deepseek-ai/dsh-client-ui-settings-local-model'
```

### 本地模型卡片

卡片渲染在 `settings.models.footer` slot 中。卡片头部显示默认模型名称、worker 阶段，以及一行硬件信息：GPU 设备及其显存、后端和系统内存。worker 运行时，卡片显示其服务的上下文长度。操作按阶段显示：下载首次运行模型、取消、启动、停止、重试，以及**移除**——停止 worker 并删除所有下载的模型。失败时显示错误消息，并在**详情**中显示 worker 最近的日志行。

### 模型管理器

卡片内的管理器列出已安装模型。每一行在默认模型上显示 **Default** 标签，并显示适配度标记（**Fits**、**Tight fit** 或 **Too large**，悬停可见说明）、大小、架构、上下文和来源。worker 运行时，每一行还显示 **Loaded**、**Loading…** 或 **Not loaded**。每行提供 **Load**、**Unload**、**Make default** 和 **Delete**；删除需要确认，导入的文件只会从列表中移除。失败的操作在该行显示错误，直到下一次尝试。

列表下方，**Downloads** 显示每个下载的进度、速度和剩余时间，并提供重试和取消。**Add a model** 搜索精选模型；形如 `owner/name` 的文本或链接则改为查询该 Hugging Face 仓库并列出其文件。精选条目和仓库文件都带有适配度标记。**Import a .gguf file** 按 Host 上的完整路径添加文件；示例路径跟随 Host 平台，而不是浏览器所在平台。

### 首次运行选项

`settings.models.local-setup` slot 在 ui-settings-models 的首次运行对话框中渲染本地选项。选择它会开始下载，或启动已安装的模型，并展开显示进度和状态。下载期间用户可以转入后台继续，worker 运行后以**开始对话**结束。下载或启动期间重新加载页面会重新打开展开视图。

文案位于 `settings.local-model` 本地化命名空间。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

浏览器入口在宿主尚未提供时挂载 `llamaCpp` Remote，然后注册两个 slot。一个可重连的镜像跟随控制器的 `follow` 流并供给所有视图；流中断时镜像标记为断开，不改变最后的 Host 状态。操作调用控制器方法并返回结果，因此每个视图自行负责其等待和错误显示。

| 文件 | 负责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Remote 挂载、本地化注册、slot 注册 |
| [`src/client/state.ts`](src/client/state.ts) | 状态镜像、字节与时间格式化 |
| [`src/client/actions.ts`](src/client/actions.ts) | 控制器调用及其结果 |
| [`src/client/LocalModelCard.tsx`](src/client/LocalModelCard.tsx)、[`src/client/ModelManager.tsx`](src/client/ModelManager.tsx) | 卡片与模型管理器 |
| [`src/client/LocalSetup.tsx`](src/client/LocalSetup.tsx) | 首次运行选项 |
| [`src/client/locales.ts`](src/client/locales.ts) | 词典 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-llama-cpp](../../llm/llama-cpp/README.zh.md)——模型、worker 和适配度。
- [llama-cpp-controller](../../api/llama-cpp-controller/README.zh.md)——本界面调用的 Remote 操作。
- [ui-settings-models](../ui-settings-models/README.zh.md)——承载两个 slot 的 Models 页面和首次运行对话框。

-----

<a id="model-experience"></a>
## 模型体验

### 本地模型选择

#### What the model sees

插件不添加模型可见的文本。它的操作改变 `local` 路由服务哪些模型以及 `local/local` 选择哪一个；该效果由 [dsh-llama-cpp](../../llm/llama-cpp/README.zh.md#model-experience) 负责。

#### Token effect

没有直接的 token 影响。**Make default** 和 **Delete** 可能改变 `local/local` 所列的 `contextWindow`。

#### KV Cache effect

**Unload**、**Delete**、**停止**和**移除**会丢弃 worker 中受影响模型的提示缓存；**Make default** 不会重新加载模型。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 非英语词典中的模型管理器、适配度、硬件和下载进度文案目前仍为英文。
- 导入需要输入 Host 上的路径；没有文件选择器或上传功能。
- 卡片没有按模型的设置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
