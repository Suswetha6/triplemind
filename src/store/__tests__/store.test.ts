import { beforeEach, describe, expect, it } from 'vitest';
import { getFullTranscript, getRecentTranscript, useStore } from '../store';
import type { TranscriptChunk } from '../../types';

const chunk = (id: string, text: string): TranscriptChunk => ({ id, text, timestamp: 0 });

beforeEach(() => {
  useStore.getState().clearSession();
});

describe('session store', () => {
  it('appends transcript chunks in arrival order', () => {
    useStore.getState().addTranscriptChunk(chunk('1', 'first'));
    useStore.getState().addTranscriptChunk(chunk('2', 'second'));
    expect(useStore.getState().transcript.map((c) => c.text)).toEqual(['first', 'second']);
  });

  it('prepends suggestion batches so the newest renders on top', () => {
    useStore.getState().prependSuggestionBatch({ id: 'old', suggestions: [], timestamp: 1 });
    useStore.getState().prependSuggestionBatch({ id: 'new', suggestions: [], timestamp: 2 });
    expect(useStore.getState().suggestionBatches.map((b) => b.id)).toEqual(['new', 'old']);
  });

  it('splices streamed tokens onto the trailing assistant message', () => {
    const store = useStore.getState();
    store.addChatMessage({ id: 'u', role: 'user', content: 'hi', timestamp: 0 });
    store.addChatMessage({ id: 'a', role: 'assistant', content: '', timestamp: 0 });
    store.appendLastAssistantMessage('He');
    store.appendLastAssistantMessage('llo');

    const messages = useStore.getState().chatMessages;
    expect(messages.at(-1)?.content).toBe('Hello');
    expect(messages[0].content).toBe('hi');
  });

  it('ignores streamed tokens when the last message is from the user', () => {
    useStore.getState().addChatMessage({ id: 'u', role: 'user', content: 'hi', timestamp: 0 });
    useStore.getState().appendLastAssistantMessage('stray');
    expect(useStore.getState().chatMessages.at(-1)?.content).toBe('hi');
  });

  it('clearSession wipes session data but keeps settings', () => {
    useStore.getState().updateSettings({ groqApiKey: 'gsk_x' });
    useStore.getState().addTranscriptChunk(chunk('1', 'text'));
    useStore.getState().clearSession();

    expect(useStore.getState().transcript).toEqual([]);
    expect(useStore.getState().settings.groqApiKey).toBe('gsk_x');
  });
});

describe('transcript selectors', () => {
  it('joins chunks with newlines', () => {
    expect(getFullTranscript([chunk('1', 'a'), chunk('2', 'b')])).toBe('a\nb');
  });

  it('returns only the trailing window when over the cap', () => {
    const chunks = [chunk('1', 'x'.repeat(100)), chunk('2', 'y'.repeat(100))];
    const recent = getRecentTranscript(chunks, 50);
    expect(recent).toHaveLength(50);
    expect(recent).toBe('y'.repeat(50));
  });

  it('returns everything when under the cap', () => {
    expect(getRecentTranscript([chunk('1', 'short')], 1000)).toBe('short');
  });
});
