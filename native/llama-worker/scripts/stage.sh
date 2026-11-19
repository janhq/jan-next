#!/usr/bin/env bash
# Stages the release jan-llama-worker and its ggml runtime into one relocatable
# directory (default dist/; the first argument overrides it). See README "Build".
#
# The ggml prefix is chosen by the JAN_GGML_BACKEND_DIR the binary embeds, not by
# mtime, so a stale build-script output dir cannot be staged.
set -euo pipefail

CRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${CARGO_TARGET_DIR:-$CRATE_DIR/target}/release"
DEST="${1:-$CRATE_DIR/dist}"

fail() {
  echo "stage: error: $*" >&2
  exit 1
}

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) OS=windows; EXE=".exe" ;;
  Darwin)               OS=macos;   EXE="" ;;
  *)                    OS=linux;   EXE="" ;;
esac

# Checked before anything is written, so a missing tool cannot leave a
# half-staged directory that still has a worker in it.
case "$OS" in
  linux)
    command -v readelf >/dev/null 2>&1 || fail "readelf (binutils) is required"
    ;;
  macos)
    for tool in otool install_name_tool codesign; do
      command -v "$tool" >/dev/null 2>&1 || fail "$tool (Xcode command line tools) is required"
    done
    ;;
esac

WORKER="$TARGET_DIR/jan-llama-worker$EXE"
[ -f "$WORKER" ] || fail "$WORKER not found; run \`pnpm run build:llama-worker\` first"

