#!/bin/bash
# Install Agent-Reach (https://github.com/Panniantong/Agent-Reach) for the
# current user so it is available in EVERY Claude Code session, on any repo.
#
# What it does (all user-scoped, no sudo):
#   1. installs the `agent-reach` CLI (uv, falling back to pipx / pip --user)
#   2. installs `yt-dlp` for the YouTube channel (best effort)
#   3. registers the skill in ~/.claude/skills/agent-reach (loaded in all repos)
#   4. adds a user-level SessionStart hook to ~/.claude/settings.json that
#      re-runs this script, so fresh machines/containers self-heal
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/theelitegrey/codes/master/scripts/install-agent-reach.sh | bash
#   # or, from a checkout:
#   bash scripts/install-agent-reach.sh
#
# Claude Code on the web: paste the curl line above into your Environment's
# setup script (claude.ai/code -> Settings -> Environments) so it runs for
# every session in that environment, whatever repo it opens.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

SRC="agent-reach @ git+https://github.com/Panniantong/agent-reach"
ZIP="https://github.com/Panniantong/agent-reach/archive/main.zip"

# 1. CLI
if ! command -v agent-reach >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install -q "$SRC" || uv tool install -q "agent-reach @ $ZIP"
  elif command -v pipx >/dev/null 2>&1; then
    pipx install "$ZIP"
  else
    python3 -m pip install -q --user "$ZIP"
  fi
fi

# 2. yt-dlp (optional)
if ! command -v yt-dlp >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install -q "yt-dlp[default]" || true
  elif command -v pipx >/dev/null 2>&1; then
    pipx install "yt-dlp[default]" || true
  fi
fi

# 2b. yt-dlp needs a JS runtime for YouTube; point it at node (idempotent)
if command -v yt-dlp >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/yt-dlp"
  grep -qxF -- '--js-runtimes node' "$HOME/.config/yt-dlp/config" 2>/dev/null \
    || printf '%s\n' '--js-runtimes node' >> "$HOME/.config/yt-dlp/config"
fi

# 3. Skill for all repos. agent-reach only writes into skill roots that
#    already exist, so create the Claude Code one first.
mkdir -p "$HOME/.claude/skills"
agent-reach skill --install

# 4. User-level SessionStart hook (merged, idempotent)
SETTINGS="$HOME/.claude/settings.json"
SCRIPT_URL="https://raw.githubusercontent.com/theelitegrey/codes/master/scripts/install-agent-reach.sh"
HOOK_CMD="command -v agent-reach >/dev/null 2>&1 && [ -d \"\$HOME/.claude/skills/agent-reach\" ] || curl -fsSL $SCRIPT_URL | bash"
python3 - "$SETTINGS" "$HOOK_CMD" << 'PY'
import json, os, sys
path, cmd = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(path):
    try:
        with open(path) as f:
            data = json.load(f)
    except Exception:
        data = {}
hooks = data.setdefault("hooks", {})
entries = hooks.setdefault("SessionStart", [])
for e in entries:
    for h in e.get("hooks", []):
        if "install-agent-reach.sh" in h.get("command", ""):
            print(f"SessionStart hook already present in {path}")
            sys.exit(0)
entries.append({"hooks": [{"type": "command", "command": cmd}]})
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(f"Added SessionStart hook to {path}")
PY

echo
agent-reach version
echo "Agent-Reach installed for all Claude Code sessions. Run 'agent-reach doctor' to see channel status."
