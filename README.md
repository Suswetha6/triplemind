# TripleMind

A real-time AI meeting copilot that listens to your mic and surfaces contextual suggestions as the conversation unfolds. Built as part of the TwinMind Live Suggestions assignment.

---

## Live Demo

**[https://triplemind.vercel.app](https://triplemind.vercel.app)** — the
original Vercel deployment of the frontend. The containerised Kubernetes
deployment is the one described under [Running it](#running-it).

---

## Running it

Three ways, in increasing order of fidelity to how it is deployed.

### 1. Docker Compose — the whole stack, one command

```bash
cp .env.example .env          # optional; only needed to change host ports
make up                       # or: docker compose up -d --build
open http://localhost:8080
```

Add Prometheus, Grafana and Tempo:

```bash
make up-observability
open http://localhost:3000    # Grafana, admin / $GRAFANA_PASSWORD (default: admin)
```

### 2. Kubernetes (kind) — how it actually ships

```bash
make kind-up                  # cluster + ingress-nginx
make deploy                   # build, side-load, helm install
make verify                   # helm test + version check + smoke test
open http://triplemind.localtest.me:8081
```

Then, optionally:

```bash
make monitoring               # Prometheus, Grafana, Tempo, dashboard, alert rules
make journey                  # full user journey against a stand-in provider
make rollback-drill           # break a release on purpose and recover from it
make load                     # drive traffic until the HPA scales
```

### 3. Bare metal dev loop

```bash
cd backend && pip install -r requirements-dev.txt
uvicorn app.main:app --reload          # :8000
npm ci && npm run dev                  # :5173, proxies /api to :8000
```

**Prerequisites:** Docker, Node 22+, Python 3.12+ (bare metal only), and for
the Kubernetes path `kind`, `kubectl` and `helm`. A [Groq API
key](https://console.groq.com) is needed to use the app for real — paste it
into Settings. The deployment never stores one.

**Tests:**

```bash
make test                     # vitest (22) + pytest (22)
make test-backend-docker      # backend suite without a local Python
make chart-lint               # helm lint across all three value sets
```

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
| Frontend | React 18 + Vite 5 + TypeScript | Fast iteration, strict types, minimal boilerplate |
| Styling | Tailwind CSS v3 | Dark UI without a component library overhead |
| State | Zustand | Minimal store; `persist` middleware for settings only |
| Backend | Python + FastAPI + httpx | Proxies all Groq calls; keeps API key off the browser network tab |
| Transcription | Groq Whisper Large V3 | Required by spec; fastest open-source ASR available |
| LLM | Groq `llama-3.3-70b-versatile` | `meta-llama/llama-4-maverick-17b-128e-instruct` (originally specified as GPT-OSS 120B) is not yet available on Groq; `llama-3.3-70b-versatile` is the closest capable replacement |
| Containers | Multi-stage Docker, nginx-unprivileged + python-slim | Non-root and read-only-root-filesystem capable; small attack surface |
| Orchestration | Kubernetes via Helm, local kind | One chart, per-environment values, no drifting manifest copies |
| CI/CD | GitHub Actions | Checks and builds on every push; approval-gated deploy with automatic rollback |
| Observability | Prometheus, Grafana, Tempo, OpenTelemetry | Metrics, logs and traces that share one request id |

---

## Architecture

```
backend/
├── app/
│   ├── main.py                 # app factory, middleware order, exception handlers
│   ├── config.py               # env-driven settings (TM_* prefix)
│   ├── logging_setup.py        # JSON formatter + request-id context
│   ├── observability.py        # Prometheus metrics, OTel tracing setup
│   ├── middleware.py           # request id / access log / metrics, rate limit, body cap
│   └── routes/
│       ├── health.py           # /healthz /readyz /version /metrics
│       └── proxy.py            # /api/transcribe /api/suggestions /api/chat
├── tests/                      # 22 pytest cases
├── requirements.in             # direct deps; requirements.txt is the generated lock
└── Dockerfile

deploy/
├── helm/triplemind/            # one chart, values{,-dev,-prod}.yaml
├── nginx/                      # main config, server template, security headers
├── kind/                       # local cluster config + stand-in provider
└── observability/              # Prometheus, alerts, Tempo, Grafana dashboards

scripts/                        # smoke, version check, rollback drill, journey, load
.github/workflows/              # ci.yml, cd.yml, codeql.yml

src/
├── types.ts                    # Suggestion, SuggestionBatch, ChatMessage, TranscriptChunk, Settings
├── store/store.ts              # Zustand store — session state (in-memory) + settings (localStorage)
├── prompts/
│   ├── suggestions.ts          # DEFAULT_SUGGESTION_PROMPT + buildSuggestionsPrompt()
│   └── chat.ts                 # DEFAULT_DETAILED_ANSWER_PROMPT + DEFAULT_CHAT_SYSTEM_PROMPT
├── services/
│   ├── groq.ts                 # transcribeAudio(), generateSuggestions(), streamChat() → backend
│   └── export.ts               # buildExport() + downloadExport()
├── hooks/
│   └── useAudioRecorder.ts     # MediaRecorder → 30s audio blobs → onChunk callback
└── components/                 # TranscriptPanel, SuggestionsPanel, SuggestionCard, ChatPanel, SettingsModal
```

Deeper detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the request
path and failure boundaries, and [docs/DECISIONS.md](docs/DECISIONS.md) for
why each choice was made and when a different one would be right.

### Data flow

```
Mic
 │
 ▼  MediaRecorder (1s timeslice)
 │
 ▼  every 30s: flush audio/webm blob
 │
 ▼  POST /api/transcribe  →  nginx  →  FastAPI  →  Groq Whisper Large V3
 │
 ▼  TranscriptChunk → appended to store (left column updates)
 │
 ▼  same 30s tick: buildSuggestionsPrompt(fullTranscript, recentTranscript)
 │
 ▼  POST /api/suggestions  →  nginx  →  FastAPI  →  Groq llama-3.3-70b-versatile (json_object, temp 0.7)
 │
 ▼  SuggestionBatch → prepended to store (new batch appears at top)
```

Chat responses stream token-by-token. `POST /api/chat` opens an SSE stream through FastAPI to Groq. Each token calls `appendLastAssistantMessage` in the store, splicing it onto the last assistant message in-place.

### API key flow

The user pastes their Groq API key into Settings. The frontend sends it as an `X-Groq-API-Key` header to the FastAPI backend on every request. The backend forwards it as the Groq `Authorization` header. The key never leaves the user's machine in plaintext — it goes through the backend proxy rather than appearing in browser network requests directly to Groq.

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
| Groq API Key | — | User-provided; stored in localStorage, forwarded to backend as a request header |
| Suggestion model | `llama-3.3-70b-versatile` | Used for both suggestions and chat |
| Transcription model | `whisper-large-v3` | Groq Whisper batch endpoint |
| Suggestion context | 3,000 chars | Recent transcript window passed to suggestion prompt |
| Detailed answer context | 12,000 chars | Max transcript chars for expanded answers |
| Refresh interval | 30,000 ms | How often suggestions auto-refresh while recording |
| Suggestion prompt | see `prompts/suggestions.ts` | Fully editable; supports `{fullTranscript}`, `{recentTranscript}`, `{contextChars}` |
| Detailed answer prompt | see `prompts/chat.ts` | Supports `{fullTranscript}`, `{title}`, `{preview}`, `{type}` |
| Chat system prompt | see `prompts/chat.ts` | Supports `{fullTranscript}` |

---

## Deploying

### Kubernetes

One Helm chart, three value sets, no duplicated manifests:

| File | Used for |
|---|---|
| `values.yaml` | defaults and documentation of every knob |
| `values-dev.yaml` | the kind cluster — 1 replica, side-loaded images, no HPA |
| `values-prod.yaml` | reference overlay — 3 replicas, HPA, TLS, NetworkPolicy, digest-pinned images |

```bash
helm upgrade --install triplemind deploy/helm/triplemind \
  -n triplemind --create-namespace \
  -f deploy/helm/triplemind/values-dev.yaml \
  --set global.appVersion=$(git rev-parse --short HEAD) \
  --wait
helm test triplemind -n triplemind --logs
```

The chart ships Deployments (stateless — see
[DECISIONS.md](docs/DECISIONS.md#deployment-not-statefulset)), startup +
liveness + readiness probes, resource requests, an HPA, PodDisruptionBudgets,
NetworkPolicies, a ServiceMonitor, SLO-derived alert rules, and a `helm test`
smoke pod.

### Pipeline

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | every push and PR | lint, typecheck, unit tests, chart lint, manifest validation against real K8s schemas, secret scan, dependency and image scan, Dockerfile lint, non-root assertion, **and a full kind deploy + smoke test + rollback drill** |
| `cd.yml` | push to main | builds and pushes both images to GHCR tagged by commit SHA with provenance and SBOM, pauses for manual approval, deploys the same chart, verifies, and **rolls back automatically if verification fails** |
| `codeql.yml` | PR + weekly | static analysis of the TypeScript and Python we wrote |

Traceability: images are tagged with the commit SHA, the chart labels every
object with `app.kubernetes.io/version`, the backend serves `/version`, the
frontend serves `/version.json`, and Prometheus carries
`triplemind_build_info`. `scripts/verify-version.sh` asserts the label and the
running process agree with the commit that was built.

## Observability

- **Metrics** — `/metrics` on the backend: request rate, latency histogram and
  in-flight count by route; Groq call rate, latency and outcome by operation;
  rate-limit rejections; build info.
- **Logs** — JSON on stdout from nginx *and* FastAPI, with the same field
  names and a shared `X-Request-ID` so one request can be followed across both.
- **Traces** — OTLP/HTTP to Tempo, with FastAPI and httpx instrumented, so a
  slow request shows whether the time was ours or the provider's.
- **Dashboard and alerts** — `deploy/observability/grafana/dashboards/` and the
  chart's `PrometheusRule`. Alerts fire on **error-budget burn rate** against a
  99% / 1-hour availability SLO, not on raw error counts, and each carries the
  diagnostic step to take in its annotations — including when *not* to roll
  back, because a provider outage is not fixed by redeploying.

## Security

| Control | Where |
|---|---|
| No credential in the repo or the cluster | The Groq key is the user's, held in their browser, forwarded per request — see [DECISIONS.md](docs/DECISIONS.md#the-users-api-key-is-never-a-cluster-secret) |
| Non-root, read-only root filesystem, all capabilities dropped, no privilege escalation, `RuntimeDefault` seccomp | both containers, enforced in the chart and asserted in CI |
| No API token mounted | `automountServiceAccountToken: false` — neither workload talks to the API server |
| CORS allowlist, never `*` | backend config; empty in-cluster because traffic is same-origin |
| Rate limiting and upload size caps | backend middleware |
| Upstream error bodies logged, not returned | backend, with a test that plants a secret in an upstream error and asserts it never reaches the client |
| CSP, `X-Frame-Options: DENY`, nosniff, Referrer-Policy, Permissions-Policy | nginx, on every response |
| NetworkPolicy — backend reachable only from the frontend and the monitoring namespace; egress limited to DNS and HTTPS | chart (see limitations) |
| Secret, dependency, image, IaC and static analysis scanning | `ci.yml` and `codeql.yml`, failing the build on fixable CRITICAL/HIGH |

## Known limitations

Stated so no claim here is read as stronger than it is:

- **NetworkPolicies are written but not enforced locally.** kind's default CNI
  ignores them. They are rendered and schema-validated in CI and enabled in
  `values-prod.yaml`; proving they block traffic needs Calico or Cilium.
- **Rate limiting is per pod.** With N replicas the real ceiling is N × limit.
  It stops accidental loops, not a determined attacker.
- **The backend API is unauthenticated.** It is a proxy that carries the
  caller's own credential; anyone who can reach it can spend their own Groq
  quota through it. NetworkPolicy and the rate limiter are the compensating
  controls. Real auth is the prerequisite for a hosted multi-tenant version.
- **CD deploys to an ephemeral kind cluster**, because a hosted runner cannot
  reach a laptop. The chart, values, digests and verification are identical to
  a real deploy; only the cluster is disposable.
- **The HPA needs metrics-server**, which kind does not install by default.
- **No persistence anywhere** — by design, but it does mean a browser refresh
  ends the session.

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

**FastAPI proxy vs. direct browser calls**
All Groq calls are proxied through the FastAPI backend rather than made directly from the browser. This keeps the API key out of browser network requests, enables server-side error handling and logging, and satisfies the full-stack evaluation criterion. The tradeoff is an extra network hop and a second service to deploy.

**30s audio chunks vs. streaming ASR**
Groq Whisper is a batch endpoint, not a streaming one. 30s chunks balance latency against transcription accuracy: shorter chunks produce more errors at sentence boundaries; longer chunks feel slow. The 30s boundary also naturally aligns the transcription and suggestion refresh cycles so they always move together.

**Suggestions and transcription on the same interval**
The suggestion `setInterval` fires on the same 30s cadence as the audio flush. Suggestions always reflect the latest transcript chunk — there's no race where a suggestion batch refers to content the transcript panel hasn't shown yet.

**Zustand `partialize` for persistence**
Session data (transcript, suggestions, chat) is intentionally not persisted to `localStorage`. Refreshing starts a clean session, which matches the spec. Only settings persist. This also avoids stale suggestion batches from a previous session appearing on load.

**`response_format: json_object` for suggestions**
Forces the model to return valid JSON every time, eliminating fragile parsing of markdown-wrapped JSON blocks. Combined with the explicit JSON schema in the prompt, parse failures are near-zero without any try/catch retry logic.
