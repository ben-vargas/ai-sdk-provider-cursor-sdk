# Examples

These examples target AI SDK v6 (`ai@^6`) and require Node.js 22.13 or newer and a Cursor API key.
Consumer projects should install the v6 SDK alongside this provider:

```bash
npm install ai@^6 ai-sdk-provider-cursor-sdk
```

From this checkout, install dependencies, build the provider, and run an example with `tsx`:

```bash
npm install
npm run build
export CURSOR_API_KEY="your-key"
npx tsx examples/basic-usage.ts
```

Every model example uses `process.env.CURSOR_MODEL ?? 'composer-2.5'`. `composer-2.5` is the
recommended default because it currently offers the best quota/cost fit for this suite; set
`CURSOR_MODEL` only when your account exposes another model you need to exercise. Run
[`list-models.ts`](list-models.ts) to discover account-specific access.

Examples that need local Cursor access create a disposable workspace under the operating system's
temporary directory and remove it after `provider.close()`. They do not inspect the repository from
which you invoke them. The repository-edit example changes only its generated fixture. Cursor runs
can execute tools, so inspect an example before adapting it to a real workspace.

If `CURSOR_API_KEY` is unset, every example prints a skip message and exits successfully. The commands
below call the real Cursor API and consume quota when the key is present.

## Suggested learning path

1. Run `basic-usage.ts` to see the result contract.
2. Run `streaming.ts` to see multiple deltas and terminal metadata.
3. Run `conversation-history.ts` to learn the recommended multi-turn pattern.
4. Run `tool-visibility.ts`, then `local-repository-edit.ts`, for agent-native work.
5. Use the observability, limitations, and persistence examples when those concerns apply.

Cloud is deliberately excluded from this local-first path.

## Quick start

| Example                            | Run                               | Interesting output                                                      |
| ---------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| [`basic-usage.ts`](basic-usage.ts) | `npx tsx examples/basic-usage.ts` | Text, `stop`, mapped/cache usage, and selected terminal Cursor metadata |
| [`streaming.ts`](streaming.ts)     | `npx tsx examples/streaming.ts`   | Incremental text, observed delta count, usage, and final run metadata   |

## Agent-native workflows

| Example                                                | Run                                         | Interesting output / side effects                                                                               |
| ------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`tool-visibility.ts`](tool-visibility.ts)             | `npx tsx examples/tool-visibility.ts`       | Provider-executed/dynamic flags and safe structural summaries from a read-only fixture                          |
| [`custom-tools.ts`](custom-tools.ts)                   | `npx tsx examples/custom-tools.ts`          | In-process callback invocation plus provider-executed custom-tool parts; live-smoke this surface before release |
| [`local-repository-edit.ts`](local-repository-edit.ts) | `npx tsx examples/local-repository-edit.ts` | A failing test, Cursor's isolated source edit/tool activity, and the passing test rerun                         |

## Sessions

| Example                                              | Run                                        | Interesting output                                                                                       |
| ---------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [`conversation-history.ts`](conversation-history.ts) | `npx tsx examples/conversation-history.ts` | Native retained context and a stable `agentId` from reusing one model instance                           |
| [`session-management.ts`](session-management.ts)     | `npx tsx examples/session-management.ts`   | Advanced cross-instance resume through two `JsonlLocalAgentStore` objects sharing one explicit directory |

For ordinary multi-turn work, reuse the same model object and send a fresh single-user prompt on each
call. Do not replay assistant/tool history. Cross-instance local resume against the default store
failed live validation with `agent_not_found`; only teach explicit local persistence with a declared
store and compatible workspace routing. See [session management](../docs/sessions.md).

## Observability and control

| Example                                    | Run                                   | Interesting output                                                                      |
| ------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------- |
| [`usage-metadata.ts`](usage-metadata.ts)   | `npx tsx examples/usage-metadata.ts`  | AI SDK totals/cache fields beside Cursor terminal usage                                 |
| [`logging-verbose.ts`](logging-verbose.ts) | `npx tsx examples/logging-verbose.ts` | Verbose logs, ordered lifecycle callbacks, and correlated run/request IDs               |
| [`raw-chunks.ts`](raw-chunks.ts)           | `npx tsx examples/raw-chunks.ts`      | Redacted diagnostic event-type counts via v6's `includeRawChunks: true`                 |
| [`abort-signal.ts`](abort-signal.ts)       | `npx tsx examples/abort-signal.ts`    | Abort after the first text delta and identity verification of the original abort reason |

Raw chunks are diagnostic and unstable. Do not treat their payloads as a versioned application
schema.

## Inputs and discovery

| Example                            | Run                                                      | Interesting output                                                    |
| ---------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| [`images.ts`](images.ts)           | `npx tsx examples/images.ts [optional-local-image-path]` | Analysis of a bundled visual fixture plus finish, usage, and metadata |
| [`list-models.ts`](list-models.ts) | `npx tsx examples/list-models.ts`                        | Compact account-specific IDs, aliases, parameters, and variants       |

`images.ts` uses inline local bytes. Remote URL input remains excluded because that path has not been
live-validated separately.

## Limitations and recovery

| Example                                  | Run                                  | Interesting output                                                                                       |
| ---------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [`limitations.ts`](limitations.ts)       | `npx tsx examples/limitations.ts`    | Feature-labeled warnings for sampling, system/history policies, application tools, and structured output |
| [`error-handling.ts`](error-handling.ts) | `npx tsx examples/error-handling.ts` | A deterministic `agent_not_found` classification followed by fresh-session recovery                      |

## Cloud opt-in

| Example                            | Run                                                                                                      | Interesting output / side effects                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`cloud-agent.ts`](cloud-agent.ts) | `CURSOR_CLOUD_EXAMPLE=1 CURSOR_CLOUD_REPO=https://github.com/OWNER/REPO npx tsx examples/cloud-agent.ts` | Read-only plan-mode report plus agent/run/git metadata |

The cloud example also requires `CURSOR_API_KEY`; `CURSOR_CLOUD_REF` optionally overrides `main`.
It can create cloud agent resources and depends on repository permissions, so it has a separate
`CURSOR_CLOUD_EXAMPLE=1` gate. It never requests automatic pull-request creation. Cloud repository
and git-metadata behavior remain live-only surfaces and must be smoke-tested for the target account.

## Maintainer verification

| Example                                      | Run                                    | Interesting output                                                                                               |
| -------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`integration-test.ts`](integration-test.ts) | `npx tsx examples/integration-test.ts` | Assertions for the full generated result, multiple stream deltas, stable same-model context, and abort rejection |

This manual smoke consumes several live calls. It is not part of the end-user learning path or the
automated no-key test suite. The repository's separately gated Vitest live suite is:

```bash
CURSOR_API_KEY=... CURSOR_INTEGRATION=1 npm run test:integration
```
