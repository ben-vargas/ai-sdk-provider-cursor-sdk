# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-11-15

### Added

- Support `teamId` to attribute requests to one Cursor team when a login belongs to several. It is
  sent on create and on every resume, validated as a positive integer, and part of the resume
  cache key.

### Changed

- Pin `@cursor/sdk` from `1.0.36` to `1.4.0`.
- Raise the `zod` peer range from `^3.0.0 || ^4.0.0` to `^3.25.76 || ^4.1.8`. The SDK now takes
  `zod` as a peer dependency (`^3.25.0 || ^4.0.0`) instead of installing its own zod 3, and imports
  the `zod/v3` and `zod/v4` entry points that only exist from zod 3.25. The new range is the one
  `ai` v6 and `@ai-sdk/provider-utils` already require, so it does not exclude any working install.
- Classify the new local options `resourceProviderOptions`, `reportedWorkspacePath`, `fs`, and
  `hostMcpBridgeUrls` as known-excluded in the SDK drift guard, for the agent and (except the
  bridge URLs, which are agent-only) per send. They are reachable through `sdkAgentOptions.local`;
  see the configuration reference. `CursorLocalSettings` omits them, and resumed handles are also
  keyed by the `fs` and `resourceProviderOptions` object identities and by the
  `reportedWorkspacePath` and `hostMcpBridgeUrls` values.

### Fixed

- Accept `maxMode` on a subagent's `agents.*.model`. The SDK type allows it since `1.0.38`, but
  the strict settings validation rejected it.
- Stop double-counting cache tokens in usage. Since `@cursor/sdk` `1.1.0`, Cursor's `inputTokens`
  is the whole prompt with cache reads and writes included. `usage.inputTokens.total` is now
  Cursor's `inputTokens` (it previously added the cache fields again), `noCache` is that value
  minus cache reads and writes, and the fallback `totalTokens` summed from turns is input + output.
- Treat the new `model-call-completed` Cursor update as a raw-only event. Its name matched the
  fail-closed unknown-event heuristic, so every `1.4.0` stream that emitted it failed with a
  protocol-consistency error. Usage still comes from `turn-ended`, which already includes each
  model call's tokens.

## [0.1.3] - 2026-10-06

### Changed

- Pin `@cursor/sdk` from `1.0.32` to `1.0.36`.
- Classify the new `local.subagentInherit` agent and send option as known-excluded in the SDK
  drift guard. It is reachable through `sdkAgentOptions.local`; see the configuration reference.
  `CursorLocalSettings` omits it so the type matches the validated settings, and resumed handles
  are keyed by the `subagentInherit` object's identity.
- Examples default to `grok-4.7` (still overridable with `CURSOR_MODEL`).
- The image example's bundled fixture is now a PNG. Cursor delivers SVG to the model as a file to
  read rather than as an image, so the example dropped SVG from its accepted extensions.
- Raise the `ai` dev dependency to `^6.0.301`. `6.0.3` rejected an aborted result with
  `NoOutputGeneratedError` instead of the caller's abort reason.

### Fixed

- `abort-signal.ts` and `integration-test.ts` no longer expect iterating `fullStream` to throw on
  abort. The AI SDK ends a started stream with an `abort` part, and an abort before the stream
  starts rejects it; the examples now accept either and check the caller's original abort reason.
- `limitations.ts` handles `NoObjectGeneratedError` when a model replies with prose instead of
  JSON, instead of crashing, and uses a less directive structured-output prompt.

## [0.1.2] - 2026-09-28

### Changed

- Pin `@cursor/sdk` from `1.0.31` to `1.0.32`.

### Fixed

- Treat the new `tool-requests-listed` Cursor update, top-level or nested in `tool-call-delta`, as
  a raw-only informational event. Previously its name matched the fail-closed unknown-event
  heuristic, so a `1.0.32` stream that emitted it failed with a protocol-consistency error.

## [0.1.1] - 2026-09-07

### Added

- Support `systemPrompt` as an explicit local Cursor harness replacement on create and resume,
  with non-blank validation, cloud/injected-agent rejection, and prompt-aware resume caching.
- Support `cloud.agentServeAgent` for Agent Serve skill discovery on cloud creation.

### Changed

- Pin `@cursor/sdk` from `1.0.23` to `1.0.31`, accounting for all intervening option/event drift.
- Preserve AI SDK system-message policies and document the separate Cursor harness replacement.

### Fixed

- Replace the invalid live image-test PNG (bad IDAT CRC/zlib checksum) with a valid red PNG
  and assert the recognized color. Add opt-in live SDK option smoke commands.

- Backport tool allow/deny lists on create and resume, legacy workspace-array conversion plus
  `local.dirs`, cloud metadata/GitHub App PR settings, and nested subagent event normalization.
- Backport the Node 22 packed-consumer smoke fix and cache resumed handles by effective prompt
  and tool restrictions, including escape-hatch overrides.
- Preserve the AI SDK v6 / V3 provider interface and `ai-sdk-v6` release tag.

## [0.1.0] - 2026-07-14

### Added

- AI SDK v6 `LanguageModelV3` / `ProviderV3` adapter for `@cursor/sdk@1.0.23`.
- Streaming and non-streaming text, reasoning, provider-executed tool activity, usage, response
  metadata, raw Cursor deltas, and terminal provider metadata.
- Local and cloud agent creation, model-instance reuse, explicit agent resume, call-scoped agents,
  per-agent send serialization, cancellation, and provider-owned cleanup.
- Inline and URL image input, Cursor custom tools, MCP server definitions, subagents, and strict
  provider settings/call options.
- Prompt-history and system-message policies with explicit warnings for lossy behavior.
- Cursor-to-AI-SDK error mapping and authentication, busy-agent, and stale-agent helpers.
- Unit, mocked AI SDK v6, opt-in live integration, package drift-guard, and packed-consumer tests.
- User documentation, gap analysis, assumptions register, examples, CI, and weekly SDK canary.

### Changed

- Cursor model IDs remain an open string set; `'auto'` and `'composer-2.5'` are convenience aliases,
  while `Cursor.models.list()` remains authoritative for each account.

### Fixed

- Live integration tests require the explicit `CURSOR_INTEGRATION=1` opt-in in addition to an API
  key, preventing accidental live calls during the normal test suite.
- Sends without an explicit call-level or model-level mode now preserve a reused or resumed agent's
  current conversation mode instead of forcing it back to `'agent'`.

### Breaking Changes

- Initial release; no earlier public API to migrate.

### Version Compatibility

- Requires Node.js `>=22.13`, AI SDK v6, `@ai-sdk/provider ^3.0.0`,
  `@ai-sdk/provider-utils ^4.0.1`, Zod `^3.0.0 || ^4.0.0`, and ESM.
- Publishes from the `ai-sdk-v6` branch under the `ai-sdk-v6` npm dist-tag.
