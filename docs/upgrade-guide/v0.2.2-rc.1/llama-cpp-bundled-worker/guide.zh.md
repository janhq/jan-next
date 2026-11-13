---
kind: upgrade-guide
description: "llama-cpp 插件改为在系统分配的端口上运行随应用打包的 jan-llama-worker，不再在固定端口上运行下载的 llama-server，并移除引擎、端口和测试覆盖相关的键。"
---

# `llama-cpp` 运行随应用打包的 `jan-llama-worker`

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-llama-cpp` 条目不再下载 `llama-server` 引擎，而是运行新键 `workerPath` 指定的 `jan-llama-worker` 可执行文件；桌面应用与 `pnpm run dev:web` 通过 `JAN_LLAMA_WORKER` 设置它，没有可用的 worker 时该条目在启动时报告 `failed`。worker 绑定系统选择的端口，该条目在 worker 提供服务期间把它发布为 `LLAMA_CPP_BASE_URL` 凭据。键 `backend`、`port`、`binaryPath` 与 `artifactOverrides` 已移除，`LLAMA_CPP_BACKEND` 不再读取。`llm-pi-ai` 的 `local` 路由改用新键 `baseURLEnv` 读取端点，不再使用 `baseURL: http://127.0.0.1:39281/v1`。`llamaCpp/readState` 与 `llamaCpp/follow` 的结果去掉 `model.engineBytes`、`model.backend`、`model.engineVersion`、`progress.phase`、`progress.overallReceivedBytes` 与 `progress.overallTotalBytes`。启动时删除 `$DSH_HOME/llama-cpp/` 下的 `engine/` 与 `downloads/` 目录；已安装的模型保留。

## 迁移

1. 在 profile patch 中，从 `llama-cpp` 条目删除 `backend`、`port`、`binaryPath` 与 `artifactOverrides`。测试把 `artifactOverrides.model` 换成 `firstModelOverride`，把 `binaryPath` 换成 `workerPath`。
2. 在复制了 `llm-pi-ai` `providers.local` 路由的 profile patch 中，把 `baseURL: http://127.0.0.1:39281/v1` 换成 `baseURLEnv: LLAMA_CPP_BASE_URL`。
3. 不经 `pnpm run dev:web` 或 `pnpm run dev:desktop` 从源码启动时，运行 `pnpm run build:llama-worker` 与 `pnpm run stage:llama-worker`，再把 `JAN_LLAMA_WORKER` 导出为 `native/llama-worker/dist/jan-llama-worker` 的绝对路径。
4. 自行运行 `llama-server` 的 headless profile 在 `LLAMA_CPP_API_KEY` 之外再导出 `LLAMA_CPP_BASE_URL=http://127.0.0.1:<port>/v1`。
5. `llamaCpp` Remote 的客户端从 `progress.receivedBytes` 与 `progress.totalBytes` 读取下载进度。
6. 打开“设置 → 模型”，确认本地模型卡片进入运行状态，并且该模型能在 `local` 路由的对话中回复。
