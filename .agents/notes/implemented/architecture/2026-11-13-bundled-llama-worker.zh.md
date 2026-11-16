# Agent Note: The bundled jan-llama-worker replaces the downloaded llama-server

Status: implemented

[English](2026-11-13-bundled-llama-worker.md) | 中文

## 问题

`llama-cpp` 插件在首次使用时从 GitHub 下载固定版本的预编译 `llama-server` 归档，用 `tar` 解包，并在固定端口 39281 上运行；`llm-pi-ai` 的 `local` 路由也把这个端口写死。这一设计有四项代价。首次运行依赖 GitHub release 的可用性，因此插件要维护镜像回退和共享的引擎安装状态机。只能使用 llama.cpp 发布的 CPU 与 Vulkan 构建，CUDA 与 HIP 无法使用。另一个进程占用 39281 端口会阻止启动，因此需要在启动前探测健康状态并校验密钥。切换模型需要重启服务，而被 SIGKILL 结束的监督进程会留下仍在运行的 `llama-server`。

## 决策

应用随包提供 `jan-llama-worker`（[`native/llama-worker`](../../../../native/llama-worker/README.zh.md)），它基于固定版本的 llama.cpp 从源码构建。`pnpm run stage:llama-worker` 把二进制、`libggml`、`libggml-base` 与全部后端模块复制到 `native/llama-worker/dist/`，其运行路径为 `$ORIGIN`（macOS 上为 `@loader_path`）。桌面安装包把该目录复制到 `<resources>/llama-worker/`。

插件通过显式的 `workerPath` 键指定可执行文件；web-app 条目从 `JAN_LLAMA_WORKER` 设置它。打包后的桌面应用把该变量设为随包副本，`pnpm run dev:web` 与 `pnpm run dev:desktop` 把它设为暂存的开发构建。worker 缺失或不可执行时，插件在启动时发布 `failed`，首次安装不会下载任何内容。

插件写入路由预设，每个已安装模型一个以模型 id 命名的段，以 `--port 0` 启动 worker，并从 stdout 握手行读取绑定的端口。插件把 `http://127.0.0.1:<port>/v1` 作为 `LLAMA_CPP_BASE_URL` 凭据与 `LLAMA_CPP_API_KEY` 密钥一同发布，`local` 路由通过 `llm-pi-ai` 的 `baseURLEnv` 配置键读取它。每个模型在路由上是 `local/<模型 id>`，首次使用时加载；`modelsMax`（默认 1，与 Jan 相同）限制常驻模型数量。已发布会话引用的 `local/local` 仍是默认模型的别名：预设的 `[local]` 段只含 `alias-of = <模型 id>`，worker 在任何查找之前把别名解析为目标，因此两个名称共用一个引擎。安装、删除或选择其他默认模型时，插件重写预设并调用 `POST /models/reload`；worker 只重新加载选项变化的段，因此移动别名不会卸载任何模型，进程、端口与密钥保持不变。停止时插件关闭 stdin，只有超过 `stopTimeoutMs` 后才终止 worker。worker 在 stdin 读到文件结尾时也会退出，因此不会在被 SIGKILL 结束的监督进程之后继续运行。

## 考虑过的替代方案

**继续下载 `llama-server`。** 安装包更小，但保留了 GitHub 依赖、仅 CPU/Vulkan 的构建矩阵、固定端口以及每次切换都重启的行为，而 worker 消除了这些问题。

**按需下载 worker。** 这以安装包大小换来同样的网络依赖，还要为第二个制品维护发布流程和完整性表；随包提供则让 worker 与讲同一协议的应用版本绑定。

**把实时端口写入 `llm-pi-ai` 设置段。** `syncRoute` 已在那里写入模型列表。但这次写入落在单个 profile 的 patch 文件中，使用其他 profile 的 `dsh acp` 与 SDK 进程看不到端口；它还会在每次启动时改写用户的 patch。凭据在各 profile 之间共享，并与密钥一同撤回。

**在 `[local]` 段中复制默认模型。** 这不需要修改 worker，但 worker 会把两个段当作两个模型，同时使用两个 id 时默认模型的文件会加载两次。

**在路由中把 `local` 映射到模型 id。** `llm-pi-ai` 原样发送配置的模型 id，不提供逐模型的请求 id；为单个路由增加该能力或请求体钩子，会让路由依赖本插件。

**保留固定端口。** 配置的端口让路由可以保留静态 `baseURL`，但会带回端口冲突时的拒绝启动，以及本次变更移除的 `port`/`baseURL` 重复配置。

## 影响

安装包增加暂存 worker 的体积（包含 CPU 与 Vulkan 后端的 Linux 构建未压缩为 78 MB）。打包前必须构建并暂存 worker；`DSH_DESKTOP_OMIT_LLAMA_WORKER=1` 可在不含 worker 的情况下打包。不经开发脚本从源码启动时必须导出 `JAN_LLAMA_WORKER`。

插件不再需要引擎制品表、归档解包、共享的引擎安装状态、镜像回退、启动前的端口探测以及切换模型时的重启。`llm-pi-ai` 新增通用的 `baseURLEnv` 键，通过凭据接口逐请求解析路由端点。

预设沿用 Jan 的生成器：未设置的选项一律省略，由 llama.cpp 或 GGUF 决定；与模型相关的键（按训练上下文封顶的 `ctx-size`，以及只对含专家的模型写入的 `moe-cache-mib`）写在各模型的小节。Jan 的逐模型 `model.yml` 设置、对话模板与语法覆盖、推测解码小节、嵌入小节以及采样默认值没有移植，因为本 harness 中没有任何东西产生它们；投影器小节按[视觉投影器 Agent Note](../feature/2026-11-16-local-model-vision-projectors.zh.md) 的记录写入。预设省略 `jinja = true`，因为固定版本的 llama.cpp 默认启用 Jinja（`common/common.h` 中的 `use_jinja = true`），Jan 转向 router 模式时也因此去掉了 `--jinja`。与 Jan 一样，`fit` 在 macOS 上默认关闭（janhq/jan#9198）。

GGUF 头由 `@huggingface/gguf`（MIT、ESM、由 Hugging Face 维护）读取，而不是手写解析器：它通过 `allowLocalFile` 读取本地文件，能给出 `general.file_type` 的量化名称，并可通过 HTTP 范围请求读取远程文件头，供后续的下载前估算使用。它唯一的依赖是 `@huggingface/tasks`。插件把这些信息记录在第 3 版 `install.json` 中，在下载和导入时拒绝把投影器与嵌入文件作为模型，并按 Jan 的阈值，用 `--list-devices` 与系统内存判断模型是否放得下。Jan 的 GPU 卸载就绪检查没有移植：它要把 worker 的设备与硬件探测结果比较，而本 harness 没有硬件探测。

逐线程 KV 持久化已接通（`slotCacheMiB`、`slots/`）但处于关闭状态。worker 要求请求体中带有 `thread_id` 与 `id_slot`；`llm-pi-ai` 只提供 `llm-pi-ai/request-headers` waterfall，也没有标记删除的 Session 事件可用于清除已保存的状态。
