# open-waifu

<p align="center">
  <img src="assets/youre-awesome.jpg" alt="You're awesome" height="220">
  <img src="assets/never-gonna-give-you-up.png" alt="Never gonna give you up" height="220">
  <img src="assets/cat-rose.jpg" alt="Cat offering a rose" height="220">
</p>

My personal fork of [Jan](https://github.com/janhq/jan) for hobby and learning purposes: a waifu chat app for macOS and Windows.

## Project tree

```text
open-waifu/
├── web-app/            React UI (Vite, TanStack Router)
├── core/               @janhq/core: shared types, extension context
├── extensions/         built-in extensions: assistant, download, llama.cpp, RAG, vector DB
├── packages/
│   ├── extension-api/      API that extensions code against
│   └── extension-runtime/  worker that runs extensions
├── src-tauri/          desktop app (Rust)
│   ├── src/                app code
│   ├── plugins/            Tauri plugins (llama.cpp, hardware, RAG, vector DB, agent tools, ...)
│   ├── utils/              shared Rust helpers
│   ├── capabilities/       Tauri permissions
│   ├── icons/              app icons (source icon.png per platform)
│   ├── static/             OpenAPI spec for the local API server
│   ├── tests/              upgrade fixtures for old user data
│   └── build-utils/        engine, icon and binary download scripts
├── assets/             README images
└── Makefile
```

## Run

Needs Node.js 20+, Yarn 4 (corepack), Rust and Make. On Windows, run make from Git Bash.

| Command | Does |
|---|---|
| `make dev` | Install, build, launch the app |
| `make dev-web` | UI only, in a browser |
| `make build` | Production build |
| `make test` | Lint and all tests |
| `make clean` | Delete build output |

The llama.cpp engine backend is set with `JAN_ENGINE_VARIANT` (`cpu`, `vulkan`, `metal`, `cuda12`, `cuda13`, `hip`), for example `make dev JAN_ENGINE_VARIANT=cuda13`. On Windows the engine needs VS 2022 Build Tools, LLVM (`clang-cl`), Ninja and CMake on `PATH`, plus the CUDA Toolkit for CUDA builds.

## License

Apache 2.0, as upstream.
