# Configuration reference

The provider has three configuration layers:

1. Provider defaults in `createCursor({ defaultSettings })`
2. Per-model `CursorSettings` in `cursor(modelId, settings)`
3. Per-call `providerOptions.cursor`

Later layers win. Provider defaults and model settings are merged shallowly by top-level key, so a
model-level `local`, `cloud`, `mcpServers`, `customTools`, or `agents` value replaces the whole
provider-default value for that key.

```ts
import { createCursor } from 'ai-sdk-provider-cursor-sdk';

const cursor = createCursor({
  apiKey: process.env.CURSOR_API_KEY,
  defaultSettings: {
    mode: 'plan',
    local: { cwd: process.cwd(), sandboxOptions: { enabled: true } },
  },
  logger: false,
});

const model = cursor('auto', {
  // Replaces the entire default local object; it does not preserve sandboxOptions.
  local: { cwd: '/another/workspace' },
});
```

Settings and call options use strict Zod schemas. Unknown keys and invalid combinations reject
before Cursor is invoked.

## Provider factory

```ts
createCursor(options?: CursorProviderSettings): CursorProvider
```

| Option            | Type              | Behavior                                                                                                        |
| ----------------- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `apiKey`          | `string`          | Provider-wide key. A model-level `settings.apiKey` wins; otherwise the provider falls back to `CURSOR_API_KEY`. |
| `defaultSettings` | `CursorSettings`  | Shallow defaults for every model constructed by this provider.                                                  |
| `logger`          | `Logger \| false` | Provider lifecycle diagnostics. `false` disables them.                                                          |

The exported `cursor` value is `createCursor()` with no explicit options. Both providers are callable
and also expose `languageModel()` and the `chat()` alias. Call `close()` or `dispose()` to release
provider-owned Cursor agents.

## `CursorSettings`

### Authentication

#### `apiKey?: string`

Per-model API key. Precedence is model setting, provider factory option, then `CURSOR_API_KEY`.
Resolution is lazy at call time. If all are absent, `loadApiKey` throws `LoadAPIKeyError` before any
Cursor agent is created or resumed.

### Agent identity and lifecycle

#### `agentId?: string`

Resume a durable agent. Cursor routes IDs beginning with `bc-` to cloud and other IDs to the local
store. Empty or whitespace-only IDs fail validation.

#### `agent?: SDKAgent`

Inject a pre-built agent. It remains caller-owned and is never closed by the provider. The object is
validated for `agentId`, `send()`, and `close()`.

#### `createNewAgentPerCall?: boolean`

When `true`, each call creates a fresh agent and closes it after the call settles. Default `false`:
one provider-owned agent is lazily created and cached per model instance.

`agentId`, `agent`, and `createNewAgentPerCall: true` are mutually exclusive.

#### `agentName?: string`

Passed as `AgentOptions.name` when creating an agent. Cursor generates/falls back to a name when it
is omitted.

#### `mode?: 'agent' | 'plan'`

Cursor conversation mode. Newly created agents default to `'agent'`. A call-level `mode` wins; when
neither tier configures a mode, sends omit the override so reused and resumed agents preserve their
current mode.

### Runtime

#### `local?: LocalAgentOptions`

Local runtime options:

| Field                | Type                                                               | Notes                                                                |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `cwd`                | `string \| string[]`                                               | Workspace path(s). Cursor defaults to its SDK behavior when omitted. |
| `autoReview`         | `boolean`                                                          | Opt into Cursor's local classifier-backed Auto-review behavior.      |
| `store`              | `LocalAgentStore`                                                  | Custom persistence backend.                                          |
| `settingSources`     | `('project' \| 'user' \| 'team' \| 'mdm' \| 'plugins' \| 'all')[]` | Ambient Cursor settings layers.                                      |
| `sandboxOptions`     | `{ enabled: boolean }`                                             | Enable Cursor's local sandbox.                                       |
| `customTools`        | `Record<string, SDKCustomTool>`                                    | Local in-process tools registered through Cursor.                    |
| `enableAgentRetries` | `boolean`                                                          | Cursor transport/stall retry policy.                                 |

