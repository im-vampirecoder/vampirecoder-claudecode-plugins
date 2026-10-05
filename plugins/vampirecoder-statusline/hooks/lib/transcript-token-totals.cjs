'use strict';

/**
 * Cumulative token totals for a session, summed from its transcript (.jsonl).
 * Streamed assistant messages repeat the same message id on consecutive lines, so only
 * the last usage per id counts. Totals are cached incrementally (byte offset) in the
 * OS temp dir so each statusline render only reads newly appended lines.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ZERO = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function cachePath(transcriptPath) {
  const hash = crypto.createHash('md5').update(transcriptPath).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `vampirecoder-token-totals-${hash}.json`);
}

function toTokens(usage) {
  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    cacheWrite: usage.cache_creation_input_tokens || 0
  };
}

function add(a, b) {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

function loadState(file, size) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && s.offset <= size) return s;
  } catch {}
  return { offset: 0, committed: ZERO(), pendingId: null, pending: ZERO() };
}

/** @returns {{input,output,cacheRead,cacheWrite,total}|null} null when no transcript is readable */
function readTokenTotals(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const size = fs.statSync(transcriptPath).size;
    const file = cachePath(transcriptPath);
    const state = loadState(file, size);

    if (size > state.offset) {
      const fd = fs.openSync(transcriptPath, 'r');
      const buf = Buffer.alloc(size - state.offset);
      fs.readSync(fd, buf, 0, buf.length, state.offset);
      fs.closeSync(fd);

      // Only consume complete lines; a partially written last line is re-read next time.
      const text = buf.toString('utf8');
      const end = text.lastIndexOf('\n') + 1;
      for (const line of text.slice(0, end).split('\n')) {
        if (!line.includes('"usage"')) continue;
        let msg;
        try { msg = JSON.parse(line).message; } catch { continue; }
        if (!msg || !msg.usage) continue;
        if (msg.id !== state.pendingId) {
          state.committed = add(state.committed, state.pending);
          state.pendingId = msg.id || null;
        }
        state.pending = toTokens(msg.usage);
      }
      state.offset += Buffer.byteLength(text.slice(0, end));
      try { fs.writeFileSync(file, JSON.stringify(state)); } catch {}
    }

    const t = add(state.committed, state.pending);
    return { ...t, total: t.input + t.output + t.cacheRead + t.cacheWrite };
  } catch {
    return null;
  }
}

module.exports = { readTokenTotals };
