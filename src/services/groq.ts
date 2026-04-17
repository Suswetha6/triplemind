import type { Suggestion } from '../types';

const GROQ_BASE = 'https://api.groq.com/openai/v1';

export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  model: string
): Promise<string> {
  const form = new FormData();
  form.append('file', audioBlob, 'audio.webm');
  form.append('model', model);
  form.append('response_format', 'text');

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Transcription error ${res.status}: ${err}`);
  }
  return res.text();
}

export async function generateSuggestions(
  prompt: string,
  apiKey: string,
  model: string
): Promise<Suggestion[]> {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Suggestions error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const raw = JSON.parse(data.choices[0].message.content);
  const items: Suggestion[] = (raw.suggestions ?? raw).map(
    (s: Omit<Suggestion, 'id'>, i: number) => ({
      ...s,
      id: `${Date.now()}-${i}`,
    })
  );
  return items.slice(0, 3);
}

export async function* streamChat(
  messages: { role: string; content: string }[],
  apiKey: string,
  model: string
): AsyncGenerator<string> {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    }),
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
