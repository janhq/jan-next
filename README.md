# Jan Next

Jan Next is an experimental rebuild of [Jan](https://jan.ai) as an agent harness, forked from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) by [DeepSeek AI](https://deepseek.com). It is local-first and privacy-focused, and it runs cloud models through [Tokamak](https://tokamak.sh), Jan's AI gateway.

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

## Local-first and privacy-focused

- **Local models.** Download an open-weight model such as Jan v3.5 4B and run it on your machine through the bundled llama.cpp worker. Sessions, settings, credentials, and models stay under the local Jan home directory (`~/.config/jan-alpha` unless `JAN_HOME` is set).
- **No telemetry.** Telemetry, product analytics, and usage reporting are not mounted in any profile.
- **Tokamak for cloud models.** Sign in to Tokamak from the app, or set `TOKAMAK_API_KEY`, to use frontier models.

Jan Next still contacts the network in these cases:

- Prompts go to `api.tokamak.sh` while a session uses a Tokamak model. Select a local model to keep a session on your machine.
- `web_search` sends the query to Tokamak when you are signed in, and to Exa's hosted endpoint when you are not.
- Model downloads come from Hugging Face and plugin installs from the npm registry, each only when you ask for them.

## Status

## Run

### Run from source


Requirements: Node.js 24.9 or later, pnpm, and a Git checkout. Run:

```sh
git clone https://github.com/janhq/jan-next.git
cd jan-next
pnpm install
pnpm run build
pnpm jan web
```

`pnpm jan web` starts the Web UI at `http://127.0.0.1:3080`, prints its URL, and opens it in the default browser for a local launch. Pass `--no-open` to run the server without opening a browser. It serves the artifacts from `pnpm run build` without rebuilding. See the [Web UI guide](docs/user/guide/index.md).

### Local models

The Web app needs the local model worker before it can offer local models. `make dev-web` builds the worker, then builds, serves, and rebuilds the Web app on source edits. The worker build needs a stable Rust toolchain, CMake 3.14 or later, and a C++17 compiler; see [native/llama-worker](native/llama-worker/README.md). Without the worker, the Web app still runs with Tokamak models.

## Documentation

Start with the [Web UI guide](docs/user/guide/index.md). Developers start with the [development guide](docs/development.md) and the [architecture documentation](docs/architecture.md); `make help` lists the Web and Desktop application commands.

For agents, follow [AGENTS.md](AGENTS.md).

## Community and support

- Report bugs through [GitHub Issues](https://github.com/janhq/jan-next/issues).
- Ask questions in the [Jan Discord](https://discord.gg/FTk2MvZwJH) or in the [Jan Q&A discussions](https://github.com/orgs/janhq/discussions/categories/q-a).
- Add the [`jan-plugin`](https://github.com/topics/jan-plugin) topic to your plugin repository for discoverability.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Citation

```bibtex
@misc{jan-next2026,
  title={Jan Next},
  author={Menlo Research},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/janhq/jan-next}},
}

@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE). Copyright (c) 2026 DeepSeek covers the original DeepSeek Harness; Copyright (c) 2026 Menlo Research covers the changes made in Jan Next.

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
