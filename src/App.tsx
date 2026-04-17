import { useCallback, useEffect, useRef, useState } from 'react';
import { TranscriptPanel } from './components/TranscriptPanel';
import { SuggestionsPanel } from './components/SuggestionsPanel';
import { ChatPanel } from './components/ChatPanel';
import { SettingsModal } from './components/SettingsModal';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useStore, getFullTranscript, getRecentTranscript } from './store/store';
import { transcribeAudio, generateSuggestions, streamChat } from './services/groq';
import { buildSuggestionsPrompt } from './prompts/suggestions';
import { buildDetailedAnswerMessages, buildChatMessages } from './prompts/chat';
import { buildExport, downloadExport } from './services/export';
import type { Suggestion, SuggestionBatch, ChatMessage, TranscriptChunk } from './types';

export default function App() {
  const store = useStore();
  const [showSettings, setShowSettings] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const apiKey = store.settings.groqApiKey;

  // ── transcription ──────────────────────────────────────────────────────────
  const processAudioChunk = useCallback(
    async (blob: Blob) => {
      if (!apiKey) return;
      try {
        const text = await transcribeAudio(blob, apiKey, store.settings.transcriptionModel);
        if (!text.trim()) return;
        const chunk: TranscriptChunk = {
          id: `${Date.now()}-${Math.random()}`,
          text: text.trim(),
          timestamp: Date.now(),
        };
        store.addTranscriptChunk(chunk);
      } catch (err) {
        console.error('Transcription failed:', err);
      }
    },
    [apiKey, store]
  );

  const { start, stop } = useAudioRecorder({
    onChunk: processAudioChunk,
    chunkIntervalMs: store.settings.refreshIntervalMs,
  });

  // ── suggestions ────────────────────────────────────────────────────────────
  const runSuggestions = useCallback(async () => {
    if (!apiKey || store.isLoadingSuggestions) return;

    const transcript = useStore.getState().transcript;
    const full = getFullTranscript(transcript);
    const recent = getRecentTranscript(transcript, store.settings.suggestionContextChars);

    if (!full.trim()) return;

    store.setIsLoadingSuggestions(true);
    try {
      const prompt = buildSuggestionsPrompt(
        full,
        recent,
        store.settings.suggestionContextChars,
        store.settings.suggestionPrompt
      );
      const suggestions = await generateSuggestions(
        prompt,
        apiKey,
        store.settings.suggestionModel
      );
      const batch: SuggestionBatch = {
        id: `batch-${Date.now()}`,
        suggestions,
        timestamp: Date.now(),
      };
      store.prependSuggestionBatch(batch);
    } catch (err) {
      console.error('Suggestions failed:', err);
    } finally {
      store.setIsLoadingSuggestions(false);
    }
  }, [apiKey, store]);

  // ── recording toggle ───────────────────────────────────────────────────────
  const handleToggleRecording = useCallback(async () => {
    if (store.isRecording) {
      stop();
      store.setIsRecording(false);
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    } else {
      if (!apiKey) {
        setShowSettings(true);
        return;
      }
      await start();
      store.setIsRecording(true);
      refreshTimerRef.current = setInterval(runSuggestions, store.settings.refreshIntervalMs);
    }
  }, [store, start, stop, apiKey, runSuggestions]);

  // ── manual refresh ─────────────────────────────────────────────────────────
  const handleManualRefresh = useCallback(() => {
    runSuggestions();
  }, [runSuggestions]);

  // ── chat ───────────────────────────────────────────────────────────────────
  const sendChatMessage = useCallback(
    async (text: string) => {
      if (!apiKey) {
        setShowSettings(true);
        return;
      }
      const userMsg: ChatMessage = {
        id: `${Date.now()}-user`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
      store.addChatMessage(userMsg);

      const assistantMsg: ChatMessage = {
        id: `${Date.now()}-asst`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      store.addChatMessage(assistantMsg);
      store.setIsLoadingChat(true);

      try {
        const currentTranscript = getFullTranscript(useStore.getState().transcript);
        const history = useStore
          .getState()
          .chatMessages.slice(0, -1)
          .map((m) => ({ role: m.role, content: m.content }));

        const messages = buildChatMessages(
          currentTranscript,
          history,
          text,
          store.settings.chatSystemPrompt
        );

        for await (const token of streamChat(messages, apiKey, store.settings.suggestionModel)) {
          store.appendLastAssistantMessage(token);
        }
      } catch (err) {
        store.appendLastAssistantMessage('\n\n_(Error: ' + String(err) + ')_');
      } finally {
        store.setIsLoadingChat(false);
      }
    },
    [apiKey, store]
  );

  const handleSuggestionClick = useCallback(
    async (suggestion: Suggestion) => {
      if (!apiKey) {
        setShowSettings(true);
        return;
      }

      const currentTranscript = getFullTranscript(useStore.getState().transcript);
      const truncated = currentTranscript.slice(-store.settings.detailedAnswerContextChars);

      const userMsg: ChatMessage = {
        id: `${Date.now()}-user`,
        role: 'user',
        content: `Tell me more about: ${suggestion.title}`,
        timestamp: Date.now(),
        suggestionRef: { title: suggestion.title, type: suggestion.type },
      };
      store.addChatMessage(userMsg);

      const assistantMsg: ChatMessage = {
        id: `${Date.now()}-asst`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      store.addChatMessage(assistantMsg);
      store.setIsLoadingChat(true);

      try {
        const messages = buildDetailedAnswerMessages(
          truncated,
          suggestion.title,
          suggestion.preview,
          suggestion.type,
          store.settings.detailedAnswerPrompt
        );

        for await (const token of streamChat(messages, apiKey, store.settings.suggestionModel)) {
          store.appendLastAssistantMessage(token);
        }
      } catch (err) {
        store.appendLastAssistantMessage('\n\n_(Error: ' + String(err) + ')_');
      } finally {
        store.setIsLoadingChat(false);
      }
    },
    [apiKey, store]
  );

  // ── export ─────────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const data = buildExport(
      store.transcript,
      store.suggestionBatches,
      store.chatMessages
    );
    downloadExport(data);
  }, [store]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-indigo-400 font-bold text-lg">Triple</span>
          <span className="text-white font-bold text-lg">Mind</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-md transition-colors"
          >
            Export
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-md transition-colors"
          >
            Settings
            {!apiKey && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-1" />
            )}
          </button>
        </div>
      </header>

      {/* No API key banner */}
      {!apiKey && (
        <div className="bg-amber-950/50 border-b border-amber-800/50 px-6 py-2 text-xs text-amber-300 flex items-center gap-2">
          <span>Groq API key required.</span>
          <button
            onClick={() => setShowSettings(true)}
            className="underline hover:text-amber-200"
          >
            Add in Settings
          </button>
        </div>
      )}

      {/* 3-column layout */}
      <div className="flex-1 grid grid-cols-3 divide-x divide-gray-800 overflow-hidden" style={{ height: 'calc(100vh - 48px)' }}>
        <div className="p-5 overflow-hidden flex flex-col">
          <TranscriptPanel
            chunks={store.transcript}
            isRecording={store.isRecording}
            onToggleRecording={handleToggleRecording}
          />
        </div>
        <div className="p-5 overflow-hidden flex flex-col">
          <SuggestionsPanel
            batches={store.suggestionBatches}
            isLoading={store.isLoadingSuggestions}
            onRefresh={handleManualRefresh}
            onSuggestionClick={handleSuggestionClick}
          />
        </div>
        <div className="p-5 overflow-hidden flex flex-col">
          <ChatPanel
            messages={store.chatMessages}
            isLoading={store.isLoadingChat}
            onSend={sendChatMessage}
          />
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          settings={store.settings}
          onSave={store.updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
