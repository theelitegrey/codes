# codes
## Agent-Reach

[Agent-Reach](https://github.com/Panniantong/Agent-Reach) gives Claude Code internet
access (web pages, RSS, GitHub, YouTube, Twitter/X, Reddit, and more).

### Install for ALL Claude Code sessions (any repo)

```bash
curl -fsSL https://raw.githubusercontent.com/theelitegrey/codes/master/scripts/install-agent-reach.sh | bash
```

This installs the `agent-reach` CLI and `yt-dlp`, registers the skill at
`~/.claude/skills/agent-reach`, and adds a user-level SessionStart hook to
`~/.claude/settings.json` so new machines/containers self-heal.

- **Claude Code on the web:** paste the line above into your Environment's setup
  script (claude.ai/code -> Settings -> Environments). It then runs for every
  session in that environment, whatever repo it opens.
- **Local machine:** run the line once in a terminal.

### This repo

`.claude/hooks/session-start.sh` calls the same installer on Claude Code on the
web, and `.claude/skills/agent-reach/` keeps a committed copy of the skill.
Check channel status any time with `agent-reach doctor`.
