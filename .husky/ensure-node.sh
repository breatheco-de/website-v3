# Ensure Node/npx are on PATH when git hooks run from GUI apps (Cursor/VS Code),
# which do not load ~/.zshrc (nvm/fnm).
if command -v npx >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  return 0 2>/dev/null || exit 0
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
elif [ -n "${FNM_PATH:-}" ] && [ -x "$FNM_PATH/fnm" ]; then
  eval "$("$FNM_PATH/fnm" env)"
elif command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
elif [ -d /opt/homebrew/bin ]; then
  export PATH="/opt/homebrew/bin:$PATH"
fi
