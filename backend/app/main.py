"""Application factory.

Middleware order matters and is listed outermost-first below:
  1. CORS            -- must see every response, including rejections
  2. TrustedHost     -- cheap Host-header check before any work
  3. RequestContext  -- request id + access log + metrics around everything else
  4. RateLimit       -- reject abusive callers before body parsing
  5. BodySizeLimit   -- reject oversized uploads before they reach a handler
"""
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import get_settings
from .logging_setup import configure_logging
from .middleware import BodySizeLimitMiddleware, RateLimitMiddleware, RequestContextMiddleware
from .observability import build_info, setup_tracing
from .routes import health, proxy

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # One pooled client for the process: TLS handshakes to Groq are expensive
    # and a per-request client would redo them on every 30s transcription tick.
    app.state.http = httpx.AsyncClient(
        timeout=httpx.Timeout(
            settings.upstream_timeout_seconds,
            connect=settings.upstream_connect_timeout_seconds,
        ),
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=10),
    )
    app.state.ready = True
    log.info(
        "startup complete",
        extra={
            "version": settings.version,
            "git_sha": settings.git_sha,
            "env": settings.environment,
        },
    )
    try:
        yield
    finally:
        app.state.ready = False  # fail readiness first so the endpoint drains
        await app.state.http.aclose()
        log.info("shutdown complete")


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings)
    build_info.labels(settings.version, settings.git_sha, settings.environment).set(1)

    expose_docs = settings.environment != "production"
    app = FastAPI(
        title="TripleMind API",
        version=settings.version,
        lifespan=lifespan,
        docs_url="/docs" if expose_docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if expose_docs else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Groq-API-Key", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_host_list)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        RateLimitMiddleware,
        limit=settings.rate_limit_requests,
        window_seconds=settings.rate_limit_window_seconds,
    )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_upload_bytes)

    app.include_router(health.router)
    app.include_router(proxy.router)

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError):
        log.warning("request validation failed", extra={"errors": exc.errors()[:5]})
        return JSONResponse({"detail": "Request failed validation."}, status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        # Never surface a stack trace to the client; the request id in the
        # response header is enough to find the full trace in the pod logs.
        log.exception("unhandled error", extra={"path": request.url.path})
        return JSONResponse({"detail": "Internal server error."}, status_code=500)

    setup_tracing(app, settings)
    return app


app = create_app()
