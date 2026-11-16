#!/usr/bin/env bash
# Verifies a staged jan-llama-worker directory before it is packaged:
#   check-stage.sh <dir> <x64|arm64>
# Every executable file must target <arch>, load only from its own directory
# or the OS, and carry no run path but $ORIGIN or @loader_path. Windows files
# must not import the Visual C++ runtime, which is not part of the OS. A copy
# of the directory must then start from an unrelated location with a scrubbed
# environment and report the llama.cpp tag pinned in build.rs.
set -euo pipefail

CRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "usage: $0 <staged-dir> <x64|arm64>" >&2
  exit 2
}
[ "$#" -eq 2 ] || usage
DIR="$(cd "$1" && pwd)"
ARCH="$2"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) OS=windows; EXE=".exe" ;;
  Darwin)               OS=macos;   EXE="" ;;
  *)                    OS=linux;   EXE="" ;;
esac

case "$OS:$ARCH" in
  linux:x64)     want='Advanced Micro Devices X86-64' ;;
  linux:arm64)   want='AArch64' ;;
  macos:x64)     want='x86_64' ;;
  macos:arm64)   want='arm64' ;;
  windows:x64)   want='8664' ;;
  windows:arm64) want='aa64' ;;
  *) usage ;;
esac

# Libraries every supported Linux desktop provides; a GPU module may also need
# the loader or driver of its own API, which the user's GPU driver installs.
LINUX_SYSTEM_LIBS=' libc.so.6 libm.so.6 libstdc++.so.6 libgcc_s.so.1 libpthread.so.0 libdl.so.2 librt.so.1
  ld-linux-x86-64.so.2 ld-linux-aarch64.so.1 libvulkan.so.1 libcuda.so.1 '
WINDOWS_DRIVER_DLLS=' vulkan-1.dll nvcuda.dll '

errors=0
problem() {
  echo "check-stage: $*" >&2
  errors=$((errors + 1))
}

has_file() { [ -f "$DIR/$1" ]; }

pe_machine() {
  local offset
  offset=$(od -An -tu4 -j60 -N4 "$1" | tr -d ' ')
  od -An -tx2 -j$((offset + 4)) -N2 "$1" | tr -d ' '
}

pe_imports() {
  if command -v llvm-readobj >/dev/null 2>&1; then
    llvm-readobj --coff-imports "$1" | sed -n 's/^ *Name: \(.*\.[dD][lL][lL]\)$/\1/p'
  elif command -v objdump >/dev/null 2>&1; then
    objdump -p "$1" | sed -n 's/^[[:space:]]*DLL Name: //p'
  else
    echo "check-stage: llvm-readobj or objdump is required" >&2
    exit 1
  fi
}

check_linux() {
  local file="$1" name machine rpath dep
  name="$(basename "$file")"
  machine="$(readelf -h "$file" | sed -n 's/^ *Machine: *//p')"
  [ "$machine" = "$want" ] || problem "$name is built for '$machine', not $ARCH"
  while IFS= read -r rpath; do
    # shellcheck disable=SC2016 # the literal ELF token, not a shell expansion
    [ -z "$rpath" ] || [ "$rpath" = '$ORIGIN' ] || problem "$name has run path $rpath"
  done < <(readelf -d "$file" | sed -n 's/.*(R\(UN\)\{0,1\}PATH).*\[\(.*\)\]/\2/p' | tr ':' '\n')
  for dep in $(readelf -d "$file" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p'); do
    has_file "$dep" || [[ "$LINUX_SYSTEM_LIBS" == *" $dep "* ]] \
      || problem "$name needs $dep, which is neither staged nor a system library"
  done
}

check_macos() {
  local file="$1" name archs id dep rpath
  name="$(basename "$file")"
  archs="$(lipo -archs "$file")"
  [ "$archs" = "$want" ] || problem "$name has architectures '$archs', not $want"
  while IFS= read -r rpath; do
    [ -z "$rpath" ] || [ "$rpath" = '@loader_path' ] || problem "$name has run path $rpath"
  done < <(otool -l "$file" | awk '$1 == "cmd" { rpath = ($2 == "LC_RPATH") } rpath && $1 == "path" { print $2 }')
  id="$(otool -D "$file" | awk 'NR > 1 { print $1 }')"
  while IFS= read -r dep; do
    if [ -z "$dep" ] || [ "$dep" = "$id" ]; then continue; fi
    case "$dep" in
      /usr/lib/*|/System/Library/*) ;;
      @rpath/*/*|@loader_path/*/*|@executable_path/*/*) problem "$name loads $dep from outside its directory" ;;
      @rpath/*|@loader_path/*|@executable_path/*)
        has_file "${dep#*/}" || problem "$name loads $dep, which is not staged" ;;
      *) problem "$name loads $dep from outside its directory" ;;
    esac
  done < <(otool -L "$file" | awk 'NR > 1 { print $1 }')
}

