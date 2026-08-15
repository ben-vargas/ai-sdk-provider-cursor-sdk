# Troubleshooting

## Missing or invalid API key

Symptoms:

- `LoadAPIKeyError` before any Cursor SDK operation
- Runtime `APICallError` with status 401 or an authentication code
- `isAuthenticationError(error) === true`

Resolution:

1. Create/rotate a user or service-account key at <https://cursor.com/dashboard/api>.
2. Export `CURSOR_API_KEY`, or pass `createCursor({ apiKey })` / model `settings.apiKey`.
3. Confirm no empty model-level key is overriding a working provider key.

The provider does not reuse the Cursor application's agent login.

## Node or module-loading errors

Requirements:

- Node.js `>=22.13`
- ESM consumer (`"type": "module"` or equivalent ESM import)
- A platform supported by `@cursor/sdk` helper packages

Check:

```bash
node --version
npm run build
npm run smoke:consumer
```

The package does not support browsers or Edge runtimes.

## Local store or `node:sqlite` problems

Local Cursor agents persist checkpoints and run state. If the default store is unsuitable for the
host (ephemeral filesystem, missing platform support, container lifecycle), use Cursor's
`JsonlLocalAgentStore`, a custom `LocalAgentStore`, or cloud mode.

```ts
import { JsonlLocalAgentStore } from '@cursor/sdk';

const model = cursor('auto', {
  local: {
    cwd: process.cwd(),
    store: new JsonlLocalAgentStore('/var/lib/cursor-agents'),
  },
});
```

To resume from another process, use the same store and compatible workspace routing. For the
provider's explicit resume path, advanced local resume options can be passed through
`sdkAgentOptions.local` or set process-wide with `Cursor.configure()`.

## Agent not found / stale session

`AgentNotFoundError` becomes a non-retryable `APICallError` with
`data.code === 'agent_not_found'`. Common causes:

- the agent was deleted or expired;
- a local ID is being looked up in a different store or workspace;
- an ID came from another machine;
- a cloud agent is not visible to the current key/team.

Use `isStaleAgentError(error)`. Correct the routing or clear the saved ID and start a new agent.

## Cloud `agent_busy` / 409

Calls made through one provider are serialized per agent, but another process or external Cursor
client can still own an active cloud run. `isAgentBusyError(error)` detects the mapped failure.

Wait for/cancel the active run before retrying. Immediate retries are not useful because Cursor marks
this conflict non-retryable until the run becomes terminal.

## Wedged local run after a crash

Cursor documents `local.force` as the recovery path when a crashed process leaves a persisted local
run active. Set it for one call:

```ts
const result = await generateText({
  model,
  prompt: 'Resume after the interrupted run.',
  providerOptions: {
    cursor: { agentId, localForce: true },
  },
});
```

This forwards `send({ local: { force: true } })`, expiring the stuck run before the new send. It is
local-only and should not be enabled on every call.

## Prompt history or system-message rejection

Defaults are deliberately strict:

- arbitrary history → `promptHistoryMode: 'reject'`
- non-empty system text → `systemMessageMode: 'reject'`

For session continuation, send only the newest user turn to the same model/agent ID. If an external
transcript must be imported, explicitly choose `ignore` or `flatten` and handle the emitted warning.
For system text, `prefix` is a lossy user-text convention, not real system authority.

## AI SDK tools are ignored

Cursor executes its own tool loop. A non-empty AI SDK `tools` list produces an unsupported warning,
and non-automatic `toolChoice` is ignored. Configure Cursor `customTools` (local only),
`mcpServers`, or `agents`, then observe `providerExecuted` dynamic tool parts.

## Structured output warning or parse failure

`responseFormat: { type: 'json' }` always receives an unsupported warning. Cursor does not perform
schema-constrained decoding through this SDK. Prompting for JSON may work, but parsing/validation can
fail. Catch the AI SDK parse/validation error or use a repair/retry strategy appropriate to your
application.

## Missing usage

Cursor usage is optional. When terminal usage is absent, the provider falls back to complete
turn-ended usage records. If neither source is present, every AI SDK usage field remains undefined;
zero is not fabricated. Cancelled or failed runs may have no usage.

## Cancellation does not stop side effects immediately

The provider preserves the original abort reason and calls `run.cancel()` once a run handle exists.
Cancellation is best effort: an SDK cancel failure is logged and swallowed, and a tool already in
flight may have performed work. Treat abort as lifecycle control, not a transaction rollback.

## Unknown-event or consistency error

Unknown optional events are preserved as redacted raw data and produce a compatibility warning.
Unknown events whose names suggest tools, permissions, usage, completion, or results fail closed as a
retryable protocol-consistency `APICallError`. This usually indicates drift in `@cursor/sdk`.

Actions:

1. Record `error.data`, especially code, request ID, operation, and prompt excerpt.
2. Reproduce against the pinned `@cursor/sdk@1.0.28`.
3. Inspect the weekly canary against `@cursor/sdk@latest`.
4. Update event handling and its compile-time drift guard before bumping the pin.

## Validation errors

Settings and `providerOptions.cursor` are strict. Frequent causes:

- both `local` and `cloud`;
- more than one agent identity mode;
- cloud plus local custom tools;
- blank `agentId`;
- `model`, `apiKey`, `agentId`, or creation-time `idempotencyKey` inside
  `sdkAgentOptions`;
- an unknown nested key.

The thrown message contains the failing path(s). See [configuration.md](configuration.md).

## Safe diagnostics

Use `logger`, `verbose`, and callbacks for observation. Raw Cursor updates are recursively redacted
before typed/raw emission, but avoid logging secrets or treating redaction as a complete DLP system.

```ts
const provider = createCursor({
  logger: console,
  defaultSettings: {
    verbose: true,
    onRunCreated: (run) => console.error('run', run.id, run.requestId),
  },
});
```

See [ASSUMPTIONS.md](ASSUMPTIONS.md) for behaviors that still require live-key validation.
