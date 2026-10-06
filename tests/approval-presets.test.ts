import { describe, expect, it } from 'vitest';
import {
  AIDER_COMMAND_CATEGORIES,
  type ApprovalPreset,
  CLAUDE_TOOL_CATEGORIES,
  CODEX_TOOL_CATEGORIES,
  GEMINI_TOOL_CATEGORIES,
  generateAiderApprovalConfig,
  generateApprovalConfig,
  generateClaudeApprovalConfig,
  generateCodexApprovalConfig,
  generateGeminiApprovalConfig,
  generateHermesApprovalConfig,
  generateOpencodeApprovalConfig,
  getDeniedCategories,
  getPresetDefinition,
  listPresets,
  PRESET_DEFINITIONS,
  TOOL_CATEGORIES,
  type ToolCategory,
} from '../src/approval-presets';
import { HermesAdapter } from '../src/hermes-adapter';
import { OpencodeAdapter } from '../src/opencode-adapter';

// ─────────────────────────────────────────────────────────────────────────────
// Constants and helpers
// ─────────────────────────────────────────────────────────────────────────────

const ALL_PRESETS: ApprovalPreset[] = [
  'readonly',
  'standard',
  'permissive',
  'autonomous',
  'edit',
];
const ALL_CATEGORIES: ToolCategory[] = [
  'file_read',
  'file_write',
  'shell',
  'web',
  'agent',
  'planning',
  'user_interaction',
];

