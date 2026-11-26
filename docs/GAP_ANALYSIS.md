# AI SDK v7/v6 gap analysis

This document compares the union of AI SDK v7 (`LanguageModelV4` / `ProviderV4`) and AI SDK v6
(`LanguageModelV3` / `ProviderV3`) with the public surface of `@cursor/sdk@1.5.0`, the version
pinned on `main`. The `ai-sdk-v6` branch still pins `1.4.0`, so the
[1.4.1 – 1.5.0 section](#cursor-sdk-141--150) does not apply there. It describes the AI SDK v7
behavior implemented on `main`; rows that differ for the `ai-sdk-v6` branch are marked.

This document defaults to the v7 `main` behavior. On the `ai-sdk-v6` branch, v7-only rows do not
apply; where a row distinguishes versions, the v6 behavior is authoritative. Named Cursor SDK
versions older than the pin appear only where a row is historical, such as back-compat with a
setting shape that an earlier `@cursor/sdk` accepted.

## Classification

- **SUPPORTED** — faithfully mapped to a public Cursor SDK capability.
- **EMULATED** — approximated with different semantics, normally with a compatibility or other
  warning.
- **UNSUPPORTED-WARN** — accepted but ignored or omitted with a call warning.
- **UNSUPPORTED-ERROR** — rejected, generally with `UnsupportedFunctionalityError` or
  `NoSuchModelError`.

Some optional surfaces are silent no-ops or absent because the authoritative design calls for
omission rather than a warning: message/part-level `providerOptions`, tool approval responses inside
explicitly flattened history, output part types that Cursor never emits, and optional provider
methods. They are labeled **UNSUPPORTED (silent)** or **UNSUPPORTED (omitted)** instead of pretending
that a warning or typed error exists.

## Prompt and inputs

| AI SDK feature                                  | Classification                                                                                       | Implemented behavior                                                                                                                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System role                                     | **UNSUPPORTED-ERROR** by default; **EMULATED** with `'prefix'`; **UNSUPPORTED-WARN** with `'ignore'` | AI SDK system messages are not automatically mapped to the local-only, access-gated Cursor harness replacement; configure `settings.systemPrompt` explicitly. `systemMessageMode` controls rejection, lossy XML-like text prefixing, or omission. |
| User text                                       | **SUPPORTED**                                                                                        | Joined into `SDKUserMessage.text`.                                                                                                                                                                                                                |
| User image with inline data                     | **SUPPORTED**                                                                                        | `Uint8Array`, base64 string, or base64 data URL becomes `SDKImage { data, mimeType }`.                                                                                                                                                            |
| User image URL                                  | **SUPPORTED**                                                                                        | HTTP(S) URL becomes `SDKImage { url }`; advertised through `supportedUrls['image/*']`. V7 uses tagged URL data; v6 uses `URL`.                                                                                                                    |
| User image provider reference (v7 only)         | **UNSUPPORTED-WARN**                                                                                 | Dropped with feature `prompt.user.file.reference`.                                                                                                                                                                                                |
| User image backed by tagged text data (v7 only) | **UNSUPPORTED-WARN**                                                                                 | Dropped with feature `prompt.user.file.text`.                                                                                                                                                                                                     |
| Non-image user file                             | **UNSUPPORTED-WARN**                                                                                 | Dropped; Cursor's structured user message accepts images, not arbitrary files.                                                                                                                                                                    |
| One effective user turn                         | **SUPPORTED**                                                                                        | Converted directly.                                                                                                                                                                                                                               |
| Arbitrary multi-turn history                    | **UNSUPPORTED-ERROR** by default; **EMULATED** with `'ignore'` or `'flatten'`                        | Cursor holds native history in an agent session. Ignore sends only the newest user turn; flatten serializes roles and tool data into text.                                                                                                        |
| Earlier image in flattened history              | **EMULATED**                                                                                         | Replaced with `[image omitted]`; only images in the latest user turn are attached.                                                                                                                                                                |
| Assistant reasoning in flattened history        | **UNSUPPORTED-WARN**                                                                                 | Omitted with feature `prompt.assistant.reasoning`.                                                                                                                                                                                                |
| Assistant reasoning-file (v7 only)              | **UNSUPPORTED-WARN**                                                                                 | Omitted with feature `prompt.assistant.reasoning-file`.                                                                                                                                                                                           |
| Assistant custom content (v7 only)              | **UNSUPPORTED-WARN**                                                                                 | Omitted with feature `prompt.assistant.custom`.                                                                                                                                                                                                   |
| Assistant file in flattened history             | **UNSUPPORTED-WARN**                                                                                 | Omitted with feature `prompt.assistant.file`. This row reflects the actual converter in addition to the original spec table.                                                                                                                      |
| Tool approval response in history               | **UNSUPPORTED-ERROR** under the default history policy; **UNSUPPORTED (silent)** in flatten mode     | Cursor's approval/request surface is not connected to the AI SDK approval protocol. Flattening drops the control-plane part.                                                                                                                      |
| Message/part-level `providerOptions`            | **UNSUPPORTED (silent)**                                                                             | Only call-level `providerOptions.cursor` is parsed.                                                                                                                                                                                               |
| Empty prompt / no user text or image            | **UNSUPPORTED-ERROR**                                                                                | `UnsupportedFunctionalityError` with functionality `prompt.empty`.                                                                                                                                                                                |

## Tools

| AI SDK feature                                      | Classification                                                                     | Implemented behavior                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application-executed function tools                 | **UNSUPPORTED-WARN**                                                               | Cursor owns an autonomous tool loop; AI SDK tools cannot be registered or answered through this adapter.                                                                                                                                                                                          |
| AI SDK provider-defined tools                       | **UNSUPPORTED-WARN**                                                               | Same warning path as function tools.                                                                                                                                                                                                                                                              |
| `toolChoice: 'auto'`                                | **SUPPORTED** no-op on v7                                                          | Automatic selection is Cursor's only mode. AI SDK v7 injects `auto`, so no warning is emitted. The v6 compatibility branch warns for an explicitly supplied `auto`.                                                                                                                               |
| `toolChoice: 'none'`, `'required'`, or a named tool | **UNSUPPORTED-WARN**                                                               | Ignored with feature `toolChoice`.                                                                                                                                                                                                                                                                |
| Cursor built-in/MCP/custom/subagent tool visibility | **SUPPORTED**                                                                      | Emits dynamic `tool-input-start/delta/end`, `tool-call`, and `tool-result` parts. `providerExecuted: true` is set on `tool-input-start` and `tool-call`, where V4 defines it. Inputs/results are redacted.                                                                                        |
| Tool input incremental deltas                       | **EMULATED**                                                                       | Default: one JSON delta from the completed input snapshot. Experimental mode emits one snapshot at tool start. `partial-tool-call` is not treated as a true delta.                                                                                                                                |
| Preliminary tool results                            | **EMULATED**, opt-in                                                               | `experimentalPreliminaryToolResults` surfaces correlated partial tool snapshots and uniquely correlatable shell output as replaceable preliminary results. Uncorrelated or late partial snapshots are dropped with one compatibility warning.                                                     |
| AI SDK tool approval request/response flow          | **UNSUPPORTED-ERROR** for a default history prompt; no approval request is emitted | Cursor's on-delta channel has no stable approval event. Unknown permission-shaped updates fail closed as protocol drift.                                                                                                                                                                          |
| Local Cursor custom tools                           | **SUPPORTED**                                                                      | `settings.customTools` / `settings.local.customTools` are passed at local agent creation. For advanced resume-time local options, use `sdkAgentOptions.local`.                                                                                                                                    |
| Inline MCP servers                                  | **SUPPORTED** at agent create/resume                                               | `settings.mcpServers` is re-passed on resume because Cursor does not persist inline definitions. Per-send replacement is intentionally not exposed.                                                                                                                                               |
| Cursor subagents                                    | **SUPPORTED**                                                                      | `settings.agents` is passed at agent create/resume.                                                                                                                                                                                                                                               |
| Cursor tool allow/deny lists                        | **SUPPORTED**, local only                                                          | `settings.tools` / `settings.disallowedTools` are passed at agent create and re-passed on resume. Combining either with `cloud` is rejected by settings validation.                                                                                                                               |
| Nested subagent activity                            | **SUPPORTED**                                                                      | A `tool-call-delta` update is recursed through the same normalizer, so nested subagent text and tool lifecycle surface as ordinary parts. A nested update without `modelCallId` inherits the parent's; deeper `tool-call-delta` nesting is dropped, matching the SDK's own convert-time behavior. |

Cursor tool names, argument objects, and results are documented as unstable. The provider therefore
marks all tool parts `dynamic: true` and exposes raw values only after credential redaction.

## Generation controls

| AI SDK feature                               | Classification                           | Implemented behavior                                                                                                                                        |
| -------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temperature`                                | **UNSUPPORTED-WARN**                     | Ignored.                                                                                                                                                    |
| `topP`                                       | **UNSUPPORTED-WARN**                     | Ignored.                                                                                                                                                    |
| `topK`                                       | **UNSUPPORTED-WARN**                     | Ignored.                                                                                                                                                    |
| `presencePenalty`                            | **UNSUPPORTED-WARN**                     | Ignored.                                                                                                                                                    |
| `frequencyPenalty`                           | **UNSUPPORTED-WARN**                     | Ignored.                                                                                                                                                    |
| `seed`                                       | **UNSUPPORTED-WARN**                     | Ignored.                                                                                                                                                    |
| Non-empty `stopSequences`                    | **UNSUPPORTED-WARN**                     | Ignored. An empty array does not warn.                                                                                                                      |
| `maxOutputTokens`                            | **UNSUPPORTED-WARN**                     | Cursor accepts no output-token cap through this SDK.                                                                                                        |
| Text response format                         | **SUPPORTED**                            | Normal text generation.                                                                                                                                     |
| JSON response format, with or without schema | **UNSUPPORTED-WARN**                     | Treated as plain text and left to client parsing/validation; no constrained-decoding guarantee.                                                             |
| AI SDK reasoning effort (v7 only)            | **UNSUPPORTED-WARN** for concrete values | `undefined` and `'provider-default'` do not warn. Select Cursor model parameters/variants instead.                                                          |
| Cursor model selection                       | **SUPPORTED**                            | Open string ID plus `modelParams`; reasserted on every send because Cursor model overrides are sticky and resumed handles may not report a model.           |
| Caller-supplied headers                      | **UNSUPPORTED-WARN** (`other` warning)   | Cursor owns its transport. AI SDK's injected `user-agent: ai/<version>` is filtered and does not warn.                                                      |
| `AbortSignal`                                | **SUPPORTED**                            | Agent acquisition and send waits are abort-raced and preserve the original reason; late call-scoped agents are released and late run handles are cancelled. |
| `includeRawChunks`                           | **SUPPORTED**                            | Redacted `InteractionUpdate` values become raw stream parts. Standard AI SDK v7 callers request them with `include: { rawChunks: true }`.                   |
| Call-level Cursor overrides                  | **SUPPORTED**                            | Strict `providerOptions.cursor` parsing for `agentId`, `mode`, `modelParams`, `idempotencyKey`, and `localForce`.                                           |

## Outputs

| AI SDK feature                             | Classification           | Implemented behavior                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text start/delta/end                       | **SUPPORTED**            | Token-level `text-delta` updates are canonical. If a finished run has terminal text but no text deltas, the provider uses that terminal text as an **EMULATED** fallback with a compatibility warning. |
| Reasoning start/delta/end                  | **SUPPORTED**            | `thinking-delta` and `thinking-completed`; availability is model-dependent.                                                                                                                            |
| Provider-executed tool calls/results       | **SUPPORTED**            | See Tools. A final result replaces a matching preliminary result in `doGenerate`.                                                                                                                      |
| Source/citation parts                      | **UNSUPPORTED (silent)** | Cursor exposes no citation mapping on the consumed channel; source parts are never emitted.                                                                                                            |
| File output parts                          | **UNSUPPORTED (silent)** | Cursor edits the workspace; file parts are never emitted. Assistant files supplied to lossy flattened input do receive an unsupported warning. Cloud artifacts remain on an injected/raw `SDKAgent`.   |
| Custom and reasoning-file output (v7 only) | **UNSUPPORTED (silent)** | No stable Cursor output mapping exists. Corresponding assistant-history inputs do warn when flattening.                                                                                                |
| Usage                                      | **SUPPORTED**            | Terminal `RunResult.usage` wins. Per-turn usage is summed locally only as fallback. Cache read/write and raw Cursor totals are preserved. Missing usage stays undefined, never fabricated as zero.     |
| Finish reason                              | **EMULATED**             | `finished → stop`, `error → error`, externally `cancelled → other`; Cursor provides run status, not model stop detail.                                                                                 |
| AI SDK response metadata                   | **SUPPORTED**            | Run ID, resolved/requested model, and current timestamp. Because deltas may precede `send()` resolution, response metadata may follow initial content parts.                                           |
| `providerMetadata.cursor`                  | **SUPPORTED**            | Agent/run/request IDs, model/params, status, duration, terminal text, Cursor usage, and cloud git data when supplied.                                                                                  |
| Error stream parts                         | **SUPPORTED**            | SDK/protocol failures emit an error part and close. A terminal Cursor error emits error then finish; `doGenerate` rejects on the error part.                                                           |
| Structured object generation               | **UNSUPPORTED-WARN**     | AI SDK parsing can succeed when the model happens to return valid JSON, but the response-format warning and lack of guarantee remain.                                                                  |
| Redacted raw chunks                        | **SUPPORTED**            | Per-event raw values require raw chunks. Late compatibility-warning raw parts are always emitted by the provider so streaming consumers can observe runtime drift.                                     |

The unconditional late-warning raw part is a deliberate conformance trade: the LanguageModelV4
contract describes raw chunks as opt-in, while the implementation follows the reference provider's
warning-visibility convention. AI SDK `streamText` filters raw parts unless the application requests
them.

## Provider surfaces and runtime

| Surface                              | Classification                 | Implemented behavior                                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Callable provider                    | **SUPPORTED**                  | `cursor(modelId, settings)`. Calling with `new` errors.                                                                                                                                                                                                   |
| `languageModel`                      | **SUPPORTED**                  | Same model factory.                                                                                                                                                                                                                                       |
| `chat` alias                         | **SUPPORTED**                  | Same model factory.                                                                                                                                                                                                                                       |
| `embeddingModel`                     | **UNSUPPORTED-ERROR**          | Throws `NoSuchModelError`.                                                                                                                                                                                                                                |
| `imageModel`                         | **UNSUPPORTED-ERROR**          | Throws `NoSuchModelError`.                                                                                                                                                                                                                                |
| Transcription, speech, reranking     | **UNSUPPORTED (omitted)**      | Optional methods are absent, so the surface does not exist.                                                                                                                                                                                               |
| V7 `files()` / `skills()`            | **UNSUPPORTED (omitted)**      | Optional provider methods are absent.                                                                                                                                                                                                                     |
| Provider cleanup                     | **SUPPORTED**                  | `close()` / `dispose()` closes provider-owned agents and never closes an injected `settings.agent`.                                                                                                                                                       |
| Local workspace roots                | **SUPPORTED**                  | `local.cwd` is the primary root and local store scope; `local.dirs` adds further roots (`@cursor/sdk` 1.0.27+). A legacy `cwd` string array, accepted by `@cursor/sdk` ≤ 1.0.23, is migrated to `cwd` plus extra `dirs` entries before the SDK is called. |
| Cloud agent metadata and PR identity | **SUPPORTED**                  | `cloud.metadata` (`@cursor/sdk` 1.0.25+) and `cloud.openAsCursorGithubApp` (1.0.27+) are passed through at cloud agent creation.                                                                                                                          |
| Browser / Edge runtime               | **UNSUPPORTED-ERROR** de facto | Node.js `>=22.13`, ESM-only; no custom runtime guard is added ahead of Cursor's Node-only package behavior.                                                                                                                                               |

## Usage mapping detail

Cursor reports `outputTokens` with reasoning already included. Since `@cursor/sdk` 1.1.0 its
`inputTokens` is the whole prompt with cache reads and writes already included, and
`totalTokens` is `inputTokens + outputTokens`; earlier SDK versions added the cache fields on top.
The V4 mapping is:

```ts
{
  inputTokens: {
    total: inputTokens,
    noCache: max(0, inputTokens - cacheReadTokens - cacheWriteTokens),
    cacheRead: cacheReadTokens,
    cacheWrite: cacheWriteTokens,
  },
  outputTokens: {
    total: outputTokens,
    text: reasoningTokens === undefined ? undefined : outputTokens - reasoningTokens,
    reasoning: reasoningTokens,
  },
  raw: cursorTokenUsage,
}
```

`SDKAgent.getUsage()` exists in `@cursor/sdk` 1.0.28 but is deliberately unused on the production
path: usage still comes from `turn-ended` deltas and terminal `RunResult.usage`, which are scoped to
the run being reported rather than to the agent's lifetime.

`@cursor/sdk` declares `toTokenUsage` and `sumTokenUsage` in its internal `usage-types.d.ts`, but
`@cursor/sdk@1.5.0` still does not export those functions from its public package entry point. The
provider therefore performs the same documented field-wise fallback calculation locally rather than
importing a non-exported subpath.

## Cursor SDK 1.0.31 options

- `systemPrompt`: supported explicitly through `CursorSettings`, on local create and resume.
  Replaces the built-in harness prompt and requires server access. AI SDK system messages retain
  their existing policy. Injected agents must be configured by their owner.
- `cloud.agentServeAgent`: supported through the validated cloud settings at creation; Cursor
  persists the Agent Serve directory slug for cloud skill discovery.
- Both additions are classified as mapped in the bidirectional SDK drift guard. Provider behavior is covered by mocked AI SDK calls. Live cloud option acceptance passed;
  harness replacement was rejected by the server and seeded skill discovery is blocked by the
  user-store upload endpoint. See the dated evidence in [ASSUMPTIONS.md](ASSUMPTIONS.md).

## Cursor SDK 1.0.32 events

- `tool-requests-listed` (`{ callCount }`), at top level and inside `tool-call-delta.taskUpdate`:
  raw-only. It reports how many tool calls the model requested in a step; each call still arrives
  through its own `tool-call-started` / `tool-call-completed` lifecycle, so the count is not needed
  to build tool parts. It is classified as mapped in both event drift-guard unions. Without this
  classification its name matches the fail-closed unknown-event heuristic and aborts the stream.
- 1.0.32 adds no new agent or send options.

## Cursor SDK 1.0.35 options

- `local.subagentInherit` (agent creation) and its per-send replacement `local.subagentInherit` on
  `LocalSendOptions`: known-excluded. It opts `Task` child sessions into inheriting executor
  overrides (`overrideReadExecutor`, `overrideShellExecutor`, …, or a per-child factory), a
  reported workspace path, and the parent's allowed-tools / exclude-tools headers. The executor
  interfaces are not published by the SDK, so the validated `local` settings do not model it.
  Callers that need it at creation or resume can pass `sdkAgentOptions.local`, which replaces
  `settings.local` as a whole. Both keys are classified as known-excluded in the drift guard.
- Without `subagentInherit`, Cursor does not forward the parent's `tools` / `disallowedTools`
  headers to `Task` children. This was already true on earlier pins.
- `SDKCustomToolContext` gains an optional `sessionId`; it is passed through to custom tool
  callbacks unchanged. 1.0.35 adds no new interaction event types.

## Cursor SDK 1.0.36

- No public type changes from 1.0.35 and no runtime dependency changes. The bundle update is
  internal (regenerated backend message schemas); no options, events, or mapping changes.

## Cursor SDK 1.0.37 – 1.4.0

Options:

- `teamId` (1.0.40): mapped as `CursorSettings.teamId` and sent on `Agent.create` and
  `Agent.resume`. Cursor sends it as `x-cursor-team-id` and does not persist it, so the provider
  re-passes it on every resume and includes it in the resume cache key. Cursor silently ignores
  zero, negative, fractional, and unsafe values; the first-class setting rejects them instead. A
  value passed through `sdkAgentOptions.teamId` is not validated, like the rest of the escape
  hatch.
- `local.resourceProviderOptions`, `local.reportedWorkspacePath`, and `local.fs` (all 1.1.0):
  known-excluded on both `LocalAgentOptions` and `LocalSendOptions`. `resourceProviderOptions`
  replaces the agent's own executors and `fs` runs the native file tools on a caller-supplied tree
  instead of the host disk; both are live objects or factories. `reportedWorkspacePath` is a plain
  string but only makes sense alongside one of them. Callers can pass all three through
  `sdkAgentOptions.local` at creation or resume; the resume cache keys `fs` and
  `resourceProviderOptions` by object identity and `reportedWorkspacePath` by value. An agent
  created with `fs` needs `fs` again on resume. The per-send replacements are not reachable: the
  provider maps only `force` per call.
- `overrideDeleteExecutor` (1.1.0) joins the executor overrides accepted by `subagentInherit` and
  `resourceProviderOptions`. Cursor's host delete permission check and approval do not run for a
  caller-supplied delete executor. It is covered by the same exclusion.
- `local.hostMcpBridgeUrls` (1.3.0): known-excluded. The SDK marks it `@internal` for Agent SDK
  hosts and says it may change without notice. It still passes through `sdkAgentOptions.local`,
  and because it selects which MCP URLs bypass the local admin MCP policy, the resume cache keys
  the URL list by value.
- `ModelSelection.maxMode` and `ModelVariant.isMaxMode` (1.0.38) are not agent or send option keys
  and are not set by the provider for the main model; the SDK derives `maxMode` when every catalog
  variant matching `modelParams` requires max mode. A subagent definition's `agents.*.model` may
  set `maxMode`, and the validated settings accept it.

Events:

- `model-call-completed` (`{ modelCallId, usage }`, 1.4.0), top level only: raw-only. It reports
  one model call's tokens, and the turn's `turn-ended` usage already includes them, so mapping it
  would double-count. A live 1.4.0 run emits it before `turn-ended`. It is classified as mapped in
  the interaction drift-guard union. Without this classification its name matches the fail-closed
  unknown-event heuristic and aborts the stream.
- The `NestedTaskUpdate` event names are unchanged, but two payloads widen without a new event
  name, which the drift guard cannot see:
  - Tool calls gain a `computerUse` tool type (1.0.37), at top level and inside
    `tool-call-delta.taskUpdate`. It needs no special case: tool parts are dynamic and take the
    tool name, input, and result from the payload.
  - `summary-completed` gains optional `failed` and `fallback` flags (1.2.0). The event stays
    raw-only and the flags are preserved in the raw value.

Usage:

- From 1.1.0 the SDK computes `totalTokens` as `inputTokens + outputTokens` and documents
  `inputTokens` as the whole prompt, cache reads and writes included. No type changed. The provider
  previously added the cache fields to the V4 input total and reported `inputTokens` as uncached,
  which over-counted input by the cache tokens; both the V4 mapping and the local fallback total
  now follow the new accounting. Verified live on 1.4.0 (see [ASSUMPTIONS.md](ASSUMPTIONS.md)).

Inherited runtime behavior, with no provider change:

- Local run errors keep their code across a store reload (1.1.0). `createRunError` already reads
  `RunResult.error.code` for metadata and retry classification, so more local failures now carry
  one.
- When a local store fails to open after a turn already produced its result text, the run now
  finishes successfully with that text (1.0.40) instead of failing. The SDK reports the store
  failure as a warning on `run.stream()` status messages, which the provider does not consume.
- With `local.sandboxOptions.enabled`, the first sandboxed command on a machine deletes and
  recreates Node's compile-cache directories outside the workspace (1.4.0): `node-compile-cache`
  in the temp directory and, on macOS, `~/Library/Caches/cursor-compile-cache`. The SDK records
  the cleanup so it runs once, and prints `INFO  node compile cache: removed …` lines to the
  process's standard output regardless of the provider's `logger` setting. Observed live running
  `examples/local-repository-edit.ts`.

Other surface changes, none used by the provider:

- `SDKAgent.summarize()` (1.2.0) starts a compaction run on local agents. The provider does not
  call it; an injected agent's owner can. `SDKMessage` gains `SDKSummaryMessage` on `run.stream()`,
  which the provider does not consume (it reads `onDelta` updates and `run.wait()`).
- `FeatureUnavailableError` (1.4.0) extends `UnknownAgentError` and maps through the generic SDK
  error path with the SDK's own `isRetryable`.
- `SteerAckOutcome` gains a `{ outcome: 'queued' }` variant (1.4.0); the provider does not steer
  runs.
- `teamId` is also accepted by the static list, get, run-lookup, archive/delete, account, and
  catalog calls, none of which the provider calls.
- `@cursor/sdk` moves `zod` from a dependency (`^3.25.0`) to a peer dependency
  (`^3.25.0 || ^4.0.0`, 1.0.38), so it resolves to the application's zod instead of installing
  its own zod 3. It imports the `zod/v3` and `zod/v4` entry points, which exist from zod 3.25; its
  public schemas still use the zod 3 API (`zod/v3`). `main` already requires zod 4. The
  `ai-sdk-v6` branch accepted zod `^3.0.0` and now requires `^3.25.76 || ^4.1.8`, the range `ai` v6
  and `@ai-sdk/provider-utils` already impose.
- New `FileSystem` helpers and errors (`overlayFs`, `tempFs`, `createFileSystemTools`,
  `FileNotFoundError`, …) are exported for building an `fs` tree.
- The `anysphere-source` conditional export is removed from the SDK's package entry points; the
  provider imports the standard entry.

## Cursor SDK 1.4.1 – 1.5.0

Triage from the published type declarations and bundles of 1.4.1, 1.4.2, and 1.5.0. Live runs
against 1.5.0 on 2026-11-25 verified the integration tests, the local examples, and
`shell-tool-call-delta` streaming; see [ASSUMPTIONS.md](ASSUMPTIONS.md). 1.4.1 changes no public
types.

Options:

- `local.onConnectionStateChange` (1.4.2): mapped in the validated `local` settings and passed at
  local agent creation. Cursor calls it with `{ state: 'reconnecting', attempt, trigger? }` when a
  local run commits to a non-immediate transport retry and with `{ state: 'connected' }` once the
  retried attempt makes progress. The delta stream is quiet in between, so an application can pause
  its own idle timeout. Cursor does not persist the listener, and like the rest of `settings.local`
  it is not sent on `agentId` resume; pass it through `sdkAgentOptions.local` there. The resume
  cache keys it by function identity. Its per-send replacement on `LocalSendOptions` is
  known-excluded: the provider maps only `force` per call.
- `local.onMcpAuthRequest` (1.4.2): known-excluded on both `LocalAgentOptions` and
  `LocalSendOptions`. It answers the agent's MCP sign-in (`mcp_auth`) requests, which Cursor
  rejects when it is unset. The SDK marks it `@internal` for Agent SDK hosts, says it may change
  without notice, and does not export its request and decision types from the package entry point.
  It still passes through `sdkAgentOptions.local` at creation or resume. Because the handler can
  approve a sign-in, the resume cache keys it by function identity.
- `local.sandboxOptions.binaryPath` (1.5.0): mapped. It is nested inside an already-mapped key, so
  the drift guard did not see it, but the strict `local` validation would have rejected a value the
  derived `CursorLocalSettings` type accepts. The guard now also accounts for the `sandboxOptions`
  keys in both directions. `binaryPath` is an absolute path to a `cursorsandbox` helper
  the host trusts. The provider checks only that it is a string; Cursor fails the run for a path
  that is not an absolute executable and tries `CURSOR_SDK_SANDBOX_BINARY` when it is unset. The
  first helper a local agent configures serves the whole process: a later agent that passes a
  different path fails, and one that passes none reuses it.

Events:

- `shell-tool-call-delta` (`{ callId, modelCallId, stream: 'stdout' | 'stderr', content }`, 1.5.0),
  top level only: raw-only. It streams a running shell tool call's output in chunks; earlier SDK
  versions dropped these backend deltas. A successful call's `tool-call-completed` result still
  carries the whole `stdout` and `stderr`, so tool parts do not need it. It is classified as mapped
  in the interaction drift-guard union. Without this classification its name matches the
  fail-closed unknown-event heuristic and aborts the stream.
- It is deliberately not surfaced as a preliminary tool result under
  `experimentalPreliminaryToolResults`, although it correlates exactly by `callId`. Each update is
  an increment and a preliminary result replaces the one before it. A live capture shows the
  updates arriving between `tool-call-started` and `tool-call-completed`, with no
  `partial-tool-call` in between. `shell-output-delta` keeps its
  existing experimental mapping. The 1.5.0 local runtime builds that update only for a
  shell-command conversation turn, not for the agent's shell tool, so the two are not expected on
  the same call.
- The `NestedTaskUpdate` event names are unchanged.
- Top-level `step-started` / `step-completed` keep their shape but change meaning for local runs
  (1.5.0): each pair now brackets one model step, a model call and the tool calls it made, and the
  step completes at `model-call-completed`, as a live run confirmed. The agent loop's own step
  updates are dropped. Both stay raw-only.

Usage:

- From 1.4.2 `RunResult.usage` also counts the model calls that completed in a turn that did not
  end, such as in a cancelled or failed run. No type changed. Terminal `RunResult.usage` already
  wins in the provider, so those runs can now report usage. The local fallback, used only when the
  terminal result has no usage, still sums `turn-ended` updates.

Inherited runtime behavior, with no provider change:

- When a team MCP allowlist applies to a local agent's MCP server, or blocks it, the SDK prints a
  `[cursor-sdk] …` notice with `console.warn` (1.4.1), regardless of the provider's `logger`
  setting: once per server and allowlist in the process when an allowlist applies, and once per
  server in each run that a server is blocked from.
- Creating a local agent no longer fails on a rate-limited model catalog and stops waiting for a
  slow one after 10 seconds (1.5.0). The agent is created with the requested model unchecked and
  the first send checks it, so a model the catalog rejects can then fail the send instead of the
  creation.
- When Cursor enables goal continuation for the account (1.5.0, server-gated), a local run whose
  turn ends with an active goal keeps going instead of finishing, so one run can span more turns.
  The provider already closes open content at each `turn-ended` and takes usage from the terminal
  result.

Other surface changes, none used by the provider:

- `CursorSdkError.retryAfterMs` (1.5.0) carries a Cursor API `Retry-After` header. The provider
  does not copy it into `APICallError.data` or response headers; it stays readable on the mapped
  error's `cause`.
- `Agent.disposeLocalStores()` (1.5.0) closes every local store the process opened. It is
  process-wide, so the provider's `close()` does not call it.
- `LocalAgentStore` gains optional `persistRunEvents` and `retainAgent` members, and
  `AgentCheckpointStore` an optional `retainAgent` (1.5.0). `LocalAgentStoreCheckpoints.get` is
  now documented as read on demand during a run, so it must return the bytes of every completed
  `create` or `update`. A custom `local.store` is passed through unchanged.
- No runtime or peer dependency changed between 1.4.0 and 1.5.0.

## Related documents

- [Assumptions requiring a live Cursor key](ASSUMPTIONS.md)
- [Condensed limitations](LIMITATIONS.md)
- [Configuration reference](configuration.md)
- [Session management](sessions.md)
- [Troubleshooting](troubleshooting.md)
