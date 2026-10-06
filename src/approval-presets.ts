/**
 * Approval Presets
 *
 * Unified preset system for controlling tool permissions across all supported
 * coding agent CLIs. Each preset translates to the correct per-CLI config
 * format (JSON settings files, CLI flags, env vars).
 */

import type { AdapterType } from './base-coding-adapter';

let _autonomousSandboxWarningLogged = false;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ToolCategory =
  | 'file_read'
  | 'file_write'
  | 'shell'
  | 'web'
  | 'agent'
  | 'planning'
  | 'user_interaction';

export type RiskLevel = 'low' | 'medium' | 'high';

export type ApprovalPreset =
  | 'readonly'
  | 'standard'
  | 'permissive'
  | 'autonomous'
  | 'edit';

export interface ToolCategoryInfo {
  category: ToolCategory;
  risk: RiskLevel;
  description: string;
}

/**
 * A named approval preset.
 *
 * - `autoApprove`: categories the agent may use without a prompt.
 * - `requireApproval`: categories that prompt a human before each use.
 * - `blocked`: categories the agent must never use.
 *
 * A category that appears in none of the three lists is **not granted**.
 * Generators treat it as denied wherever the CLI can express a deny (see
 * {@link getDeniedCategories}); they never auto-approve it.
 */
export interface PresetDefinition {
  preset: ApprovalPreset;
  description: string;
  autoApprove: ToolCategory[];
  requireApproval: ToolCategory[];
  blocked: ToolCategory[];
}

