#!/usr/bin/env node
'use strict';

/**
 * SessionStart hook: keeps a stable symlink <claude config dir>/vampirecoder-statusline
 * pointing at this plugin's install folder. The plugin folder changes with every version,
 * but settings.json's statusLine command can only hold one fixed path, so it uses the symlink.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

try {
  const root = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
  const link = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'vampirecoder-statusline');
  let current = null;
  try { current = fs.readlinkSync(link); } catch {}
  if (current !== root) {
    try { fs.unlinkSync(link); } catch {}
    fs.symlinkSync(root, link, 'dir');
  }
} catch {}
console.log(JSON.stringify({ continue: true }));
