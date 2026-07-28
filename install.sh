#!/usr/bin/env bash
set -euo pipefail

# gg is installed only in the user's home directories. Unlike its predecessor,
# this installer never installs Git hooks and never changes any Git configuration.

# GG_REPO_URL exists so the installer can be exercised against a local checkout
# before a change reaches GitHub. Verifying the install path any other way means
# verifying a different script than the one users run.
REPO_URL="${GG_REPO_URL:-https://github.com/noamsiegel/gg}"
GG_HOME="${GG_HOME:-$HOME/.local/share/gg}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
LINK_PATH="$BIN_DIR/gg"

fail() {
  printf 'gg installer: %s\n' "$1" >&2
  exit 1
}

for required in git bash; do
  command -v "$required" >/dev/null 2>&1 || fail "required command '$required' was not found on PATH"
done

mkdir -p "$(dirname "$GG_HOME")" "$BIN_DIR"

if [[ -d "$GG_HOME/.git" ]]; then
  git -C "$GG_HOME" pull --ff-only
elif [[ -e "$GG_HOME" ]]; then
  fail "install path exists but is not a gg Git checkout: $GG_HOME"
else
  git clone "$REPO_URL" "$GG_HOME"
fi

[[ -f "$GG_HOME/gg" ]] || fail "checkout does not contain the gg executable: $GG_HOME/gg"
chmod +x "$GG_HOME/gg"
ln -sfn "$GG_HOME/gg" "$LINK_PATH"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    printf 'warning: %s is not on PATH. Add this exact line to your shell profile:\n' "$BIN_DIR" >&2
    printf 'export PATH="%s:$PATH"\n' "$BIN_DIR" >&2
    ;;
esac

version="$("$GG_HOME/gg" --version 2>/dev/null || printf 'unknown')"
printf 'gg installed\n'
printf '  version: %s\n' "$version"
printf '  install: %s\n' "$GG_HOME"
printf '  command: %s -> %s\n' "$LINK_PATH" "$GG_HOME/gg"
printf '  optional runners:\n'
for runner in uvx npx gitleaks; do
  if command -v "$runner" >/dev/null 2>&1; then
    printf '    %s: present\n' "$runner"
  else
    printf '    %s: missing (dependent checks will be skipped)\n' "$runner"
  fi
done