export interface ApprovalConfig {
  preset: ApprovalPreset;
  cliFlags: string[];
  workspaceFiles: Array<{
    relativePath: string;
    content: string;
    format: 'json' | 'yaml' | 'toml';
  }>;
  envVars: Record<string, string>;
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const TOOL_CATEGORIES: ToolCategoryInfo[] = [
  {
    category: 'file_read',
    risk: 'low',
    description: 'Read files, search, list directories',
  },
  {
    category: 'file_write',
    risk: 'medium',
    description: 'Write, edit, and create files',
  },
  { category: 'shell', risk: 'high', description: 'Execute shell commands' },
  { category: 'web', risk: 'medium', description: 'Web search and fetch' },
  {
    category: 'agent',
    risk: 'medium',
    description: 'Spawn sub-agents, skills, MCP tools',
  },
  {
    category: 'planning',
    risk: 'low',
    description: 'Task planning and todo management',
  },
  {
    category: 'user_interaction',
    risk: 'low',
    description: 'Ask user questions',
  },
];

export const PRESET_DEFINITIONS: PresetDefinition[] = [
  {
    preset: 'readonly',
    description: 'Read-only. Safe for auditing.',
    autoApprove: ['file_read', 'planning', 'user_interaction'],
    requireApproval: [],
    blocked: ['file_write', 'shell', 'web', 'agent'],
  },
  {
    preset: 'standard',
    description: 'Standard dev. Reads + web auto, writes/shell prompt.',
    autoApprove: ['file_read', 'planning', 'user_interaction', 'web'],
    requireApproval: ['file_write', 'shell', 'agent'],
    blocked: [],
  },
  {
    preset: 'permissive',
    description: 'File ops auto-approved, shell still prompts.',
    autoApprove: [
      'file_read',
      'file_write',
      'planning',
      'user_interaction',
      'web',
      'agent',
    ],
    requireApproval: ['shell'],
    blocked: [],
  },
  {
    preset: 'autonomous',
    description: 'Everything auto-approved. Use with sandbox.',
    autoApprove: [
      'file_read',
      'file_write',
      'shell',
      'web',
      'agent',
      'planning',
      'user_interaction',
    ],
    requireApproval: [],
    blocked: [],
  },
  {
    // Unattended code changes without command execution or network access.
    // Nothing prompts: a prompt in an unattended session either stalls it or
    // gets answered by whatever is driving the PTY.
    //
    // `user_interaction` is deliberately left out of autoApprove: asking the
    // human a question would stall an unattended session. It is not listed
    // anywhere, so generators deny it (see getDeniedCategories).
    preset: 'edit',
    description:
      'File reads and edits auto-approved; shell, web and sub-agents blocked. For unattended code changes without command execution.',
    autoApprove: ['file_read', 'file_write', 'planning'],
    requireApproval: [],
    blocked: ['shell', 'web', 'agent'],
  },
];

/**
 * Categories a preset denies: its `blocked` list plus every category it does
 * not mention at all. For the four original presets this equals `blocked`
 * (they list all seven categories); for `edit` it adds `user_interaction`.
 */
export function getDeniedCategories(def: PresetDefinition): ToolCategory[] {
  const listed = new Set<ToolCategory>([
    ...def.autoApprove,
    ...def.requireApproval,
    ...def.blocked,
  ]);
  const unlisted = TOOL_CATEGORIES.map((t) => t.category).filter(
    (c) => !listed.has(c)
  );
  return [...def.blocked, ...unlisted];
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-CLI Tool Category Mappings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Claude Code built-in tool names, as used in `.claude/settings.json`
 * `permissions.allow` / `permissions.deny` rules.
 *
 * Includes both current names and legacy names. Claude Code (2.1.x) treats
 * `Task`, `KillShell` and `BashOutput` as aliases of `Agent`, `TaskStop` and
 * `TaskOutput`; listing both keeps rules correct on older and newer builds.
 * A rule naming a tool a build does not ship is ignored.
 */
export const CLAUDE_TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // file_read
  Read: 'file_read',
  Grep: 'file_read',
  Glob: 'file_read',
  LS: 'file_read',
  NotebookRead: 'file_read',
  LSP: 'file_read',
  // file_write
  Write: 'file_write',
  Edit: 'file_write',
  MultiEdit: 'file_write',
  NotebookEdit: 'file_write',
  // shell (anything that runs a command or arbitrary code)
  Bash: 'shell',
  BashOutput: 'shell',
  KillShell: 'shell',
  TaskOutput: 'shell',
  TaskStop: 'shell',
  PowerShell: 'shell',
  Monitor: 'shell',
  REPL: 'shell',
  // web
  WebSearch: 'web',
  WebFetch: 'web',
  // agent
  Task: 'agent',
  Agent: 'agent',
  Skill: 'agent',
  Workflow: 'agent',
  // Cross-session messaging and scheduling. These run without a permission
  // check, so they must be denied explicitly (dontAsk alone does not stop
  // them): SendMessage can reach other Claude sessions on the same machine.
  SendMessage: 'agent',
  ListAgents: 'agent',
  ListPeers: 'agent',
  CronCreate: 'agent',
  CronDelete: 'agent',
  CronList: 'agent',
  ScheduleWakeup: 'agent',
  RemoteTrigger: 'agent',
  // planning
  TodoWrite: 'planning',
  TaskCreate: 'planning',
  TaskGet: 'planning',
  TaskList: 'planning',
  TaskUpdate: 'planning',
  // user_interaction
  AskUserQuestion: 'user_interaction',
};

/**
 * Gemini CLI tool names, as used in `.gemini/settings.json` `tools.allowed` /
 * `tools.exclude`. Sub-agents are registered as tools named after the agent,
 * so the built-in agents are listed under `agent`. `search_file_content` is
 * the legacy alias of `grep_search`.
 */
export const GEMINI_TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // file_read
  read_file: 'file_read',
  read_many_files: 'file_read',
  list_directory: 'file_read',
  glob: 'file_read',
  grep_search: 'file_read',
  search_file_content: 'file_read',
  // file_write
  write_file: 'file_write',
  replace: 'file_write',
  // shell
  run_shell_command: 'shell',
  // web
  web_fetch: 'web',
  google_web_search: 'web',
  // agent
  activate_skill: 'agent',
  get_internal_docs: 'agent',
  codebase_investigator: 'agent',
  cli_help: 'agent',
  generalist: 'agent',
  browser_agent: 'agent',
  // planning
  save_memory: 'planning',
  write_todos: 'planning',
  tracker_create_task: 'planning',
  tracker_update_task: 'planning',
  tracker_get_task: 'planning',
  tracker_list_tasks: 'planning',
  tracker_add_dependency: 'planning',
  tracker_visualize: 'planning',
  // user_interaction
  ask_user: 'user_interaction',
};

