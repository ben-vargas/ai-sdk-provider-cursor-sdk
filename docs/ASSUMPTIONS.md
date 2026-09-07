# Live-key assumptions and validation register

The default test suite mocks the `@cursor/sdk` boundary. No live Cursor key is required to build,
typecheck, lint, test, package, or import this provider. The behaviors below require a real
`CURSOR_API_KEY` to settle completely.

Run the opt-in suite with both gates present:

```bash
CURSOR_API_KEY=... CURSOR_INTEGRATION=1 npm run test:integration
```

`CURSOR_REASONING_MODEL` remains an optional integration-test input, but standalone reasoning events
are model-dependent and have not been validated for the suite default. They therefore do not have a
runnable example.

## Confirmed live behavior (2026-07-15)

The following behavior was verified against the real Cursor API with `composer-2.5` and supersedes
older assumptions in examples and session guidance:

- `generateText` returned text, `finishReason: 'stop'`, mapped input/output/total and cache-token
  usage, and terminal `providerMetadata.cursor` fields for agent, run, request, model, status,
  duration, result, and raw Cursor usage.
- `streamText` produced multiple text deltas and ended with `finishReason: 'stop'`.
- Reusing the same model object preserved native context and a stable `agentId` across calls in both
  plan and agent modes. This is the recommended multi-turn pattern.
- Cross-instance resume by `agentId` against the default local store failed cleanly with
  `data.code === 'agent_not_found'`. Examples must not describe that pattern as reliable.
- AbortSignal cancellation rejected the in-flight call with the original abort reason.
- Local mode required an explicit workspace. Cursor-owned tool-loop activity surfaced as dynamic,
  provider-executed tool parts with redacted/unstable payloads.
- Inline image bytes were live-validated. Remote URL image input was not.

Cloud repository behavior, explicit-store portability, reasoning deltas, and local custom-tool
callbacks still require their own target-environment live smoke.

## Architectural assumptions

| ID       | Open question                                                                       | Conservative behavior shipped                                                                                                                                                                                      | Live validation                                                                                  |
| -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **A-1**  | Can `onDelta` fire before `agent.send()` resolves?                                  | Yes. The callback feeds a queue immediately; response metadata is emitted once the `Run` handle exists, even if content arrived first.                                                                             | Capture delta/send resolution ordering.                                                          |
| **A-2**  | Can an awaited `onDelta` callback outlive `run.wait()`?                             | The SDK docs say callbacks are awaited. The provider still drains queued callbacks after wait settles before emitting the terminal part.                                                                           | Count callbacks completing after wait.                                                           |
| **A-3**  | Can `onDelta` and `run.stream()` be consumed together without duplication?          | The provider does not combine them. `onDelta` owns token/tool updates and `run.wait()` owns the terminal result; normalized `SDKMessage` status/task events are intentionally not consumed.                        | Spike dual consumption and correlate events.                                                     |
| **A-4**  | Is terminal usage cumulative and turn-ended usage incremental?                      | `RunResult.usage` is terminal authority. Turn-ended usage is summed field-by-field only when terminal usage is absent.                                                                                             | Compare both sources on a multi-turn run.                                                        |
| **A-5**  | Do input tokens exclude cache read/write tokens?                                    | Yes, following Cursor's documented total formula. V4 input total adds input, cache read, and cache write.                                                                                                          | Cache-token fields and the mapped total were verified with `composer-2.5` on 2026-07-15.         |
| **A-6**  | Is there a hidden detailed stop reason?                                             | No detail is inferred. Finished/error/cancelled map conservatively to stop/error/other.                                                                                                                            | Probe length-limited and refusal cases.                                                          |
| **A-7**  | Are overlapping sends safe on one agent?                                            | Both local and cloud sends are serialized. Cloud busy errors are documented; local overlap safety is not. Distinct agents remain parallel.                                                                         | Run overlapping local sends and inspect checkpoints.                                             |
| **A-8**  | Can tool completion arrive without tool start?                                      | Yes. The provider synthesizes the call from the completion payload and emits a compatibility warning.                                                                                                              | Capture real built-in and MCP tool sequences.                                                    |
| **A-9**  | Is usage present on failed/cancelled results?                                       | It may be absent. Unknown fields stay undefined rather than zero.                                                                                                                                                  | Capture failed and cancelled runs.                                                               |
| **A-10** | What image formats, sizes, counts, and runtime combinations work?                   | Inline data and URL images pass through without provider-side limits. Only inline image forwarding is covered by the current live suite; URL behavior is type/unit tested but live-unverified.                     | Exercise a local/cloud format-size-count matrix including URL input.                             |
| **A-11** | What happens when cancellation races agent creation, send, or completion?           | Acquisition and send waits settle with the original abort reason. A late call-scoped agent is released; a late run handle is cancelled best effort. Cancel failures are logged and never replace the abort reason. | In-flight cancellation preserved the original reason on 2026-07-15; other race points remain.    |
| **A-12** | Which tool-result shapes indicate failure?                                          | `toolCall.result.status === 'error'` is primary; a truthy `error` key is the fallback when a completion has no recognized envelope. Payloads remain unstable.                                                      | Capture several failing tools.                                                                   |
| **A-13** | Does a packed ESM consumer load Cursor's platform/native dependencies?              | Yes on Node 22/24. CI's packed-consumer smoke proves import and model construction without network execution.                                                                                                      | Keep the smoke on both Node lines; add live platform coverage separately.                        |
| **A-14** | Do concatenated text deltas equal terminal `RunResult.result`?                      | Deltas are canonical. Terminal text is exposed as metadata and used only when a finished run emitted no text deltas, with a compatibility warning.                                                                 | Compare both text sources on varied runs.                                                        |
| **A-15** | Are `partial-tool-call` values snapshots or true deltas?                            | They are treated as cumulative snapshots. Default typed output drops them; experimental mode emits them as preliminary results, never fabricated input deltas.                                                     | Capture real partial sequences before changing the model.                                        |
| **A-16** | Should a resumed conversation preserve its current mode when no mode is configured? | Yes. The provider omits `SendOptions.mode` unless the call or model explicitly configures it, matching the SDK's documented omit-to-preserve behavior.                                                             | Resume a plan-mode agent with and without explicit `mode: 'plan'` and verify the effective mode. |
| **A-17** | Can `partial-tool-call` arrive before `tool-call-started` or after completion?      | Yes. Known but uncorrelated/late partial snapshots are dropped with one compatibility warning rather than failing the stream; unknown semantic event types still fail closed.                                      | Capture real partial/start/completion ordering for built-in, MCP, and custom tools.              |

