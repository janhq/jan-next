# Short names for the Web and Desktop application commands. The package.json
# scripts they call stay the source of truth; docs/development.md documents both.
.DEFAULT_GOAL := help
.PHONY: help build clean web desktop dev-web dev-desktop llama-worker package package-dir package-check

PNPM ?= pnpm
ARGS ?=

ifeq ($(shell uname -s),Darwin)
LLAMA_WORKER_FEATURES ?= engine-metal
else ifneq ($(shell command -v glslc 2>/dev/null),)
LLAMA_WORKER_FEATURES ?= engine-vulkan
else
LLAMA_WORKER_FEATURES ?= engine
endif

help:
	@echo "make build         pnpm run build           complete repository build"
	@echo "make clean         pnpm run clean           remove build outputs and safe deleted-package residue"
	@echo "make web           pnpm run start:web       serve the built Web artifacts from source"
	@echo "make desktop       pnpm run start:desktop   launch the built Desktop artifacts"
	@echo "make dev-web       pnpm run dev:web         build the local model worker and Web, serve, and rebuild Web on source edits"
	@echo "make dev-desktop   pnpm run dev:desktop     build the local model worker and Desktop, then launch Desktop"
	@echo "make llama-worker  build:llama-worker, stage:llama-worker   build and stage the local model worker"
	@echo "make package       pnpm run package:desktop:unsigned   build the worker, then an unsigned installer for this machine"
	@echo "                   (macOS DMG, Windows .exe, Linux AppImage and .deb) in apps/desktop/.desktop-build/targets/<target>/unsigned-artifacts"
	@echo "make package-dir   pnpm run package:desktop:unsigned:dir   same, stopping at the unpacked application"
	@echo "make package-check pnpm run package:desktop:unsigned --check   check tools and configuration without building"
	@echo "ARGS='--no-open --port 3081' forwards options to the launched application;"
	@echo "the Web commands accept jan web flags, the Desktop launcher accepts none."
	@echo "LLAMA_WORKER_FEATURES=$(LLAMA_WORKER_FEATURES) selects the worker's cargo features."

build:
	$(PNPM) run build

clean:
	$(PNPM) run clean

web:
	$(PNPM) run start:web $(ARGS)

desktop:
	$(PNPM) run start:desktop $(ARGS)

dev-web: llama-worker
	$(PNPM) run dev:web $(ARGS)

dev-desktop: llama-worker
	$(PNPM) run dev:desktop $(ARGS)

llama-worker:
	$(PNPM) run build:llama-worker --features $(LLAMA_WORKER_FEATURES)
	$(PNPM) run stage:llama-worker

package: llama-worker
	$(PNPM) run package:desktop:unsigned $(ARGS)

package-dir: llama-worker
	$(PNPM) run package:desktop:unsigned:dir $(ARGS)

package-check:
	$(PNPM) run package:desktop:unsigned --check $(ARGS)