/**
 * Codex model-facing tool names. Codex has no per-tool allow/deny list; these
 * names document what each preset's sandbox, approval policy and feature
 * flags (`shell_tool`, `multi_agent`, `web_search`) switch on or off.
 */
export const CODEX_TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // shell (codex uses shell for most operations)
  exec_command: 'shell',
  write_stdin: 'shell',
  shell_command: 'shell',
  shell: 'shell',
  local_shell: 'shell',
  js_repl: 'shell',
  // file_write
  apply_patch: 'file_write',
  // file_read (grep_files/read_file/list_dir only ship on some models)
  grep_files: 'file_read',
  read_file: 'file_read',
  list_dir: 'file_read',
  view_image: 'file_read',
  // web
  web_search: 'web',
  // agent
  spawn_agent: 'agent',
  send_input: 'agent',
  resume_agent: 'agent',
  wait: 'agent',
  close_agent: 'agent',
  list_mcp_resources: 'agent',
  list_mcp_resource_templates: 'agent',
  read_mcp_resource: 'agent',
  // planning
  update_plan: 'planning',
  // user_interaction
  request_user_input: 'user_interaction',
};

export const AIDER_COMMAND_CATEGORIES: Record<string, ToolCategory> = {
  // file_read
  '/read-only': 'file_read',
  '/ls': 'file_read',
  '/map': 'file_read',
  '/map-refresh': 'file_read',
  '/tokens': 'file_read',
  '/diff': 'file_read',
  '/context': 'file_read',
  // file_write
  '/add': 'file_write',
  '/drop': 'file_write',
  '/edit': 'file_write',
  '/code': 'file_write',
  '/architect': 'file_write',
  '/undo': 'file_write',
  // shell
  '/run': 'shell',
  '/test': 'shell',
  '/lint': 'shell',
  '/git': 'shell',
  // web
  '/web': 'web',
  // planning
  '/ask': 'planning',
  // user_interaction
  '/voice': 'user_interaction',
  '/help': 'user_interaction',
  // config/other
  '/model': 'planning',
  '/settings': 'planning',
  '/commit': 'file_write',
  '/clear': 'planning',
  '/reset': 'planning',
};

/**
 * OpenCode permission keys (the `permission` object in opencode.json, or the
 * `OPENCODE_PERMISSION` env var). `edit` covers the edit, write and
 * apply_patch tools.
 */
export const OPENCODE_PERMISSION_CATEGORIES: Record<string, ToolCategory> = {
  // file_read
  read: 'file_read',
  glob: 'file_read',
  grep: 'file_read',
  list: 'file_read',
  lsp: 'file_read',
  // file_write
  edit: 'file_write',
  // shell
  bash: 'shell',
  // web
  webfetch: 'web',
  websearch: 'web',
  // agent
  task: 'agent',
  skill: 'agent',
  // planning
  todowrite: 'planning',
  // user_interaction
  question: 'user_interaction',
};

/**
 * Hermes Agent toolsets (`hermes chat --toolsets a,b`) and the categories each
 * one needs. A toolset is enabled only when every category it needs is
 * auto-approved. Toolsets not listed here are never enabled by a preset.
 */
