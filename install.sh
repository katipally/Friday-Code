#!/usr/bin/env sh
# Friday Code installer — downloads the prebuilt, self-contained binary for your
# platform from GitHub Releases, verifies its checksum, and installs it.
#
#   curl -fsSL https://raw.githubusercontent.com/katipally/friday-code/main/install.sh | sh
#
# Env:
#   FRIDAY_VERSION       install a specific version (e.g. 2.0.0); default: latest
#   FRIDAY_INSTALL_DIR   install location; default: $HOME/.friday/bin
set -eu

REPO="katipally/friday-code"
BIN_DIR="${FRIDAY_INSTALL_DIR:-$HOME/.friday/bin}"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) echo "friday: unsupported OS '$os'. On Windows use Scoop or download from GitHub Releases." >&2; exit 1 ;;
esac
case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) echo "friday: unsupported architecture '$arch'." >&2; exit 1 ;;
esac
target="${os}-${arch}"
asset="friday-${target}"

if [ "${FRIDAY_VERSION:-}" != "" ]; then
  tag="v${FRIDAY_VERSION}"
else
  tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | cut -d '"' -f 4)"
fi
[ "${tag:-}" != "" ] || { echo "friday: could not determine the release to install." >&2; exit 1; }

base="https://github.com/${REPO}/releases/download/${tag}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading friday ${tag} (${target})…"
curl -fsSL "${base}/${asset}" -o "${tmp}/friday" || { echo "friday: no prebuilt binary for ${target} in ${tag}." >&2; exit 1; }

if curl -fsSL "${base}/SHASUMS256.txt" -o "${tmp}/SHASUMS256.txt" 2>/dev/null; then
  expected="$(grep " ${asset}\$" "${tmp}/SHASUMS256.txt" | awk '{print $1}')"
  if [ "${expected:-}" != "" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "${tmp}/friday" | awk '{print $1}')"
    else
      actual="$(shasum -a 256 "${tmp}/friday" | awk '{print $1}')"
    fi
    [ "$expected" = "$actual" ] || { echo "friday: checksum mismatch — aborting." >&2; exit 1; }
    echo "Checksum verified."
  fi
fi

mkdir -p "$BIN_DIR"
mv "${tmp}/friday" "${BIN_DIR}/friday"
chmod +x "${BIN_DIR}/friday"
echo "Installed friday → ${BIN_DIR}/friday"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo ""
    echo "Add it to your PATH (then restart your shell):"
    echo "  export PATH=\"${BIN_DIR}:\$PATH\""
    ;;
esac
echo "Run 'friday' to get started."
