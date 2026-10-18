"""Exposure controls: CORS allowlist and the per-pod rate limiter."""
import os

import pytest
from fastapi.testclient import TestClient

from .conftest import HEADERS


def test_cors_rejects_unknown_origin(client):
    resp = client.options(
        "/api/suggestions",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in {k.lower() for k in resp.headers}


def test_cors_allows_configured_origin(client):
    resp = client.options(
        "/api/suggestions",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-groq-api-key",
        },
    )
    assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"


@pytest.fixture
def strict_client(monkeypatch):
    """A second app instance with a limit of 2 requests/minute."""
    from app.config import get_settings

    monkeypatch.setitem(os.environ, "TM_RATE_LIMIT_REQUESTS", "2")
    get_settings.cache_clear()
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c
    get_settings.cache_clear()


def test_rate_limiter_rejects_the_third_request(strict_client):
    for _ in range(2):
        # 400 (bad key) still counts -- the limiter runs before the handler.
        strict_client.post("/api/suggestions", headers=HEADERS, json={"prompt": "x", "model": "m"})
    resp = strict_client.post(
        "/api/suggestions", headers=HEADERS, json={"prompt": "x", "model": "m"}
    )
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers


def test_probes_are_exempt_from_rate_limiting(strict_client):
    for _ in range(10):
        assert strict_client.get("/healthz").status_code == 200