describe('Approval Presets', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // listPresets / getPresetDefinition
  // ─────────────────────────────────────────────────────────────────────────

  describe('listPresets()', () => {
    it('returns all 5 presets', () => {
      const presets = listPresets();
      expect(presets).toHaveLength(5);
      expect(presets.map((p) => p.preset)).toEqual(ALL_PRESETS);
    });

    it('returns a copy (not the original array)', () => {
      const a = listPresets();
      const b = listPresets();
      expect(a).not.toBe(b);
    });
  });

  describe('getPresetDefinition()', () => {
    it('returns definition for each preset', () => {
      for (const name of ALL_PRESETS) {
        const def = getPresetDefinition(name);
        expect(def.preset).toBe(name);
        expect(def.description).toBeTruthy();
      }
    });

    it('throws for unknown preset', () => {
      expect(() =>
        getPresetDefinition('nonexistent' as ApprovalPreset)
      ).toThrow('Unknown preset');
    });

    it('every category in autoApprove/requireApproval/blocked is a valid ToolCategory', () => {
      for (const def of PRESET_DEFINITIONS) {
        for (const cat of [
          ...def.autoApprove,
          ...def.requireApproval,
          ...def.blocked,
        ]) {
          expect(ALL_CATEGORIES).toContain(cat);
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Tool category mapping completeness
  // ─────────────────────────────────────────────────────────────────────────

  describe('TOOL_CATEGORIES', () => {
    it('defines all 7 categories', () => {
      expect(TOOL_CATEGORIES).toHaveLength(7);
      expect(TOOL_CATEGORIES.map((t) => t.category).sort()).toEqual(
        [...ALL_CATEGORIES].sort()
      );
    });
  });

  describe('per-CLI tool category mappings', () => {
    it('CLAUDE_TOOL_CATEGORIES maps all tools to valid categories', () => {
      for (const cat of Object.values(CLAUDE_TOOL_CATEGORIES)) {
        expect(ALL_CATEGORIES).toContain(cat);
      }
      expect(Object.keys(CLAUDE_TOOL_CATEGORIES).length).toBeGreaterThan(0);
    });

    it('GEMINI_TOOL_CATEGORIES maps all tools to valid categories', () => {
      for (const cat of Object.values(GEMINI_TOOL_CATEGORIES)) {
        expect(ALL_CATEGORIES).toContain(cat);
      }
      expect(Object.keys(GEMINI_TOOL_CATEGORIES).length).toBeGreaterThan(0);
    });

    it('CODEX_TOOL_CATEGORIES maps all tools to valid categories', () => {
      for (const cat of Object.values(CODEX_TOOL_CATEGORIES)) {
        expect(ALL_CATEGORIES).toContain(cat);
      }
      expect(Object.keys(CODEX_TOOL_CATEGORIES).length).toBeGreaterThan(0);
    });

    it('AIDER_COMMAND_CATEGORIES maps all commands to valid categories', () => {
      for (const cat of Object.values(AIDER_COMMAND_CATEGORIES)) {
        expect(ALL_CATEGORIES).toContain(cat);
      }
      expect(Object.keys(AIDER_COMMAND_CATEGORIES).length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateApprovalConfig dispatch
  // ─────────────────────────────────────────────────────────────────────────

  describe('generateApprovalConfig()', () => {
    it('dispatches to correct per-CLI generator', () => {
      const claude = generateApprovalConfig('claude', 'standard');
      expect(claude.summary).toContain('Claude Code');

      const gemini = generateApprovalConfig('gemini', 'standard');
      expect(gemini.summary).toContain('Gemini CLI');

      const codex = generateApprovalConfig('codex', 'standard');
      expect(codex.summary).toContain('Codex');

      const aider = generateApprovalConfig('aider', 'standard');
      expect(aider.summary).toContain('Aider');

      const hermes = generateApprovalConfig('hermes', 'standard');
      expect(hermes.summary).toContain('Hermes Agent');
    });

    it('throws for unknown adapter type', () => {
      expect(() =>
        generateApprovalConfig('unknown' as never, 'standard')
      ).toThrow('Unknown adapter type');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Claude Code config generation (4 presets)
  // ─────────────────────────────────────────────────────────────────────────

  describe('generateClaudeApprovalConfig()', () => {
    it('readonly: blocks write/shell/web tools', () => {
      const config = generateClaudeApprovalConfig('readonly');
      expect(config.preset).toBe('readonly');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.permissions.allow).toContain('Read');
      expect(settings.permissions.allow).toContain('Grep');
      expect(settings.permissions.deny).toContain('Write');
      expect(settings.permissions.deny).toContain('Bash');
      expect(settings.permissions.deny).toContain('WebSearch');
      expect(config.cliFlags).toEqual([]);
    });

    it('standard: allows read + web, no deny list', () => {
      const config = generateClaudeApprovalConfig('standard');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.permissions.allow).toContain('Read');
      expect(settings.permissions.allow).toContain('WebSearch');
      expect(settings.permissions.deny).toBeUndefined();
    });

    it('permissive: allows read + write + web + agent, no deny', () => {
      const config = generateClaudeApprovalConfig('permissive');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.permissions.allow).toContain('Write');
      expect(settings.permissions.allow).toContain('Edit');
      expect(settings.permissions.allow).toContain('Skill');
      expect(settings.permissions.deny).toBeUndefined();
    });

    it('autonomous: enables sandbox, skips --tools allowlist', () => {
      const config = generateClaudeApprovalConfig('autonomous');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.sandbox?.enabled).toBe(true);
      expect(settings.sandbox?.autoAllowBashIfSandboxed).toBe(true);
      expect(settings.permissions.allow).toContain('Bash');
      expect(config.cliFlags).toContain('--dangerously-skip-permissions');
      expect(config.cliFlags).not.toContain('--tools');
    });

    it('writes to .claude/settings.json', () => {
      const config = generateClaudeApprovalConfig('standard');
      expect(config.workspaceFiles[0].relativePath).toBe(
        '.claude/settings.json'
      );
      expect(config.workspaceFiles[0].format).toBe('json');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Gemini CLI config generation (4 presets)
  // ─────────────────────────────────────────────────────────────────────────

  describe('generateGeminiApprovalConfig()', () => {
    it('readonly: plan mode, excludes write/shell tools', () => {
      const config = generateGeminiApprovalConfig('readonly');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.general.defaultApprovalMode).toBe('plan');
      expect(settings.tools.exclude).toContain('write_file');
      expect(settings.tools.exclude).toContain('run_shell_command');
      expect(config.cliFlags).toContain('--approval-mode');
      expect(config.cliFlags).toContain('plan');
    });

    it('standard: default mode', () => {
      const config = generateGeminiApprovalConfig('standard');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.general.defaultApprovalMode).toBe('default');
      expect(config.cliFlags).toEqual([]);
    });

    it('permissive: auto_edit mode', () => {
      const config = generateGeminiApprovalConfig('permissive');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.general.defaultApprovalMode).toBe('auto_edit');
      expect(config.cliFlags).toContain('auto_edit');
    });

    it('autonomous: auto_edit with -y flag', () => {
      const config = generateGeminiApprovalConfig('autonomous');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.general.defaultApprovalMode).toBe('auto_edit');
      expect(config.cliFlags).toContain('-y');
    });

    it('writes to .gemini/settings.json', () => {
      const config = generateGeminiApprovalConfig('standard');
      expect(config.workspaceFiles[0].relativePath).toBe(
        '.gemini/settings.json'
      );
      expect(config.workspaceFiles[0].format).toBe('json');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Codex config generation (4 presets)
  // ─────────────────────────────────────────────────────────────────────────

  describe('generateCodexApprovalConfig()', () => {
    it('readonly: untrusted policy, workspace-read sandbox, no web search', () => {
      const config = generateCodexApprovalConfig('readonly');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.approval_policy).toBe('untrusted');
      expect(settings.sandbox_mode).toBe('workspace-read');
      expect(settings.tools.web_search).toBe(false);
      expect(config.cliFlags).toContain('--sandbox');
      expect(config.cliFlags).toContain('workspace-read');
    });

    it('standard: on-failure policy, workspace-write sandbox', () => {
      const config = generateCodexApprovalConfig('standard');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.approval_policy).toBe('on-failure');
      expect(settings.sandbox_mode).toBe('workspace-write');
      expect(settings.tools.web_search).toBe(true);
      expect(config.cliFlags).toContain('--sandbox');
      expect(config.cliFlags).toContain('workspace-write');
    });

    it('permissive: on-request policy', () => {
      const config = generateCodexApprovalConfig('permissive');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.approval_policy).toBe('on-request');
      expect(config.cliFlags).toContain('-a');
      expect(config.cliFlags).toContain('on-request');
    });

    it('autonomous: --full-auto flag', () => {
      const config = generateCodexApprovalConfig('autonomous');
      const settings = JSON.parse(config.workspaceFiles[0].content);
      expect(settings.approval_policy).toBe('never');
      expect(config.cliFlags).toContain('--full-auto');
    });

    it('writes to .codex/config.json', () => {
      const config = generateCodexApprovalConfig('standard');
      expect(config.workspaceFiles[0].relativePath).toBe('.codex/config.json');
      expect(config.workspaceFiles[0].format).toBe('json');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Aider config generation (4 presets)
  // ─────────────────────────────────────────────────────────────────────────

  describe('generateAiderApprovalConfig()', () => {
    it('readonly: no auto-commits, no yes-always', () => {
      const config = generateAiderApprovalConfig('readonly');
      const content = config.workspaceFiles[0].content;
      expect(content).toContain('yes-always: false');
      expect(content).toContain('no-auto-commits: true');
      expect(config.cliFlags).toContain('--no-auto-commits');
    });

    it('standard: no yes-always, no extra flags', () => {
      const config = generateAiderApprovalConfig('standard');
      const content = config.workspaceFiles[0].content;
      expect(content).toContain('yes-always: false');
      expect(config.cliFlags).toEqual([]);
    });

    it('permissive: yes-always enabled', () => {
      const config = generateAiderApprovalConfig('permissive');
      const content = config.workspaceFiles[0].content;
      expect(content).toContain('yes-always: true');
      expect(config.cliFlags).toContain('--yes-always');
    });

    it('autonomous: yes-always enabled', () => {
      const config = generateAiderApprovalConfig('autonomous');
      const content = config.workspaceFiles[0].content;
      expect(content).toContain('yes-always: true');
      expect(config.cliFlags).toContain('--yes-always');
    });

    it('writes to .aider.conf.yml', () => {
      const config = generateAiderApprovalConfig('standard');
      expect(config.workspaceFiles[0].relativePath).toBe('.aider.conf.yml');
      expect(config.workspaceFiles[0].format).toBe('yaml');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Cross-cutting validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('all configs', () => {
    const adapters = ['claude', 'gemini', 'codex', 'aider'] as const;

    for (const adapter of adapters) {
      for (const preset of ALL_PRESETS) {
        it(`${adapter}/${preset}: returns valid ApprovalConfig`, () => {
          const config = generateApprovalConfig(adapter, preset);
          expect(config.preset).toBe(preset);
          expect(config.summary).toBeTruthy();
          expect(Array.isArray(config.cliFlags)).toBe(true);
          expect(Array.isArray(config.workspaceFiles)).toBe(true);
          expect(config.workspaceFiles.length).toBeGreaterThan(0);
          expect(typeof config.envVars).toBe('object');

          // Workspace file content should be valid for its format
          for (const file of config.workspaceFiles) {
            expect(file.relativePath).toBeTruthy();
            expect(file.content).toBeTruthy();
            if (file.format === 'json') {
              expect(() => JSON.parse(file.content)).not.toThrow();
            }
          }
        });
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Hermes config generation (4 presets)
// ─────────────────────────────────────────────────────────────────────────

describe('generateHermesApprovalConfig()', () => {
  it('returns a no-op translation for the four original presets', () => {
    for (const preset of [
      'readonly',
      'standard',
      'permissive',
      'autonomous',
    ] as const) {
      const config = generateHermesApprovalConfig(preset);
      expect(config.preset).toBe(preset);
      expect(config.cliFlags).toEqual([]);
      expect(config.workspaceFiles).toEqual([]);
      expect(config.envVars).toEqual({});
      expect(config.summary).toContain('Hermes Agent');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// `edit` preset: unattended file edits, shell / web / agents blocked
// ─────────────────────────────────────────────────────────────────────────

/** Tools in a per-CLI map whose category is one of `cats`. */
function toolsIn(
  mapping: Record<string, ToolCategory>,
  cats: ToolCategory[]
): string[] {
  return Object.entries(mapping)
    .filter(([, c]) => cats.includes(c))
    .map(([t]) => t);
}

function claudeSettings(preset: ApprovalPreset) {
  const config = generateClaudeApprovalConfig(preset);
  const file = config.workspaceFiles.find(
    (f) => f.relativePath === '.claude/settings.json'
  );
  if (!file) throw new Error('missing .claude/settings.json');
  return { config, settings: JSON.parse(file.content) };
}

describe('edit preset', () => {
  describe('definition', () => {
    it('matches the specified categories', () => {
      expect(getPresetDefinition('edit')).toEqual({
        preset: 'edit',
        description:
          'File reads and edits auto-approved; shell, web and sub-agents blocked. For unattended code changes without command execution.',
        autoApprove: ['file_read', 'file_write', 'planning'],
        requireApproval: [],
        blocked: ['shell', 'web', 'agent'],
      });
    });

    it('is listed last, after the four original presets', () => {
      expect(listPresets().map((p) => p.preset)).toEqual(ALL_PRESETS);
    });

    it('denies user_interaction because it is not listed anywhere', () => {
      expect(getDeniedCategories(getPresetDefinition('edit'))).toEqual([
        'shell',
        'web',
        'agent',
        'user_interaction',
      ]);
    });

    it('denied categories equal `blocked` for the four original presets', () => {
      for (const preset of [
        'readonly',
        'standard',
        'permissive',
        'autonomous',
      ] as const) {
        const def = getPresetDefinition(preset);
        expect(getDeniedCategories(def)).toEqual(def.blocked);
      }
    });
  });

  describe('Claude Code', () => {
    const EXPECTED_ALLOW = [
      'Read',
      'Grep',
      'Glob',
      'LS',
      'NotebookRead',
      'LSP',
      'Write',
      'Edit',
      'MultiEdit',
      'NotebookEdit',
      'TodoWrite',
      'TaskCreate',
      'TaskGet',
      'TaskList',
      'TaskUpdate',
    ];
    const EXPECTED_DENY = [
      'Bash',
      'BashOutput',
      'KillShell',
      'TaskOutput',
      'TaskStop',
      'PowerShell',
      'Monitor',
      'REPL',
      'WebSearch',
      'WebFetch',
      'Task',
      'Agent',
      'Skill',
      'Workflow',
      'SendMessage',
      'ListAgents',
      'ListPeers',
      'CronCreate',
      'CronDelete',
      'CronList',
      'ScheduleWakeup',
      'RemoteTrigger',
      'AskUserQuestion',
    ];

    it('allows exactly the file, read and planning tools', () => {
      const { settings } = claudeSettings('edit');
      expect(settings.permissions.allow).toEqual(EXPECTED_ALLOW);
    });

    it('denies exactly the shell, web, agent and user-interaction tools', () => {
      const { settings } = claudeSettings('edit');
      expect(settings.permissions.deny).toEqual(EXPECTED_DENY);
    });

    it('denies every shell and web tool and allows none of them', () => {
      const { settings } = claudeSettings('edit');
      const shellAndWeb = toolsIn(CLAUDE_TOOL_CATEGORIES, ['shell', 'web']);
      expect(shellAndWeb).toEqual(
        expect.arrayContaining(['Bash', 'WebFetch', 'WebSearch'])
      );
      for (const tool of shellAndWeb) {
        expect(settings.permissions.deny).toContain(tool);
        expect(settings.permissions.allow).not.toContain(tool);
      }
    });

    it('allows the edit tools named in the Lookout requirement', () => {
      const { settings } = claudeSettings('edit');
      for (const tool of [
        'Edit',
        'Write',
        'MultiEdit',
        'NotebookEdit',
        'Read',
        'Grep',
        'Glob',
        'LS',
      ]) {
        expect(settings.permissions.allow).toContain(tool);
      }
    });

    it('never prompts: no ask rules, dontAsk mode in settings and on the CLI', () => {
      const { config, settings } = claudeSettings('edit');
      expect(settings.permissions.ask).toBeUndefined();
      expect(settings.permissions.defaultMode).toBe('dontAsk');
      const modeIdx = config.cliFlags.indexOf('--permission-mode');
      expect(config.cliFlags[modeIdx + 1]).toBe('dontAsk');
      expect(config.cliFlags).not.toContain('--dangerously-skip-permissions');
      expect(settings.sandbox).toBeUndefined();
    });

    it('passes the same settings on the CLI so untrusted workspaces still get the allow list', () => {
      const { config, settings } = claudeSettings('edit');
      const idx = config.cliFlags.indexOf('--settings');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(JSON.parse(config.cliFlags[idx + 1])).toEqual(settings);
    });
  });

  describe('Claude Code readonly (regression)', () => {
    it('denies every shell and web tool, including PowerShell and Monitor', () => {
      const { settings } = claudeSettings('readonly');
      for (const tool of toolsIn(CLAUDE_TOOL_CATEGORIES, ['shell', 'web'])) {
        expect(settings.permissions.deny).toContain(tool);
      }
      for (const tool of [
        'Bash',
        'PowerShell',
        'Monitor',
        'REPL',
        'WebFetch',
        'WebSearch',
      ]) {
        expect(settings.permissions.deny).toContain(tool);
        expect(settings.permissions.allow).not.toContain(tool);
      }
    });
  });

  describe('Gemini CLI', () => {
    const config = generateGeminiApprovalConfig('edit');
    const settings = JSON.parse(config.workspaceFiles[0].content);

    it('auto-approves edits via auto_edit, never yolo', () => {
      expect(settings.general.defaultApprovalMode).toBe('auto_edit');
      expect(config.cliFlags).toEqual(['--approval-mode', 'auto_edit']);
      expect(config.cliFlags).not.toContain('-y');
      expect(config.cliFlags).not.toContain('--yolo');
    });

    it('allows exactly the file, read and planning tools', () => {
      expect(settings.tools.allowed).toEqual(
        toolsIn(GEMINI_TOOL_CATEGORIES, ['file_read', 'file_write', 'planning'])
      );
      expect(settings.tools.allowed).toEqual(
        expect.arrayContaining(['read_file', 'write_file', 'replace'])
      );
    });

    it('excludes exactly the shell, web, agent and ask_user tools', () => {
      expect(settings.tools.exclude).toEqual([
        'run_shell_command',
        'web_fetch',
        'google_web_search',
        'activate_skill',
        'get_internal_docs',
        'codebase_investigator',
        'cli_help',
        'generalist',
        'browser_agent',
        'ask_user',
      ]);
    });

    it('disables sub-agents and every MCP server', () => {
      expect(settings.experimental).toEqual({ enableAgents: false });
      expect(settings.mcp).toEqual({ excluded: ['*'] });
    });
  });

  describe('Codex', () => {
    const config = generateCodexApprovalConfig('edit');
    const settings = JSON.parse(config.workspaceFiles[0].content);

    it('emits exactly the expected CLI flags', () => {
      expect(config.cliFlags).toEqual([
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never',
        '-c',
        'features.shell_tool=false',
        '-c',
        'web_search="disabled"',
        '-c',
        'features.browser_use=false',
        '-c',
        'features.browser_use_external=false',
        '-c',
        'features.computer_use=false',
        '-c',
        'features.multi_agent=false',
        '-c',
        'features.multi_agent_v2=false',
        '-c',
        'features.apps=false',
        '-c',
        'features.plugins=false',
      ]);
    });

    it('never prompts and never bypasses the sandbox', () => {
      expect(settings.approval_policy).toBe('never');
      expect(settings.sandbox_mode).toBe('workspace-write');
      expect(config.cliFlags).not.toContain('--full-auto');
      expect(config.cliFlags).not.toContain(
        '--dangerously-bypass-approvals-and-sandbox'
      );
    });

    it('turns off the shell tool, web search and multi-agent tools', () => {
      expect(settings.web_search).toBe('disabled');
      expect(settings.tools.web_search).toBe(false);
      expect(settings.features.shell_tool).toBe(false);
      expect(settings.features.multi_agent).toBe(false);
      expect(settings.features.multi_agent_v2).toBe(false);
    });

    it('documents that reads depend on the model when shell is off', () => {
      expect(config.summary).toContain('read_file');
    });
  });

  describe('Aider', () => {
    const config = generateAiderApprovalConfig('edit');

    it('emits exactly the expected flags and config', () => {
      expect(config.cliFlags).toEqual([
        '--yes-always',
        '--no-suggest-shell-commands',
        '--no-detect-urls',
        '--no-auto-lint',
        '--no-auto-test',
      ]);
      expect(config.workspaceFiles[0].content).toBe(
        'yes-always: true\nsuggest-shell-commands: false\ndetect-urls: false\nauto-lint: false\nauto-test: false\n'
      );
    });

    it('documents that typed /run and ! commands cannot be disabled', () => {
      expect(config.summary).toContain('/run');
    });
  });

  describe('Hermes Agent', () => {
    it('enables only the file and todo toolsets', () => {
      const config = generateHermesApprovalConfig('edit');
      expect(config.cliFlags).toEqual(['--toolsets', 'file,todo']);
    });

    it('HermesAdapter.getArgs appends the toolsets flag', () => {
      const adapter = new HermesAdapter();
      expect(
        adapter.getArgs({
          name: 't',
          type: 'hermes',
          adapterConfig: { approvalPreset: 'edit' },
        })
      ).toEqual(['chat', '--toolsets', 'file,todo']);
      expect(adapter.getArgs({ name: 't', type: 'hermes' })).toEqual(['chat']);
    });
  });

  describe('OpenCode', () => {
    const config = generateOpencodeApprovalConfig('edit');
    const permission = JSON.parse(config.envVars.OPENCODE_PERMISSION);

    it('emits exactly the expected permission rules', () => {
      expect(permission).toEqual({
        '*': 'deny',
        read: {
          '*': 'allow',
          '*.env': 'deny',
          '*.env.*': 'deny',
          '*.env.example': 'allow',
        },
        glob: 'allow',
        grep: 'allow',
        list: 'allow',
        lsp: 'allow',
        edit: 'allow',
        bash: 'deny',
        webfetch: 'deny',
        websearch: 'deny',
        task: 'deny',
        skill: 'deny',
        todowrite: 'allow',
        question: 'deny',
        external_directory: 'deny',
        doom_loop: 'deny',
      });
      // Catch-all deny must come first: OpenCode rules are last-match-wins.
      expect(Object.keys(permission)[0]).toBe('*');
    });

    it('never resolves a permission to "ask"', () => {
      expect(config.envVars.OPENCODE_PERMISSION).not.toContain('"ask"');
    });

    it('adapter passes OPENCODE_PERMISSION and drops --dangerously-skip-permissions', () => {
      const adapter = new OpencodeAdapter();
      const spawn = {
        name: 't',
        type: 'opencode',
        adapterConfig: { approvalPreset: 'edit' },
      };
      expect(adapter.getArgs(spawn)).toEqual(['run']);
      expect(adapter.getEnv(spawn).OPENCODE_PERMISSION).toBe(
        config.envVars.OPENCODE_PERMISSION
      );
      // Other presets keep the existing behaviour.
      expect(adapter.getArgs({ name: 't', type: 'opencode' })).toEqual([
        'run',
        '--dangerously-skip-permissions',
      ]);
    });
  });

  describe('every adapter', () => {
    const adapters = [
      'claude',
      'gemini',
      'codex',
      'aider',
      'hermes',
      'opencode',
    ] as const;

    for (const adapter of adapters) {
      it(`${adapter}: emits no blanket-approval flags`, () => {
        const config = generateApprovalConfig(adapter, 'edit');
        for (const flag of [
          '--dangerously-skip-permissions',
          '--dangerously-bypass-approvals-and-sandbox',
          '--full-auto',
          '--yolo',
          '-y',
          '--auto',
        ]) {
          expect(config.cliFlags).not.toContain(flag);
        }
      });
    }
  });
});
