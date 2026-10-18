import os

import pytest

# Deterministic settings for the whole suite. Set before the app is imported so
# the lru_cached Settings object picks them up.
os.environ.update(
    {
        "TM_ENVIRONMENT": "test",
        "TM_VERSION": "0.0.0-test",
        "TM_GIT_SHA": "deadbeef",
        "TM_LOG_FORMAT": "console",
        "TM_LOG_LEVEL": "WARNING",
        "TM_GROQ_BASE_URL": "https://api.groq.test/openai/v1",
        "TM_CORS_ALLOW_ORIGINS": "http://localhost:5173",
        "TM_RATE_LIMIT_REQUESTS": "1000",
        "TM_MAX_UPLOAD_BYTES": "1024",
        "TM_OTEL_EXPORTER_OTLP_ENDPOINT": "",
    }
)

GROQ = "https://api.groq.test/openai/v1"
HEADERS = {"X-Groq-API-Key": "gsk_test_key_123456"}


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c
