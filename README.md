# vampirecoder-claudecode-plugins

A private Claude Code plugin marketplace (`vampirecoder`). Plugins:

- **`vampirecoder-statusline`**: a two-line statusline that also stamps each assistant message with the time it finished. Documented below.

## vampirecoder-statusline

```
🤖 Opus - 📁 ~/Projects/app - ctx ▰▰▰▰▱▱▱▱▱▱ 42% - 🔢 in 98  out 29.8k  cache r/w 5.4M/181.4k  total 5.6M
👤 me@example.com  💰 month $58.09  5hr ▰▱▱▱▱▱▱▱▱▱ 7% (resets in 0h 24m)  week ▱▱▱▱▱▱▱▱▱▱ 3% (resets in 4d 9h)  🌿 main (+1)  📋 plan-slug  📝 +10 -3
```

**Line 1:** model, folder, context-window bar, session token totals (input, output, cache read/write, total).

**Line 2:** logged-in Claude account, this month's cost, 5-hour and weekly usage bars with time until reset, git branch, active plan, lines changed. Running agents and open todos appear as extra rows below when there are any.

Each item on line 2 is hidden when it has nothing to show.

**Message timestamps:** when an assistant message finishes, a line is added under it in your local time:

```
Done.

🕐 Oct 5, 2026 @ 08:28 PM
```

## Install

The repo is private, so Claude Code uses your existing `gh` / git credentials.

```
/plugin marketplace add im-vampirecoder/vampirecoder-claudecode-plugins
/plugin install vampirecoder-statusline@vampirecoder
/vampirecoder-statusline:setup
```

Then start a new session. `/vampirecoder-statusline:setup` points the `statusLine` setting in `~/.claude/settings.json` at the plugin (a plugin cannot set it by itself) and tells you if it replaces an existing one.

## How it works

| Piece | What it does |
| --- | --- |
| `vampirecoder-claudecode-statusline.cjs` | Reads Claude Code's JSON on stdin and prints the two lines. |
| `hooks/link-statusline.cjs` (SessionStart) | Keeps the symlink `~/.claude/vampirecoder-statusline` pointing at the plugin's install folder. The folder changes with each version; `statusLine` needs one fixed path. |
| `hooks/usage-quota-cache-refresh.cjs` (PostToolUse, UserPromptSubmit, Stop) | Keeps the cached 5hr / weekly usage numbers fresh. |
| `hooks/monthly-cost-refresh.cjs` (Stop) | Refreshes the cached monthly cost in the background. |
| `hooks/message-timestamp.cjs` (MessageDisplay) | Appends `🕐 Oct 5, 2026 @ 08:25 PM` (local time) under each assistant message when it finishes. Display-only; the model never sees it. |

The statusline itself only reads small cache files in the OS temp dir, so rendering stays fast.

### Monthly cost

Computed with `npx ccusage claude monthly --since <YYYY-MM>-01 --json`, so it needs network access the first time (npm download and pricing). It is an estimate at API prices, not a bill. Until the first refresh finishes, or if it has never succeeded, the 💰 item is hidden.

### Message timestamps

Uses Claude Code's `MessageDisplay` hook, which can change what is shown for a message as it streams. Only the final chunk of each message gets the stamp, and every assistant message gets one, including short notes written between tool calls. The stamp is display-only: it is not saved with the message and the model never sees it, so it does not appear on messages from before the plugin loaded or when an old conversation is resumed. The time is read from the system clock in your local timezone.

### Account shown

Read from `oauthAccount` in `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`): email, else display name. Hidden when using an API key or logged out.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `VAMPIRECODER_MONTHLY_COST_CACHE_PATH` | Override the monthly-cost cache file. |
| `VAMPIRECODER_USAGE_CACHE_PATH`, `VAMPIRECODER_USAGE_ELIGIBILITY_CACHE_PATH` | Override the usage cache files. |
| `VAMPIRECODER_STATUSLINE_STDIN_TIMEOUT_MS` | Give up waiting for stdin after this many ms. |
| `VAMPIRECODER_GIT_TIMEOUT_MS` | Git command timeout for the branch lookup. |
| `VAMPIRECODER_HOOK_LOG_DIR` | Where hook crash logs go. |
| `NO_COLOR=1` | Disable colors. |

## Updating

Change the code, bump `version` in `plugins/vampirecoder-statusline/.claude-plugin/plugin.json`, push, then run `/plugin update` in Claude Code.

If you registered `usage-quota-cache-refresh` or `monthly-cost-refresh` hooks in `settings.json` by hand, remove them once the plugin is installed; the plugin registers them itself.

## Layout

```
.claude-plugin/marketplace.json
plugins/vampirecoder-statusline/
  .claude-plugin/plugin.json
  commands/setup.md
  hooks/            hooks.json, hook scripts, lib/
  vampirecoder-claudecode-statusline.cjs
```

Validate with `claude plugin validate .` and `claude plugin validate plugins/vampirecoder-statusline`.
