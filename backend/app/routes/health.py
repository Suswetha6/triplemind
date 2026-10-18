"""Liveness, readiness, version and metrics endpoints.

Liveness and readiness are deliberately different checks:

* /healthz answers "is this process wedged?" -- it must never depend on Groq,
  otherwise a third-party outage would make the kubelet kill healthy pods.
* /readyz answers "can this pod serve traffic?" -- it waits for startup to
  finish so a rolling update never sends traffic to a half-initialised pod.
"""
from fastapi import APIRouter, Request, Response

from ..config import get_settings
from ..observability import CONTENT_TYPE, render_metrics

router = APIRouter(tags=["ops"])


@router.get("/healthz", summary="Liveness probe")
async def healthz() -> dict:
    return {"status": "ok"}


@router.get("/readyz", summary="Readiness probe")
async def readyz(request: Request, response: Response) -> dict:
    ready = bool(getattr(request.app.state, "ready", False))
    if not ready:
        response.status_code = 503
    return {"status": "ready" if ready else "starting"}


@router.get("/version", summary="Running build metadata")
async def version() -> dict:
    """Lets evidence tie a live pod back to the exact commit that produced it."""
    settings = get_settings()
    return {
        "name": settings.app_name,
        "version": settings.version,
        "gitSha": settings.git_sha,
        "buildTime": settings.build_time,
        "environment": settings.environment,
    }


@router.get("/metrics", summary="Prometheus exposition", include_in_schema=False)
async def metrics() -> Response:
    settings = get_settings()
    if not settings.metrics_enabled:
        return Response(status_code=404)
    return Response(content=render_metrics(), media_type=CONTENT_TYPE)