When both `local` and `cloud` are absent, the provider explicitly creates with `local: {}` rather
than relying on undocumented omit-both behavior.

`settings.local` is applied when creating an agent. On explicit `agentId` resume, the implementation
passes auth, MCP servers, subagents, and `sdkAgentOptions`; provide advanced resume-only local routing
such as a custom store through `sdkAgentOptions.local`.

#### `cloud?: CloudAgentOptions`

Cloud runtime options:

| Field                 | Type                                                      | Notes                                                     |
| --------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `env`                 | `{ type: 'cloud' \| 'pool' \| 'machine'; name?: string }` | Cursor-hosted, self-hosted pool, or named machine target. |
| `repos`               | `{ url: string; startingRef?: string; prUrl?: string }[]` | Repositories/refs for the VM.                             |
| `workOnCurrentBranch` | `boolean`                                                 | Work on the existing branch.                              |
| `autoCreatePR`        | `boolean`                                                 | Ask Cursor to open a PR after the run.                    |
| `skipReviewerRequest` | `boolean`                                                 | Do not request the caller as reviewer.                    |
| `envVars`             | `Record<string, string>`                                  | Agent-scoped cloud environment variables.                 |

`local` and `cloud` are mutually exclusive. Local custom tools combined with `cloud` fail validation.

### Cursor tools and configuration

#### `customTools?: Record<string, SDKCustomTool>`

Shorthand that becomes `local.customTools` during agent creation:

```ts
const model = cursor('auto', {
  local: { cwd: process.cwd() },
  customTools: {
    deployment_status: {
      description: 'Return deployment status for a service.',
      inputSchema: {
        type: 'object',
        properties: { service: { type: 'string' } },
        required: ['service'],
      },
      async execute(args) {
        const service = String(args.service ?? 'unknown');
        return { service, status: 'healthy' };
      },
    },
  },
});
```

Only the presence of `execute()` is runtime-validated by this provider; Cursor validates and uses the
tool's schema/result contract. Custom tools are local only.

#### `mcpServers?: Record<string, McpServerConfig>`

Inline stdio, HTTP, or SSE servers:

```ts
const model = cursor('auto', {
  mcpServers: {
    localDocs: {
      type: 'stdio',
      command: 'node',
      args: ['./mcp-server.mjs'],
      cwd: process.cwd(),
      env: { MODE: 'read-only' },
    },
    remoteDocs: {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: `Bearer ${process.env.MCP_TOKEN}` },
      auth: {
        CLIENT_ID: 'cursor-provider',
        CLIENT_SECRET: process.env.MCP_CLIENT_SECRET,
        scopes: ['docs:read'],
      },
    },
  },
});
```

For HTTP/SSE servers, `auth.CLIENT_ID` is required when `auth` is present;
`auth.CLIENT_SECRET` and `auth.scopes` are optional. The object is strictly validated, so unknown
authentication keys are rejected before Cursor is called.

The provider uses the creation/resume channel. Cursor's per-send `mcpServers` option fully replaces
creation-time servers, so it is deliberately not exposed through `providerOptions.cursor`.

#### `agents?: Record<string, AgentDefinition>`

Inline Cursor subagents. Each definition requires `description` and `prompt`, and can include a
model selection or `'inherit'` plus referenced/inline MCP servers.

```ts
const model = cursor('auto', {
  agents: {
    reviewer: {
      description: 'Review changes for concrete defects.',
      prompt: 'Inspect the diff and report only reproducible issues.',
      model: 'inherit',
    },
  },
});
```

### Prompt policies

#### `promptHistoryMode?: 'reject' | 'ignore' | 'flatten'`

Default `'reject'`.

- `reject`: throws when assistant/tool messages or multiple user turns are present.
- `ignore`: sends only the latest user turn and emits an `other` warning.
- `flatten`: serializes supported roles and tool data into one user text and emits compatibility or
  unsupported warnings for lossy parts.

