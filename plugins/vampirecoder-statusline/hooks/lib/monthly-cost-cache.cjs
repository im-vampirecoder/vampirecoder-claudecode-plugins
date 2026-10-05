'use strict';

/**
 * Current-month Claude Code cost via `ccusage claude monthly`.
 * The statusline must stay fast, so it only reads a cache file. The Stop hook
 * (monthly-cost-refresh.cjs) calls startRefresh() after each turn: a detached child (this
 * file run with --refresh) calls ccusage and rewrites the cache. A stale value is shown
 * until the refresh lands. A lock file keeps refreshes from running concurrently.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const LOCK_TTL_MS = 2 * 60 * 1000;
const CACHE_FILE = process.env.VAMPIRECODER_MONTHLY_COST_CACHE_PATH || path.join(os.tmpdir(), 'vampirecoder-monthly-cost.json');
const LOCK_FILE = `${CACHE_FILE}.lock`;

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function ageMs(file) {
  try { return Date.now() - fs.statSync(file).mtimeMs; } catch { return Infinity; }
}

/** Runs ccusage and writes the cache. Used by the detached --refresh child. */
function refresh() {
  const month = currentMonth();
  // npx lives next to the node that runs the statusline; PATH may not include it.
  const binDir = path.dirname(process.execPath);
  const out = execFileSync('npx', ['-y', 'ccusage', 'claude', 'monthly', '--since', `${month}-01`, '--json'], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` }
  });
  const totalCost = JSON.parse(out).totals?.totalCost;
  if (typeof totalCost === 'number') {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ month, totalCost }));
  }
}

/** Starts a detached refresh unless one is already running (lock younger than LOCK_TTL_MS). */
function startRefresh() {
  if (ageMs(LOCK_FILE) <= LOCK_TTL_MS) return;
  try {
    fs.writeFileSync(LOCK_FILE, String(Date.now()));
    spawn(process.execPath, [__filename, '--refresh'], { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

/**
 * @returns {number|null} this month's cost in USD, or null until the first refresh lands.
 * Normally refreshed by the Stop hook; only bootstraps a refresh itself when there is no
 * usable value (fresh install, new month).
 */
function readMonthlyCost() {
  const cache = readJson(CACHE_FILE);
  const valid = cache && cache.month === currentMonth() && typeof cache.totalCost === 'number';
  if (!valid) startRefresh();
  return valid ? cache.totalCost : null;
}

if (require.main === module && process.argv.includes('--refresh')) {
  try { refresh(); } catch {}
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

module.exports = { readMonthlyCost, startRefresh };
