---
description: Point Claude Code's statusLine setting at the vampirecoder statusline
allowed-tools: Read, Edit, Bash(node:*)
---

Set up the vampirecoder statusline in the user's Claude Code settings.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/hooks/link-statusline.cjs"` so the stable link `~/.claude/vampirecoder-statusline` exists (symlink on macOS/Linux, directory junction or forwarder folder on Windows; no admin rights needed), then confirm with `node -e "require('fs').accessSync(require('path').join(require('os').homedir(),'.claude','vampirecoder-statusline','vampirecoder-claudecode-statusline.cjs'))"` (no output = success). Do not create links manually.
2. Read `~/.claude/settings.json`. If it already has a `statusLine` that is not this one, tell the user what it currently is and that you are replacing it.
3. Set `statusLine` to exactly:
   `{ "type": "command", "command": "node \"$HOME/.claude/vampirecoder-statusline/vampirecoder-claudecode-statusline.cjs\"", "padding": 0 }`
   Change nothing else in the file.
4. Tell the user to start a new session (or send a message) to see it. Mention that the plugin's own hooks keep the usage and monthly-cost caches fresh, so any older copies of `usage-quota-cache-refresh` or `monthly-cost-refresh` hooks in settings.json are now redundant.
