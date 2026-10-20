"""Structured JSON logging.

Every log line carries the request id so a user-reported failure can be traced
from the browser's X-Request-ID response header straight to the pod logs, and
(when tracing is on) to the matching span via trace_id.
"""
import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

_RESERVED = {
    "args", "asctime", "created", "exc_info", "exc_text", "filename", "funcName",
    "levelname", "levelno", "lineno", "module", "msecs", "message", "msg", "name",
    "pathname", "process", "processName", "relativeCreated", "stack_info",
    "thread", "threadName", "taskName",
}


class JsonFormatter(logging.Formatter):
    def __init__(self, service: str, version: str, environment: str) -> None:
        super().__init__()
        self.service = service
        self.version = version
        self.environment = environment

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "service": self.service,
            "version": self.version,
            "env": self.environment,
            "request_id": request_id_ctx.get(),
        }

        trace_id = _current_trace_id()
        if trace_id:
            payload["trace_id"] = trace_id

        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


def _current_trace_id() -> str | None:
    """Best-effort span correlation; returns None when tracing is not installed."""
    try:
        from opentelemetry import trace
    except ImportError:  # pragma: no cover - tracing extras not installed
        return None
    span = trace.get_current_span()
    ctx = span.get_span_context()
    if not ctx.is_valid:
        return None
    return format(ctx.trace_id, "032x")


def configure_logging(settings) -> None:
    handler = logging.StreamHandler(sys.stdout)
    if settings.log_format == "json":
        handler.setFormatter(
            JsonFormatter(settings.app_name, settings.version, settings.environment)
        )
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-8s %(name)s | %(message)s")
        )

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level.upper())

    # uvicorn ships its own handlers; drop them so everything is JSON on stdout.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True

    # The access log is replaced by our own middleware, which records duration,
    # request id and route template rather than a raw path.
    logging.getLogger("uvicorn.access").disabled = True
