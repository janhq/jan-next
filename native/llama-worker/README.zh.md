# jan-llama-worker

[English](README.md) | 中文

## Summary

`jan-llama-worker` 是一个独立的 Rust 可执行文件，它链接 llama.cpp，并在回环端口上提供兼容 OpenAI 的 HTTP 服务。监管进程启动一个 worker 进程，从其 stdout 读取一行 JSON 握手信息，携带 bearer token 发送请求，并通过关闭其 stdin 使其停止。进程边界隔离了 `GGML_ASSERT` 中止和 GPU 驱动故障，因此模型失败只会让 worker 退出，而不会波及监管进程。该 crate 不属于 pnpm workspace，任何安装或构建脚本都不会编译它。

## Table of Contents

- [构建](#build)
- [固定的 llama.cpp 版本](#pinned-llamacpp)
- [命令行](#command-line)
- [握手](#handshake)
- [HTTP API](#http-api)
- [关闭与退出码](#shutdown-and-exit-codes)
- [开发备注](#dev-note)

## Build

构建需要稳定版 Rust 工具链、CMake 3.14 或更高版本、C++17 编译器和 git。找到 `ccache` 或 `sccache` 时会使用它们。每个 GPU 后端还需要各自的工具链：Vulkan 需要 Vulkan 头文件、加载器和 `glslc`；CUDA 需要 `nvcc`；HIP 需要带 rocWMMA 的 ROCm；Metal 需要 Xcode。Windows 构建需要 Ninja 和 clang-cl。

在仓库根目录运行 `pnpm run build:llama-worker`，会获取固定版本的 llama.cpp，并以 release 模式构建 CPU worker。额外的 Cargo 参数会追加到 `cargo build` 之后；例如 `pnpm run build:llama-worker --features engine-vulkan` 会加入 Vulkan 后端。在本目录中，先运行一次 `scripts/fetch-llama-cpp.sh`，再运行 `cargo build --release --features <features>`。

| Cargo feature | 增加的内容 |
|---|---|
| `engine` | llama.cpp、C++ shim 和多变体 CPU 后端；二进制文件必需 |
| `engine-vulkan` | Vulkan 后端模块 |
| `engine-cuda` | CUDA 后端模块，对应所找到的 `nvcc` 的 CUDA 主版本 |
| `engine-hip` | HIP 后端模块 |
| `engine-metal` | Metal 后端模块 |

二进制文件写入 `target/release/jan-llama-worker`。ggml 被构建为共享库和运行时加载的后端模块，位于构建脚本的输出目录下。二进制文件通过其运行路径和编译时写入的构建树目录找到它们，因此可以就地运行，但不能单独移动。

`pnpm run stage:llama-worker`（或在本目录中运行 `scripts/stage.sh [<dir>]`）会把 release 二进制文件，以及该二进制文件所链接构建中的 `libggml`、`libggml-base` 和所有 `ggml-*` 后端模块复制到同一个目录（默认为 `dist/`）；缺少二进制文件、其 ggml prefix 或后端模块时脚本会失败。ggml 从可执行文件所在目录加载后端模块，各个库在 Linux 上通过 `$ORIGIN` 运行路径、在 macOS 上通过 `@loader_path`、在 Windows 上通过可执行文件所在目录解析，因此暂存目录可以从任意位置运行。脚本会从暂存的二进制文件中移除绝对构建树运行路径：macOS 上使用 `install_name_tool`，Linux 上在已安装 `patchelf` 时使用它；没有 `patchelf` 时这些路径保留在 `$ORIGIN` 之后，暂存的 ggml 库仍然优先。桌面安装包把 `dist/` 复制到 `<resources>/llama-worker/`，因此打包后的 worker 位于 `<resources>/llama-worker/jan-llama-worker`（Windows 上为 `.exe`）；除非设置 `DSH_DESKTOP_OMIT_LLAMA_WORKER=1`，否则 `dist/` 中没有 worker 时打包会失败。

| 构建变量 | 作用 |
|---|---|
| `JAN_LLAMA_CPP_DIR` | 针对已有的 llama.cpp 检出目录构建，而不使用 `vendor/llama.cpp` |
| `JAN_ENGINE_BUILD_LOG` | 将 CMake 输出追加到该文件，以便实时查看进度 |
| `JAN_ENGINE_BUILD_DIR` | 将 CMake 构建树放在该目录下 |
| `JAN_ENGINE_CUDA_ARCHS` | 覆盖 `CMAKE_CUDA_ARCHITECTURES` |
| `JAN_ENGINE_HIP_TARGETS` | 覆盖 HIP 的 `GPU_TARGETS` 列表 |

## Pinned llama.cpp

`build.rs` 通过 `LLAMA_CPP_TAG`、`LLAMA_CPP_COMMIT`、`LLAMA_CPP_BUILD_NUMBER` 和 `LLAMA_CPP_VERSION` 声明固定版本；crate 版本等于 `LLAMA_CPP_VERSION`。当前固定为标签 `b12110`、llama.cpp 版本 0.9.0、提交 `cd959bae99ff4bed22bef2604f45241c09bbb8c8`。llama.cpp 源码从不提交到仓库：`scripts/fetch-llama-cpp.sh` 从 `build.rs` 读取标签和提交，从上游 GitHub 仓库浅克隆该标签到被忽略的 `vendor/llama.cpp`，并且只有当 `HEAD` 等于固定提交时才会成功。启动时，worker 会将所链接 llama.cpp 的构建号与固定版本比较，不一致时以退出码 3 退出。

更新固定版本时，需要同时修改全部四个常量和 crate 版本，删除 `vendor/llama.cpp`，然后重新运行获取脚本。单元测试会拒绝与 `build.rs` 不一致的 crate 版本、编译时常量或获取脚本。对于 CUDA 构建，当上游默认的 CUDA 架构列表与 `build.rs` 推导出的列表不再一致时，构建也会失败。

## Command line

| 调用方式 | 行为 |
|---|---|
| `jan-llama-worker --preset <ini> [--port N] [--models-max N] [--slot-cache-mib N]` | 为预设中的模型提供服务；端口默认为 0，由操作系统选择 |
| `jan-llama-worker` | 以空的已注册模型集合提供服务 |
| `jan-llama-worker --list-devices` | 以一个 JSON 数组打印可卸载计算的设备后退出 |
| `jan-llama-worker --diagnose [--diagnose-preset quick\|full\|model] [--diagnose-plan JSON] [--device NAME]...` | 运行 ggml 算子诊断，每行打印一个 JSON 事件 |
| `jan-llama-worker --version` | 打印固定的 llama.cpp 标签 |

`--models-max` 限制常驻模型的数量；默认为 1，设为 0 表示不限制。超过上限加载时会驱逐最近最少使用的空闲模型；当所有常驻模型都忙碌时，需要另一个模型的请求会收到 HTTP 503。`--slot-cache-mib` 限制 `slot-save-path` 所指定的按线程 KV 缓存目录的大小，默认为 0，即禁用保存。`--diagnose-run`、`--diagnose-devices` 和 `--diagnose-ops` 用于启动由 `--diagnose` 监管的叶子进程。

预设采用 llama.cpp 路由器预设的 INI 格式。除 `[*]` 外，每个节注册一个模型，模型 id 即节名；`[*]` 保存应用于所有节的默认值，节内自己的键会覆盖它们。键是去掉前导短横线的 llama.cpp 服务器选项名，例如 `model`、`ctx-size`、`n-gpu-layers`、`device`、`flash-attn`、`cache-type-k`、`cache-type-v`、`fit` 和 `split-mode`；未知的键会被忽略。worker 自身会从 `[*]` 读取 `slot-save-path`，并在开始服务前创建该目录。模型在第一个指定它的请求到来时加载，或在收到 `POST /models/load` 时加载。

bearer token 从 `JAN_LLAMA_API_KEY` 环境变量读取，读取后从进程环境中移除；值为空或未设置时禁用认证。

## Handshake

监听器绑定后，worker 向 stdout 打印且只打印一行 JSON 并立即刷新；服务模式下不会再向 stdout 打印其他内容。

```json
{"port":39271,"pid":1234,"models":["a","b"],"cuda_toolkit":null,"devices":[{"id":"Vulkan0","name":"AMD Radeon"}]}
```

`models` 列出排序后的预设节名。`cuda_toolkit` 是 CUDA 构建所使用的 `major.minor` CUDA 版本，其他构建为 `null`。`devices` 列出本进程初始化的设备；无法读取时为 `null`，空数组表示该机器没有可卸载计算的设备。

## HTTP API

worker 监听 `127.0.0.1`，并对每个请求检查 `Authorization: Bearer <key>`。

| 方法与路径 | 用途 |
|---|---|
| `GET /v1/models`、`GET /models` | 列出所有已注册模型及其 llama.cpp 路由器 `status` 和 `busy` 标志 |
| `GET /models/sse` | 以服务器发送事件推送模型生命周期事件及加载进度 |
| `POST /models/load`、`POST /models/unload` | 加载或卸载 `{"model": id}` |
| `POST /models/reload` | 重新读取 `{"preset_path", "models_max"?}`，只重新加载发生变化的模型 |
| `POST /slots/state/erase` | 删除 `{"thread"}` 或 `{"model"}` 已保存的 KV 状态 |
| `POST /v1/chat/completions`、`/v1/completions`、`/v1/embeddings`、`/rerank`、`/tokenize`、`/detokenize`、`/apply-template` | llama.cpp 自身的处理器，包括流式输出 |
| `GET /health`、`GET /props`、`GET /slots` | llama.cpp 自身的处理器 |

请求根据请求体的 `model` 字段或 `model` 查询参数选择模型；两者都没有时，由任意常驻模型应答。补全请求中的 `thread_id` 字段会启用按线程的 KV 状态复用，并在请求体交给 llama.cpp 之前被移除。

## Shutdown and exit codes

worker 在 stdin 到达文件末尾时停止，在 Unix 上收到 SIGTERM 时也会停止。随后它停止接受连接，给进行中的请求最多 10 秒完成，保存常驻线程的 KV 状态，释放所有模型，并以 0 退出。写入 stdin 的字节会被忽略。被强制终止的 worker 会跳过 KV 保存和模型释放。`--diagnose` 以同样的方式取消。

| 退出码 | 含义 |
|---|---|
| 2 | 参数无效 |
| 3 | 所链接的 llama.cpp 不是固定的构建版本 |
| 4 | 无法读取预设 |
| 5 | 无法绑定监听器 |
| 6 | `--list-devices` 无法枚举设备 |
| 7 | 无法创建 `slot-save-path` 目录 |
| 8, 9, 10 | 诊断初始化失败、读取方丢失或叶子进程超过期限 |

## Dev Note

`cargo test` 和 `cargo clippy --all-targets` 无需 CMake 即可运行：只有 `engine` feature 会编译 llama.cpp，HTTP、预设、注册表、KV 状态和诊断编排逻辑在不启用它时也会被测试。`cargo test --features engine` 还会运行 shim、算子诊断和 worker 进程测试；`tests/engine_smoke.rs` 和 `tests/worker_http.rs` 中依赖模型的用例只在 `JAN_TEST_GGUF` 指向一个小型 GGUF 文件时运行。`src/sys.rs` 是该 crate 中唯一的 `unsafe` 代码。
