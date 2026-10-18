import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSuggestions, streamChat, transcribeAudio } from '../groq';

const API_KEY = 'gsk_test_key';

function mockFetch(impl: (url: string, init: RequestInit) => Response) {
  const spy = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(url), init ?? {}))
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('transcribeAudio', () => {
  it('posts the chunk with the key header and returns the text', async () => {
    const spy = mockFetch(() => new Response(JSON.stringify({ text: 'hello' })));
    const text = await transcribeAudio(new Blob(['x']), API_KEY, 'whisper-large-v3');

    expect(text).toBe('hello');
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe('/api/transcribe');
    expect((init as RequestInit).headers).toMatchObject({ 'X-Groq-API-Key': API_KEY });
  });

  it('throws with the status when the backend rejects the chunk', async () => {
    mockFetch(() => new Response('too large', { status: 413 }));
    await expect(transcribeAudio(new Blob(['x']), API_KEY, 'm')).rejects.toThrow(
      /Transcription error 413/
    );
  });
});

describe('generateSuggestions', () => {
  it('caps a batch at three cards and assigns ids', async () => {
    const suggestions = Array.from({ length: 5 }, (_, i) => ({
      title: `t${i}`,
      preview: 'p',
      type: 'question',
    }));
    mockFetch(() => new Response(JSON.stringify({ suggestions })));

    const result = await generateSuggestions('prompt', API_KEY, 'model');

    expect(result).toHaveLength(3);
    expect(new Set(result.map((s) => s.id)).size).toBe(3);
  });
});

describe('streamChat', () => {
  it('yields only the content deltas from the SSE frames', async () => {
    mockFetch(
      () =>
        new Response(
          sseStream([
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
            'data: [DONE]\n',
          ])
        )
    );

    const tokens: string[] = [];
    for await (const token of streamChat([{ role: 'user', content: 'hi' }], API_KEY, 'm')) {
      tokens.push(token);
    }
    expect(tokens.join('')).toBe('Hello');
  });

  it('survives a frame split across two network chunks', async () => {
    // The backend streams through nginx unbuffered, so a JSON frame can arrive
    // in pieces; the reader must buffer rather than drop it.
    mockFetch(
      () =>
        new Response(
          sseStream(['data: {"choices":[{"delta":{"con', 'tent":"split"}}]}\n', 'data: [DONE]\n'])
        )
    );

    const tokens: string[] = [];
    for await (const token of streamChat([{ role: 'user', content: 'hi' }], API_KEY, 'm')) {
      tokens.push(token);
    }
    expect(tokens).toEqual(['split']);
  });

  it('skips malformed frames instead of aborting the stream', async () => {
    mockFetch(
      () =>
        new Response(
          sseStream([
            'data: not-json\n',
            'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
            'data: [DONE]\n',
          ])
        )
    );

    const tokens: string[] = [];
    for await (const token of streamChat([{ role: 'user', content: 'hi' }], API_KEY, 'm')) {
      tokens.push(token);
    }
    expect(tokens).toEqual(['ok']);
  });

  it('throws before streaming when the backend returns an error status', async () => {
    mockFetch(() => new Response('rate limited', { status: 429 }));
    const iterator = streamChat([{ role: 'user', content: 'hi' }], API_KEY, 'm');
    await expect(iterator.next()).rejects.toThrow(/Chat error 429/);
  });
});
