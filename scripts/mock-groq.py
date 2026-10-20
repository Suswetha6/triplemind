#!/usr/bin/env python3
"""A stand-in for the Groq API.

Exists so the whole user journey -- record, transcribe, suggest, chat -- can be
exercised in CI and in a demo without a real provider key. Nothing here is a
test double inside the application: the backend talks to this over HTTP exactly
as it would talk to Groq, so the proxy, streaming and error paths under test
are the real ones.

Point the backend at it with:
    TM_GROQ_BASE_URL=http://mock-groq:8081/openai/v1

Stdlib only, so it runs in any python image with no install step.
"""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8081

TRANSCRIPT_LINES = [
    "So the Q3 numbers came in and revenue was about eight percent under plan.",
    "Most of the gap is in the enterprise segment, not self-serve.",
    "We think two large renewals slipped into Q4 rather than churning outright.",
    "The question is whether we re-forecast now or wait for the November close.",
]

SUGGESTIONS = {
    "suggestions": [
        {
            "title": "What drove the enterprise shortfall?",
            "preview": (
                "Revenue missed plan by roughly eight percent, concentrated in enterprise "
                "rather than self-serve. Two renewals are described as slipping to Q4, which "
                "is a timing problem rather than lost business -- worth confirming before the "
                "forecast is revised."
            ),
            "type": "question",
        },
        {
            "title": "Slipped renewals are not churn",
            "preview": (
                "A renewal that moves a quarter still closes; churn does not. Treating the two "
                "the same way inflates the apparent loss and leads to over-correcting the "
                "forecast. Confirm the renewal dates before re-planning."
            ),
            "type": "clarification",
        },
        {
            "title": "Re-forecast after the November close",
            "preview": (
                "With two deals in flight the November close resolves most of the uncertainty. "
                "Re-forecasting now bakes in an assumption that may be wrong in three weeks, "
                "and a mid-quarter revision costs credibility if it is reversed."
            ),
            "type": "talking_point",
        },
    ]
}

ANSWER = (
    "The shortfall looks like a timing effect rather than a demand problem.\n\n"
    "Two large enterprise renewals moved into Q4, which accounts for most of the "
    "eight percent gap. Self-serve performed to plan, so the underlying funnel is "
    "intact. The useful distinction is between revenue that was lost and revenue "
    "that was delayed: only the first justifies changing the plan.\n\n"
    "Before re-forecasting, confirm the new close dates with the account team and "
    "check whether the delay was procurement-side or a signal of weaker intent."
)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quieter, and structured like the rest
        print(json.dumps({"logger": "mock-groq", "msg": fmt % args}), flush=True)

    def _send(self, status, body: bytes, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            self._send(200, b"ok\n", "text/plain")
        else:
            self._send(404, b'{"error":"not found"}')

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""

        # The backend must forward the caller's key; refuse if it did not.
        if not self.headers.get("Authorization", "").startswith("Bearer "):
            self._send(401, b'{"error":{"message":"missing bearer token"}}')
            return

        if self.path.endswith("/audio/transcriptions"):
            # Rotates through the script so successive 30s chunks build a
            # conversation rather than repeating one line.
            line = TRANSCRIPT_LINES[int(time.time() // 30) % len(TRANSCRIPT_LINES)]
            self._send(200, line.encode(), "text/plain")
            return

        if self.path.endswith("/chat/completions"):
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                self._send(400, b'{"error":{"message":"bad json"}}')
                return

            if body.get("stream"):
                self._stream_chat()
            else:
                payload = {
                    "choices": [{"message": {"content": json.dumps(SUGGESTIONS)}}],
                    "model": body.get("model", "mock"),
                }
                self._send(200, json.dumps(payload).encode())
            return

        self._send(404, b'{"error":"not found"}')

    def _stream_chat(self):
        """Server-sent events, token by token, with a real delay between
        frames -- that is what proves nothing in the chain is buffering."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        for word in ANSWER.split(" "):
            frame = {"choices": [{"delta": {"content": word + " "}}]}
            self.wfile.write(f"data: {json.dumps(frame)}\n\n".encode())
            self.wfile.flush()
            time.sleep(0.02)
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


if __name__ == "__main__":
    print(f"mock-groq listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
