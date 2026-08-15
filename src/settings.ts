import type {
  AgentDefinition,
  AgentOptions,
  CloudAgentOptions,
  InteractionUpdate,
  LocalAgentOptions,
  McpServerConfig,
  ModelParameterValue,
  Run,
  RunResult,
  SDKAgent,
  SDKCustomTool,
  ToolName,
} from '@cursor/sdk';
import { z } from 'zod';
import type { Logger } from './logger.js';
import type { CursorPromptHistoryMode, CursorSystemMessageMode } from './types.js';

/**
 * Provider-facing local options. `@cursor/sdk` 1.0.24+ types `cwd` as a single
 * string and adds `dirs` for extra workspace roots. Arrays remain accepted here
 * for back-compat and are migrated to `cwd` + `dirs` at the SDK call edge.
 */
export type CursorLocalSettings = Omit<LocalAgentOptions, 'cwd'> & {
  cwd?: string | string[];
};

export interface CursorSettings {
  apiKey?: string;
  agentId?: string;
  agent?: SDKAgent;
  createNewAgentPerCall?: boolean;
  agentName?: string;
  mode?: 'agent' | 'plan';
  tools?: ToolName[];
  disallowedTools?: ToolName[];
  local?: CursorLocalSettings;
  cloud?: CloudAgentOptions;
  customTools?: Record<string, SDKCustomTool>;
  mcpServers?: Record<string, McpServerConfig>;
  agents?: Record<string, AgentDefinition>;
  promptHistoryMode?: CursorPromptHistoryMode;
  systemMessageMode?: CursorSystemMessageMode;
  modelParams?: ModelParameterValue[];
  experimentalPreliminaryToolResults?: boolean;
  sdkAgentOptions?: Partial<Omit<AgentOptions, 'model' | 'apiKey' | 'agentId' | 'idempotencyKey'>>;
  idempotencyKey?: string;
  logger?: Logger | false;
  verbose?: boolean;
  onDeltaEvent?: (update: InteractionUpdate) => void;
  onRunResult?: (result: RunResult) => void;
  onRunCreated?: (run: Run) => void;
}

export interface CursorProviderOptions {
  agentId?: string;
  mode?: 'agent' | 'plan';
  modelParams?: ModelParameterValue[];
  idempotencyKey?: string;
  localForce?: boolean;
}

const loggerSchema = z.custom<Logger>(
  (value) =>
    value !== null &&
    typeof value === 'object' &&
    ['debug', 'info', 'warn', 'error'].every(
      (method) => typeof (value as Record<string, unknown>)[method] === 'function'
    ),
  'logger must implement debug, info, warn, and error methods'
);

const sdkAgentSchema = z.custom<SDKAgent>(
  (value) =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { agentId?: unknown }).agentId === 'string' &&
    typeof (value as { send?: unknown }).send === 'function' &&
    typeof (value as { close?: unknown }).close === 'function',
  'agent must implement the @cursor/sdk SDKAgent interface'
);

const modelParameterSchema = z.object({ id: z.string(), value: z.string() }).strict();

const customToolSchema = z.custom<SDKCustomTool>(
  (value) =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { execute?: unknown }).execute === 'function',
  'custom tool must provide an execute function'
);

const customToolsSchema = z.record(z.string(), customToolSchema);

