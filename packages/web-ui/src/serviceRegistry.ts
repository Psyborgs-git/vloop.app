/**
 * Service Registry — type-safe metadata for every orchestrator topic/action.
 *
 * Used by the ConsoleView to render dynamic dropdown selectors and
 * auto-generated payload forms.
 */

// ─── Field Types ─────────────────────────────────────────────────────────────

export type FieldType = 'string' | 'number' | 'boolean' | 'json' | 'string[]' | 'select';

export interface FieldDef {
    name: string;
    type: FieldType;
    required: boolean;
    description: string;
    default?: unknown;
    /** For 'select' type fields */
    options?: string[];
}

export interface ActionDef {
    action: string;
    description: string;
    fields: FieldDef[];
    isStream?: boolean;
}

export interface TopicDef {
    topic: string;
    label: string;
    description: string;
    color: string; // MUI-friendly color for badges
    actions: ActionDef[];
}

// ─── Registry ────────────────────────────────────────────────────────────────

export const SERVICE_REGISTRY: TopicDef[] = [
    // ── Auth ─────────────────────────────────────────────────────────────
    {
        topic: 'auth',
        label: 'Auth',
        description: 'Authentication, users, and JWT providers',
        color: '#8b5cf6',
        actions: [
            {
                action: 'login',
                description: 'Login with email/password or JWT token',
                fields: [
                    { name: 'type', type: 'select', required: true, description: 'Login type', options: ['local', 'jwt'], default: 'local' },
                    { name: 'email', type: 'string', required: false, description: 'Email address (local login)' },
                    { name: 'password', type: 'string', required: false, description: 'Password (local login)' },
                    { name: 'token', type: 'string', required: false, description: 'JWT token (jwt login)' },
                ],
            },
            {
                action: 'user.create',
                description: 'Create a new user',
                fields: [
                    { name: 'email', type: 'string', required: true, description: 'User email' },
                    { name: 'password', type: 'string', required: false, description: 'Password (optional)' },
                    { name: 'allowedRoles', type: 'string[]', required: false, description: 'Allowed roles (e.g. admin,viewer)', default: ['viewer'] },
                ],
            },
            {
                action: 'user.update_roles',
                description: 'Update user allowed roles',
                fields: [
                    { name: 'email', type: 'string', required: true, description: 'User email' },
                    { name: 'allowedRoles', type: 'string[]', required: true, description: 'Allowed roles' },
                ],
            },
            {
                action: 'user.update_password',
                description: 'Update user password',
                fields: [
                    { name: 'email', type: 'string', required: true, description: 'User email' },
                    { name: 'newPassword', type: 'string', required: true, description: 'New password' },
                ],
            },
            {
                action: 'user.list',
                description: 'List all users',
                fields: [],
            },
            {
                action: 'provider.add',
                description: 'Add a JWT identity provider',
                fields: [
                    { name: 'issuer', type: 'string', required: true, description: 'Issuer URL' },
                    { name: 'jwksUrl', type: 'string', required: true, description: 'JWKS URL' },
                    { name: 'audience', type: 'string', required: false, description: 'Expected audience' },
                ],
            },
            {
                action: 'provider.remove',
                description: 'Remove a JWT identity provider',
                fields: [
                    { name: 'issuer', type: 'string', required: true, description: 'Issuer URL' },
                ],
            },
            {
                action: 'provider.list',
                description: 'List all JWT providers',
                fields: [],
            },
        ],
    },

    // ── Vault ────────────────────────────────────────────────────────────
    {
        topic: 'vault',
        label: 'Vault',
        description: 'Encrypted secrets management',
        color: '#f59e0b',
        actions: [
            {
                action: 'secret.create',
                description: 'Create a new secret',
                fields: [
                    { name: 'name', type: 'string', required: true, description: 'Secret name / path' },
                    { name: 'value', type: 'string', required: true, description: 'Secret value' },
                    { name: 'metadata', type: 'json', required: false, description: 'Optional metadata object' },
                ],
            },
            {
                action: 'secret.get',
                description: 'Read a secret by name',
                fields: [
                    { name: 'name', type: 'string', required: true, description: 'Secret name / path' },
                    { name: 'version', type: 'number', required: false, description: 'Version number (latest if omitted)' },
                ],
            },
            {
                action: 'secret.update',
                description: 'Update an existing secret',
                fields: [
                    { name: 'name', type: 'string', required: true, description: 'Secret name / path' },
                    { name: 'value', type: 'string', required: true, description: 'New secret value' },
                    { name: 'metadata', type: 'json', required: false, description: 'Updated metadata object' },
                ],
            },
            {
                action: 'secret.delete',
                description: 'Delete a secret',
                fields: [
                    { name: 'name', type: 'string', required: true, description: 'Secret name / path' },
                    { name: 'hard', type: 'boolean', required: false, description: 'Hard delete (permanent)', default: false },
                ],
            },
            {
                action: 'secret.list',
                description: 'List secrets',
                fields: [
                    { name: 'prefix', type: 'string', required: false, description: 'Filter by prefix' },
                    { name: 'limit', type: 'number', required: false, description: 'Max results' },
                    { name: 'offset', type: 'number', required: false, description: 'Offset for pagination' },
                ],
            },
        ],
    },

    // ── Container ────────────────────────────────────────────────────────
    {
        topic: 'container',
        label: 'Container',
        description: 'Docker images and containers',
        color: '#0ea5e9',
        actions: [
            {
                action: 'image.pull',
                description: 'Pull a Docker image',
                fields: [
                    { name: 'image', type: 'string', required: true, description: 'Image name (e.g. alpine:latest)' },
                ],
            },
            {
                action: 'image.list',
                description: 'List local Docker images',
                fields: [],
            },
            {
                action: 'image.inspect',
                description: 'Inspect a Docker image',
                fields: [
                    { name: 'image', type: 'string', required: true, description: 'Image name or ID' },
                ],
            },
            {
                action: 'image.remove',
                description: 'Remove a Docker image',
                fields: [
                    { name: 'image', type: 'string', required: true, description: 'Image name or ID' },
                    { name: 'force', type: 'boolean', required: false, description: 'Force removal', default: false },
                ],
            },
            {
                action: 'container.create',
                description: 'Create a Docker container',
                fields: [
                    { name: 'name', type: 'string', required: true, description: 'Container name' },
                    { name: 'image', type: 'string', required: true, description: 'Docker image' },
                    { name: 'cmd', type: 'string[]', required: false, description: 'Command to run' },
                    { name: 'env', type: 'string[]', required: false, description: 'Environment variables (KEY=VAL)' },
                    { name: 'workingDir', type: 'string', required: false, description: 'Working directory' },
                    { name: 'cpuLimit', type: 'number', required: false, description: 'CPU limit (cores)' },
                    { name: 'memoryLimit', type: 'number', required: false, description: 'Memory limit (bytes)' },
                    { name: 'restartPolicy', type: 'select', required: false, description: 'Restart policy', options: ['no', 'always', 'unless-stopped', 'on-failure'] },
                    { name: 'autoRemove', type: 'boolean', required: false, description: 'Auto-remove when stopped', default: false },
                    { name: 'ports', type: 'json', required: false, description: 'Port mappings: [{host, container, protocol}]' },
                    { name: 'volumes', type: 'json', required: false, description: 'Volume mounts: [{host, container, readOnly}]' },
                    { name: 'labels', type: 'json', required: false, description: 'Container labels object' },
                ],
            },
            {
                action: 'container.start',
                description: 'Start a container',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Container name or ID' },
                ],
            },
            {
                action: 'container.stop',
                description: 'Stop a container',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Container name or ID' },
                    { name: 'timeout', type: 'number', required: false, description: 'Timeout seconds', default: 10 },
                ],
            },
            {
                action: 'container.restart',
                description: 'Restart a container',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Container name or ID' },
                    { name: 'timeout', type: 'number', required: false, description: 'Timeout seconds', default: 10 },
                ],
            },
            {
                action: 'container.remove',
                description: 'Remove a container',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Container name or ID' },
                    { name: 'force', type: 'boolean', required: false, description: 'Force removal', default: false },
                ],
            },
            {
                action: 'container.list',
                description: 'List containers',
                fields: [
                    { name: 'all', type: 'boolean', required: false, description: 'Include stopped containers', default: false },
                ],
            },
            {
                action: 'container.inspect',
                description: 'Inspect a container',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Container name or ID' },
                ],
            },
            {
                action: 'container.logs',
                description: 'Get container logs',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Container name or ID' },
                    { name: 'tail', type: 'number', required: false, description: 'Tail N lines' },
                    { name: 'since', type: 'string', required: false, description: 'Since timestamp' },
                ],
            },
        ],
    },

    // ── Process ──────────────────────────────────────────────────────────
    {
        topic: 'process',
        label: 'Process',
        description: 'Background process management',
        color: '#10b981',
        actions: [
            {
                action: 'process.spawn',
                description: 'Spawn a new background process',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Unique process identifier' },
                    { name: 'command', type: 'string', required: true, description: 'Executable command' },
                    { name: 'args', type: 'string[]', required: false, description: 'Command arguments' },
                    { name: 'cwd', type: 'string', required: false, description: 'Working directory' },
                    { name: 'env', type: 'json', required: false, description: 'Environment variables object' },
                    { name: 'restartPolicy', type: 'select', required: false, description: 'Restart policy', options: ['always', 'on-failure', 'never'], default: 'never' },
                    { name: 'maxRestarts', type: 'number', required: false, description: 'Max restart attempts', default: 5 },
                    { name: 'shutdownTimeoutMs', type: 'number', required: false, description: 'Shutdown timeout (ms)', default: 10000 },
                ],
            },
            {
                action: 'process.stop',
                description: 'Stop a running process',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Process ID' },
                ],
            },
            {
                action: 'process.restart',
                description: 'Restart a process',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Process ID' },
                ],
            },
            {
                action: 'process.list',
                description: 'List all managed processes',
                fields: [],
            },
            {
                action: 'process.inspect',
                description: 'Get detailed process info',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Process ID' },
                ],
            },
            {
                action: 'process.logs',
                description: 'Get process logs',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Process ID' },
                    { name: 'tail', type: 'number', required: false, description: 'Tail N lines' },
                ],
            },
        ],
    },

    // ── Schedule ─────────────────────────────────────────────────────────
    {
        topic: 'schedule',
        label: 'Schedule',
        description: 'Cron job scheduling',
        color: '#ec4899',
        actions: [
            {
                action: 'schedule.create',
                description: 'Create a scheduled job',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Job identifier' },
                    { name: 'command', type: 'string', required: true, description: 'Command to execute' },
                    { name: 'cron', type: 'string', required: false, description: 'Cron expression (e.g. */5 * * * *)' },
                    { name: 'runAt', type: 'string', required: false, description: 'ISO 8601 timestamp for one-time run' },
                    { name: 'args', type: 'string[]', required: false, description: 'Command arguments' },
                    { name: 'cwd', type: 'string', required: false, description: 'Working directory' },
                    { name: 'env', type: 'json', required: false, description: 'Environment variables' },
                    { name: 'timeoutMs', type: 'number', required: false, description: 'Execution timeout (ms)' },
                ],
            },
            {
                action: 'schedule.list',
                description: 'List all scheduled jobs',
                fields: [],
            },
            {
                action: 'schedule.get',
                description: 'Get scheduled job details',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Job ID' },
                ],
            },
            {
                action: 'schedule.delete',
                description: 'Delete a scheduled job',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Job ID' },
                ],
            },
        ],
    },

    // ── DB ────────────────────────────────────────────────────────────────
    {
        topic: 'db',
        label: 'Database',
        description: 'Internal & external databases, provisioning, queries',
        color: '#6366f1',
        actions: [
            {
                action: 'db.provision',
                description: 'Provision a new workspace database',
                fields: [
                    { name: 'workspaceId', type: 'string', required: true, description: 'Workspace identifier' },
                    { name: 'description', type: 'string', required: false, description: 'Description' },
                ],
            },
            {
                action: 'db.query',
                description: 'Execute raw SQL on a workspace database',
                fields: [
                    { name: 'workspaceId', type: 'string', required: true, description: 'Workspace identifier' },
                    { name: 'dbId', type: 'string', required: true, description: 'Database identifier' },
                    { name: 'sql', type: 'string', required: true, description: 'SQL query' },
                    { name: 'params', type: 'json', required: false, description: 'Query parameters array' },
                ],
            },
            {
                action: 'db.disconnect',
                description: 'Disconnect a workspace database',
                fields: [
                    { name: 'workspaceId', type: 'string', required: true, description: 'Workspace identifier' },
                    { name: 'dbId', type: 'string', required: true, description: 'Database identifier' },
                ],
            },
            {
                action: 'db.root_query',
                description: 'Query the root orchestrator database (admin only)',
                fields: [
                    { name: 'sql', type: 'string', required: true, description: 'SQL query' },
                    { name: 'params', type: 'json', required: false, description: 'Query parameters array' },
                ],
            },
            {
                action: 'db.ext.register',
                description: 'Register an external database connection',
                fields: [
                    { name: 'label', type: 'string', required: true, description: 'Display name' },
                    { name: 'dbType', type: 'select', required: true, description: 'Database type', options: ['postgres', 'mysql', 'sqlite'] },
                    { name: 'host', type: 'string', required: false, description: 'Host address' },
                    { name: 'port', type: 'number', required: false, description: 'Port number' },
                    { name: 'databaseName', type: 'string', required: false, description: 'Database name' },
                    { name: 'ssl', type: 'boolean', required: false, description: 'Use SSL', default: false },
                    { name: 'username', type: 'string', required: false, description: 'Username' },
                    { name: 'password', type: 'string', required: false, description: 'Password' },
                    { name: 'filePath', type: 'string', required: false, description: 'SQLite file path' },
                ],
            },
            {
                action: 'db.ext.list',
                description: 'List your external databases',
                fields: [],
            },
            {
                action: 'db.ext.query',
                description: 'Execute SQL on an external database',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'External DB config ID' },
                    { name: 'sql', type: 'string', required: true, description: 'SQL query' },
                    { name: 'params', type: 'json', required: false, description: 'Query parameters array' },
                ],
            },
            {
                action: 'db.ext.test',
                description: 'Test an external database connection',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'External DB config ID' },
                ],
            },
            {
                action: 'db.ext.remove',
                description: 'Remove an external database config',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'External DB config ID' },
                ],
            },
        ],
    },

    // ── Terminal ─────────────────────────────────────────────────────────
    {
        topic: 'terminal',
        label: 'Terminal',
        description: 'Interactive shell sessions and terminal profiles',
        color: '#f97316',
        actions: [
            {
                action: 'spawn',
                description: 'Spawn a terminal session (streaming PTY output)',
                isStream: true,
                fields: [
                    { name: 'sessionId', type: 'string', required: false, description: 'Optional custom session ID' },
                    { name: 'shell', type: 'string', required: false, description: 'Shell executable' },
                    { name: 'args', type: 'string[]', required: false, description: 'Shell arguments' },
                    { name: 'cwd', type: 'string', required: false, description: 'Working directory' },
                    { name: 'env', type: 'json', required: false, description: 'Environment variables object' },
                    { name: 'cols', type: 'number', required: false, description: 'Terminal columns', default: 120 },
                    { name: 'rows', type: 'number', required: false, description: 'Terminal rows', default: 30 },
                    { name: 'profileId', type: 'string', required: false, description: 'Optional profile ID' },
                ],
            },
            {
                action: 'write',
                description: 'Write input to terminal session',
                fields: [
                    { name: 'sessionId', type: 'string', required: true, description: 'Terminal session ID' },
                    { name: 'data', type: 'string', required: true, description: 'Input data to send' },
                ],
            },
            {
                action: 'resize',
                description: 'Resize terminal dimensions',
                fields: [
                    { name: 'sessionId', type: 'string', required: true, description: 'Terminal session ID' },
                    { name: 'cols', type: 'number', required: true, description: 'Columns' },
                    { name: 'rows', type: 'number', required: true, description: 'Rows' },
                ],
            },
            {
                action: 'kill',
                description: 'Terminate terminal session',
                fields: [
                    { name: 'sessionId', type: 'string', required: true, description: 'Terminal session ID' },
                ],
            },
            {
                action: 'list',
                description: 'List active terminal sessions',
                fields: [],
            },
            {
                action: 'scrollback',
                description: 'Fetch session scrollback buffer',
                fields: [
                    { name: 'sessionId', type: 'string', required: true, description: 'Terminal session ID' },
                    { name: 'lines', type: 'number', required: false, description: 'Last N lines to return' },
                ],
            },
            {
                action: 'profile.list',
                description: 'List terminal profiles',
                fields: [
                    { name: 'owner', type: 'string', required: false, description: 'Owner identity (admin only override)' },
                ],
            },
            {
                action: 'profile.create',
                description: 'Create terminal profile',
                fields: [
                    { name: 'name', type: 'string', required: true, description: 'Profile name' },
                    { name: 'shell', type: 'string', required: false, description: 'Shell executable' },
                    { name: 'args', type: 'string[]', required: false, description: 'Shell args' },
                    { name: 'cwd', type: 'string', required: false, description: 'Working directory' },
                    { name: 'env', type: 'json', required: false, description: 'Environment variables object' },
                    { name: 'startupCommands', type: 'string[]', required: false, description: 'Commands to run at startup' },
                    { name: 'isDefault', type: 'boolean', required: false, description: 'Set as default profile', default: false },
                ],
            },
            {
                action: 'profile.update',
                description: 'Update terminal profile',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Profile ID' },
                    { name: 'name', type: 'string', required: false, description: 'Profile name' },
                    { name: 'shell', type: 'string', required: false, description: 'Shell executable' },
                    { name: 'args', type: 'string[]', required: false, description: 'Shell args' },
                    { name: 'cwd', type: 'string', required: false, description: 'Working directory' },
                    { name: 'env', type: 'json', required: false, description: 'Environment variables object' },
                    { name: 'startupCommands', type: 'string[]', required: false, description: 'Commands to run at startup' },
                    { name: 'isDefault', type: 'boolean', required: false, description: 'Set as default profile' },
                ],
            },
            {
                action: 'profile.delete',
                description: 'Delete terminal profile',
                fields: [
                    { name: 'id', type: 'string', required: true, description: 'Profile ID' },
                ],
            },
        ],
    },

    // ── Agent ─────────────────────────────────────────────────────────────
    {
        topic: 'agent',
        label: 'AI Agent',
        description: 'AI agent configuration, chat, workflow, and memory management',
        color: '#f43f5e',
        actions: [
            // Legacy
            {
                action: 'agent.workflow',
                description: 'Run a legacy AI agent workflow (streaming)',
                isStream: true,
                fields: [
                    { name: 'workspaceId', type: 'string', required: true, description: 'Workspace identifier' },
                    { name: 'prompt', type: 'string', required: true, description: 'Prompt / instruction' },
                ],
            },
            // Provider CRUD
            {
                action: 'agent.provider.create', description: 'Create an AI provider', fields: [
                    { name: 'name', type: 'string', required: true, description: 'Provider name' },
                    { name: 'type', type: 'select', required: true, description: 'Provider type', options: ['google', 'openai', 'anthropic', 'ollama', 'groq', 'custom'] },
                    { name: 'baseUrl', type: 'string', required: false, description: 'Base URL' },
                    { name: 'apiKeyRef', type: 'string', required: false, description: 'Vault key reference' },
                ]
            },
            { action: 'agent.provider.list', description: 'List all providers', fields: [] },
            { action: 'agent.provider.get', description: 'Get a provider by ID', fields: [{ name: 'id', type: 'string', required: true, description: 'Provider ID' }] },
            { action: 'agent.provider.delete', description: 'Delete a provider', fields: [{ name: 'id', type: 'string', required: true, description: 'Provider ID' }] },
            // Model CRUD
            {
                action: 'agent.model.create', description: 'Create a model config', fields: [
                    { name: 'name', type: 'string', required: true, description: 'Display name' },
                    { name: 'providerId', type: 'string', required: true, description: 'Provider ID' },
                    { name: 'modelId', type: 'string', required: true, description: 'Model identifier (e.g. gemini-2.5-flash)' },
                    { name: 'params', type: 'json', required: false, description: 'Model parameters JSON' },
                ]
            },
            { action: 'agent.model.list', description: 'List all models', fields: [] },
            { action: 'agent.model.delete', description: 'Delete a model', fields: [{ name: 'id', type: 'string', required: true, description: 'Model ID' }] },
            // Tool CRUD
            {
                action: 'agent.tool.create', description: 'Create a tool config', fields: [
                    { name: 'name', type: 'string', required: true, description: 'Tool name' },
                    { name: 'description', type: 'string', required: true, description: 'Tool description' },
                    { name: 'handlerType', type: 'select', required: true, description: 'Handler type', options: ['builtin', 'script', 'api'] },
                    { name: 'parametersSchema', type: 'json', required: false, description: 'Parameters schema JSON' },
                    { name: 'handlerConfig', type: 'json', required: false, description: 'Handler config JSON' },
                ]
            },
            { action: 'agent.tool.list', description: 'List all tools', fields: [] },
            { action: 'agent.tool.delete', description: 'Delete a tool', fields: [{ name: 'id', type: 'string', required: true, description: 'Tool ID' }] },
            // Agent Config CRUD
            {
                action: 'agent.config.create', description: 'Create an agent config', fields: [
                    { name: 'name', type: 'string', required: true, description: 'Agent name' },
                    { name: 'description', type: 'string', required: false, description: 'Agent description' },
                    { name: 'modelId', type: 'string', required: true, description: 'Model config ID' },
                    { name: 'systemPrompt', type: 'string', required: false, description: 'System prompt' },
                    { name: 'toolIds', type: 'json', required: false, description: 'Tool IDs JSON array' },
                    { name: 'params', type: 'json', required: false, description: 'Override params JSON' },
                ]
            },
            { action: 'agent.config.list', description: 'List all agent configs', fields: [] },
            { action: 'agent.config.delete', description: 'Delete an agent config', fields: [{ name: 'id', type: 'string', required: true, description: 'Agent ID' }] },
            // Workflow CRUD
            {
                action: 'agent.workflow.create', description: 'Create a workflow config', fields: [
                    { name: 'name', type: 'string', required: true, description: 'Workflow name' },
                    { name: 'type', type: 'select', required: true, description: 'Execution type', options: ['sequential', 'parallel', 'loop'] },
                    { name: 'steps', type: 'json', required: true, description: 'Steps JSON array' },
                ]
            },
            { action: 'agent.workflow.list', description: 'List all workflows', fields: [] },
            { action: 'agent.workflow.delete', description: 'Delete a workflow', fields: [{ name: 'id', type: 'string', required: true, description: 'Workflow ID' }] },
            // Chat Session
            {
                action: 'agent.chat.create', description: 'Create a chat session', fields: [
                    { name: 'agentId', type: 'string', required: false, description: 'Agent config ID' },
                    { name: 'title', type: 'string', required: false, description: 'Session title' },
                ]
            },
            { action: 'agent.chat.list', description: 'List chat sessions', fields: [] },
            { action: 'agent.chat.history', description: 'Get chat history', fields: [{ name: 'sessionId', type: 'string', required: true, description: 'Session ID' }] },
            {
                action: 'agent.chat.send', description: 'Send message to chat (streaming)', isStream: true, fields: [
                    { name: 'sessionId', type: 'string', required: true, description: 'Session ID' },
                    { name: 'content', type: 'string', required: true, description: 'Message content' },
                ]
            },
            // Execution
            {
                action: 'agent.run.chat', description: 'Run agent chat (streaming)', isStream: true, fields: [
                    { name: 'agentId', type: 'string', required: true, description: 'Agent config ID' },
                    { name: 'sessionId', type: 'string', required: true, description: 'Chat session ID' },
                    { name: 'prompt', type: 'string', required: true, description: 'User prompt' },
                ]
            },
            {
                action: 'agent.run.workflow', description: 'Run a workflow (streaming)', isStream: true, fields: [
                    { name: 'workflowId', type: 'string', required: true, description: 'Workflow config ID' },
                    { name: 'input', type: 'string', required: true, description: 'Workflow input' },
                ]
            },
            // Memory
            {
                action: 'agent.memory.add', description: 'Add a memory entry', fields: [
                    { name: 'content', type: 'string', required: true, description: 'Memory content' },
                    { name: 'agentId', type: 'string', required: false, description: 'Agent ID' },
                ]
            },
            { action: 'agent.memory.list', description: 'List memories', fields: [{ name: 'agentId', type: 'string', required: false, description: 'Filter by agent' }] },
            { action: 'agent.memory.search', description: 'Search memories', fields: [{ name: 'query', type: 'string', required: true, description: 'Search query' }] },
            { action: 'agent.memory.delete', description: 'Delete a memory', fields: [{ name: 'id', type: 'string', required: true, description: 'Memory ID' }] },
        ],
    },

    // ── Session ───────────────────────────────────────────────────────────
    {
        topic: 'session',
        label: 'Session',
        description: 'Session management',
        color: '#14b8a6',
        actions: [
            {
                action: 'info',
                description: 'Get current session info',
                fields: [],
            },
            {
                action: 'refresh',
                description: 'Refresh the current session',
                fields: [],
            },
            {
                action: 'list',
                description: 'List all active sessions',
                fields: [],
            },
        ],
    },

    // ── Health ────────────────────────────────────────────────────────────
    {
        topic: 'health',
        label: 'Health',
        description: 'System health checks',
        color: '#22c55e',
        actions: [
            {
                action: 'check',
                description: 'Run a health check',
                fields: [],
            },
        ],
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Look up a topic definition by name. */
export function getTopicDef(topic: string): TopicDef | undefined {
    return SERVICE_REGISTRY.find(t => t.topic === topic);
}

/** Look up an action definition within a topic. */
export function getActionDef(topic: string, action: string): ActionDef | undefined {
    return getTopicDef(topic)?.actions.find(a => a.action === action);
}

/**
 * Build a payload object from form field values.
 * Converts string values to the correct types based on FieldDef metadata.
 */
export function buildPayload(fields: FieldDef[], values: Record<string, string>): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    for (const field of fields) {
        const raw = values[field.name];
        if (raw === undefined || raw === '') continue;

        switch (field.type) {
            case 'string':
            case 'select':
                payload[field.name] = raw;
                break;
            case 'number':
                payload[field.name] = Number(raw);
                break;
            case 'boolean':
                payload[field.name] = raw === 'true';
                break;
            case 'json':
                try { payload[field.name] = JSON.parse(raw); } catch { payload[field.name] = raw; }
                break;
            case 'string[]':
                try {
                    const parsed = JSON.parse(raw);
                    payload[field.name] = Array.isArray(parsed) ? parsed : raw.split(',').map(s => s.trim());
                } catch {
                    payload[field.name] = raw.split(',').map(s => s.trim());
                }
                break;
        }
    }

    return payload;
}
