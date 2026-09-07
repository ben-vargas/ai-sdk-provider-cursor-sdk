# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
