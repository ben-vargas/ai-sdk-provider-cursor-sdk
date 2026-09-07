# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-09-07

### Added

- Support `systemPrompt` as an explicit local Cursor harness replacement on create and resume,
  with non-blank validation, cloud/injected-agent rejection, and prompt-aware resume caching.
- Support `cloud.agentServeAgent` for Agent Serve skill discovery on cloud creation.

### Changed

- Pin `@cursor/sdk` from the `1.0.0` release's `1.0.23` to `1.0.31`, including the earlier
  unreleased `1.0.28` compatibility work and coverage for the two new SDK options.
- Map first-class `tools` / `disallowedTools` on create and resume (local only).
- Map `local.dirs`, `cloud.metadata`, and `cloud.openAsCursorGithubApp`. Legacy `local.cwd`
  arrays remain accepted and are converted to `cwd` plus `dirs` at the SDK boundary.
- Normalize `tool-call-delta.taskUpdate` so nested subagent text and tools remain visible.
- Preserve AI SDK system-message policies and document the separate Cursor harness replacement.

### Fixed

- Replace the invalid live image-test PNG (bad IDAT CRC/zlib checksum) with a valid red PNG
  and assert the recognized color. Add opt-in live SDK option smoke commands.

- Parse `npm pack --json` when Node 22 / npm 10 includes lifecycle output before the JSON.
- Key resumed handles by agent ID, effective system prompt, and tool restrictions, including
  `sdkAgentOptions` overrides, so different configurations cannot inherit a mismatched handle.

## [1.0.0] - 2026-07-14

### Added

- AI SDK v7 `LanguageModelV4` / `ProviderV4` adapter for `@cursor/sdk@1.0.23`.
- Streaming and non-streaming text, reasoning, provider-executed tool activity, usage, response
  metadata, raw Cursor deltas, and terminal provider metadata.
- Local and cloud agent creation, model-instance reuse, explicit agent resume, call-scoped agents,
  per-agent send serialization, cancellation, and provider-owned cleanup.
- Inline and URL image input, Cursor custom tools, MCP server definitions, subagents, and strict
  provider settings/call options.
- Prompt-history and system-message policies with explicit warnings for lossy behavior.
- Cursor-to-AI-SDK error mapping and authentication, busy-agent, and stale-agent helpers.
- Unit, mocked AI SDK v7, opt-in live integration, package drift-guard, and packed-consumer tests.
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

- Requires Node.js `>=22.13`, AI SDK v7, `@ai-sdk/provider ^4.0.2`,
  `@ai-sdk/provider-utils ^5.0.5`, Zod `^4.1.8`, and ESM.
- Publishes from `main` under the `latest` npm dist-tag.
