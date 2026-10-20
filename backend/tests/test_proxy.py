"""Proxy behaviour: contract preservation, validation, and error containment."""
import httpx
import respx

from .conftest import GROQ, HEADERS


@respx.mock
def test_transcribe_returns_text(client):
    route = respx.post(f"{GROQ}/audio/transcriptions").mock(
        return_value=httpx.Response(200, text="hello world")
    )
    resp = client.post(
        "/api/transcribe",
        headers=HEADERS,
        files={"file": ("audio.webm", b"fake-audio", "audio/webm")},
        data={"model": "whisper-large-v3"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"text": "hello world"}
    # The user's key is forwarded, never substituted by a deployment secret.
    assert route.calls.last.request.headers["authorization"] == "Bearer gsk_test_key_123456"


@respx.mock
def test_suggestions_unwraps_the_model_payload(client):
    respx.post(f"{GROQ}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": '{"suggestions": [{"type": "question", "title": "t"}]}'
                        }
                    }
                ]
            },
        )
    )
    resp = client.post(
        "/api/suggestions",
        headers=HEADERS,
        json={"prompt": "what next?", "model": "llama-3.3-70b-versatile"},
    )
    assert resp.status_code == 200
    assert resp.json()["suggestions"][0]["title"] == "t"


@respx.mock
def test_chat_streams_sse_frames(client):
    body = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'
    respx.post(f"{GROQ}/chat/completions").mock(return_value=httpx.Response(200, text=body))
    resp = client.post(
        "/api/chat",
        headers=HEADERS,
        json={
            "messages": [{"role": "user", "content": "hello"}],
            "model": "llama-3.3-70b-versatile",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert '"content":"hi"' in resp.text


# --- error containment ----------------------------------------------------


@respx.mock
def test_upstream_error_body_is_not_forwarded(client):
    """A Groq error can echo request fragments; the client must only see a
    generic message while the detail goes to the logs."""
    secret_ish = "invalid api key gsk_live_SHOULD_NOT_LEAK"
    respx.post(f"{GROQ}/chat/completions").mock(
        return_value=httpx.Response(401, text=secret_ish)
    )
    resp = client.post(
        "/api/suggestions", headers=HEADERS, json={"prompt": "x", "model": "m"}
    )
    assert resp.status_code == 401
    assert "SHOULD_NOT_LEAK" not in resp.text
    assert resp.json()["detail"] == "Upstream provider returned 401 for suggestions."


@respx.mock
def test_upstream_5xx_is_normalised_to_502(client):
    respx.post(f"{GROQ}/chat/completions").mock(return_value=httpx.Response(503, text="down"))
    resp = client.post("/api/suggestions", headers=HEADERS, json={"prompt": "x", "model": "m"})
    assert resp.status_code == 502


@respx.mock
def test_unreachable_upstream_returns_502(client):
    respx.post(f"{GROQ}/chat/completions").mock(side_effect=httpx.ConnectError("no route"))
    resp = client.post("/api/suggestions", headers=HEADERS, json={"prompt": "x", "model": "m"})
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Upstream provider unreachable."


@respx.mock
def test_chat_reports_upstream_failure_inside_the_stream(client):
    respx.post(f"{GROQ}/chat/completions").mock(return_value=httpx.Response(500, text="boom"))
    resp = client.post(
        "/api/chat",
        headers=HEADERS,
        json={"messages": [{"role": "user", "content": "hi"}], "model": "m"},
    )
    assert resp.status_code == 200  # headers are already sent before the failure
    assert "upstream error 500" in resp.text
    assert "boom" not in resp.text
    assert "[DONE]" in resp.text


# --- input validation -----------------------------------------------------


def test_missing_api_key_is_rejected(client):
    resp = client.post("/api/suggestions", json={"prompt": "x", "model": "m"})
    assert resp.status_code == 422


def test_malformed_api_key_is_rejected(client):
    resp = client.post(
        "/api/suggestions", headers={"X-Groq-API-Key": "short"}, json={"prompt": "x", "model": "m"}
    )
    assert resp.status_code == 400


def test_invalid_model_identifier_is_rejected(client):
    resp = client.post(
        "/api/suggestions",
        headers=HEADERS,
        json={"prompt": "x", "model": "../../etc/passwd; rm -rf"},
    )
    assert resp.status_code == 422


def test_invalid_chat_role_is_rejected(client):
    resp = client.post(
        "/api/chat",
        headers=HEADERS,
        json={"messages": [{"role": "root", "content": "hi"}], "model": "m"},
    )
    assert resp.status_code == 422


def test_empty_audio_is_rejected(client):
    resp = client.post(
        "/api/transcribe",
        headers=HEADERS,
        files={"file": ("audio.webm", b"", "audio/webm")},
        data={"model": "whisper-large-v3"},
    )
    assert resp.status_code == 422


def test_oversized_body_is_rejected_before_the_handler(client):
    """TM_MAX_UPLOAD_BYTES is 1024 in tests; the middleware must reject on the
    declared Content-Length without buffering the payload."""
    resp = client.post(
        "/api/transcribe",
        headers=HEADERS,
        files={"file": ("audio.webm", b"x" * 5000, "audio/webm")},
        data={"model": "whisper-large-v3"},
    )
    assert resp.status_code == 413
