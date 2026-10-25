'use strict';
const U = require('./util');

// Provider abstraction. Milestone 1 ships only the local deterministic provider:
// simple parsed commands over local data. No model, no network, no cost.
// External providers stay behind this same interface and are added in Milestone 4
// only with verified credentials and your explicit approval.

const localProvider = {
  id: 'local-deterministic',
  label: 'Local deterministic engine',
  available() {
    return true;
  },
  describe() {
    return 'Runs typed commands against your local data. No model, no network, no cost.';
  },
  execute(command, ctx) {
    const text = String(command || '').trim();
    if (!text) return { lines: ['Type a command, or "help".'] };
    const sp = text.indexOf(' ');
    const cmd = (sp === -1 ? text : text.slice(0, sp)).toLowerCase();
    const rest = sp === -1 ? '' : text.slice(sp + 1).trim();

    switch (cmd) {
      case 'help':
        return {
          lines: [
            'Commands:',
            '  capture <text>      add an item to the Quick Capture inbox',
            '  note <text>         append a note to memory inbox',
            '  run <routine>       execute a routine (approval gates still apply)',
            '  invoke <skill>      run a skill artifact now',
            '  search <query>      search stores and memory',
            '  summary             counts of your local data',
            '  help                this list'
          ]
        };
      case 'capture':
        if (!rest) return { lines: ['Usage: capture <text>'] };
        ctx.addInbox(rest);
        return { lines: ['Captured to inbox: ' + rest] };
      case 'note':
        if (!rest) return { lines: ['Usage: note <text>'] };
        ctx.memoryNote(rest);
        return { lines: ['Noted to memory inbox.'] };
      case 'run': {
        if (!rest) return { lines: ['Usage: run <routine-id> (see Routines module for ids)'] };
        const r = ctx.runRoutine(rest, false);
        if (r.error) return { lines: ['Routine failed: ' + r.error] };
        return { lines: ['Routine "' + rest + '" → ' + r.status + '. Artifacts: ' + (r.artifacts ? r.artifacts.length : 0) + '.'] };
      }
      case 'invoke': {
        if (!rest) return { lines: ['Usage: invoke <skill-id>'] };
        const s = ctx.invokeSkill(rest, {}, { confirm: false });
        if (s.status === 'needs_approval') return { lines: [s.reason] };
        if (s.status === 'ok' && s.doc) return { lines: ['Skill artifact created: ' + s.doc.title + ' (see Docs app).'] };
        if (s.status === 'ok') return { lines: ['Skill "' + rest + '" returned reference content. See the Skills module to view it.'] };
        return { lines: ['Skill failed: ' + (s.reason || s.status)] };
      }
      case 'search': {
        if (!rest) return { lines: ['Usage: search <query>'] };
        const res = ctx.search(rest);
        const lines = [];
        for (const [coll, items] of Object.entries(res.stores || {})) {
          for (const it of items.slice(0, 3)) lines.push('[' + coll + '] ' + (it.title || it.text || it.id));
        }
        for (const mem of (res.memory || []).slice(0, 3)) lines.push('[memory] ' + mem.path + ': ' + mem.line);
        return { lines: lines.length ? lines : ['No matches for "' + rest + '".'] };
      }
      case 'summary': {
        const c = ctx.counts();
        return {
          lines: [
            'Local data summary:',
            '  open tasks: ' + c.tasks,
            '  inbox items: ' + c.inbox,
            '  notes: ' + c.notes,
            '  documents: ' + c.docs,
            '  memory files: ' + c.memoryFiles
          ]
        };
      }
      default:
        return { lines: ['Unknown command "' + cmd + '". Type help for the command list.'] };
    }
  }
};

const llmProvider = {
  id: 'external-llm',
  label: 'External model provider',
  available() {
    return false;
  },
  reason() {
    return 'No model provider is configured. Provider wiring is planned for Milestone 4 and requires verified credentials plus your explicit approval before any data leaves this machine.';
  }
};

function runAssistant(command, ctx) {
  if (localProvider.available()) {
    return { provider: localProvider.id, providerLabel: localProvider.label, lines: localProvider.execute(command, ctx).lines };
  }
  return { provider: llmProvider.id, providerLabel: llmProvider.label, lines: [llmProvider.reason()] };
}

module.exports = { runAssistant, providers: [localProvider, llmProvider] };
