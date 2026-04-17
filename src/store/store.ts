import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  TranscriptChunk,
  SuggestionBatch,
  ChatMessage,
  Settings,
} from '../types';
import { DEFAULT_SUGGESTION_PROMPT } from '../prompts/suggestions';
import { DEFAULT_DETAILED_ANSWER_PROMPT, DEFAULT_CHAT_SYSTEM_PROMPT } from '../prompts/chat';

const DEFAULT_SETTINGS: Settings = {
  groqApiKey: '',
  suggestionModel: 'meta-llama/llama-4-maverick-17b-128e-instruct',
  transcriptionModel: 'whisper-large-v3',
  suggestionPrompt: DEFAULT_SUGGESTION_PROMPT,
  detailedAnswerPrompt: DEFAULT_DETAILED_ANSWER_PROMPT,
  chatSystemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT,
  suggestionContextChars: 3000,
  detailedAnswerContextChars: 12000,
  refreshIntervalMs: 30000,
};

interface SessionState {
  transcript: TranscriptChunk[];
  suggestionBatches: SuggestionBatch[];
  chatMessages: ChatMessage[];
  isRecording: boolean;
  isLoadingSuggestions: boolean;
  isLoadingChat: boolean;
  settings: Settings;

  addTranscriptChunk: (chunk: TranscriptChunk) => void;
  prependSuggestionBatch: (batch: SuggestionBatch) => void;
  addChatMessage: (msg: ChatMessage) => void;
  appendLastAssistantMessage: (token: string) => void;
  setIsRecording: (v: boolean) => void;
  setIsLoadingSuggestions: (v: boolean) => void;
  setIsLoadingChat: (v: boolean) => void;
  updateSettings: (partial: Partial<Settings>) => void;
  clearSession: () => void;
}

export const useStore = create<SessionState>()(
  persist(
    (set) => ({
      transcript: [],
      suggestionBatches: [],
      chatMessages: [],
      isRecording: false,
      isLoadingSuggestions: false,
      isLoadingChat: false,
      settings: DEFAULT_SETTINGS,

      addTranscriptChunk: (chunk) =>
        set((s) => ({ transcript: [...s.transcript, chunk] })),

      prependSuggestionBatch: (batch) =>
        set((s) => ({ suggestionBatches: [batch, ...s.suggestionBatches] })),

      addChatMessage: (msg) =>
        set((s) => ({ chatMessages: [...s.chatMessages, msg] })),

      appendLastAssistantMessage: (token) =>
        set((s) => {
          const msgs = [...s.chatMessages];
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant') {
            msgs[msgs.length - 1] = { ...last, content: last.content + token };
          }
          return { chatMessages: msgs };
        }),

      setIsRecording: (v) => set({ isRecording: v }),
      setIsLoadingSuggestions: (v) => set({ isLoadingSuggestions: v }),
      setIsLoadingChat: (v) => set({ isLoadingChat: v }),

      updateSettings: (partial) =>
        set((s) => ({ settings: { ...s.settings, ...partial } })),

      clearSession: () =>
        set({ transcript: [], suggestionBatches: [], chatMessages: [] }),
    }),
    {
      name: 'triplemind-settings',
      // only persist settings, not session data
      partialize: (s) => ({ settings: s.settings }),
    }
  )
);

export function getFullTranscript(chunks: TranscriptChunk[]) {
  return chunks.map((c) => c.text).join('\n');
}

export function getRecentTranscript(chunks: TranscriptChunk[], maxChars: number) {
  const full = getFullTranscript(chunks);
  return full.length > maxChars ? full.slice(-maxChars) : full;
}
