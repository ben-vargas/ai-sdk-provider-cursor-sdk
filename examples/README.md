# Examples

Every example requires Node.js 22.13+ and `CURSOR_API_KEY`. Build/typecheck the repository, then run
an example with `tsx`:

```bash
export CURSOR_API_KEY="your-key"
npm run build
npx tsx examples/basic-usage.ts
```

Examples import the local source so they remain typecheckable before `dist/` exists.

| Example                                              | Demonstrates                                      |
| ---------------------------------------------------- | ------------------------------------------------- |
| [`basic-usage.ts`](basic-usage.ts)                   | `generateText`, usage, and terminal metadata      |
| [`streaming.ts`](streaming.ts)                       | `streamText` text deltas                          |
| [`reasoning-stream.ts`](reasoning-stream.ts)         | Separate reasoning and answer deltas              |
| [`images.ts`](images.ts)                             | Inline base64 and remote URL image input          |
| [`tool-visibility.ts`](tool-visibility.ts)           | Observing provider-executed tool calls/results    |
| [`custom-tools.ts`](custom-tools.ts)                 | Local Cursor callback tools                       |
| [`session-management.ts`](session-management.ts)     | Model reuse and explicit `agentId` resume         |
| [`conversation-history.ts`](conversation-history.ts) | Lossy `ignore` and `flatten` history policies     |
| [`cloud-agent.ts`](cloud-agent.ts)                   | Cloud runtime settings and git metadata           |
| [`abort-signal.ts`](abort-signal.ts)                 | Cancelling a live run with the original reason    |
| [`usage-metadata.ts`](usage-metadata.ts)             | AI SDK usage vs raw Cursor usage/metadata         |
| [`raw-chunks.ts`](raw-chunks.ts)                     | Redacted raw `InteractionUpdate` chunks           |
| [`limitations.ts`](limitations.ts)                   | Unsupported/compatibility/other warnings          |
| [`list-models.ts`](list-models.ts)                   | Account-specific `Cursor.models.list()` discovery |
| [`error-handling.ts`](error-handling.ts)             | Authentication, busy, and stale-agent helpers     |
| [`logging-verbose.ts`](logging-verbose.ts)           | Custom verbose diagnostics and callbacks          |
| [`integration-test.ts`](integration-test.ts)         | Manual basic, streaming, and session smoke        |

Most examples use local mode against `process.cwd()`, which lets Cursor read and modify that
workspace and execute tools. Use an isolated test repository and appropriate Cursor sandbox/policy
settings. `custom-tools.ts` exposes an in-process tool. `cloud-agent.ts` can create cloud resources
and may open a PR when you opt in through environment variables.

Optional environment variables:

- `CURSOR_MODEL` — model used by most examples (default `auto`)
- `CURSOR_REASONING_MODEL` — reasoning-capable model for `reasoning-stream.ts`
- `CURSOR_IMAGE_URL` — remote image URL for the second half of `images.ts`
- `CURSOR_CLOUD_REPO` — Git repository URL for `cloud-agent.ts`
- `CURSOR_CLOUD_REF` — starting ref (default `main`)
- `CURSOR_CLOUD_AUTO_PR=1` — allow `cloud-agent.ts` to request automatic PR creation

The automated live suite is a separate explicit gate:

```bash
CURSOR_API_KEY=... CURSOR_INTEGRATION=1 npm run test:integration
```
