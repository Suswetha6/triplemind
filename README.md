# TripleMind

A real-time AI meeting copilot that listens to your mic and surfaces contextual suggestions as the conversation unfolds. Built as part of the TwinMind Live Suggestions assignment.

---

## Live Demo

> Add Vercel URL here after deployment

---

## Setup

**Requirements:** Node.js 18+, a [Groq API key](https://console.groq.com)

```bash
git clone <repo-url>
cd triplemind
npm install
npm run dev
```

Open `http://localhost:5173`, click **Settings**, paste your Groq API key, and press **Start**.

---

## What it does

Three columns, always visible:

| Column | What it shows |
|--------|---------------|
| **Transcript** | Live mic audio transcribed in ~30s chunks via Whisper |
| **Suggestions** | 3 AI-generated cards per batch, newest on top, auto-refreshes every 30s |
| **Chat** | Click any suggestion for a detailed answer, or type your own question |

Each suggestion card shows a type badge and a preview that delivers standalone value — you don't need to click to learn something useful. Clicking opens a full streamed answer in the chat panel.

An **Export** button in the header downloads the full session — transcript, every suggestion batch, and the complete chat history with timestamps — as a JSON file.

---

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | React 18 + Vite 5 + TypeScript | Fast iteration, strict types, minimal boilerplate |
| Styling | Tailwind CSS v3 | Dark UI without a component library overhead |
| State | Zustand | Minimal store; `persist` middleware for settings only |
| Transcription | Groq Whisper Large V3 | Required by spec; fastest open-source ASR available |
| LLM | Groq `meta-llama/llama-4-maverick-17b-128e-instruct` | Required GPT-OSS 120B; Groq latency makes real-time feel viable |
| API calls | Fetch (browser-native) | No Node SDK — everything runs client-side, no server needed |

---

## Architecture

```
src/
├── types.ts                    # Suggestion, SuggestionBatch, ChatMessage, TranscriptChunk, Settings
├── store/store.ts              # Zustand store — session state (in-memory) + settings (localStorage)
├── prompts/
│   ├── suggestions.ts          # DEFAULT_SUGGESTION_PROMPT + buildSuggestionsPrompt()
│   └── chat.ts                 # DEFAULT_DETAILED_ANSWER_PROMPT + DEFAULT_CHAT_SYSTEM_PROMPT
├── services/
│   ├── groq.ts                 # transcribeAudio(), generateSuggestions(), streamChat()
│   └── export.ts               # buildExport() + downloadExport()
├── hooks/
│   └── useAudioRecorder.ts     # MediaRecorder → 30s audio blobs → onChunk callback
└── components/
    ├── TranscriptPanel.tsx     # Left column: mic toggle + auto-scrolling transcript
    ├── SuggestionsPanel.tsx    # Middle column: batches list + manual refresh button
    ├── SuggestionCard.tsx      # Card with colored type badge, title, preview
    ├── ChatPanel.tsx           # Right column: streamed messages + input
    └── SettingsModal.tsx       # 3-tab modal: API/Models | Prompts | Parameters
```

### Data flow

```
Mic
 │
 ▼  MediaRecorder (1s timeslice)
 │
 ▼  every 30s: flush audio/webm blob
 │
 ▼  Groq Whisper Large V3
 │
 ▼  TranscriptChunk → appended to store (left column updates)
 │
 ▼  same 30s tick: buildSuggestionsPrompt(fullTranscript, recentTranscript)
 │
 ▼  Groq llama-4-maverick  (json_object mode, temp 0.7)
 │
 ▼  SuggestionBatch → prepended to store (new batch appears at top)
```

Chat responses stream token-by-token via the Groq SSE endpoint. Each token calls `appendLastAssistantMessage` in the store, which splices it onto the last assistant message in-place — no re-renders of the whole list.

---

## Prompt strategy

### Live suggestions

The prompt passes two transcript windows:

- **Full transcript** — gives the model the full conversation arc so it understands topic and history
- **Recent transcript** — last 3,000 chars (configurable), explicitly weighted in the instructions so the model focuses on what's happening *right now*

The critical design decision is instructing the model to pick the best **mix of types** for the current moment rather than defaulting to a homogeneous list:

| Type | When it fires |
|------|--------------|
| `answer` | Someone just asked a question — give the direct answer |
| `question` | A natural follow-up worth asking next |
| `fact_check` | A claim was made that deserves verification or nuance |
| `talking_point` | A relevant point worth raising now |
| `clarification` | Background context that would help the conversation |

Two hard rules enforced in the prompt that most naive implementations skip:

**1. No type monoculture.** The prompt explicitly says "never return 3 of the same type." Without this, models under low-entropy conditions will return three `talking_point` cards because it's the safe choice. The rule forces diversity even when the model wants to hedge.

**2. Standalone previews.** The preview must contain actual information, not a teaser. The prompt bans phrases like "Click to learn more" and requires 2–3 sentences of real insight. This means the suggestion card delivers value even if the user never clicks — which is the bar TwinMind described.

### Detailed answers (on click)

Passes the full transcript (capped at 12,000 chars by default) plus the clicked suggestion's title, preview, and type. The prompt asks for 200–400 words of structured markdown that goes *beyond* the preview. The click should reward the user with meaningfully more depth, not a padded restatement of what they already read.

The model receives `type` so it can frame the response correctly — an `answer` response reads differently from a `fact_check` response even when the topic is the same.

### Chat

The system prompt injects the full transcript as context on every request. Every user message is sent with the full conversation history so the assistant can handle follow-ups coherently. The transcript injection means users can ask questions like "What did they say about the Q3 budget?" and get accurate, grounded answers rather than generic responses.

---

## Settings

All parameters are editable in the Settings modal (3 tabs) and persist across page reloads via `localStorage`. Nothing is stored on a server.

| Setting | Default | Description |
|---------|---------|-------------|
| Groq API Key | — | User-provided; stored in localStorage, never sent anywhere except Groq |
| Suggestion model | `meta-llama/llama-4-maverick-17b-128e-instruct` | Used for both suggestions and chat |
| Transcription model | `whisper-large-v3` | Groq Whisper batch endpoint |
| Suggestion context | 3,000 chars | Recent transcript window passed to suggestion prompt |
| Detailed answer context | 12,000 chars | Max transcript chars for expanded answers |
| Refresh interval | 30,000 ms | How often suggestions auto-refresh while recording |
| Suggestion prompt | see `prompts/suggestions.ts` | Fully editable; supports `{fullTranscript}`, `{recentTranscript}`, `{contextChars}` |
| Detailed answer prompt | see `prompts/chat.ts` | Supports `{fullTranscript}`, `{title}`, `{preview}`, `{type}` |
| Chat system prompt | see `prompts/chat.ts` | Supports `{fullTranscript}` |

---

## Export format

```json
{
  "exportedAt": "2026-04-17T10:30:00.000Z",
  "transcript": [
    { "timestamp": "2026-04-17T10:00:05.000Z", "text": "So the Q3 numbers came in..." }
  ],
  "suggestionBatches": [
    {
      "timestamp": "2026-04-17T10:00:35.000Z",
      "suggestions": [
        {
          "type": "question",
          "title": "What drove the Q3 shortfall?",
          "preview": "The team mentioned Q3 numbers without explaining the cause. Asking directly here could surface the root issue before the conversation moves on."
        }
      ]
    }
  ],
  "chat": [
    { "timestamp": "2026-04-17T10:01:00.000Z", "role": "user", "content": "Tell me more about: What drove the Q3 shortfall?" },
    { "timestamp": "2026-04-17T10:01:02.000Z", "role": "assistant", "content": "Based on what was said..." }
  ]
}
```

---

## Tradeoffs

**Client-side only vs. a backend proxy**
All Groq calls go directly from the browser using the user's own API key. This keeps deployment dead-simple (static host, no server) and matches the spec. The tradeoff is the API key sits in `localStorage` — fine for a personal tool, not for a multi-tenant product.

**30s audio chunks vs. streaming ASR**
Groq Whisper is a batch endpoint, not a streaming one. 30s chunks balance latency against transcription accuracy: shorter chunks produce more errors at sentence boundaries; longer chunks feel slow. The 30s boundary also naturally aligns the transcription and suggestion refresh cycles so they always move together.

**Suggestions and transcription on the same interval**
The suggestion `setInterval` fires on the same 30s cadence as the audio flush. Suggestions always reflect the latest transcript chunk — there's no race where a suggestion batch refers to content the transcript panel hasn't shown yet.

**Zustand `partialize` for persistence**
Session data (transcript, suggestions, chat) is intentionally not persisted to `localStorage`. Refreshing starts a clean session, which matches the spec. Only settings persist. This also avoids stale suggestion batches from a previous session appearing on load.

**`response_format: json_object` for suggestions**
Forces the model to return valid JSON every time, eliminating fragile parsing of markdown-wrapped JSON blocks. Combined with the explicit JSON schema in the prompt, parse failures are near-zero without any try/catch retry logic.
