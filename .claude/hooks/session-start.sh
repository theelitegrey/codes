#!/bin/bash
# SessionStart hook: install the Agent-Reach CLI so the committed
# .claude/skills/agent-reach skill works in every Claude Code web session.
# Project: https://github.com/Panniantong/Agent-Reach
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

# agent-reach CLI (idempotent; skipped if already present)
if ! command -v agent-reach >/dev/null 2>&1; then
  uv tool install -q "agent-reach @ git+https://github.com/Panniantong/agent-reach" \
    || echo "agent-reach: install failed (network?)" >&2
fi

# yt-dlp for the YouTube channel (optional, best effort)
if ! command -v yt-dlp >/dev/null 2>&1; then
  uv tool install -q "yt-dlp[default]" || true
fi

# Read-only status check, no system changes
if command -v agent-reach >/dev/null 2>&1; then
  agent-reach install --env=auto 2>&1 | tail -3 || true
fi
