"""OpenTelemetry tracing bootstrap shared by the backend entry points."""
from __future__ import annotations

import logging


logger = logging.getLogger("dmb_backlog.telemetry")
_configured = False


def _trace_response_hook(span, scope, message) -> None:
    """Attach the active trace id while the ASGI server span is still alive."""
    if message.get("type") != "http.response.start":
        return
    context = span.get_span_context()
    if not context or not context.is_valid:
        return
    headers = list(message.get("headers", []))
    headers = [item for item in headers if item[0].lower() != b"x-trace-id"]
    headers.append((b"x-trace-id", format(context.trace_id, "032x").encode("ascii")))
    message["headers"] = headers


def current_trace_id() -> str | None:
    """Return the active W3C trace id without making OTel a hard import."""
    try:
        from opentelemetry import trace

        context = trace.get_current_span().get_span_context()
        if context and context.is_valid:
            return format(context.trace_id, "032x")
    except ImportError:
        return None
    return None


def configure_telemetry(app, *, engine, settings) -> bool:
    """Configure OTLP tracing once per process.

    The SDK is optional for local development, but an enabled production
    configuration fails closed when dependencies or the collector are missing.
    """
    global _configured
    if _configured or not settings.OTEL_ENABLED:
        return _configured
    if not settings.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
        raise RuntimeError(
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is required when OTEL_ENABLED=true"
        )
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        from opentelemetry.instrumentation.urllib import URLLibInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
    except ImportError as exc:
        raise RuntimeError(
            "OpenTelemetry dependencies are required when OTEL_ENABLED=true"
        ) from exc

    ratio = min(1.0, max(0.0, float(settings.OTEL_TRACE_SAMPLE_RATIO)))
    provider = TracerProvider(
        resource=Resource.create({
            "service.name": settings.OTEL_SERVICE_NAME,
            "service.version": settings.APP_VERSION,
            "deployment.environment.name": settings.OTEL_DEPLOYMENT_ENVIRONMENT,
        }),
        sampler=ParentBased(TraceIdRatioBased(ratio)),
    )
    exporter = OTLPSpanExporter(
        endpoint=settings.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
        timeout=settings.OTEL_EXPORT_TIMEOUT_SECONDS,
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=provider,
        excluded_urls=settings.OTEL_EXCLUDED_URLS,
        client_response_hook=_trace_response_hook,
    )
    SQLAlchemyInstrumentor().instrument(engine=engine, tracer_provider=provider)
    URLLibInstrumentor().instrument(tracer_provider=provider)
    _configured = True
    logger.info(
        "OpenTelemetry tracing enabled: service=%s endpoint=%s sample_ratio=%s",
        settings.OTEL_SERVICE_NAME,
        settings.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
        ratio,
    )
    return True
