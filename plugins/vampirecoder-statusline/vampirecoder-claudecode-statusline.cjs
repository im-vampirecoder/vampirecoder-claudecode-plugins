#!/usr/bin/env node
// Kit identity stays separate because moving it to core would break kit-specific branding and configuration.
'use strict';

/**
 * Claude Code statusline renderer — reads JSON from stdin, writes ANSI lines to stdout.
 * Line 1: model - folder - context bar - session tokens (in/out/cache r/w/total)
 * Line 2: Claude user, month cost (ccusage), 5hr/week usage bars, git, plan, lines changed; agent/todo rows below when active
 */

const { stdin, env } = require('process');
const os = require('os');

const { cyan, yellow, green, red, dim, resolveColor, coloredBar } = require('./hooks/lib/colors.cjs');
const { createSessionStateContext, readSessionState, writeContextState } = require('./hooks/lib/vampirecoder-config-utils.cjs');
const { readMonthlyCost } = require('./hooks/lib/monthly-cost-cache.cjs');
const { readTokenTotals } = require('./hooks/lib/transcript-token-totals.cjs');
const { getGitInfo } = require('./hooks/lib/git-info-cache.cjs');
const { readActivitySnapshot } = require('./hooks/lib/statusline-session-cache.cjs');
const { getSectionRenderer } = require('./hooks/lib/statusline-section-registry.cjs');
const { renderAgentsLines, renderTodosLine } = require('./hooks/lib/statusline-activity-renderers.cjs');
const {
  readUsageCache,
  normalizeUtilization,
  isUsageCacheFresh,
  resolveQuotaDisplayEligibility
} = require('./hooks/lib/usage-limits-cache.cjs');

const AUTOCOMPACT_BUFFER = 40000;
const USAGE_CACHE_RENDER_TTL_MS = 300000;

// ============================================================================
// UTILITIES
// ============================================================================

function expandHome(filePath) {
  const homeDir = os.homedir();
  return filePath.startsWith(homeDir) ? filePath.replace(homeDir, '~') : filePath;
}

// Read stdin with optional inactivity timeout (VAMPIRECODER_STATUSLINE_STDIN_TIMEOUT_MS)
async function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stdin.setEncoding('utf8');
    const parsedTimeout = Number.parseInt(env.VAMPIRECODER_STATUSLINE_STDIN_TIMEOUT_MS || '', 10);
    const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 0;
    let timer = null;
    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const armTimer = () => {
      if (!timeoutMs) return;
      clearTimer();
      timer = setTimeout(() => reject(new Error(`stdin timeout after ${timeoutMs}ms`)), timeoutMs);
    };
    armTimer();
    stdin.on('data', chunk => { chunks.push(chunk); armTimer(); });
    stdin.on('end', () => { clearTimer(); resolve(chunks.join('')); });
    stdin.on('error', err => { clearTimer(); reject(err); });
  });
}

