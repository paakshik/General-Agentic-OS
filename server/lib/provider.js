'use strict';
const U = require('./util');

// Provider abstraction. Milestone 1 ships with a local deterministic provider:
// simple parsed commands over local data. No model, no network, no cost.
// External providers (LiteLLM/OpenAI-compatible) are added when explicitly
// configured with verified credentials and your explicit approval.

// ---- Local deterministic provider (always available) ----
const localProvider = {
  id: 'local-deterministic',
  label: 'Local deterministic engine',
  available() { return true; },
  describe() { return 'Runs typed commands against your local data. No model, no network, no cost.'; },
  execute(command, ctx) {
    const text = String(command || '').trim();
    if (!text) return { lines: ['Type a command, or "help".'] };
    const sp = text.indexOf(' ');
    const cmd = (sp === -1 ? text : text.slice(0, sp)).toLowerCase();
    const rest = sp === -1 ? '' : text.slice(sp + 1).trim();

    switch (cmd) {
      case 'help':
        return { lines: [
          'Commands (local):',
          '  capture <text>      add an item to the Quick Capture inbox',
          '  note <text>         append a note to memory inbox',
          '  run <routine>       execute a routine (approval gates still apply)',
          '  invoke <skill>      run a skill artifact now',
          '  search <query>      search stores and memory',
          '  summary             counts of your local data',
          '  help                this list',
          '',
          'When an LLM provider is configured, you can also chat naturally.',
          '  e.g. "summarize my tasks" or "draft a brief for my project"'
        ] };
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
        return { lines: [
          'Local data summary:',
          '  open tasks: ' + c.tasks,
          '  inbox items: ' + c.inbox,
          '  notes: ' + c.notes,
          '  documents: ' + c.docs,
          '  memory files: ' + c.memoryFiles
        ]};
      }
      default:
        return { lines: ['Unknown command "' + cmd + '". Type help for the command list.'] };
    }
  }
};

