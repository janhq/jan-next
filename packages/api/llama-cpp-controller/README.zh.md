---
description: "受管理的本地 llama.cpp 模型的已认证 Remote 操作与状态流：下载、Hugging Face 查询、导入、默认模型选择、加载与卸载、worker 启停以及移除。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-llama-cpp-controller

[English](README.md) | 中文

## 概述

浏览器页面通过已认证的 Remote 操作和一个状态流管理本地模型。页面可以下载、导入、加载、卸载、删除模型并选择默认模型，也可以启动、停止或移除本地 worker。控制器把每个操作转发给 [dsh-llama-cpp](../../llm/llama-cpp/README.zh.md)，从不返回文件路径或密钥。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 `llama-cpp` 旁挂载该行；它依赖 `llamaCpp` 和 `typert` 服务，没有配置项。浏览器以 `llamaCpp` Remote 命名空间访问它。

```yaml
- id: llama-cpp-controller
  name: '@deepseek-ai/dsh-api-llama-cpp-controller'
```

| 操作 | 效果 |
|---|---|
| `readState`、`follow` | 读取当前状态；`follow` 先发送当前快照，之后每次变化发送一个，直到调用方断开 |
| `beginInstall`、`cancelInstall` | 首次运行：下载首次运行模型并启动 worker，或启动已安装的默认模型；停止所有下载 |
| `downloadModel`、`lookupRepo`、`downloadRepoFile` | 下载精选模型；列出 Hugging Face 仓库中的 GGUF 文件及其视觉投影器；下载其中一个（连同仓库的投影器）并返回其模型 id |
| `retryDownload`、`cancelDownload` | 从部分文件重新开始失败的下载；停止一个下载或关闭一个失败条目 |
| `importModel` | 按 Host 上的绝对路径添加 `.gguf` 文件，可另给其视觉投影器的绝对路径（两者都留在原位置），并返回其模型 id；为已导入的文件给出投影器会替换该模型的投影器 |
| `setDefaultModel`、`loadModel`、`unloadModel`、`deleteModel` | 设为默认模型并加载；立即加载或卸载模型；移除模型 |
| `startServer`、`stopServer`、`removeInstall` | 启动或停止 worker；停止 worker 并删除所有下载的模型和路由凭据 |

失败的操作抛出代码为 `llama-cpp/failed`、详情为 `{ reason }` 的 `RemoteError`，其中 `reason` 是服务给出的消息。`startServer` 或 `setDefaultModel` 中的 worker 启动失败则以 `follow` 上的 `failed` 阶段呈现。状态快照不含路径或密钥；`importModel` 接收路径，但只返回 id。

<a id="understand-the-implementation"></a>
## 理解实现

控制器是一个 `TypertRemoteService`，把每个操作转发给 `ctx.llamaCpp`，并把抛出的错误转换为 `llama-cpp/failed`。它不保存自己的状态。它重新导出客户端可见的状态类型，使浏览器代码依赖本包而不是 Host 服务。

<a id="further-exploration"></a>
## 进一步探索

[dsh-llama-cpp](../../llm/llama-cpp/README.zh.md) 定义这些操作的行为；[ui-settings-local-model](../../client/ui-settings-local-model/README.zh.md) 是浏览器端使用方；[api](../README.zh.md) 汇总各 Remote 控制器。

<a id="model-experience"></a>
## 模型体验

### 本地模型操作

#### What the model sees

控制器不添加模型可见的文本。它的操作改变 `local` 路由服务哪些模型以及 `local/local` 选择哪一个；该效果由 [dsh-llama-cpp](../../llm/llama-cpp/README.zh.md#model-experience) 负责。

#### Token effect

没有直接的 token 影响。`setDefaultModel` 和 `deleteModel` 可能改变 `local/local` 所列的 `contextWindow`。

#### KV Cache effect

通过控制器卸载、删除、停止或移除时，会丢弃 worker 中受影响模型的提示缓存；更改默认模型不会重新加载模型。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 失败只携带一个自由文本 `reason`；调用方无法按代码区分模型忙、文件缺失或 Hugging Face 不可达。
- `importModel` 接收 Host 文件系统上的路径；远程浏览器无法通过它上传模型或投影器文件。

<a id="dev-note"></a>
### 开发备注

无。
