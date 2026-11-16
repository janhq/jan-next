# open-waifu

<p align="center">
  <img src="assets/youre-awesome.jpg" alt="You're awesome" height="220">
  <img src="assets/never-gonna-give-you-up.png" alt="Never gonna give you up" height="220">
  <img src="assets/cat-rose.jpg" alt="Cat offering a rose" height="220">
</p>

My personal fork of [Jan](https://github.com/janhq/jan) for hobby and learning purposes: a waifu chat app for macOS and Windows. The desktop window runs DeepSeek Harness (DSH). A DSH UI plugin supplies Jan's styling and native window controls. Rust retains the llama.cpp engine and other native services; their DSH settings and Model Hub integration are still in progress.

## Architecture

Read [the architecture guide](docs/architecture.md) for before/after diagrams, startup flow, plugin boundaries and migration status.

## Project tree

```text
open-waifu/
├── web-app/            desktop bootstrap and legacy web routes (Vite, React)
├── dsh/                DSH plugins: Jan shell, native bridge, llama.cpp, downloads, assistants, plugin template (see dsh/README.md)
├── core/               @janhq/core: shared types
├── src-tauri/          desktop app (Rust)
│   ├── src/                app code
│   ├── plugins/            Tauri plugins (llama.cpp, hardware)
│   ├── utils/              shared Rust helpers
│   ├── capabilities/       Tauri permissions
│   ├── icons/              app icons (source icon.png per platform)
│   ├── static/             OpenAPI spec for the local API server
│   ├── tests/              upgrade fixtures for old user data
│   └── build-utils/        engine, icon and binary download scripts
├── scripts/            e2e-desktop.mjs: end-to-end check of the real desktop build
├── docs/plans/         design notes
├── assets/             README images
└── Makefile
```

## Run

Needs Node.js 22+, Yarn 4 (corepack), Rust and Make. On Windows, run make from Git Bash.

Install the DSH host with `npm install -g @deepseek-ai/dsh` (the current integration uses 0.2.2). `OW_DSH_CLI` can point to another built `lib/bin.js`. The app keeps its DSH profile and sessions under the Jan data folder, separate from your own DSH installation's state.

The desktop opens DSH directly. There is no separate Jan UI destination. Existing Jan provider endpoints and the selected model are passed to the host at startup; API keys are read from the OS keyring. UI plugins are installed and managed through DSH's Plugins page.

This is an experimental migration. The desktop starts the selected local llama.cpp model and passes its live endpoint to DSH. A local turn was verified in Minimal mode. Standard mode exceeded the model's saved 8,192-token context setting with a 22,385-token prompt; choose a mode and context size that fit the model. Remote chat was also verified with a configured OpenAI-compatible endpoint.

The chat area, composer and transcript are DSH's own. Jan's identity sits on top: palette, fonts, wordmark, the hand activity mark, line icons on plugin cards, and Jan's places for things (New Chat, New project and Search rows, the Chats list, Model Hub, Plugin manager and Settings in the footer, the model pill at the top left). New installs start with DSH's Session search and conversation-following titles switched on; both can be turned off in the Plugin manager. See [the migration plan](docs/plans/2026-11-13-dsh-host-shell.md) for verified behavior and remaining work.

To add a feature as a plugin, or to run the desktop end-to-end check, read [dsh/README.md](dsh/README.md).

| Command | Does |
|---|---|
| `make dev` | Install, build, launch the app |
| `make dev-web` | UI only, in a browser |
| `make build` | Production build |
| `make test` | Lint and all tests |
| `make clean` | Delete build output |
| `node scripts/e2e-desktop.mjs` | Launch the real desktop on a temporary data root and check its main screens |

The llama.cpp engine backend is set with `JAN_ENGINE_VARIANT` (`cpu`, `vulkan`, `metal`, `cuda12`, `cuda13`, `hip`), for example `make dev JAN_ENGINE_VARIANT=cuda13`. On Windows the engine needs VS 2022 Build Tools, LLVM (`clang-cl`), Ninja and CMake on `PATH`, plus the CUDA Toolkit for CUDA builds.

## License

Apache 2.0, as upstream.
