# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Parse `npm pack --json` even when Node 22 / npm 10 prints lifecycle (tsup `prepare`) output
  before the JSON array, so packed-consumer smoke stays green on Node 22 and 24.
- Key the resumed-agent cache by `agentId` plus `tools` / `disallowedTools` so a later model
  cannot inherit an unrestricted handle (for example `tools: []` after an unrestricted resume).

### Changed

- Pinned `@cursor/sdk` from `1.0.23` to `1.0.28` after triaging weekly canary drift.
- Map first-class `tools` / `disallowedTools` on create and resume (local only; rejected with
  `cloud`).
- Map `local.dirs`, `cloud.metadata`, and `cloud.openAsCursorGithubApp`. A legacy `local.cwd`
  string array is still accepted and migrated to `cwd` + `dirs` before the SDK is called.
- Handle `tool-call-delta` by recursing `taskUpdate` through the existing event normalizer so
  nested subagent text and tools are visible, instead of throwing on the default branch.

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
