import type { TranscriptChunk, SuggestionBatch, ChatMessage } from '../types';

interface SessionExport {
  exportedAt: string;
  transcript: { timestamp: string; text: string }[];
  suggestionBatches: {
    timestamp: string;
    suggestions: { type: string; title: string; preview: string }[];
  }[];
  chat: { timestamp: string; role: string; content: string }[];
}

function fmt(ts: number) {
  return new Date(ts).toISOString();
}

export function buildExport(
  transcript: TranscriptChunk[],
  batches: SuggestionBatch[],
  chat: ChatMessage[]
): SessionExport {
  return {
    exportedAt: new Date().toISOString(),
    transcript: transcript.map((c) => ({ timestamp: fmt(c.timestamp), text: c.text })),
    suggestionBatches: batches.map((b) => ({
      timestamp: fmt(b.timestamp),
      suggestions: b.suggestions.map((s) => ({
        type: s.type,
        title: s.title,
        preview: s.preview,
      })),
    })),
    chat: chat.map((m) => ({
      timestamp: fmt(m.timestamp),
      role: m.role,
      content: m.content,
    })),
  };
}

export function downloadExport(data: SessionExport) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `triplemind-session-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