check_windows() {
  local file="$1" name machine dep lower
  name="$(basename "$file")"
  machine="$(pe_machine "$file")"
  [ "$machine" = "$want" ] || problem "$name has PE machine 0x$machine, not 0x$want"
  local system32
  system32="$(cygpath -u "${SYSTEMROOT:-C:\\Windows}")/System32"
  for dep in $(pe_imports "$file" | tr -d '\r'); do
    lower="$(tr '[:upper:]' '[:lower:]' <<<"$dep")"
    case "$lower" in api-ms-win-*|ext-ms-*) continue ;; esac
    [[ "$WINDOWS_DRIVER_DLLS" == *" $lower "* ]] && continue
    # The Visual C++ Redistributable installs these, so a build host has them
    # in System32 while a clean user machine does not.
    case "$lower" in
      msvcp*.dll|vcruntime*.dll|concrt*.dll|vcomp*.dll)
        problem "$name imports $dep from the Visual C++ Redistributable; build with the static MSVC runtime"
        continue ;;
    esac
    [ -n "$(find "$DIR" -maxdepth 1 -iname "$dep" -print -quit)" ] && continue
    [ -n "$(find "$system32" -maxdepth 1 -iname "$dep" -print -quit 2>/dev/null)" ] && continue
    problem "$name imports $dep, which is neither staged nor in System32"
  done
}

WORKER="$DIR/jan-llama-worker$EXE"
[ -f "$WORKER" ] || { echo "check-stage: $WORKER is missing" >&2; exit 1; }

checked=0
for file in "$DIR"/*; do
  [ -L "$file" ] && { problem "$(basename "$file") is a symbolic link"; continue; }
  [ -f "$file" ] || continue
  case "$OS" in
    linux)   [ "$(od -An -tx1 -N4 "$file" | tr -d ' ')" = 7f454c46 ] || continue; check_linux "$file" ;;
    macos)   file -b "$file" | grep -q '^Mach-O' || continue; check_macos "$file" ;;
    windows) [ "$(head -c2 "$file")" = MZ ] || continue; check_windows "$file" ;;
  esac
  checked=$((checked + 1))
done
[ "$errors" -eq 0 ] || { echo "check-stage: $errors problems in $DIR" >&2; exit 1; }
echo "check-stage: $checked files target $ARCH and load only from $DIR or the OS"

TAG="$(sed -n 's/^pub const LLAMA_CPP_TAG: &str = "\(.*\)";/\1/p' "$CRATE_DIR/build.rs")"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
cp -R "$DIR" "$SCRATCH/worker"
RUN="$SCRATCH/worker/jan-llama-worker$EXE"
cd "$SCRATCH"
if [ "$OS" = windows ]; then
  run() { PATH="$(cygpath -u "${SYSTEMROOT:-C:\\Windows}")/System32" "$RUN" "$@"; }
else
  run() { env -i HOME="$SCRATCH" PATH=/usr/bin:/bin "$RUN" "$@"; }
fi
version="$(run --version | tr -d '\r')" || { echo "check-stage: the relocated worker does not start" >&2; exit 1; }
expected="jan-llama-worker (llama.cpp $TAG)"
[ "$version" = "$expected" ] || { echo "check-stage: the relocated worker reports '$version', not '$expected'" >&2; exit 1; }
echo "check-stage: the relocated worker runs and reports $version"
# A runner without a GPU driver may fail to enumerate devices; --version above
# already proved the libraries load, so this only reports.
if devices="$(run --list-devices)"; then
  echo "check-stage: devices $devices"
else
  echo "check-stage: warning: --list-devices exited with $?" >&2
fi
