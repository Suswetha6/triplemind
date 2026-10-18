"""Runtime configuration. Everything is environment-driven so the same image
runs locally, in Compose, and in Kubernetes without a rebuild."""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TM_", env_file=".env", extra="ignore")

    # --- identity / traceability -------------------------------------------
    app_name: str = "triplemind-backend"
    # Injected at image build time by CI (see .github/workflows/cd.yml) so the
    # running pod can always be traced back to an exact commit.
    version: str = Field(default="dev")
    git_sha: str = Field(default="unknown")
    build_time: str = Field(default="unknown")
    environment: str = Field(default="local")

    # --- upstream -----------------------------------------------------------
    groq_base_url: str = "https://api.groq.com/openai/v1"
    upstream_timeout_seconds: float = 60.0
    upstream_connect_timeout_seconds: float = 5.0

    # --- exposure / security ------------------------------------------------
    # Comma-separated. Defaults to the local dev origin only -- never "*".
    cors_allow_origins: str = "http://localhost:5173,http://localhost:8080"
    trusted_hosts: str = "*"
    max_upload_bytes: int = 25 * 1024 * 1024  # Groq's own audio cap
    rate_limit_requests: int = 60
    rate_limit_window_seconds: int = 60

    # --- observability ------------------------------------------------------
    log_level: str = "INFO"
    log_format: str = "json"  # "json" | "console"
    metrics_enabled: bool = True
    otel_exporter_otlp_endpoint: str = ""  # empty disables tracing
    otel_service_name: str = "triplemind-backend"
    otel_traces_sampler_ratio: float = 1.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    @property
    def trusted_host_list(self) -> list[str]:
        return [h.strip() for h in self.trusted_hosts.split(",") if h.strip()]

    @property
    def tracing_enabled(self) -> bool:
        return bool(self.otel_exporter_otlp_endpoint)


@lru_cache
def get_settings() -> Settings:
    return Settings()
