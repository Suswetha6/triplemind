# TripleMind - Context for Claude

> **Note:** these are the application-era working notes, kept for history. They
> describe the app before the DevOps work and are stale in places (the
> "no server needed" line predates the FastAPI backend). For current state see
> [README.md](README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
> [docs/DECISIONS.md](docs/DECISIONS.md).

## Assignment Summary
Build a 3-column web app that listens to live mic audio and surfaces real-time AI suggestions during conversations, mimicking and improving on TwinMind's live suggestions feature.

## Progress
- [x] Project scaffolding: React + Vite 5 + TypeScript + Tailwind CSS + Zustand
- [x] `src/types.ts` — all TypeScript interfaces
- [x] `src/store/store.ts` — Zustand session store (settings persisted in localStorage)
- [x] `src/prompts/suggestions.ts` — suggestions prompt builder with DEFAULT_SUGGESTION_PROMPT
- [x] `src/prompts/chat.ts` — chat + detailed answer prompt builders
- [x] `src/services/groq.ts` — transcribeAudio, generateSuggestions, streamChat
- [x] `src/services/export.ts` — buildExport + downloadExport (JSON)
- [x] `src/hooks/useAudioRecorder.ts` — MediaRecorder hook, flushes every 30s
- [x] `src/components/TranscriptPanel.tsx` — left column
- [x] `src/components/SuggestionCard.tsx` — colored badge per type
- [x] `src/components/SuggestionsPanel.tsx` — middle column, newest batch on top
- [x] `src/components/ChatPanel.tsx` — right column, streaming messages
- [x] `src/components/SettingsModal.tsx` — 3-tab modal: API/Models, Prompts, Parameters
- [x] `src/App.tsx` — layout + orchestration (30s refresh timer, all event handlers)
- [x] Build passes (`npm run build` ✓)
- [ ] README.md
- [ ] GitHub repo push
- [ ] Vercel deployment

## Stack
- **Framework:** React + Vite 5 + TypeScript
- **Styling:** Tailwind CSS v3
- **State:** Zustand (settings persisted, session state in-memory)
- **Transcription:** Groq Whisper Large V3 (`whisper-large-v3`)
- **LLM:** Groq GPT-OSS 120B (`meta-llama/llama-4-maverick-17b-128e-instruct`)
- **Audio:** Web MediaRecorder API

## Layout (3 columns)
1. **Left:** Mic toggle + live transcript (auto-appends every ~30s)
2. **Middle:** Live suggestion cards (3 per batch, newest on top, refreshes every ~30s)
3. **Right:** Chat panel (click suggestion or type freely)

## Key Files
```
src/
├── types.ts               # All TypeScript interfaces
├── store/store.ts         # Zustand session store
├── prompts/suggestions.ts # Suggestions prompt builder
├── prompts/chat.ts        # Chat + detailed answer prompt builders
├── services/groq.ts       # All Groq API calls (transcribe, suggestions, stream chat)
├── services/export.ts     # Export session to JSON/text
├── hooks/useAudioRecorder.ts  # MediaRecorder hook, 30s chunks → Whisper
├── components/
│   ├── TranscriptPanel.tsx    # Left column
│   ├── SuggestionsPanel.tsx   # Middle column
│   ├── SuggestionCard.tsx     # Individual card
│   ├── ChatPanel.tsx          # Right column
│   └── SettingsModal.tsx      # API key + editable prompts/settings (3 tabs)
├── App.tsx                # Layout + orchestration (30s refresh timer)
```

## Data Flow
1. MediaRecorder collects audio chunks continuously (1s timeslice)
2. Every 30s: flush audio blob → transcribeAudio (Whisper) → append TranscriptChunk
3. Every 30s (on same interval): buildSuggestionsPrompt → generateSuggestions → prepend SuggestionBatch
4. Suggestion click → buildDetailedAnswerMessages → streamChat → appended token-by-token
5. Chat input → buildChatMessages (with full transcript context) → streamChat

## Suggestion Types
- `answer` — direct answer to a question just asked
- `question` — good follow-up question to ask
- `fact_check` — verify/nuance a claim that was made
- `talking_point` — relevant point worth raising
- `clarification` — background context that would help

## Prompt Strategy
- **Suggestions:** Pass last N chars as "recent context" + full transcript. Model picks best MIX of types. Preview must have standalone value (not "click for more").
- **Detailed answer:** Full transcript (capped at detailedAnswerContextChars) + clicked suggestion metadata → 200-400 word structured markdown response
- **Chat:** System prompt with full transcript context; conversational assistant with streaming

## Default Settings
- `suggestionContextChars`: 3000
- `detailedAnswerContextChars`: 12000
- `suggestionModel`: `meta-llama/llama-4-maverick-17b-128e-instruct`
- `transcriptionModel`: `whisper-large-v3`
- `refreshIntervalMs`: 30000

## Design Decisions
- All Groq calls from browser (user provides API key — never hardcoded)
- Settings persisted in localStorage via Zustand persist middleware
- Chat streamed token-by-token via SSE for responsiveness
- No server needed — pure frontend
- Export: transcript chunks + all suggestion batches + full chat + timestamps as JSON
