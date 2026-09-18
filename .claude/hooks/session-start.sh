#!/bin/bash
# SessionStart hook for Claude Code on the web: ensure Agent-Reach is installed
# user-wide (CLI + ~/.claude/skills/agent-reach) via the shared installer.
# Project: https://github.com/Panniantong/Agent-Reach
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

bash "$CLAUDE_PROJECT_DIR/scripts/install-agent-reach.sh"