## SDK 1.0.31 live validation (2026-09-07)

Both the v7 (`1.0.1`) and v6 (`0.1.1`) worktrees passed all seven live integration tests on
Node 24 with SDK `1.0.31` and `CURSOR_REASONING_MODEL=composer-2.5`: generation, streaming,
inline images, usage, reasoning, session resume, and cancellation. The first run found a corrupt
image fixture; the corrected PNG passes and is now checked for the expected red color.

Real cloud generation with `cloud.agentServeAgent` also finished successfully on both branches.
This verifies backend option acceptance and provider execution. Actual seeded skill discovery
remains unverified: an attempt to upload a unique synthetic skill through Cursor's published
`@cursor/july@0.1.102` user-store client failed at
`POST https://api.cursor.com/v0/agent-serve-files/user/upload` with `Not found` (404), before any
skill was uploaded.

Real `systemPrompt` requests on both branches failed with
`[invalid_argument] unknown option '--system-prompt'`. The installed SDK and npm's latest version
were both `1.0.31`; its bundled runtime forwards `customSystemPrompt` to the server, and the SDK
option documentation describes this server-side access gate. Successful harness replacement and
resume with a replacement prompt remain blocked by server availability/access, not established
by the mocked tests. The failure is propagated to the caller rather than silently falling back.

Reproduce the option probes (requires a real API key; cloud creates then archives a test agent):

```bash
npm run smoke:sdk-options -- system-prompt
npm run smoke:sdk-options -- cloud
```

The system-prompt probe uses a disposable workspace and explicit JSONL store, checks one unique
response marker on creation, then a different marker after cross-provider resume. It exits with
failure when the server rejects the option. The cloud probe tests option acceptance without
claiming seeded skill discovery.

## Additional live-only surfaces

The following are passed through according to published types and documentation but cannot be
fully verified by unit fixtures alone:

- Which model IDs, aliases, parameters, and reasoning variants a specific account can use.
- Acceptance and billing behavior for user vs service-account API keys, and server-side policy
  failures for unsupported key classes.
- Cloud repository access, saved environments, self-hosted pools/machines, cloud environment
  variables, automatic PR creation, and returned git metadata.
- End-to-end execution and payload shapes for local custom tools, inline MCP servers, file-based MCP
  configuration, and inline/file-based subagents. Built-in tool visibility was confirmed only at the
  dynamic/provider-executed structural level; payload shapes remain explicitly unstable.
- Cursor's permission, sandbox, and auto-review behavior on each supported platform.
- Cross-process portability for explicit JSONL and custom stores, including visibility under
  different `cwd` values. Default-store cross-instance resume is a confirmed limitation in the
  validated environment, not an open promise.
- Exact server error codes, status values, request IDs, and retryability for authentication, rate
  limits, network failures, integration failures, and externally busy agents. The stale local ID
  path was confirmed as `agent_not_found`.
- Cancellation effectiveness for a tool already executing and behavior after a process crash.

## What is verified without a live key

- Strict settings/provider-option validation and drift guards for every published Cursor option and
  interaction-update discriminant used by the adapter.
- Prompt conversion for text, inline/URL images, system policies, history policies, and flattening.
- Event normalization, redaction, block ordering, tool ordering, usage mapping, finish mapping, and
  error mapping against captured fixtures and real error classes.
- AI SDK v7 `generateText`, `streamText`, object parsing/warning behavior, and abort propagation over
  a fake Cursor agent.
- Package build, declarations, publication layout, and packed-consumer importability.

Update this register when live evidence replaces an assumption; do not silently turn an assumption
into a documented guarantee.