// "2h 15m" under a day, "4d 3h" beyond; '' when already reset or unknown
function formatReset(resetsAt) {
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (!resetsAt || !(ms > 0)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Returns [{ label, percent, reset }] for the 5-hour and weekly windows ([] when cache is stale)
function buildUsageWindows(cache) {
  if (!cache || cache.status !== 'available') return [];
  if (!isUsageCacheFresh(cache, USAGE_CACHE_RENDER_TTL_MS)) return [];
  return [
    { label: '5hr', percent: cache.snapshot?.fiveHourPercent ?? normalizeUtilization(cache.data?.five_hour?.utilization), resetsAt: cache.data?.five_hour?.resets_at },
    { label: 'week', percent: cache.snapshot?.weekPercent ?? normalizeUtilization(cache.data?.seven_day?.utilization), resetsAt: cache.data?.seven_day?.resets_at }
  ].filter(w => w.percent != null).map(w => ({ label: w.label, percent: w.percent, reset: formatReset(w.resetsAt) }));
}

function extractActivePlanLabel(planPath) {
  if (!planPath || typeof planPath !== 'string') return '';
  const normalizedPath = planPath.trim().replace(/\\/g, '/');
  const match = normalizedPath.match(/(?:^|\/)plans\/\d+-\d+-(.+?)(?:\/|$)/);
  if (match) return match[1];
  return normalizedPath.split('/').filter(Boolean).pop() || normalizedPath;
}

// 950 -> "950", 12400 -> "12.4k", 3100000 -> "3.1M"
function formatTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

// Logged-in Claude account (email, else display name) from .claude.json; '' for API-key / logged-out use
function readClaudeUser() {
  const dir = env.CLAUDE_CONFIG_DIR;
  const candidates = [dir && require('path').join(dir, '.claude.json'), require('path').join(os.homedir(), '.claude.json')];
  for (const file of candidates.filter(Boolean)) {
    try {
      const account = JSON.parse(require('fs').readFileSync(file, 'utf8')).oauthAccount;
      if (account) return account.emailAddress || account.displayName || '';
    } catch {}
  }
  return '';
}

const pctColor = p => (p >= 85 ? red : p >= 70 ? yellow : green);

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  try {
    const input = await readStdin();
    if (!input.trim()) { console.error('No input provided'); process.exit(1); }

    const data = JSON.parse(input);
    const sessionContext = createSessionStateContext({
      sessionId: data.session_id,
      cwd: process['env'].VAMPIRECODER_PROJECT_ROOT || data.workspace?.current_dir || data.cwd || process.cwd(),
      requireBinding: true
    });

    // Directory
    let currentDir = data.workspace?.current_dir || data.cwd || 'unknown';
    currentDir = expandHome(currentDir);

    const modelName = data.model?.display_name || 'Claude';

    // Git + session state (active plan, agents, todos)
    const gitInfo = getGitInfo(data.workspace?.current_dir || data.cwd || process.cwd());
    let activePlan = '';
    let transcript = { agents: [], todos: [], sessionStart: null };
    try {
      if (sessionContext) {
        const planPath = readSessionState(sessionContext)?.activePlan?.trim();
        if (planPath) activePlan = extractActivePlanLabel(planPath);
        transcript = readActivitySnapshot(sessionContext, readSessionState) || transcript;
      }
    } catch {}

    // Context window percentage
    const usage = data.context_window?.current_usage || {};
    const contextSize = data.context_window?.context_window_size || 0;
    let contextPercent = 0;
    let totalTokens = 0;
    if (contextSize > 0) {
      totalTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      const preCalc = data.context_window?.used_percentage;
      if (typeof preCalc === 'number' && preCalc >= 0) {
        contextPercent = Math.round(preCalc);
      } else if (contextSize > AUTOCOMPACT_BUFFER) {
        contextPercent = Math.min(100, Math.round(((totalTokens + AUTOCOMPACT_BUFFER) / contextSize) * 100));
      }
    }

    // Persist context data for hooks
    if (sessionContext && contextSize > 0) {
      try {
        writeContextState(sessionContext, {
          percent: contextPercent,
          remaining: data.context_window?.remaining_percentage ?? (100 - contextPercent),
          tokens: totalTokens,
          size: contextSize,
          usage,
          timestamp: Date.now()
        });
      } catch {}
    }

    const usageWindows = resolveQuotaDisplayEligibility({ useCache: true }).eligible
      ? buildUsageWindows(readUsageCache())
      : [];

    // Line 1: model - folder - context bar - session tokens
    const tok = readTokenTotals(data.transcript_path);
    const parts = [
      `🤖 ${cyan(modelName)}`,
      `📁 ${resolveColor('blue')(currentDir)}`,
      `ctx ${coloredBar(contextPercent, 10)} ${pctColor(contextPercent)(`${contextPercent}%`)}`,
      tok && `🔢 ${dim('in')} ${formatTokens(tok.input)}  ${dim('out')} ${formatTokens(tok.output)}  ` +
        `${dim('cache r/w')} ${formatTokens(tok.cacheRead)}/${formatTokens(tok.cacheWrite)}  ${dim('total')} ${formatTokens(tok.total)}`
    ].filter(Boolean);
    console.log(parts.join(dim(' - ')));

    // Line 2: Claude user, month cost (ccusage), 5hr/week usage bars, git, plan, lines changed; then agent/todo rows when active
    const ctx = {
      gitBranch: gitInfo?.branch || '', gitUnstaged: gitInfo?.unstaged || 0, gitStaged: gitInfo?.staged || 0,
      gitAhead: gitInfo?.ahead || 0, gitBehind: gitInfo?.behind || 0,
      activePlan,
      linesAdded: data.cost?.total_lines_added || 0,
      linesRemoved: data.cost?.total_lines_removed || 0
    };
    const claudeUser = readClaudeUser();
    const usageItems = usageWindows.map(w =>
      `${w.label} ${coloredBar(w.percent, 10)} ${pctColor(w.percent)(`${w.percent}%`)}${w.reset ? dim(` (resets in ${w.reset})`) : ''}`);
    const monthlyUsd = readMonthlyCost();
    const monthCost = monthlyUsd == null ? null : `💰 ${dim('month')} $${monthlyUsd.toFixed(2)}`;
    const section = id => getSectionRenderer(id)(ctx, {}, {});
    const line2 = [claudeUser && `👤 ${cyan(claudeUser)}`, monthCost, ...usageItems,
      section('git'), section('plan'), section('changes')].filter(Boolean);
    if (line2.length > 0) console.log(line2.join('  '));
    for (const row of renderAgentsLines(transcript, 4, {}, false)) console.log(row);
    const todosLine = renderTodosLine(transcript, 50, {});
    if (todosLine) console.log(todosLine);

  } catch {
    console.log('📁 ' + (process.cwd() || 'unknown'));
  }
}

main().catch(() => { console.log('📁 error'); process.exit(1); });
