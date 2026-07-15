# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
