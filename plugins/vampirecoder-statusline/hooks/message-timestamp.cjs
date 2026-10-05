#!/usr/bin/env node
'use strict';

/**
 * MessageDisplay hook: when an assistant message finishes streaming (the `final` flush),
 * append "🕐 Oct 5, 2026 @ 08:25 PM" (local time) to what is shown. Display-only: the stored
 * message and what the model sees are unchanged. Earlier flushes pass through untouched.
 */

function formatStamp(date) {
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${day} @ ${time}`;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    if (input.hook_event_name !== 'MessageDisplay' || !input.final) return;
    const delta = typeof input.delta === 'string' ? input.delta : '';
    const gap = delta === '' || delta.endsWith('\n') ? '\n' : '\n\n';
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'MessageDisplay',
        displayContent: `${delta}${gap}🕐 ${formatStamp(new Date())}`
      }
    }));
  } catch {}
});
