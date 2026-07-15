<p align="center">
  <a href="https://www.npmjs.com/package/ai-sdk-provider-cursor-sdk"><img src="https://img.shields.io/npm/v/ai-sdk-provider-cursor-sdk?color=5B5BD6" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/ai-sdk-provider-cursor-sdk"><img src="https://img.shields.io/npm/dy/ai-sdk-provider-cursor-sdk.svg?color=5B5BD6" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-5B5BD6" alt="License: MIT" /></a>
  <a href="https://nodejs.org/en/about/previous-releases"><img src="https://img.shields.io/badge/node-%3E%3D22.13-5B5BD6" alt="Node.js ≥ 22.13" /></a>
  <a href="https://ai-sdk.dev/"><img src="https://img.shields.io/badge/AI%20SDK-v7-5B5BD6" alt="AI SDK v7" /></a>
  <img src="https://img.shields.io/badge/module-ESM--only-5B5BD6" alt="ESM-only" />
  <img src="https://img.shields.io/badge/TypeScript-ready-5B5BD6" alt="TypeScript ready" />
</p>

# AI SDK Provider for Cursor Agent SDK

`ai-sdk-provider-cursor-sdk` connects the Vercel AI SDK to Cursor through the official
[`@cursor/sdk`](https://www.npmjs.com/package/@cursor/sdk). It is an agent-native adapter:
Cursor runs its own autonomous tool loop against a local workspace or cloud environment, and the
provider exposes text, reasoning, tool activity, usage, sessions, cancellation, and metadata through
AI SDK v7 primitives.

## Version compatibility

| Provider | AI SDK                 | Cursor SDK           | Branch      | npm tag     |
| -------- | ---------------------- | -------------------- | ----------- | ----------- |
| `1.x`    | v7 (`LanguageModelV4`) | `@cursor/sdk@1.0.23` | `main`      | `latest`    |
| `0.x`    | v6 (`LanguageModelV3`) | `@cursor/sdk@1.0.23` | `ai-sdk-v6` | `ai-sdk-v6` |

The `main` branch and `latest` npm tag target AI SDK v7. The `ai-sdk-v6` branch and matching npm
tag remain the maintained AI SDK v6 compatibility line.

AI SDK v7 uses the V4 provider contract: file inputs use tagged `data`, `url`, `reference`, and
`text` variants. Automatic tool choice is a supported no-op; other tool choices warn because Cursor
owns tool selection. Concrete AI SDK reasoning-effort values also warn because Cursor does not expose
that control. Configure Cursor reasoning through `modelParams`.

## Installation

```bash
npm i ai ai-sdk-provider-cursor-sdk zod
```

Node.js 22.13 or newer is required. The package is ESM-only.

## Authentication

Create a user or service-account API key in the
[Cursor dashboard](https://cursor.com/dashboard/api), then set `CURSOR_API_KEY`:

```bash
export CURSOR_API_KEY="your-key"
```

You can instead pass a key in code:

```ts
import { createCursor } from 'ai-sdk-provider-cursor-sdk';

const cursor = createCursor({ apiKey: process.env.MY_CURSOR_KEY });
```

Key precedence is:

1. Model `settings.apiKey`
2. `createCursor({ apiKey })`
3. `CURSOR_API_KEY`

The key is resolved lazily when a model call begins. Constructing a provider or model does not
require a key. This provider supports API-key authentication only; it does not reuse the Cursor
application login for agent authentication and does not provide OAuth login.

## Quick start

### `generateText`

```ts
import { generateText } from 'ai';
import { cursor } from 'ai-sdk-provider-cursor-sdk';

const result = await generateText({
  model: cursor('auto', {
    local: { cwd: process.cwd() },
  }),
  prompt: 'Summarize this repository in three bullets.',
});

console.log(result.text);
await cursor.close();
```

### `streamText`

```ts
import { streamText } from 'ai';
import { cursor } from 'ai-sdk-provider-cursor-sdk';

const result = streamText({
  model: cursor('auto', {
    local: { cwd: process.cwd() },
  }),
  prompt: 'Find the entry point and explain what it does.',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}

await cursor.close();
```

### Reasoning deltas

Reasoning is model-dependent. Select a supported model and parameters from
`Cursor.models.list()`, then observe the standard AI SDK stream:

```ts
const result = streamText({
  model: cursor('composer-2.5', {
    modelParams: [{ id: 'fast', value: 'true' }],
  }),
  prompt: 'Reason briefly, then explain the result.',
});

for await (const part of result.fullStream) {
  if (part.type === 'reasoning-delta') process.stdout.write(part.text);
  if (part.type === 'text-delta') process.stdout.write(part.text);
}
```

## Models

Model IDs are intentionally open-ended. `'auto'` and `'composer-2.5'` are known aliases, but the
available catalog and parameters are account-specific. Discover them with the Cursor SDK:

```ts
import { Cursor } from '@cursor/sdk';

const models = await Cursor.models.list();
console.dir(models, { depth: null });
```

Use `modelParams` for per-model options such as reasoning effort. Do not infer thinking support from
a model-ID suffix.

## Core features

- Token-level text and reasoning streaming
- Inline base64/byte image input and remote HTTP(S) image URLs
- Provider-executed dynamic tool-call and tool-result visibility
- Local and cloud Cursor agents
- Persistent model-scoped agents, explicit resume by `agentId`, and per-call agents
- Usage and response metadata
- AbortSignal and consumer-stream cancellation bridged across agent acquisition, send, and
  `run.cancel()`
- Redacted raw `InteractionUpdate` chunks when requested
- Cursor custom tools, MCP servers, and subagent definitions

## Sessions and multi-turn work

One model instance lazily creates one Cursor agent and reuses it. Send each follow-up as a new,
single-user-turn call; Cursor owns the conversation state:

```ts
const model = cursor('auto', { local: { cwd: process.cwd() } });

await generateText({ model, prompt: 'Remember the number 731.' });
const followUp = await generateText({ model, prompt: 'What number did I give you?' });

console.log(followUp.text);
```

To continue from another model instance or process, capture the terminal metadata and resume it:

```ts
const first = await generateText({
  model: cursor('auto'),
  prompt: 'Create a migration checklist.',
});

const agentId = first.providerMetadata?.cursor?.agentId;
if (typeof agentId !== 'string') throw new Error('Cursor did not return an agent ID');

const second = await generateText({
  model: cursor('auto'),
  prompt: 'Continue with the next item.',
  providerOptions: { cursor: { agentId } },
});
```

Arbitrary AI SDK message history is rejected by default because Cursor sessions are authoritative.
`promptHistoryMode: 'ignore'` sends only the latest user turn; `'flatten'` serializes history into
lossy text. See [Session management](docs/sessions.md).

## Cursor tools

Cursor executes its own built-in, MCP, subagent, and custom tools. `providerExecuted: true` is set
on `tool-input-start` and `tool-call` parts, and every tool part carries `dynamic: true`; observe
them, but do not execute them again:

```ts
const result = streamText({
  model: cursor('auto', { local: { cwd: process.cwd() } }),
  prompt: 'List the TypeScript files and summarize the entry point.',
});

for await (const part of result.fullStream) {
  if (part.type === 'tool-call') console.log('started', part.toolName, part.input);
  if (part.type === 'tool-result') console.log('finished', part.toolName, part.output);
}
```

AI SDK `tools` and non-automatic `toolChoice` values cannot be bridged into Cursor's autonomous loop
and produce unsupported warnings. Configure local `customTools`, `mcpServers`, or `agents` instead.
Tool names and payload shapes are intentionally treated as unstable.

## Cloud agents

Pass `cloud` instead of `local` to run in a Cursor-hosted or self-hosted environment:

```ts
const model = cursor('composer-2.5', {
  cloud: {
    repos: [{ url: 'https://github.com/your-org/your-repo', startingRef: 'main' }],
    autoCreatePR: true,
  },
});
```

Cloud run metadata may include repository branch and PR information under
`providerMetadata.cursor.git`. `local` and `cloud` are mutually exclusive.

## Configuration

`createCursor({ defaultSettings })` provides defaults for every model. Per-model settings win by
top-level key; nested objects are shallow-replaced, not deep-merged.

| Setting                              | Type                                | Default          | Behavior                                                          |
| ------------------------------------ | ----------------------------------- | ---------------- | ----------------------------------------------------------------- |
| `apiKey`                             | `string`                            | `CURSOR_API_KEY` | Per-model key override                                            |
| `agentId`                            | `string`                            | —                | Resume an existing local or cloud agent                           |
| `agent`                              | `SDKAgent`                          | —                | Use a caller-owned agent; never closed by the provider            |
| `createNewAgentPerCall`              | `boolean`                           | `false`          | Create and close a fresh agent for each call                      |
| `agentName`                          | `string`                            | SDK-generated    | Dashboard-visible name                                            |
| `mode`                               | `'agent' \| 'plan'`                 | `'agent'`        | New-agent mode; omitted sends preserve an existing agent's mode   |
| `local`                              | `LocalAgentOptions`                 | `{}`             | Local runtime options; selected explicitly when `cloud` is absent |
| `cloud`                              | `CloudAgentOptions`                 | —                | Cloud runtime options                                             |
| `customTools`                        | `Record<string, SDKCustomTool>`     | —                | Shorthand for local custom tools                                  |
| `mcpServers`                         | `Record<string, McpServerConfig>`   | —                | Creation/resume-time inline MCP servers                           |
| `agents`                             | `Record<string, AgentDefinition>`   | —                | Inline Cursor subagents                                           |
| `promptHistoryMode`                  | `'reject' \| 'ignore' \| 'flatten'` | `'reject'`       | Arbitrary-history policy                                          |
| `systemMessageMode`                  | `'reject' \| 'ignore' \| 'prefix'`  | `'reject'`       | System-message policy                                             |
| `modelParams`                        | `{ id: string; value: string }[]`   | —                | Cursor model parameters                                           |
| `experimentalPreliminaryToolResults` | `boolean`                           | `false`          | Opt in to early, snapshot-based tool visibility                   |
| `sdkAgentOptions`                    | `Partial<AgentOptions>`             | —                | Creation/resume escape hatch; managed keys are rejected           |
| `idempotencyKey`                     | `string`                            | —                | Default send-level idempotency key                                |
| `logger`                             | `Logger \| false`                   | console-backed   | Model diagnostics or disabled logging                             |
| `verbose`                            | `boolean`                           | `false`          | Enable debug/info diagnostics                                     |
| `onDeltaEvent`                       | callback                            | —                | Observe each raw Cursor delta before normalization                |
| `onRunCreated`                       | callback                            | —                | Receive the live `Run` handle                                     |
| `onRunResult`                        | callback                            | —                | Receive the terminal `RunResult`                                  |

The `sdkAgentOptions` keys `model`, `apiKey`, `agentId`, and creation-time `idempotencyKey` are
provider-managed and rejected. See the full [configuration reference](docs/configuration.md).

### Call-level `providerOptions.cursor`

```ts
const result = await generateText({
  model: cursor('auto'),
  prompt: 'Continue the plan.',
  providerOptions: {
    cursor: {
      agentId,
      mode: 'plan',
      modelParams: [{ id: 'fast', value: 'true' }],
      idempotencyKey: crypto.randomUUID(),
      localForce: false,
    },
  },
});
```

| Option           | Behavior                                              |
| ---------------- | ----------------------------------------------------- |
| `agentId`        | Resume target for this call; overrides model settings |
| `mode`           | Per-call `'agent'`/`'plan'` override                  |
| `modelParams`    | Per-call model parameter override                     |
| `idempotencyKey` | Per-call `SendOptions.idempotencyKey`                 |
| `localForce`     | Local-only recovery for a stuck persisted run         |

Unknown keys are rejected before an SDK call starts.

## Structured output

Cursor does not expose native schema-constrained output through this SDK. AI SDK JSON/object output
requests are treated as plain text and receive an `unsupported` warning. You can prompt for JSON and
let the AI SDK parse and validate it, but generation is not constrained and can still fail validation:

```ts
import { generateText, Output } from 'ai';
import { z } from 'zod';

const result = await generateText({
  model: cursor('auto'),
  output: Output.object({ schema: z.object({ summary: z.string() }) }),
  prompt: 'Return only JSON with a summary string.',
});

console.log(result.output);
```

## Limitations

- System-role semantics are unavailable; `prefix` and `ignore` are explicit lossy policies.
- Arbitrary role history cannot be imported natively; use Cursor sessions.
- AI SDK application-executed tools and tool choice cannot be bridged.
- Sampling controls, stop sequences, seeds, and maximum output-token caps are ignored with warnings.
- Structured output is not guaranteed.
- Cursor exposes run status rather than detailed model stop reasons.
- No source, generated-file, embedding, image-generation, speech, transcription, reranking, files, or skills provider surface.
- Node.js 22.13+ only; no browser or Edge runtime.

See [Known limitations](docs/LIMITATIONS.md), the complete
[AI SDK v7/v6 gap analysis](docs/GAP_ANALYSIS.md), and the
[live-key assumptions register](docs/ASSUMPTIONS.md).

## Errors and diagnostics

SDK failures are mapped to AI SDK errors while preserving Cursor codes, status, request IDs, and
operation details in `APICallError.data`, whose public shape is exported as `CursorErrorMetadata`.
The package also exports helpers for common recovery paths:

```ts
import {
  isAgentBusyError,
  isAuthenticationError,
  isStaleAgentError,
} from 'ai-sdk-provider-cursor-sdk';

try {
  await generateText({ model: cursor('auto'), prompt: 'Review the repository.' });
} catch (error) {
  if (isAuthenticationError(error)) console.error('Check CURSOR_API_KEY');
  else if (isStaleAgentError(error)) console.error('Start a new session');
  else if (isAgentBusyError(error)) console.error('Wait for the active cloud run');
  else throw error;
}
```

See [Troubleshooting](docs/troubleshooting.md).

Advanced consumers can import the concrete `CursorLanguageModel` class and the generation-neutral
`NormalizedEvent` type. Most applications should construct models through `createCursor` or
`cursor` and consume standard AI SDK stream parts instead.

## Provider metadata

Terminal metadata is returned under the `cursor` namespace:

```ts
interface CursorProviderMetadata {
  agentId: string;
  runId: string;
  requestId?: string;
  model?: string;
  modelParams?: Array<{ id: string; value: string }>;
  status: 'finished' | 'error' | 'cancelled';
  durationMs?: number;
  result?: string;
  usage?: TokenUsage;
  git?: { branches: Array<{ repoUrl: string; branch?: string; prUrl?: string }> };
}
```

With `generateText`, read it from `result.providerMetadata?.cursor`. With `streamText`, read it from
`(await result.providerMetadata)?.cursor` after the stream settles.

## Runtime and Zod requirements

`@cursor/sdk` requires Node.js 22.13 or newer and ships platform-specific helper binaries. This
provider is ESM-only and does not support Edge or browser runtimes. Local agents persist state on
disk by default; use Cursor's `JsonlLocalAgentStore`, a custom local store, or cloud mode when the
default local store is unsuitable.

The `1.x` line requires Zod `^4.1.8`. Cursor's internal Zod dependency is separate; schemas are not
shared between the packages.

## Documentation

- [Configuration reference](docs/configuration.md)
- [Session management](docs/sessions.md)
- [Known limitations](docs/LIMITATIONS.md)
- [AI SDK v7/v6 gap analysis](docs/GAP_ANALYSIS.md)
- [Live-key assumptions](docs/ASSUMPTIONS.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Runnable examples](examples/README.md)
- [Official Cursor TypeScript SDK docs](https://cursor.com/docs/sdk/typescript)
- [Vercel AI SDK docs](https://ai-sdk.dev/docs)

## Disclaimer

This is an unofficial community provider. It is not affiliated with or endorsed by Cursor or
Vercel. Cursor agent runs can read and modify files, execute commands, and access configured tools;
scope credentials and runtime permissions appropriately.

## Contributing

```bash
npm install
npm run validate
npm run smoke:consumer
```

Live tests are opt-in and require both `CURSOR_INTEGRATION=1` and `CURSOR_API_KEY`:

```bash
CURSOR_API_KEY=... npm run test:integration
```

## License

MIT © Ben Vargas. See [LICENSE](LICENSE).
