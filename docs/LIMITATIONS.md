# Known limitations

This provider adapts an autonomous Cursor agent to the AI SDK language-model contract. The largest
differences from a conventional chat-completions provider are intentional.

## Prompts and conversations

- Cursor root agents have no system-role field. System messages reject by default. `prefix` embeds
  them in user text and `ignore` drops them; neither preserves system authority.
- Cursor agents own durable conversation state. Arbitrary AI SDK role history rejects by default.
  `ignore` sends only the newest user turn, while `flatten` serializes roles/tool data into lossy
  text.
- Only images are accepted as structured user file input. Provider references, tagged text files,
  PDFs, audio, and other files are dropped with warnings.
- Images from earlier flattened turns are replaced with a text marker; only latest-turn images are
  attached.

Use one model instance or resume an `agentId` instead of replaying a transcript. See
[sessions.md](sessions.md).

## Tools and approvals

- AI SDK function/provider tools are not connected to Cursor. Cursor executes its own built-in,
  MCP, subagent, and local custom tools.
- Non-automatic AI SDK tool choice is ignored with a warning.
- Cursor tool names, argument shapes, and result shapes can change. All emitted tool parts are
  dynamic. `providerExecuted: true` appears on `tool-input-start` and `tool-call`, the V4 parts that
  define it; observe Cursor tools, but do not execute them again.
- Input "deltas" are full JSON snapshots, not verified incremental JSON fragments.
- Preliminary tool results are experimental and off by default.
- The AI SDK tool-approval request/response protocol is not implemented. Cursor's raw on-delta
  surface does not expose a stable mapping for it.

## Generation and output

- Temperature, top-p, top-k, presence/frequency penalties, seed, stop sequences, and maximum output
  tokens have no Cursor SDK equivalent and are ignored with typed warnings.
- AI SDK reasoning effort is ignored. Select an account-available model parameter or variant with
  `modelParams` instead.
- JSON/object generation is prompt-and-validate only. Cursor does not constrain output to the
  requested schema, so parsing and validation can fail.
- Cursor reports run status, not a model stop reason. The provider never claims length,
  content-filter, or tool-call termination.
- There are no source/citation or file output parts. Cursor edits its workspace; cloud artifacts are
  available only through a raw/injected Cursor `SDKAgent`.
- No embeddings, image generation, transcription, speech, reranking, V7 files, or V7 skills
  provider surface is implemented.

## Runtime and persistence

- Node.js 22.13 or newer is required. The package is ESM-only and does not run in browsers or Edge
  runtimes.
- Local agents persist state on disk by default. Serverless or ephemeral filesystems can lose
  session continuity; choose cloud mode or an appropriate local store.
- Inline MCP servers are not persisted by Cursor. The provider re-passes configured
  `settings.mcpServers` on explicit resume.
- One agent's sends are serialized. This avoids checkpoint races but means concurrent calls on one
  model/agent wait for each other.
- `providerOptions.cursor.localForce` can expire a stuck local persisted run. It is a recovery knob,
  not a normal concurrency mode.
- Provider cleanup calls synchronous `SDKAgent.close()` for provider-owned handles. Injected agents
  always remain caller-owned.

## Raw data and compatibility warnings

Requested raw chunks are recursively redacted, but redaction is defensive rather than a formal data
loss prevention boundary. Avoid putting secrets into prompts or tool payloads unnecessarily.

Late compatibility warnings are represented by provider raw parts so streaming consumers can see
runtime protocol drift. The provider emits those warning parts even when its low-level
`includeRawChunks` flag is false; standard AI SDK streaming filters raw parts unless the application
requests them.

For the complete feature-by-feature classification, see [GAP_ANALYSIS.md](GAP_ANALYSIS.md). For
runtime claims still needing a live key, see [ASSUMPTIONS.md](ASSUMPTIONS.md).