This setting does not change automatically for resumed/reused agents.

#### `systemMessageMode?: 'reject' | 'ignore' | 'prefix'`

Default `'reject'` for non-empty system messages.

- `reject`: throws `UnsupportedFunctionalityError`.
- `ignore`: drops system text with an unsupported warning.
- `prefix`: prepends `<system>...</system>` to user text with a compatibility warning.

`prefix` is text emulation and does not preserve system-role authority.

### Model and stream behavior

#### `modelParams?: ModelParameterValue[]`

Cursor model parameters as `{ id, value }` strings. Discover valid values with
`Cursor.models.list()`. The provider sets them on agent creation and reasserts the requested model
and parameters on every send.

#### `experimentalPreliminaryToolResults?: boolean`

Default `false`. When enabled, the provider emits a tool call from the start-time argument snapshot,
then emits correlatable partial tool snapshots/shell output as preliminary tool results. Final tool
results replace preliminary results in non-streaming reduction. Snapshot payloads are unstable and
may not contain final arguments.

### Agent option escape hatch

#### `sdkAgentOptions?: Partial<Omit<AgentOptions, 'model' | 'apiKey' | 'agentId' | 'idempotencyKey'>>`

Merged last into `Agent.create()` or `Agent.resume()` options. The provider rejects these managed
keys:

- `model`
- `apiKey`
- `agentId`
- creation-time `idempotencyKey`

The exposed `settings.idempotencyKey` is a send-level key; it is deliberately separate from Cursor's
cloud-only creation-time key.

#### `idempotencyKey?: string`

Default `SendOptions.idempotencyKey`; a per-call key wins.

### Diagnostics and callbacks

#### `logger?: Logger | false`

Model-level diagnostic logger. It must implement `debug`, `info`, `warn`, and `error`. `false`
disables it. Without `verbose`, custom/default loggers emit warn/error only for model diagnostics.

#### `verbose?: boolean`

Enables debug/info diagnostic methods for that model. Default `false`.

#### `onDeltaEvent?: (update: InteractionUpdate) => void`

Called synchronously for every Cursor update before queueing/normalization. Use for observation; the
typed AI SDK stream remains the stable consumer surface.

#### `onRunCreated?: (run: Run) => void`

Called once `agent.send()` resolves with a live run. Useful for advanced observation/cancellation.

#### `onRunResult?: (result: RunResult) => void`

Called after `run.wait()` and delta draining, before terminal AI SDK emission.

## `providerOptions.cursor`

Call-level keys are strict and override model/provider defaults where they overlap.

| Key              | Type                              | Behavior                                                     |
| ---------------- | --------------------------------- | ------------------------------------------------------------ |
| `agentId`        | `string`                          | Resume target for this call. Non-empty after trimming.       |
| `mode`           | `'agent' \| 'plan'`               | Per-send mode.                                               |
| `modelParams`    | `{ id: string; value: string }[]` | Per-send model parameters.                                   |
| `idempotencyKey` | `string`                          | Per-send idempotency key.                                    |
| `localForce`     | `boolean`                         | Sends `local: { force: true }` for local stuck-run recovery. |

```ts
const result = await generateText({
  model,
  prompt: 'Continue.',
  providerOptions: {
    cursor: {
      agentId,
      mode: 'agent',
      modelParams: [{ id: 'fast', value: 'true' }],
      idempotencyKey: crypto.randomUUID(),
    },
  },
});
```

Message- and content-part-level provider options are not interpreted.

## Settings combinations rejected before a call

- More than one of `agentId`, `agent`, and `createNewAgentPerCall: true`
- Both `local` and `cloud`
- `cloud` with `customTools` or `local.customTools`
- Blank `agentId`
- Managed keys inside `sdkAgentOptions`
- Unknown keys or invalid nested shapes

See [sessions.md](sessions.md) for lifecycle behavior and [troubleshooting.md](troubleshooting.md)
for common validation/runtime failures.
