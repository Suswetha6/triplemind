import json
import httpx
from fastapi import FastAPI, Header, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_BASE = "https://api.groq.com/openai/v1"


@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form(...),
    x_groq_api_key: str = Header(...),
):
    audio_bytes = await file.read()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{GROQ_BASE}/audio/transcriptions",
            headers={"Authorization": f"Bearer {x_groq_api_key}"},
            files={"file": (file.filename or "audio.webm", audio_bytes, "audio/webm")},
            data={"model": model, "response_format": "text"},
        )
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return {"text": resp.text}


class SuggestionsRequest(BaseModel):
    prompt: str
    model: str


@app.post("/api/suggestions")
async def suggestions(
    body: SuggestionsRequest,
    x_groq_api_key: str = Header(...),
):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GROQ_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {x_groq_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": body.model,
                "messages": [{"role": "user", "content": body.prompt}],
                "response_format": {"type": "json_object"},
                "temperature": 0.7,
                "max_tokens": 1024,
            },
        )
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    data = resp.json()
    raw = json.loads(data["choices"][0]["message"]["content"])
    return {"suggestions": raw.get("suggestions", raw)}


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str


@app.post("/api/chat")
async def chat_stream(
    body: ChatRequest,
    x_groq_api_key: str = Header(...),
):
    async def stream():
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream(
                "POST",
                f"{GROQ_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {x_groq_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": body.model,
                    "messages": [m.model_dump() for m in body.messages],
                    "stream": True,
                    "temperature": 0.7,
                    "max_tokens": 2048,
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if line:
                        yield line + "\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
