#!/usr/bin/env node
'use strict';

/**
 * Stop hook: refresh the cached current-month cost (ccusage) after each turn so the
 * statusline shows an up-to-date figure. The refresh runs detached and never blocks.
 */

const { startRefresh } = require('./lib/monthly-cost-cache.cjs');

try { startRefresh(); } catch {}
console.log(JSON.stringify({ continue: true }));
