# codes
## Agent-Reach

Every Claude Code session on this repo gets [Agent-Reach](https://github.com/Panniantong/Agent-Reach)
(internet access for the agent: web pages, RSS, GitHub, YouTube, Twitter/X, Reddit, etc.).

- `.claude/skills/agent-reach/` — the skill, committed so it loads in every session.
- `.claude/hooks/session-start.sh` — SessionStart hook that installs the `agent-reach`
  CLI and `yt-dlp` with `uv` on Claude Code on the web.
- Check channel status any time with `agent-reach doctor`.
