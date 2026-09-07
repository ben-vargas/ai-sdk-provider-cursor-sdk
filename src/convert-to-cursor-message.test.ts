import {
  UnsupportedFunctionalityError,
  type LanguageModelV4Prompt,
  type LanguageModelV4ToolResultOutput,
} from '@ai-sdk/provider';
import { convertToCursorMessage, type CursorPromptPolicy } from './convert-to-cursor-message.js';

function policy(overrides: Partial<CursorPromptPolicy> = {}): CursorPromptPolicy {
  return {
    promptHistoryMode: 'reject',
    systemMessageMode: 'reject',
    isSessionContinuation: false,
    ...overrides,
  };
}

function historyPrompt(): LanguageModelV4Prompt {
  return [
    { role: 'system', content: 'Be precise.' },
    { role: 'user', content: [{ type: 'text', text: 'First' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'Latest' }] },
  ];
}

describe('convertToCursorMessage', () => {
  it('joins text parts and omits the images key when absent', () => {
    expect(
      convertToCursorMessage(
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'one' },
              { type: 'text', text: 'two' },
            ],
          },
        ],
        policy()
      )
    ).toEqual({ message: { text: 'one\n\ntwo' }, warnings: [] });
  });

  it.each(['reject', 'ignore', 'prefix'] as const)(
    'rejects history before applying system mode %s when history mode is reject',
    (systemMessageMode) => {
      let thrown: unknown;
      try {
        convertToCursorMessage(
          historyPrompt(),
          policy({ promptHistoryMode: 'reject', systemMessageMode })
        );
      } catch (error) {
        thrown = error;
      }
      expect(UnsupportedFunctionalityError.isInstance(thrown)).toBe(true);
      expect(thrown).toMatchObject({ functionality: 'prompt.history' });
      expect(thrown).toHaveProperty(
        'message',
        expect.stringMatching(/cannot ingest an arbitrary message history/)
      );
    }
  );

  it('enriches history rejection for an existing Cursor session', () => {
    const convert = (isSessionContinuation: boolean) => {
      try {
        convertToCursorMessage(
          [
            { role: 'user', content: [{ type: 'text', text: 'First' }] },
            { role: 'user', content: [{ type: 'text', text: 'Second' }] },
          ],
          policy({ isSessionContinuation })
        );
      } catch (error) {
        return error;
      }
      throw new Error('expected history rejection');
    };

    expect((convert(false) as Error).message).not.toContain(
      'already targets an existing Cursor session'
    );
    expect((convert(true) as Error).message).toContain(
      'already targets an existing Cursor session'
    );
  });

  it.each([
    ['ignore', 'reject', 'system-error'],
    ['ignore', 'ignore', 'Latest'],
    ['ignore', 'prefix', '<system>\nBe precise.\n</system>\n\nLatest'],
    ['flatten', 'reject', 'system-error'],
    ['flatten', 'ignore', 'Human: First\n\nAssistant: Earlier answer\n\nHuman: Latest'],
    [
      'flatten',
      'prefix',
      '<system>\nBe precise.\n</system>\n\nHuman: First\n\nAssistant: Earlier answer\n\nHuman: Latest',
    ],
  ] as const)(
    'applies history mode %s with system mode %s',
    (promptHistoryMode, systemMessageMode, expected) => {
      const convert = (): ReturnType<typeof convertToCursorMessage> =>
        convertToCursorMessage(historyPrompt(), policy({ promptHistoryMode, systemMessageMode }));
      if (expected === 'system-error') {
        let thrown: unknown;
        try {
          convert();
        } catch (error) {
          thrown = error;
        }
        expect(UnsupportedFunctionalityError.isInstance(thrown)).toBe(true);
        expect(thrown).toMatchObject({ functionality: 'prompt.system' });
        return;
      }
      const result = convert();
      expect(result.message.text).toBe(expected);
      expect(result.warnings).toContainEqual(
        promptHistoryMode === 'ignore'
          ? {
              type: 'other',
              message:
                'promptHistoryMode "ignore": earlier prompt messages were not sent; the Cursor agent supplies conversation state.',
            }
          : {
              type: 'compatibility',
              feature: 'prompt.history',
              details:
                'History was flattened into a single Cursor user message; roles, tool calls and results were serialized as text.',
            }
      );
      expect(result.warnings).toContainEqual(
        systemMessageMode === 'ignore'
          ? {
              type: 'unsupported',
              feature: 'prompt.system',
              details:
                'AI SDK system messages were ignored; configure systemPrompt explicitly to replace the local Cursor harness prompt.',
            }
          : {
              type: 'compatibility',
              feature: 'prompt.system',
              details:
                'System messages were prefixed to the Cursor user message and do not retain system-role semantics.',
            }
      );
    }
  );

  it('concatenates non-empty system messages and silently drops blank ones', () => {
    const result = convertToCursorMessage(
      [
        { role: 'system', content: 'First system' },
        { role: 'system', content: '   ' },
        { role: 'system', content: 'Second system' },
        { role: 'user', content: [{ type: 'text', text: 'Question' }] },
      ],
      policy({ systemMessageMode: 'prefix' })
    );
    expect(result.message.text).toBe(
      '<system>\nFirst system\n\nSecond system\n</system>\n\nQuestion'
    );
  });

  it('converts inline bytes, base64 strings, data URLs, and remote image URLs', () => {
    const result = convertToCursorMessage(
      [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              mediaType: 'image/png',
              data: { type: 'data', data: new Uint8Array([104, 105]) },
            },
            {
              type: 'file',
              mediaType: 'image/jpeg',
              data: { type: 'data', data: 'aGVsbG8=' },
            },
            {
              type: 'file',
              mediaType: 'image/gif',
              data: { type: 'data', data: 'data:image/gif;base64,R0lGODlh' },
            },
            {
              type: 'file',
              mediaType: 'image/svg+xml',
              data: {
                type: 'data',
                data: 'data:image/svg+xml;charset=utf-8;base64,PHN2Zz4=',
              },
            },
            {
              type: 'file',
              mediaType: 'image/webp',
              data: { type: 'url', url: new URL('https://example.test/image.webp') },
            },
          ],
        },
      ],
      policy()
    );
    expect(result.message).toEqual({
      text: '',
      images: [
        { data: 'aGk=', mimeType: 'image/png' },
        { data: 'aGVsbG8=', mimeType: 'image/jpeg' },
        { data: 'R0lGODlh', mimeType: 'image/gif' },
        { data: 'PHN2Zz4=', mimeType: 'image/svg+xml' },
        { url: 'https://example.test/image.webp' },
      ],
    });
  });

  it('warns and drops V4 provider-reference and tagged-text image data', () => {
    const result = convertToCursorMessage(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'keep' },
            {
              type: 'file',
              mediaType: 'image/png',
              data: { type: 'reference', reference: { cursor: 'image-1' } },
            },
            {
              type: 'file',
              mediaType: 'image/svg+xml',
              data: { type: 'text', text: '<svg />' },
            },
          ],
        },
      ],
      policy()
    );

    expect(result.message).toEqual({ text: 'keep' });
    expect(result.warnings).toEqual([
      {
        type: 'unsupported',
        feature: 'prompt.user.file.reference',
        details: 'Provider file references are not supported; supply inline data or a URL.',
      },
      {
        type: 'unsupported',
        feature: 'prompt.user.file.text',
        details: 'Text-backed image files are not supported; supply inline data or a URL.',
      },
    ]);
  });

  it('warns and drops non-image and unknown user parts', () => {
    const result = convertToCursorMessage(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'keep' },
            {
              type: 'file',
              mediaType: 'application/pdf',
              data: { type: 'data', data: 'cGRm' },
            },
            { type: 'audio', data: 'ignored' } as never,
          ],
        },
      ],
      policy()
    );
    expect(result.message).toEqual({ text: 'keep' });
    expect(result.warnings).toEqual([
      {
        type: 'unsupported',
        feature: 'prompt.user.file',
        details:
          'Unsupported file part (application/pdf) was ignored; Cursor accepts only image attachments.',
      },
      { type: 'other', message: "Unsupported user part 'audio' was skipped." },
    ]);
  });

  it('flattens assistant tool calls/results and tool-role results with documented formats', () => {
    const result = convertToCursorMessage(
      [
        { role: 'user', content: [{ type: 'text', text: 'Use tools' }] },
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: { q: 'x' } },
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'lookup',
              output: { type: 'json', value: { answer: 1 } },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c2',
              toolName: 'shell',
              output: {
                type: 'content',
                value: [
                  { type: 'text', text: 'stdout' },
                  {
                    type: 'file',
                    mediaType: 'text/plain',
                    data: { type: 'data', data: 'ZmlsZQ==' },
                  },
                  { type: 'custom' },
                ],
              },
            },
            { type: 'tool-approval-response', approvalId: 'a1', approved: true },
          ],
        },
        { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
      ],
      policy({ promptHistoryMode: 'flatten' })
    );

    expect(result.message.text).toBe(
      'Human: Use tools\n\n' +
        'Assistant: [Tool call: lookup({"q":"x"})]\n' +
        'Tool Result (lookup): {"answer":1}\n\n' +
        'Tool Result (shell): stdout\n' +
        '[file omitted]\n[custom omitted]\n\n' +
        'Human: Continue'
    );
  });

  it.each([
    [{ type: 'text', value: 'plain text' }, 'plain text'],
    [{ type: 'error-text', value: 'plain error' }, 'plain error'],
    [{ type: 'error-json', value: { message: 'boom' } }, '{"message":"boom"}'],
    [{ type: 'execution-denied', reason: 'not allowed' }, '[execution denied]'],
  ] satisfies Array<[LanguageModelV4ToolResultOutput, string]>)(
    'serializes flattened %s tool results exactly',
    (output, serialized) => {
      const result = convertToCursorMessage(
        [
          { role: 'user', content: [{ type: 'text', text: 'Run it' }] },
          {
            role: 'assistant',
            content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'tool', output }],
          },
          { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
        ],
        policy({ promptHistoryMode: 'flatten' })
      );
      expect(result.message.text).toContain(`Tool Result (tool): ${serialized}`);
    }
  );

  it('truncates serialized tool input at exactly 1000 characters', () => {
    const convertInput = (input: string) =>
      convertToCursorMessage(
        [
          { role: 'user', content: [{ type: 'text', text: 'First' }] },
          {
            role: 'assistant',
            content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'long', input }],
          },
          { role: 'user', content: [{ type: 'text', text: 'Last' }] },
        ],
        policy({ promptHistoryMode: 'flatten' })
      );

    expect(convertInput('x'.repeat(1001)).message.text).toContain(
      `[Tool call: long("${'x'.repeat(999)}...[truncated])]`
    );
    const exactly1000 = 'x'.repeat(998);
    expect(convertInput(exactly1000).message.text).toContain(
      `[Tool call: long(${JSON.stringify(exactly1000)})]`
    );
    expect(convertInput(exactly1000).message.text).not.toContain('...[truncated]');
  });

  it('omits V4 assistant reasoning, reasoning-file, custom, and file parts with warnings', () => {
    const result = convertToCursorMessage(
      [
        { role: 'user', content: [{ type: 'text', text: 'First' }] },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'secret thought' },
            {
              type: 'reasoning-file',
              mediaType: 'text/plain',
              data: { type: 'data', data: 'cmVhc29uaW5n' },
            },
            { type: 'custom', kind: 'cursor.note' },
            {
              type: 'file',
              mediaType: 'image/png',
              data: { type: 'data', data: 'aW1hZ2U=' },
            },
          ],
        },
        { role: 'user', content: [{ type: 'text', text: 'Last' }] },
      ],
      policy({ promptHistoryMode: 'flatten' })
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        {
          type: 'unsupported',
          feature: 'prompt.assistant.reasoning',
          details:
            'Assistant reasoning cannot be represented in a Cursor user message and was omitted.',
        },
        {
          type: 'unsupported',
          feature: 'prompt.assistant.reasoning-file',
          details:
            'Assistant reasoning files cannot be represented in a Cursor user message and were omitted.',
        },
        {
          type: 'unsupported',
          feature: 'prompt.assistant.custom',
          details:
            'Assistant custom content cannot be represented in a Cursor user message and was omitted.',
        },
        {
          type: 'unsupported',
          feature: 'prompt.assistant.file',
          details:
            'Assistant file content cannot be represented in flattened Cursor history and was omitted.',
        },
      ])
    );
    expect(result.message.text).not.toContain('secret thought');
  });

  it('attaches only final-turn images when flattening and warns for earlier images', () => {
    const result = convertToCursorMessage(
      [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              mediaType: 'image/png',
              data: { type: 'url', url: new URL('https://example.test/old.png') },
            },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'seen' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'new' },
            {
              type: 'file',
              mediaType: 'image/png',
              data: { type: 'url', url: new URL('https://example.test/new.png') },
            },
          ],
        },
      ],
      policy({ promptHistoryMode: 'flatten' })
    );
    expect(result.message.text).toContain('Human: [image omitted]');
    expect(result.message.images).toEqual([{ url: 'https://example.test/new.png' }]);
    expect(result.warnings).toContainEqual({
      type: 'compatibility',
      feature: 'prompt.history.image',
      details: 'An image from an earlier user turn was omitted while flattening prompt history.',
    });
  });

  it('treats two user turns without an assistant as history', () => {
    expect(() =>
      convertToCursorMessage(
        [
          { role: 'user', content: [{ type: 'text', text: 'First' }] },
          { role: 'user', content: [{ type: 'text', text: 'Second' }] },
        ],
        policy()
      )
    ).toThrow(/cannot ingest an arbitrary message history/);
  });

  it.each(['ignore', 'flatten'] as const)(
    'does not warn for a single-turn prompt in %s history mode',
    (promptHistoryMode) => {
      expect(
        convertToCursorMessage(
          [{ role: 'user', content: [{ type: 'text', text: 'Only turn' }] }],
          policy({ promptHistoryMode })
        ).warnings
      ).toEqual([]);
    }
  );

  it.each([
    { name: 'no messages', prompt: [] },
    { name: 'system only', prompt: [{ role: 'system', content: 'only system' }] },
    { name: 'empty user content', prompt: [{ role: 'user', content: [] }] },
    {
      name: 'whitespace-only user text',
      prompt: [{ role: 'user', content: [{ type: 'text', text: '   ' }] }],
    },
  ] satisfies Array<{ name: string; prompt: LanguageModelV4Prompt }>)(
    'rejects an empty effective prompt: $name',
    ({ prompt }) => {
      for (const promptHistoryMode of ['reject', 'ignore', 'flatten'] as const) {
        let thrown: unknown;
        try {
          convertToCursorMessage(prompt, policy({ promptHistoryMode }));
        } catch (error) {
          thrown = error;
        }
        expect(UnsupportedFunctionalityError.isInstance(thrown)).toBe(true);
        expect(thrown).toMatchObject({ functionality: 'prompt.empty' });
      }
    }
  );

  it('rejects a single user turn with a system message using the typed system contract', () => {
    let thrown: unknown;
    try {
      convertToCursorMessage(
        [
          { role: 'system', content: 'Be precise.' },
          { role: 'user', content: [{ type: 'text', text: 'Question' }] },
        ],
        policy()
      );
    } catch (error) {
      thrown = error;
    }
    expect(UnsupportedFunctionalityError.isInstance(thrown)).toBe(true);
    expect(thrown).toMatchObject({ functionality: 'prompt.system' });
  });
});