matches=()
# Build-script stdout: build/<pkg>-<hash>/output before Rust 1.100, build/<pkg>/<hash>/run/stdout since.
for record in "$TARGET_DIR"/build/jan-llama-worker-*/output "$TARGET_DIR"/build/jan-llama-worker/*/run/stdout; do
  [ -f "$record" ] || continue
  dir="$(sed -n 's/^cargo:rustc-env=JAN_GGML_BACKEND_DIR=//p' "$record" | tr -d '\r')"
  [ -n "$dir" ] || continue
  if grep -aqF -- "$dir" "$WORKER"; then matches+=("$dir"); fi
done
case "${#matches[@]}" in
  0) fail "no build output under $TARGET_DIR/build matches $WORKER; was it built with --features engine?" ;;
  1) BACKEND_DIR="${matches[0]}" ;;
  *) fail "$WORKER embeds several ggml backend dirs (${matches[*]}); run \`cargo clean\` and rebuild" ;;
esac
if [ "$OS" = windows ] && command -v cygpath >/dev/null 2>&1; then
  BACKEND_DIR="$(cygpath -u "$BACKEND_DIR")"
fi
PREFIX="$(dirname "$BACKEND_DIR")"
[ -d "$PREFIX/bin" ] && [ -d "$PREFIX/lib" ] \
  || fail "ggml prefix $PREFIX is missing; rebuild with \`pnpm run build:llama-worker\`"

mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
# Only names this script writes are removed, so a caller-chosen directory keeps
# unrelated files while a previous variant's backend modules cannot linger.
find "$DEST" -maxdepth 1 \( -name 'jan-llama-worker*' -o -name 'libggml*' -o -name 'ggml*.dll' \) \
  -exec rm -f {} +

STAGED="$DEST/jan-llama-worker$EXE"
# A failed run removes the worker, so packaging cannot take a half-staged directory.
remove_worker_on_failure() { [ "$1" -eq 0 ] || rm -f "$STAGED"; }
trap 'remove_worker_on_failure $?' EXIT
install -m 755 "$WORKER" "$STAGED"

# Copies dereferenced, so the directory holds no symlinks for packagers to mangle.
stage_lib() {
  [ -f "$1" ] || fail "$1 is missing from the ggml prefix"
  cp -fL "$1" "$DEST/$2"
  chmod 644 "$DEST/$2"
}

# Prints the libggml* names a Mach-O or ELF file loads from its run path.
ggml_imports() {
  case "$OS" in
    linux) readelf -d "$1" | sed -n 's/.*(NEEDED).*\[\(libggml[^]]*\)\]/\1/p' ;;
    macos) otool -L "$1" | awk 'NR > 1 { print $1 }' | grep '/libggml' | sed 's|^@rpath/||' || true ;;
  esac
}

# Prints the run-path entries of the executable, one per line.
run_paths() {
  case "$OS" in
    linux) readelf -d "$1" | sed -n 's/.*(R\(UN\)\{0,1\}PATH).*\[\(.*\)\]/\2/p' | tr ':' '\n' ;;
    macos) otool -l "$1" | awk '$1 == "cmd" { rpath = ($2 == "LC_RPATH") } rpath && $1 == "path" { print $2 }' ;;
  esac
}

# Ends the ELF run-path string after its leading entry $2 by overwriting the
# next byte in .dynstr with NUL, as `chrpath -r` does, so no patchelf is needed.
truncate_elf_run_path() {
  local full offsets
  full="$(readelf -d "$1" | sed -n 's/.*(R\(UN\)\{0,1\}PATH).*\[\(.*\)\]/\2/p')"
  [[ "$full" == "$2:"* ]] || fail "$1 run path does not start with $2 (has: $full)"
  offsets="$(grep -obaF -- "$full" "$1" | cut -d: -f1)"
  [ -n "$offsets" ] && [ "$(wc -l <<<"$offsets")" -eq 1 ] \
    || fail "$1 does not hold its run path string exactly once"
  printf '\0' | dd of="$1" bs=1 seek=$((offsets + ${#2})) conv=notrunc status=none
}

modules=0
if [ "$OS" = windows ]; then
  # Windows has no import libraries to filter on: every DLL cmake installed is
  # either ggml/ggml-base or a backend module, all loaded from the .exe's dir.
  for src in "$PREFIX"/bin/*.dll "$PREFIX"/lib/*.dll; do
    [ -f "$src" ] || continue
    name="$(basename "$src")"
    stage_lib "$src" "$name"
    case "$name" in ggml.dll|ggml-base.dll) ;; *) modules=$((modules + 1)) ;; esac
  done
else
  core="$(ggml_imports "$STAGED")"
  [ -n "$core" ] || fail "$WORKER links no libggml shared library; was it built with --features engine?"
  for name in $core; do stage_lib "$PREFIX/lib/$name" "$name"; done
  # ggml's loader looks only for the `.so` extension, on macOS too.
  for src in "$PREFIX"/bin/libggml-*.so; do
    [ -f "$src" ] || continue
    stage_lib "$src" "$(basename "$src")"
    modules=$((modules + 1))
  done
fi
[ "$modules" -gt 0 ] || fail "no ggml backend module found in $PREFIX/bin"

if [ "$OS" != windows ]; then
  for file in "$STAGED" "$DEST"/libggml*; do
    for name in $(ggml_imports "$file"); do
      [ -f "$DEST/$name" ] || fail "$(basename "$file") needs $name, which is not in the ggml prefix"
    done
  done

  case "$OS" in linux) relative='$ORIGIN' ;; macos) relative='@loader_path' ;; esac
  paths="$(run_paths "$STAGED")"
  grep -qxF -- "$relative" <<<"$paths" || fail "$WORKER has no $relative run path (has: $(tr '\n' ' ' <<<"$paths"))"
  # build.rs adds absolute build-tree run paths so the unstaged binary runs in
  # place; the staged copy drops them because they name this machine.
  absolute="$(grep -vxF -- "$relative" <<<"$paths" || true)"
  if [ -n "$absolute" ]; then
    case "$OS" in
      linux) truncate_elf_run_path "$STAGED" "$relative" ;;
      macos)
        while IFS= read -r path; do install_name_tool -delete_rpath "$path" "$STAGED"; done <<<"$absolute"
        # install_name_tool invalidates the linker's ad-hoc signature, without
        # which Apple silicon refuses to execute the binary.
        codesign --force --sign - "$STAGED"
        ;;
    esac
  fi
  paths="$(run_paths "$STAGED")"
  [ "$paths" = "$relative" ] || fail "the staged run path is not exactly $relative (has: $(tr '\n' ' ' <<<"$paths"))"
  echo "stage: run path: $paths"
fi

"$STAGED" --version >/dev/null || fail "the staged $STAGED does not start"

echo "stage: staged jan-llama-worker$EXE and $modules backend modules into $DEST"
echo "stage: ggml prefix $PREFIX"
