"""Cross-cutting request middleware: correlation ids, access logging, metrics,
body-size enforcement and a per-pod rate limiter."""
import logging
import time
import uuid
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .logging_setup import request_id_ctx
from .observability import (
    http_request_duration_seconds,
    http_requests_in_flight,
    http_requests_total,
    rate_limited_total,
)

log = logging.getLogger("triplemind.access")

REQUEST_ID_HEADER = "X-Request-ID"


def _route_template(request: Request) -> str:
    """Use the matched route pattern, not the raw path, to keep metric
    cardinality bounded."""
    route = request.scope.get("route")
    return getattr(route, "path", None) or "unmatched"


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assigns/propagates a request id and emits one structured access log line."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        token = request_id_ctx.set(request_id)
        start = time.perf_counter()
        http_requests_in_flight.inc()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers[REQUEST_ID_HEADER] = request_id
            return response
        finally:
            duration = time.perf_counter() - start
            http_requests_in_flight.dec()
            route = _route_template(request)
            http_requests_total.labels(request.method, route, str(status)).inc()
            http_request_duration_seconds.labels(request.method, route).observe(duration)
            if route not in ("/healthz", "/readyz", "/metrics"):
                log.info(
                    "request",
                    extra={
                        "method": request.method,
                        "route": route,
                        "path": request.url.path,
                        "status": status,
                        "duration_ms": round(duration * 1000, 2),
                        "client_ip": request.client.host if request.client else None,
                    },
                )
            request_id_ctx.reset(token)


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Rejects oversized uploads up front. Without this an unauthenticated
    caller can push arbitrary bytes through the pod and on to Groq."""

    def __init__(self, app, max_bytes: int) -> None:
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next):
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            log.warning("request body too large", extra={"declared_bytes": int(declared)})
            return JSONResponse(
                {"detail": f"Request body exceeds {self.max_bytes} bytes."},
                status_code=413,
            )
        return await call_next(request)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window limiter, per client IP, per pod.

    Deliberately in-process: a shared limiter would need Redis, and the goal
    here is to blunt accidental loops and trivial abuse of an unauthenticated
    proxy. With N replicas the effective ceiling is N x limit -- documented in
    docs/DECISIONS.md rather than hidden.
    """

    def __init__(self, app, limit: int, window_seconds: int) -> None:
        super().__init__(app)
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _client_key(self, request: Request) -> str:
        # Ingress sits in front in Kubernetes, so prefer the forwarded chain.
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next):
        if request.url.path in ("/healthz", "/readyz", "/metrics", "/version"):
            return await call_next(request)

        key = self._client_key(request)
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()

        if len(hits) >= self.limit:
            rate_limited_total.labels(request.url.path).inc()
            retry_after = int(self.window - (now - hits[0])) + 1
            log.warning("rate limited", extra={"client_key": key, "path": request.url.path})
            return JSONResponse(
                {"detail": "Too many requests."},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )

        hits.append(now)
        response: Response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, self.limit - len(hits)))
        return response
