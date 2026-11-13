# Agent Note: The bundled jan-llama-worker replaces the downloaded llama-server

Status: implemented

[English](2026-11-13-bundled-llama-worker.md) | 中文

## 问题

`llama-cpp` 插件在首次使用时从 GitHub 下载固定版本的预编译 `llama-server` 归档，用 `tar` 解包，并在固定端口 39281 上运行；`llm-pi-ai` 的 `local` 路由也把这个端口写死。这一设计有四项代价。首次运行依赖 GitHub release 的可用性，因此插件要维护镜像回退和共享的引擎安装状态机。只能使用 llama.cpp 发布的 CPU 与 Vulkan 构建，CUDA 与 HIP 无法使用。另一个进程占用 39281 端口会阻止启动，因此需要在启动前探测健康状态并校验密钥。切换模型需要重启服务，而被 SIGKILL 结束的监督进程会留下仍在运行的 `llama-server`。

## 决策

应用随包提供 `jan-llama-worker`（[`native/llama-worker`](../../../../native/llama-worker/README.zh.md)），它基于固定版本的 llama.cpp 从源码构建。`pnpm run stage:llama-worker` 把二进制、`libggml`、`libggml-base` 与全部后端模块复制到 `native/llama-worker/dist/`，其运行路径为 `$ORIGIN`（macOS 上为 `@loader_path`）。桌面安装包把该目录复制到 `<resources>/llama-worker/`。

插件通过显式的 `workerPath` 键指定可执行文件；web-app 条目从 `JAN_LLAMA_WORKER` 设置它。打包后的桌面应用把该变量设为随包副本，`pnpm run dev:web` 与 `pnpm run dev:desktop` 把它设为暂存的开发构建。worker 缺失或不可执行时，插件在启动时发布 `failed`，首次安装不会下载任何内容。

插件写入只有一个 `[local]` 段的路由预设，以 `--port 0` 启动 worker，并从 stdout 握手行读取绑定的端口。插件把 `http://127.0.0.1:<port>/v1` 作为 `LLAMA_CPP_BASE_URL` 凭据与 `LLAMA_CPP_API_KEY` 密钥一同发布，`local` 路由通过 `llm-pi-ai` 的 `baseURLEnv` 配置键读取它。选择其他模型时，插件重写预设并调用 `POST /models/reload`，因此进程、端口与密钥在切换后保持不变。停止时插件关闭 stdin，只有超过 `stopTimeoutMs` 后才终止 worker。worker 在 stdin 读到文件结尾时也会退出，因此不会在被 SIGKILL 结束的监督进程之后继续运行。

## 考虑过的替代方案

**继续下载 `llama-server`。** 安装包更小，但保留了 GitHub 依赖、仅 CPU/Vulkan 的构建矩阵、固定端口以及每次切换都重启的行为，而 worker 消除了这些问题。

**按需下载 worker。** 这以安装包大小换来同样的网络依赖，还要为第二个制品维护发布流程和完整性表；随包提供则让 worker 与讲同一协议的应用版本绑定。

**把实时端口写入 `llm-pi-ai` 设置段。** `syncRoute` 已在那里写入模型列表。但这次写入落在单个 profile 的 patch 文件中，使用其他 profile 的 `dsh acp` 与 SDK 进程看不到端口；它还会在每次启动时改写用户的 patch。凭据在各 profile 之间共享，并与密钥一同撤回。

**保留固定端口。** 配置的端口让路由可以保留静态 `baseURL`，但会带回端口冲突时的拒绝启动，以及本次变更移除的 `port`/`baseURL` 重复配置。

## 影响

安装包增加暂存 worker 的体积（包含 CPU 与 Vulkan 后端的 Linux 构建未压缩为 78 MB）。打包前必须构建并暂存 worker；`DSH_DESKTOP_OMIT_LLAMA_WORKER=1` 可在不含 worker 的情况下打包。不经开发脚本从源码启动时必须导出 `JAN_LLAMA_WORKER`。

插件不再需要引擎制品表、归档解包、共享的引擎安装状态、镜像回退、启动前的端口探测以及切换模型时的重启。`llm-pi-ai` 新增通用的 `baseURLEnv` 键，通过凭据接口逐请求解析路由端点。

预设刻意保持最小；后续变更会移植 Jan 完整的预设生成器与 GGUF 元数据读取。
