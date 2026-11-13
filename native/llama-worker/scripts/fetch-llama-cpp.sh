#!/usr/bin/env bash
# Shallow-clones the llama.cpp pinned in build.rs into vendor/llama.cpp.
#
# The commit is verified after cloning because a git tag is mutable: upstream
# could move the pinned tag, and a --branch clone would then silently hand over
# different sources than build.rs claims.
set -euo pipefail

CRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$CRATE_DIR/vendor/llama.cpp"
SRC_URL="https://github.com/ggml-org/llama.cpp.git"

if [ -n "${JAN_LLAMA_CPP_DIR:-}" ]; then
  echo "llama.cpp source: using JAN_LLAMA_CPP_DIR=$JAN_LLAMA_CPP_DIR (skipping the pinned clone)"
  exit 0
fi

pin() { sed -n "s/^pub const $1: &str = \"\(.*\)\";/\1/p" "$CRATE_DIR/build.rs"; }
TAG=$(pin LLAMA_CPP_TAG)
COMMIT=$(pin LLAMA_CPP_COMMIT)
if [ -z "$TAG" ] || [ -z "$COMMIT" ]; then
  echo "error: could not read the llama.cpp pin out of $CRATE_DIR/build.rs" >&2
  exit 1
fi

if [ ! -f "$SRC_DIR/CMakeLists.txt" ]; then
  echo "Cloning llama.cpp $TAG (shallow)..."
  rm -rf "$SRC_DIR"
  git clone --depth 1 --branch "$TAG" "$SRC_URL" "$SRC_DIR" || {
    echo "error: could not clone $SRC_URL at tag $TAG" >&2
    exit 1
  }
fi

got=$(git -C "$SRC_DIR" rev-parse HEAD)
if [ "$got" != "$COMMIT" ]; then
  echo "error: $SRC_DIR is at $got but build.rs pins $COMMIT." >&2
  echo "       The tag $TAG may have moved upstream, or the tree is stale." >&2
  echo "       Delete it and re-run, or point JAN_LLAMA_CPP_DIR at a checkout." >&2
  exit 1
fi
echo "llama.cpp source: $TAG at $got"
