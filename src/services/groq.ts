import type { Suggestion } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '') + '/api';

export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  model: string
): Promise<string> {
  const form = new FormData();
  form.append('file', audioBlob, 'audio.webm');
  form.append('model', model);

  const res = await fetch(`${API_BASE}/transcribe`, {
    method: 'POST',
    headers: { 'X-Groq-API-Key': apiKey },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Transcription error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.text;
}

export async function generateSuggestions(
  prompt: string,
  apiKey: string,
  model: string
): Promise<Suggestion[]> {
  const res = await fetch(`${API_BASE}/suggestions`, {
    method: 'POST',
    headers: {
      'X-Groq-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, model }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Suggestions error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (data.suggestions as Omit<Suggestion, 'id'>[])
    .map((s, i) => ({ ...s, id: `${Date.now()}-${i}` }))
    .slice(0, 3);
}

export async function* streamChat(
  messages: { role: string; content: string }[],
  apiKey: string,
  model: string
): AsyncGenerator<string> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'X-Groq-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages, model }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Chat error ${res.status}: ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        // malformed SSE chunk — skip
      }
    }
  }
}
