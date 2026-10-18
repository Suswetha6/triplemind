"""Groq proxy endpoints.

The contract with the frontend is unchanged from the baseline -- same three
paths, same response shapes -- but each call is now metered, traced, size- and
shape-validated, and upstream error bodies are logged rather than returned.
"""
import json
import logging
import re
import time
from collections.abc import AsyncIterator

import httpx
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from ..config import Settings, get_settings
from ..observability import upstream_duration_seconds, upstream_requests_total

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["groq"])

# Model ids are user-editable in the Settings modal, so they are validated as
# opaque identifiers rather than against a fixed allowlist that would go stale.
MODEL_PATTERN = re.compile(r"^[A-Za-z0-9._\-/]{1,128}$")
MAX_PROMPT_CHARS = 200_000
MAX_MESSAGES = 200
ALLOWED_ROLES = {"system", "user", "assistant"}


def require_api_key(x_groq_api_key: str = Header(..., alias="X-Groq-API-Key")) -> str:
    """The key belongs to the end user, never to the deployment: it arrives per
    request and is forwarded upstream. Nothing is persisted or logged."""
    key = x_groq_api_key.strip()
    if not 8 <= len(key) <= 256 or not key.isprintable():
        raise HTTPException(status_code=400, detail="Malformed API key header.")
    return key


def validate_model(model: str) -> str:
    if not MODEL_PATTERN.match(model):
        raise HTTPException(status_code=422, detail="Invalid model identifier.")
    return model


def _client(request: Request) -> httpx.AsyncClient:
    return request.app.state.http


def _fail(operation: str, status_code: int, body: str) -> HTTPException:
    """Log the upstream detail, return a generic message.

    Groq error bodies can echo request fragments; forwarding them verbatim to
    an unauthenticated caller is an information-disclosure risk.
    """
    upstream_requests_total.labels(operation, "error").inc()
    log.error(
        "upstream error",
        extra={
            "operation": operation,
            "upstream_status": status_code,
            "upstream_body": body[:2000],
        },
    )
    client_status = 502 if status_code >= 500 else status_code
    return HTTPException(
        status_code=client_status,
        detail=f"Upstream provider returned {status_code} for {operation}.",
    )


@router.post("/transcribe", summary="Transcribe an audio chunk via Groq Whisper")
async def transcribe(
    request: Request,
    file: UploadFile = File(...),
    model: str = Form(...),
    api_key: str = Depends(require_api_key),
    settings: Settings = Depends(get_settings),
) -> dict:
    validate_model(model)
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="Empty audio upload.")
    if len(audio_bytes) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Audio chunk too large.")

    started = time.perf_counter()
    try:
        resp = await _client(request).post(
            f"{settings.groq_base_url}/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (file.filename or "audio.webm", audio_bytes, "audio/webm")},
            data={"model": model, "response_format": "text"},
        )
    except httpx.HTTPError as exc:
        upstream_requests_total.labels("transcribe", "unreachable").inc()
        log.error("upstream unreachable", extra={"operation": "transcribe", "error": str(exc)})
        raise HTTPException(status_code=502, detail="Upstream provider unreachable.") from exc
    finally:
        upstream_duration_seconds.labels("transcribe").observe(time.perf_counter() - started)

    if not resp.is_success:
        raise _fail("transcribe", resp.status_code, resp.text)

    upstream_requests_total.labels("transcribe", "success").inc()
    return {"text": resp.text}


class SuggestionsRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=MAX_PROMPT_CHARS)
    model: str

    @field_validator("model")
    @classmethod
    def _model(cls, v: str) -> str:
        return validate_model(v)


@router.post("/suggestions", summary="Generate a batch of live suggestions")
async def suggestions(
    request: Request,
    body: SuggestionsRequest,
    api_key: str = Depends(require_api_key),
    settings: Settings = Depends(get_settings),
) -> dict:
    started = time.perf_counter()
    try:
        resp = await _client(request).post(
            f"{settings.groq_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": body.model,
                "messages": [{"role": "user", "content": body.prompt}],
                "response_format": {"type": "json_object"},
                "temperature": 0.7,
                "max_tokens": 1024,
            },
        )
    except httpx.HTTPError as exc:
        upstream_requests_total.labels("suggestions", "unreachable").inc()
        log.error("upstream unreachable", extra={"operation": "suggestions", "error": str(exc)})
        raise HTTPException(status_code=502, detail="Upstream provider unreachable.") from exc
    finally:
        upstream_duration_seconds.labels("suggestions").observe(time.perf_counter() - started)

    if not resp.is_success:
        raise _fail("suggestions", resp.status_code, resp.text)

    try:
        content = resp.json()["choices"][0]["message"]["content"]
        raw = json.loads(content)
    except (KeyError, IndexError, ValueError) as exc:
        upstream_requests_total.labels("suggestions", "malformed").inc()
        log.error(
            "malformed upstream payload",
            extra={"operation": "suggestions", "error": str(exc)},
        )
        raise HTTPException(
            status_code=502, detail="Upstream returned an unreadable payload."
        ) from exc

    upstream_requests_total.labels("suggestions", "success").inc()
    return {"suggestions": raw.get("suggestions", raw) if isinstance(raw, dict) else raw}


class ChatMessage(BaseModel):
    role: str
    content: str = Field(max_length=MAX_PROMPT_CHARS)

    @field_validator("role")
    @classmethod
    def _role(cls, v: str) -> str:
        if v not in ALLOWED_ROLES:
            raise ValueError(f"role must be one of {sorted(ALLOWED_ROLES)}")
        return v


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    model: str

    @field_validator("model")
    @classmethod
    def _model(cls, v: str) -> str:
        return validate_model(v)


def _sse_notice(text: str) -> str:
    """Surface a failure inside the stream the browser is already reading."""
    frame = {"choices": [{"delta": {"content": text}}]}
    return f"data: {json.dumps(frame)}\n\ndata: [DONE]\n\n"


@router.post("/chat", summary="Stream a chat completion (SSE)")
async def chat_stream(
    request: Request,
    body: ChatRequest,
    api_key: str = Depends(require_api_key),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    async def stream() -> AsyncIterator[str]:
        started = time.perf_counter()
        try:
            async with _client(request).stream(
                "POST",
                f"{settings.groq_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": body.model,
                    "messages": [m.model_dump() for m in body.messages],
                    "stream": True,
                    "temperature": 0.7,
                    "max_tokens": 2048,
                },
            ) as resp:
                if not resp.is_success:
                    detail = (await resp.aread()).decode(errors="replace")
                    upstream_requests_total.labels("chat", "error").inc()
                    log.error(
                        "upstream error",
                        extra={
                            "operation": "chat",
                            "upstream_status": resp.status_code,
                            "upstream_body": detail[:2000],
                        },
                    )
                    yield _sse_notice(f"[upstream error {resp.status_code}]")
                    return

                async for line in resp.aiter_lines():
                    if line:
                        yield line + "\n"
            upstream_requests_total.labels("chat", "success").inc()
        except httpx.HTTPError as exc:
            upstream_requests_total.labels("chat", "unreachable").inc()
            log.error("upstream unreachable", extra={"operation": "chat", "error": str(exc)})
            yield _sse_notice("[upstream unreachable]")
        finally:
            upstream_duration_seconds.labels("chat").observe(time.perf_counter() - started)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
