"""Prometheus metrics and OpenTelemetry tracing wiring."""
import logging

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

log = logging.getLogger(__name__)

# Buckets tuned for this workload: health checks land in single-digit ms, Groq
# chat/transcription calls routinely take seconds, so the tail matters.
_LATENCY_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60)

http_requests_total = Counter(
    "triplemind_http_requests_total",
    "HTTP requests handled by the backend.",
    ["method", "route", "status"],
)

http_request_duration_seconds = Histogram(
    "triplemind_http_request_duration_seconds",
    "End-to-end request latency.",
    ["method", "route"],
    buckets=_LATENCY_BUCKETS,
)

http_requests_in_flight = Gauge(
    "triplemind_http_requests_in_flight",
    "Requests currently being served.",
)

upstream_requests_total = Counter(
    "triplemind_upstream_requests_total",
    "Calls made to the Groq API.",
    ["operation", "outcome"],
)

upstream_duration_seconds = Histogram(
    "triplemind_upstream_duration_seconds",
    "Groq API call latency.",
    ["operation"],
    buckets=_LATENCY_BUCKETS,
)

rate_limited_total = Counter(
    "triplemind_rate_limited_total",
    "Requests rejected by the per-pod rate limiter.",
    ["route"],
)

build_info = Gauge(
    "triplemind_build_info",
    "Build metadata of the running process; value is always 1.",
    ["version", "git_sha", "environment"],
)

CONTENT_TYPE = CONTENT_TYPE_LATEST


def render_metrics() -> bytes:
    return generate_latest()


def setup_tracing(app, settings) -> None:
    """Install OTel tracing. No-op unless an OTLP endpoint is configured, so
    local runs and unit tests stay free of exporter noise."""
    if not settings.tracing_enabled:
        log.info("tracing disabled (TM_OTEL_EXPORTER_OTLP_ENDPOINT unset)")
        return

    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

    resource = Resource.create(
        {
            "service.name": settings.otel_service_name,
            "service.version": settings.version,
            "deployment.environment": settings.environment,
        }
    )
    provider = TracerProvider(
        resource=resource,
        sampler=ParentBased(TraceIdRatioBased(settings.otel_traces_sampler_ratio)),
    )
    provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(endpoint=f"{settings.otel_exporter_otlp_endpoint}/v1/traces")
        )
    )
    trace.set_tracer_provider(provider)

    # /healthz and /metrics are excluded: kubelet and Prometheus poll them
    # constantly and the spans carry no diagnostic value.
    FastAPIInstrumentor.instrument_app(app, excluded_urls="healthz,readyz,metrics")
    HTTPXClientInstrumentor().instrument()
    log.info("tracing enabled", extra={"endpoint": settings.otel_exporter_otlp_endpoint})