export const HERMES_TOOLSET_CATEGORIES: Record<string, ToolCategory[]> = {
  file: ['file_read', 'file_write'],
  todo: ['planning'],
  terminal: ['shell'],
  code_execution: ['shell'],
  web: ['web'],
  search: ['web'],
  browser: ['web'],
  delegation: ['agent'],
  skills: ['agent'],
  clarify: ['user_interaction'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-CLI Config Generators
// ─────────────────────────────────────────────────────────────────────────────

function getToolsForCategories(
  mapping: Record<string, ToolCategory>,
  categories: ToolCategory[]
): string[] {
  return Object.entries(mapping)
    .filter(([, cat]) => categories.includes(cat))
    .map(([tool]) => tool);
}

export function generateClaudeApprovalConfig(
  preset: ApprovalPreset
): ApprovalConfig {
  const def = getPresetDefinition(preset);

  const allowTools = getToolsForCategories(
    CLAUDE_TOOL_CATEGORIES,
    def.autoApprove
  );
  const denyTools = getToolsForCategories(
    CLAUDE_TOOL_CATEGORIES,
    getDeniedCategories(def)
  );

  const settings: Record<string, unknown> = {
    permissions: {} as Record<string, unknown>,
  };

  const permissions = settings.permissions as Record<string, unknown>;
  // Edit: `dontAsk` turns every would-be prompt into a deny. Anything not in
  // `allow` (MCP tools, tools newer than CLAUDE_TOOL_CATEGORIES, writes to
  // protected paths such as .git/ and .claude/) is refused instead of waiting
  // on a human.
  if (preset === 'edit') {
    permissions.defaultMode = 'dontAsk';
  }
  if (allowTools.length > 0) {
    permissions.allow = allowTools;
  }
  if (denyTools.length > 0) {
    permissions.deny = denyTools;
  }

  // Autonomous mode: enable sandbox and auto-allow bash
  if (preset === 'autonomous') {
    settings.sandbox = {
      enabled: true,
      autoAllowBashIfSandboxed: true,
    };
  }

  const cliFlags: string[] = [];

  // Permissive: auto-accept file edits via --permission-mode acceptEdits
  // (from leaked source: valid modes are default, plan, acceptEdits, bypassPermissions, dontAsk)
  if (preset === 'permissive') {
    cliFlags.push('--permission-mode', 'acceptEdits');
  }

  // Edit: deny anything not pre-approved rather than prompting, and pass the
  // full settings on the command line with --settings. Claude Code ignores
  // `permissions.allow` from a project's .claude/settings.json until the
  // workspace has been trusted interactively (never the case in a fresh
  // container), while CLI settings are always honoured. The CLI copy also
  // takes precedence over defaultMode in any other settings file.
  if (preset === 'edit') {
    cliFlags.push(
      '--permission-mode',
      'dontAsk',
      '--settings',
      JSON.stringify(settings)
    );
  }

  // Autonomous: skip all permission prompts and pass all tools
  if (preset === 'autonomous') {
    cliFlags.push('--dangerously-skip-permissions');
    if (!_autonomousSandboxWarningLogged) {
      console.warn(
        'Autonomous preset uses --dangerously-skip-permissions. Ensure agents run in a sandboxed environment.'
      );
      _autonomousSandboxWarningLogged = true;
    }
  }

  return {
    preset,
    cliFlags,
    workspaceFiles: [
      {
        relativePath: '.claude/settings.json',
        content: JSON.stringify(settings, null, 2),
        format: 'json',
      },
    ],
    envVars: {},
    summary: `Claude Code: ${def.description}`,
  };
}

export function generateGeminiApprovalConfig(
  preset: ApprovalPreset
): ApprovalConfig {
  const def = getPresetDefinition(preset);
  const cliFlags: string[] = [];

  const allowedTools = getToolsForCategories(
    GEMINI_TOOL_CATEGORIES,
    def.autoApprove
  );
  const excludeTools = getToolsForCategories(
    GEMINI_TOOL_CATEGORIES,
    getDeniedCategories(def)
  );

  let approvalMode: string;

  switch (preset) {
    case 'readonly':
      approvalMode = 'plan';
      cliFlags.push('--approval-mode', 'plan');
      break;
    case 'standard':
      approvalMode = 'default';
      break;
    case 'permissive':
      approvalMode = 'auto_edit';
      cliFlags.push('--approval-mode', 'auto_edit');
      break;
    case 'autonomous':
      approvalMode = 'auto_edit';
      cliFlags.push('-y');
      break;
    case 'edit':
      // auto_edit auto-approves write_file/replace; tools.exclude turns the
      // shell, web, skill and sub-agent tools into policy-engine DENY rules,
      // which also removes them from the model's tool list.
      approvalMode = 'auto_edit';
      cliFlags.push('--approval-mode', 'auto_edit');
      break;
  }

  const settings: Record<string, unknown> = {
    general: {
      defaultApprovalMode: approvalMode,
    },
    tools: {} as Record<string, unknown>,
  };

  const tools = settings.tools as Record<string, unknown>;
  if (allowedTools.length > 0) {
    tools.allowed = allowedTools;
  }
  if (excludeTools.length > 0) {
    tools.exclude = excludeTools;
  }

  if (preset === 'edit') {
    // `agent` covers sub-agents and MCP tools. Disabling agents drops every
    // sub-agent tool, including ones defined by the workspace in
    // .gemini/agents/, and `mcp.excluded: ['*']` denies all MCP server tools.
    settings.experimental = { enableAgents: false };
    settings.mcp = { excluded: ['*'] };
  }

  return {
    preset,
    cliFlags,
    workspaceFiles: [
      {
        relativePath: '.gemini/settings.json',
        content: JSON.stringify(settings, null, 2),
        format: 'json',
      },
    ],
    envVars: {},
    summary: `Gemini CLI: ${def.description}`,
  };
}

/**
 * `-c key=value` overrides the Codex `edit` preset passes on the command line.
 * Codex has no per-tool deny list, so tools are removed by switching off the
 * features that register them. `-c features.<name>=…` is used rather than
 * `--disable <name>` because Codex rejects unknown names given to `--disable`
 * but ignores unknown keys under `-c`, so the flags stay valid across Codex
 * versions that add or remove a feature.
 */
export const CODEX_EDIT_OVERRIDES: Record<string, string> = {
  // shell: removes exec_command / write_stdin / shell_command entirely.
  'features.shell_tool': 'false',
  // web: no web_search tool.
  web_search: '"disabled"',
  'features.browser_use': 'false',
  'features.browser_use_external': 'false',
  'features.computer_use': 'false',
  // agent: no spawn_agent & co., no app connectors or plugin-provided tools.
  'features.multi_agent': 'false',
  'features.multi_agent_v2': 'false',
  'features.apps': 'false',
  'features.plugins': 'false',
};

export function generateCodexApprovalConfig(
  preset: ApprovalPreset
): ApprovalConfig {
  const cliFlags: string[] = [];

  let approvalPolicy: string;
  let sandboxMode: string;
  let webSearch: boolean;

  switch (preset) {
    case 'readonly':
      approvalPolicy = 'untrusted';
      sandboxMode = 'workspace-read';
      webSearch = false;
      cliFlags.push('--sandbox', 'workspace-read', '-a', 'untrusted');
      break;
    case 'standard':
      approvalPolicy = 'on-failure';
      sandboxMode = 'workspace-write';
      webSearch = true;
      cliFlags.push('--sandbox', 'workspace-write');
      break;
    case 'permissive':
      approvalPolicy = 'on-request';
      sandboxMode = 'workspace-write';
      webSearch = true;
      cliFlags.push('-a', 'on-request');
      break;
    case 'autonomous':
      approvalPolicy = 'never';
      sandboxMode = 'workspace-write';
      webSearch = true;
      cliFlags.push('--full-auto');
      break;
    case 'edit':
      approvalPolicy = 'never';
      sandboxMode = 'workspace-write';
      webSearch = false;
      cliFlags.push(
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never'
      );
      for (const [key, value] of Object.entries(CODEX_EDIT_OVERRIDES)) {
        cliFlags.push('-c', `${key}=${value}`);
      }
      break;
  }

  const config: Record<string, unknown> = {
    approval_policy: approvalPolicy,
    sandbox_mode: sandboxMode,
    tools: {
      web_search: webSearch,
    },
  };

  let summary = `Codex: ${getPresetDefinition(preset).description}`;

  if (preset === 'edit') {
    config.web_search = 'disabled';
    config.features = Object.fromEntries(
      Object.entries(CODEX_EDIT_OVERRIDES)
        .filter(([key]) => key.startsWith('features.'))
        .map(([key, value]) => [
          key.slice('features.'.length),
          value === 'true',
        ])
    );
    summary +=
      ' Codex reads files through its shell tool, so with shell disabled the agent can only read files on models that ship read_file/list_dir/grep_files.';
  }

  return {
    preset,
    cliFlags,
    workspaceFiles: [
      {
        relativePath: '.codex/config.json',
        content: JSON.stringify(config, null, 2),
        format: 'json',
      },
    ],
    envVars: {},
    summary,
  };
}

export function generateAiderApprovalConfig(
  preset: ApprovalPreset
): ApprovalConfig {
  const def = getPresetDefinition(preset);
  const cliFlags: string[] = [];
  const lines: string[] = [];

  switch (preset) {
    case 'readonly':
      lines.push('yes-always: false');
      lines.push('no-auto-commits: true');
      cliFlags.push('--no-auto-commits');
      break;
    case 'standard':
      lines.push('yes-always: false');
      break;
    case 'permissive':
      lines.push('yes-always: true');
      cliFlags.push('--yes-always');
      break;
    case 'autonomous':
      lines.push('yes-always: true');
      cliFlags.push('--yes-always');
      break;
    case 'edit':
      // yes-always answers aider's own file prompts (add file to chat, create
      // file). Shell-command prompts need an explicit yes, so yes-always
      // declines them; suggest-shell-commands=false stops the model proposing
      // them at all. detect-urls=false stops aider fetching URLs that appear
      // in the input (yes-always would otherwise accept them). Lint and test
      // commands are turned off because they run shell commands.
      lines.push('yes-always: true');
      lines.push('suggest-shell-commands: false');
      lines.push('detect-urls: false');
      lines.push('auto-lint: false');
      lines.push('auto-test: false');
      cliFlags.push(
        '--yes-always',
        '--no-suggest-shell-commands',
        '--no-detect-urls',
        '--no-auto-lint',
        '--no-auto-test'
      );
      break;
  }

  let summary = `Aider: ${def.description}`;
  if (preset === 'edit') {
    summary +=
      ' Aider still runs /run, /test, /git, /web and ! commands typed into its input, so never forward untrusted text that starts with / or !.';
  }

  return {
    preset,
    cliFlags,
    workspaceFiles: [
      {
        relativePath: '.aider.conf.yml',
        content: `${lines.join('\n')}\n`,
        format: 'yaml',
      },
    ],
    envVars: {},
    summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
export function generateHermesApprovalConfig(
  preset: ApprovalPreset
): ApprovalConfig {
  const def = getPresetDefinition(preset);

  // Hermes CLI handles dangerous command approvals internally and does not
  // currently expose a stable approval-policy CLI/file matrix like other adapters.
  // The `edit` preset is the exception: it selects toolsets explicitly with
  // `--toolsets`, so shell, web, delegation and clarify tools (and MCP
  // toolsets) are never registered. Hermes only prompts for terminal commands
  // and writes to ~/.ssh/config, so file edits run without prompts.
  const cliFlags: string[] = [];
  if (preset === 'edit') {
    const toolsets = Object.entries(HERMES_TOOLSET_CATEGORIES)
      .filter(([, cats]) => cats.every((c) => def.autoApprove.includes(c)))
      .map(([toolset]) => toolset);
    cliFlags.push('--toolsets', toolsets.join(','));
  }

  return {
    preset,
    cliFlags,
    workspaceFiles: [],
    envVars: {},
    summary: `Hermes Agent: ${def.description}`,
  };
}

// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function generateApprovalConfig(
  adapterType: AdapterType,
  preset: ApprovalPreset
): ApprovalConfig {
  switch (adapterType) {
    case 'claude':
      return generateClaudeApprovalConfig(preset);
    case 'gemini':
      return generateGeminiApprovalConfig(preset);
    case 'codex':
      return generateCodexApprovalConfig(preset);
    case 'aider':
      return generateAiderApprovalConfig(preset);
    case 'hermes':
      return generateHermesApprovalConfig(preset);
    case 'opencode':
      return generateOpencodeApprovalConfig(preset);
    default:
      throw new Error(`Unknown adapter type: ${adapterType}`);
  }
}

/**
 * OpenCode approval-preset → CLI flag mapping.
 *
 * OpenCode has a single permission switch: `--dangerously-skip-permissions`
 * (a flag of the `run` subcommand). Either you accept all tool actions
 * unsupervised or you don't. The readonly / standard / permissive
 * presets map to "no flag" (opencode falls back to its own interactive
 * permission prompts); only `autonomous` opts into the bypass.
 *
 * Tools are not declared explicitly to opencode at spawn time — it picks
 * them up from its built-in registry and the loaded plugins. `tools: {}`
 * is kept for shape-consistency with the other adapters.
 *
 * The `edit` preset is enforced through OpenCode's permission rules instead,
 * passed in the `OPENCODE_PERMISSION` env var (merged over every config
 * file). Deny rules hold even under `--dangerously-skip-permissions`, and the
 * adapter does not pass that flag for `edit`, so any leftover "ask" is
 * auto-rejected in `run` mode rather than approved.
 */
export function generateOpencodeApprovalConfig(
  preset: ApprovalPreset
): ApprovalConfig {
  const cliFlags: string[] = [];
  const envVars: Record<string, string> = {};
  let summary: string;
  switch (preset) {
    case 'edit':
      envVars.OPENCODE_PERMISSION = JSON.stringify(
        buildOpencodePermission(getPresetDefinition(preset))
      );
      summary =
        'OpenCode: file reads and edits allowed; shell, web, sub-agents, skills and questions denied (OPENCODE_PERMISSION).';
      break;
    case 'autonomous':
      cliFlags.push('--dangerously-skip-permissions');
      summary =
        'OpenCode: all tool actions auto-approved (--dangerously-skip-permissions)';
      break;
    case 'readonly':
      summary = 'OpenCode: interactive permissions (read-heavy session)';
      break;
    case 'standard':
      summary = 'OpenCode: interactive permissions (standard session)';
      break;
    case 'permissive':
      summary = 'OpenCode: interactive permissions (permissive session)';
      break;
  }
  return {
    preset,
    cliFlags,
    workspaceFiles: [],
    envVars,
    summary,
  };
}

/**
 * Build an OpenCode `permission` object for a preset. OpenCode evaluates
 * rules last-match-wins, so the catch-all `"*": "deny"` comes first and
 * denies anything not named (MCP tools, unknown tools). Every known key is
 * then set to allow or deny so nothing resolves to "ask".
 */
function buildOpencodePermission(
  def: PresetDefinition
): Record<string, string | Record<string, string>> {
  const permission: Record<string, string | Record<string, string>> = {
    '*': 'deny',
  };
  for (const [key, category] of Object.entries(
    OPENCODE_PERMISSION_CATEGORIES
  )) {
    permission[key] = def.autoApprove.includes(category) ? 'allow' : 'deny';
  }
  // Keep OpenCode's default protection for .env files.
  if (permission.read === 'allow') {
    permission.read = {
      '*': 'allow',
      '*.env': 'deny',
      '*.env.*': 'deny',
      '*.env.example': 'allow',
    };
  }
  // Never prompt: touching paths outside the project and repeated identical
  // tool calls (doom_loop) both default to "ask".
  permission.external_directory = 'deny';
  permission.doom_loop = 'deny';
  return permission;
}

export function listPresets(): PresetDefinition[] {
  return [...PRESET_DEFINITIONS];
}

export function getPresetDefinition(preset: ApprovalPreset): PresetDefinition {
  const def = PRESET_DEFINITIONS.find((d) => d.preset === preset);
  if (!def) {
    throw new Error(`Unknown preset: ${preset}`);
  }
  return def;
}
