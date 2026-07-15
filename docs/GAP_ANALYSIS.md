# AI SDK v7/v6 gap analysis

This document compares the union of AI SDK v7 (`LanguageModelV4` / `ProviderV4`) and AI SDK v6
(`LanguageModelV3` / `ProviderV3`) with the public surface of `@cursor/sdk@1.0.23`. It describes the
behavior implemented on `main`; rows that differ for the planned `ai-sdk-v6` branch are marked.

On the `ai-sdk-v6` branch, v7-only rows do not apply; where a row distinguishes versions, the v6
behavior is authoritative.

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

| AI SDK feature                                  | Classification                                                                                       | Implemented behavior                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| System role                                     | **UNSUPPORTED-ERROR** by default; **EMULATED** with `'prefix'`; **UNSUPPORTED-WARN** with `'ignore'` | Cursor root agents expose no system-prompt field. `systemMessageMode` controls rejection, lossy XML-like text prefixing, or omission.      |
| User text                                       | **SUPPORTED**                                                                                        | Joined into `SDKUserMessage.text`.                                                                                                         |
| User image with inline data                     | **SUPPORTED**                                                                                        | `Uint8Array`, base64 string, or base64 data URL becomes `SDKImage { data, mimeType }`.                                                     |
| User image URL                                  | **SUPPORTED**                                                                                        | HTTP(S) URL becomes `SDKImage { url }`; advertised through `supportedUrls['image/*']`. V7 uses tagged URL data; v6 uses `URL`.             |
| User image provider reference (v7 only)         | **UNSUPPORTED-WARN**                                                                                 | Dropped with feature `prompt.user.file.reference`.                                                                                         |
| User image backed by tagged text data (v7 only) | **UNSUPPORTED-WARN**                                                                                 | Dropped with feature `prompt.user.file.text`.                                                                                              |
| Non-image user file                             | **UNSUPPORTED-WARN**                                                                                 | Dropped; Cursor's structured user message accepts images, not arbitrary files.                                                             |
| One effective user turn                         | **SUPPORTED**                                                                                        | Converted directly.                                                                                                                        |
| Arbitrary multi-turn history                    | **UNSUPPORTED-ERROR** by default; **EMULATED** with `'ignore'` or `'flatten'`                        | Cursor holds native history in an agent session. Ignore sends only the newest user turn; flatten serializes roles and tool data into text. |
| Earlier image in flattened history              | **EMULATED**                                                                                         | Replaced with `[image omitted]`; only images in the latest user turn are attached.                                                         |
| Assistant reasoning in flattened history        | **UNSUPPORTED-WARN**                                                                                 | Omitted with feature `prompt.assistant.reasoning`.                                                                                         |
| Assistant reasoning-file (v7 only)              | **UNSUPPORTED-WARN**                                                                                 | Omitted with feature `prompt.assistant.reasoning-file`.                                                                                    |
| Assistant custom content (v7 only)              | **UNSUPPORTED-WARN**                                                                                 | Omitted with feature `prompt.assistant.custom`.                                                                                            |
| Assistant file in flattened history             | **UNSUPPORTED-WARN**                                                                                 | Omitted with feature `prompt.assistant.file`. This row reflects the actual converter in addition to the original spec table.               |
| Tool approval response in history               | **UNSUPPORTED-ERROR** under the default history policy; **UNSUPPORTED (silent)** in flatten mode     | Cursor's approval/request surface is not connected to the AI SDK approval protocol. Flattening drops the control-plane part.               |
| Message/part-level `providerOptions`            | **UNSUPPORTED (silent)**                                                                             | Only call-level `providerOptions.cursor` is parsed.                                                                                        |
| Empty prompt / no user text or image            | **UNSUPPORTED-ERROR**                                                                                | `UnsupportedFunctionalityError` with functionality `prompt.empty`.                                                                         |

## Tools