// ---- LiteLLM / OpenAI-compatible provider (requires explicit config) ----
async function getLlmConfig() {
  // Load from settings (persisted config)
  try {
    const fs = require('fs');
    const path = require('path');
    const settingsPath = path.join(__dirname, '..', '..', 'data', 'stores', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.llm && settings.llm.enabled) {
        return settings.llm;
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function callLlmApi(config, messages, tools) {
  const url = (config.baseUrl || 'http://127.0.0.1:4000').replace(/\/$/, '') + '/v1/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + (config.apiKey || 'dummy-key-for-local-litellm')
  };
  const body = {
    model: config.model || 'nemotron-3-ultra',
    messages,
    temperature: config.temperature ?? 0.3,
    max_tokens: config.maxTokens ?? 2048,
    stream: false
  };
  if (tools && tools.length) body.tools = tools;

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('LLM API error ' + res.status + ': ' + errText);
  }
  return res.json();
}

function buildSystemPrompt(ctx) {
  const counts = ctx.counts();
  return 'You are the Meridian OS assistant. You have access to the user\'s local data via function calls. ' +
    'Current local data: ' + counts.tasks + ' open tasks, ' + counts.inbox + ' inbox items, ' +
    counts.notes + ' notes, ' + counts.docs + ' documents, ' + counts.memoryFiles + ' memory files. ' +
    'Today is ' + U.today() + '. ' +
    'Be concise, helpful, and honest. Never claim capabilities you do not have. ' +
    'If the user asks for something requiring external access, explain what would be needed.';
}

const llmTools = [
  {
    type: 'function',
    function: {
      name: 'list_store',
      description: 'List items from a local collection',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', enum: ['inbox', 'tasks', 'notes', 'docs', 'events', 'activity', 'runs', 'proposals'] },
          filter: { type: 'object', properties: { done: { type: 'boolean' } } }
        },
        required: ['collection']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_all',
      description: 'Search across all local stores and memory',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a new task',
      parameters: { type: 'object', properties: { title: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high'] } }, required: ['title'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_note',
      description: 'Create a new note',
      parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title', 'content'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'capture_inbox',
      description: 'Add an item to the quick capture inbox',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_routine',
      description: 'Execute a routine by ID',
      parameters: { type: 'object', properties: { routineId: { type: 'string' }, approved: { type: 'boolean' } }, required: ['routineId'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'invoke_skill',
      description: 'Invoke a skill by ID',
      parameters: { type: 'object', properties: { skillId: { type: 'string' }, inputs: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['skillId'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'memory_note',
      description: 'Add a note to memory inbox',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
    }
  }
];

async function executeToolCall(ctx, name, args) {
  switch (name) {
    case 'list_store':
      return ctx.listStore(args.collection).filter((x) => {
        if (args.filter && args.filter.done !== undefined) return !!x.done === args.filter.done;
        return true;
      });
    case 'search_all':
      return ctx.search(args.query);
    case 'create_task':
      return ctx.addInbox ? { id: 'temp', title: args.title, priority: args.priority || 'normal' } : await ctx.addInbox('task: ' + args.title);
    case 'create_note':
      return { id: 'temp', title: args.title, content: args.content };
    case 'capture_inbox':
      return ctx.addInbox(args.text);
    case 'run_routine':
      return ctx.runRoutine(args.routineId, !!args.approved);
    case 'invoke_skill':
      return ctx.invokeSkill(args.skillId, args.inputs || {}, { confirm: !!args.confirm });
    case 'memory_note':
      return ctx.memoryNote(args.text);
    default:
      throw new Error('Unknown tool: ' + name);
  }
}

const llmProvider = {
  id: 'litellm',
  label: 'LiteLLM / OpenAI-compatible',
  async available() {
    const config = await getLlmConfig();
    return !!(config && config.enabled && config.baseUrl);
  },
  async describe() {
    const config = await getLlmConfig();
    if (!config || !config.enabled) {
      return 'Not configured. Set baseUrl, apiKey, and model in Settings to enable.';
    }
    return 'Connected to ' + config.baseUrl + ' (model: ' + (config.model || 'default') + ')';
  },
  async execute(command, ctx) {
    const config = await getLlmConfig();
    if (!config || !config.enabled || !config.baseUrl) {
      return { lines: ['LLM provider not configured. Use "help" for local commands, or configure LiteLLM in Settings.'] };
    }

    const messages = [
      { role: 'system', content: buildSystemPrompt(ctx) },
      { role: 'user', content: command }
    ];

    try {
      let response = await callLlmApi(config, messages, llmTools);
      let iterations = 0;
      const maxIterations = 5;

      while (response.choices?.[0]?.message?.tool_calls && iterations < maxIterations) {
        const toolCalls = response.choices[0].message.tool_calls;
        messages.push(response.choices[0].message);

        for (const tc of toolCalls) {
          try {
            const result = await executeToolCall(ctx, tc.function.name, JSON.parse(tc.function.arguments || '{}'));
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(result)
            });
          } catch (e) {
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify({ error: e.message })
            });
          }
        }

        response = await callLlmApi(config, messages, llmTools);
        iterations++;
      }

      const content = response.choices?.[0]?.message?.content || '(no response)';
      return { lines: content.split('\n').filter((l) => l.trim()) };
    } catch (e) {
      return { lines: ['LLM error: ' + e.message + '. Falling back to local commands. Type "help".'] };
    }
  }
};

async function runAssistant(command, ctx) {
  // Try LLM provider first if available
  if (await llmProvider.available()) {
    return { provider: llmProvider.id, providerLabel: llmProvider.label, lines: (await llmProvider.execute(command, ctx)).lines };
  }
  // Fall back to local deterministic
  return { provider: localProvider.id, providerLabel: localProvider.label, lines: localProvider.execute(command, ctx).lines };
}

module.exports = { runAssistant, providers: [localProvider, llmProvider] };
