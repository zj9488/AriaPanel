#!/usr/bin/env bash
set -euo pipefail

dst="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources"
mkdir -p "$dst"

if command -v aria2c &>/dev/null; then
    cp "$(command -v aria2c)" "$dst/aria2c"
    chmod +x "$dst/aria2c"
    echo "copied system aria2c -> $dst/aria2c"
else
    echo "aria2c not found in PATH"
    if [[ "$(uname)" == "Darwin" ]]; then
        echo "Install via: brew install aria2"
    else
        echo "Install via: sudo apt install aria2 (or your distro's package manager)"
    fi
    exit 1
fi

"$dst/aria2c" --version