const mcpServerSchema = z.union([
  z
    .object({
      type: z.literal('stdio').optional(),
      command: z.string(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
      cwd: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.enum(['http', 'sse']).optional(),
      url: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
      auth: z
        .object({
          CLIENT_ID: z.string(),
          CLIENT_SECRET: z.string().optional(),
          scopes: z.array(z.string()).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);

const agentDefinitionSchema = z
  .object({
    description: z.string(),
    prompt: z.string(),
    model: z
      .union([
        z.literal('inherit'),
        z.object({ id: z.string(), params: z.array(modelParameterSchema).optional() }).strict(),
      ])
      .optional(),
    mcpServers: z.array(z.union([z.string(), z.record(z.string(), mcpServerSchema)])).optional(),
  })
  .strict();

const toolNameSchema = z.custom<ToolName>((value) => typeof value === 'string');
const toolNamesSchema = z.array(toolNameSchema);

const localOptionsSchema = z
  .object({
    cwd: z.union([z.string(), z.array(z.string())]).optional(),
    dirs: z.array(z.string()).optional(),
    autoReview: z.boolean().optional(),
    store: z.custom<NonNullable<LocalAgentOptions['store']>>().optional(),
    settingSources: z
      .array(z.enum(['project', 'user', 'team', 'mdm', 'plugins', 'all']))
      .optional(),
    sandboxOptions: z.object({ enabled: z.boolean() }).strict().optional(),
    customTools: customToolsSchema.optional(),
    enableAgentRetries: z.boolean().optional(),
  })
  .strict();

const cloudOptionsSchema = z
  .object({
    env: z
      .object({
        type: z.enum(['cloud', 'pool', 'machine']),
        name: z.string().optional(),
      })
      .strict()
      .optional(),
    repos: z
      .array(
        z
          .object({
            url: z.string(),
            startingRef: z.string().optional(),
            prUrl: z.string().optional(),
          })
          .strict()
      )
      .optional(),
    workOnCurrentBranch: z.boolean().optional(),
    autoCreatePR: z.boolean().optional(),
    openAsCursorGithubApp: z.boolean().optional(),
    skipReviewerRequest: z.boolean().optional(),
    envVars: z.record(z.string(), z.string()).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const managedAgentOptionKeys = ['model', 'apiKey', 'agentId', 'idempotencyKey'] as const;

export const cursorSettingsSchema: z.ZodType<CursorSettings> = z
  .object({
    apiKey: z.string().optional(),
    agentId: z.string().optional(),
    agent: sdkAgentSchema.optional(),
    createNewAgentPerCall: z.boolean().optional(),
    agentName: z.string().optional(),
    mode: z.enum(['agent', 'plan']).optional(),
    tools: toolNamesSchema.optional(),
    disallowedTools: toolNamesSchema.optional(),
    local: localOptionsSchema.optional(),
    cloud: cloudOptionsSchema.optional(),
    customTools: customToolsSchema.optional(),
    mcpServers: z.record(z.string(), mcpServerSchema).optional(),
    agents: z.record(z.string(), agentDefinitionSchema).optional(),
    promptHistoryMode: z.enum(['reject', 'ignore', 'flatten']).optional(),
    systemMessageMode: z.enum(['reject', 'ignore', 'prefix']).optional(),
    modelParams: z.array(modelParameterSchema).optional(),
    experimentalPreliminaryToolResults: z.boolean().optional(),
    sdkAgentOptions: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: z.string().optional(),
    logger: z.union([loggerSchema, z.literal(false)]).optional(),
    verbose: z.boolean().optional(),
    onDeltaEvent: z
      .custom<(update: InteractionUpdate) => void>((value) => typeof value === 'function')
      .optional(),
    onRunResult: z
      .custom<(result: RunResult) => void>((value) => typeof value === 'function')
      .optional(),
    onRunCreated: z.custom<(run: Run) => void>((value) => typeof value === 'function').optional(),
  })
  .strict()
  .superRefine((settings, context) => {
    const identityOptions = [
      settings.agentId !== undefined,
      settings.agent !== undefined,
      settings.createNewAgentPerCall === true,
    ].filter(Boolean).length;
    if (identityOptions > 1) {
      context.addIssue({
        code: 'custom',
        message: 'agentId, agent, and createNewAgentPerCall are mutually exclusive',
      });
    }
    if (settings.agentId !== undefined && settings.agentId.trim().length === 0) {
      context.addIssue({ code: 'custom', path: ['agentId'], message: 'agentId cannot be empty' });
    }
    if (settings.local && settings.cloud) {
      context.addIssue({ code: 'custom', message: 'local and cloud are mutually exclusive' });
    }
    if (settings.cloud && (settings.customTools || settings.local?.customTools)) {
      context.addIssue({
        code: 'custom',
        message: 'customTools are supported only by local Cursor agents',
      });
    }
    if (
      settings.cloud &&
      (settings.tools !== undefined || settings.disallowedTools !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'tools and disallowedTools are supported only by local Cursor agents',
      });
    }
    const sdkAgentOptions = settings.sdkAgentOptions as Record<string, unknown> | undefined;
    for (const key of managedAgentOptionKeys) {
      if (sdkAgentOptions && key in sdkAgentOptions) {
        context.addIssue({
          code: 'custom',
          path: ['sdkAgentOptions', key],
          message: `sdkAgentOptions.${key} is provider-managed and cannot be overridden`,
        });
      }
    }
  });

export const cursorProviderOptionsSchema: z.ZodType<CursorProviderOptions> = z
  .object({
    agentId: z.string().trim().min(1).optional(),
    mode: z.enum(['agent', 'plan']).optional(),
    modelParams: z.array(modelParameterSchema).optional(),
    idempotencyKey: z.string().optional(),
    localForce: z.boolean().optional(),
  })
  .strict();

export function mergeCursorSettings(
  defaults: CursorSettings = {},
  overrides: CursorSettings = {}
): CursorSettings {
  return { ...defaults, ...overrides };
}