| AI SDK feature                                      | Classification                                                                     | Implemented behavior                                                                                                                                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application-executed function tools                 | **UNSUPPORTED-WARN**                                                               | Cursor owns an autonomous tool loop; AI SDK tools cannot be registered or answered through this adapter.                                                                                                                                      |
| AI SDK provider-defined tools                       | **UNSUPPORTED-WARN**                                                               | Same warning path as function tools.                                                                                                                                                                                                          |
| `toolChoice: 'auto'`                                | **SUPPORTED** no-op on v7                                                          | Automatic selection is Cursor's only mode. AI SDK v7 injects `auto`, so no warning is emitted. The planned v6 branch warns for an explicitly supplied `auto`.                                                                                 |
| `toolChoice: 'none'`, `'required'`, or a named tool | **UNSUPPORTED-WARN**                                                               | Ignored with feature `toolChoice`.                                                                                                                                                                                                            |
| Cursor built-in/MCP/custom/subagent tool visibility | **SUPPORTED**                                                                      | Emits dynamic `tool-input-start/delta/end`, `tool-call`, and `tool-result` parts. `providerExecuted: true` is set on `tool-input-start` and `tool-call`, where V4 defines it. Inputs/results are redacted.                                    |
| Tool input incremental deltas                       | **EMULATED**                                                                       | Default: one JSON delta from the completed input snapshot. Experimental mode emits one snapshot at tool start. `partial-tool-call` is not treated as a true delta.                                                                            |
| Preliminary tool results                            | **EMULATED**, opt-in                                                               | `experimentalPreliminaryToolResults` surfaces correlated partial tool snapshots and uniquely correlatable shell output as replaceable preliminary results. Uncorrelated or late partial snapshots are dropped with one compatibility warning. |
| AI SDK tool approval request/response flow          | **UNSUPPORTED-ERROR** for a default history prompt; no approval request is emitted | Cursor's on-delta channel has no stable approval event. Unknown permission-shaped updates fail closed as protocol drift.                                                                                                                      |
| Local Cursor custom tools                           | **SUPPORTED**                                                                      | `settings.customTools` / `settings.local.customTools` are passed at local agent creation. For advanced resume-time local options, use `sdkAgentOptions.local`.                                                                                |
| Inline MCP servers                                  | **SUPPORTED** at agent create/resume                                               | `settings.mcpServers` is re-passed on resume because Cursor does not persist inline definitions. Per-send replacement is intentionally not exposed.                                                                                           |
| Cursor subagents                                    | **SUPPORTED**                                                                      | `settings.agents` is passed at agent create/resume.                                                                                                                                                                                           |

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

| Surface                          | Classification                 | Implemented behavior                                                                                        |
| -------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Callable provider                | **SUPPORTED**                  | `cursor(modelId, settings)`. Calling with `new` errors.                                                     |
| `languageModel`                  | **SUPPORTED**                  | Same model factory.                                                                                         |
| `chat` alias                     | **SUPPORTED**                  | Same model factory.                                                                                         |
| `embeddingModel`                 | **UNSUPPORTED-ERROR**          | Throws `NoSuchModelError`.                                                                                  |
| `imageModel`                     | **UNSUPPORTED-ERROR**          | Throws `NoSuchModelError`.                                                                                  |
| Transcription, speech, reranking | **UNSUPPORTED (omitted)**      | Optional methods are absent, so the surface does not exist.                                                 |
| V7 `files()` / `skills()`        | **UNSUPPORTED (omitted)**      | Optional provider methods are absent.                                                                       |
| Provider cleanup                 | **SUPPORTED**                  | `close()` / `dispose()` closes provider-owned agents and never closes an injected `settings.agent`.         |
| Browser / Edge runtime           | **UNSUPPORTED-ERROR** de facto | Node.js `>=22.13`, ESM-only; no custom runtime guard is added ahead of Cursor's Node-only package behavior. |

## Usage mapping detail

Cursor reports `outputTokens` with reasoning already included and reports cache tokens separately.
The V4 mapping is:

```ts
{
  inputTokens: {
    total: inputTokens + cacheReadTokens + cacheWriteTokens,
    noCache: inputTokens,
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

`@cursor/sdk` declares `toTokenUsage` and `sumTokenUsage` in its internal
`usage-types.d.ts`, but `@cursor/sdk@1.0.23` does not export those functions from its public package
entry point. The provider therefore performs the same documented field-wise fallback calculation
locally rather than importing a non-exported subpath.

## Related documents

- [Assumptions requiring a live Cursor key](ASSUMPTIONS.md)
- [Condensed limitations](LIMITATIONS.md)
- [Configuration reference](configuration.md)
- [Session management](sessions.md)
- [Troubleshooting](troubleshooting.md)
