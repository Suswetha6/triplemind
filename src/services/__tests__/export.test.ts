import { describe, expect, it } from 'vitest';
import type { ChatMessage, SuggestionBatch, TranscriptChunk } from '../../types';
import { buildExport } from '../export';

const AT = Date.parse('2026-04-17T10:00:00.000Z');

describe('buildExport', () => {
  it('renders every section with ISO timestamps', () => {
    const transcript: TranscriptChunk[] = [{ id: 't1', text: 'Q3 numbers came in', timestamp: AT }];
    const batches: SuggestionBatch[] = [
      {
        id: 'b1',
        timestamp: AT + 35_000,
        suggestions: [{ id: 's1', title: 'Why the shortfall?', preview: 'Because…', type: 'question' }],
      },
    ];
    const chat: ChatMessage[] = [
      { id: 'c1', role: 'user', content: 'tell me more', timestamp: AT + 60_000 },
    ];

    const result = buildExport(transcript, batches, chat);

    expect(result.transcript).toEqual([
      { timestamp: '2026-04-17T10:00:00.000Z', text: 'Q3 numbers came in' },
    ]);
    expect(result.suggestionBatches[0].timestamp).toBe('2026-04-17T10:00:35.000Z');
    expect(result.chat[0]).toEqual({
      timestamp: '2026-04-17T10:01:00.000Z',
      role: 'user',
      content: 'tell me more',
    });
    expect(Date.parse(result.exportedAt)).not.toBeNaN();
  });

  it('drops internal ids from the exported payload', () => {
    const result = buildExport(
      [],
      [
        {
          id: 'b1',
          timestamp: AT,
          suggestions: [{ id: 'secret', title: 't', preview: 'p', type: 'answer' }],
        },
      ],
      []
    );
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('handles an empty session', () => {
    const result = buildExport([], [], []);
    expect(result).toMatchObject({ transcript: [], suggestionBatches: [], chat: [] });
  });
});
