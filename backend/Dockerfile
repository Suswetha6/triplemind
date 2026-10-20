# syntax=docker/dockerfile:1.7
# --- build stage: resolve deps into a venv we can copy wholesale -------------
FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copied first so the dependency layer is cached across source-only changes.
COPY requirements.txt ./
# pip is removed from the venv immediately after use: nothing at runtime needs
# it, and shipping it means inheriting every pip CVE in the image scan.
RUN pip install -r requirements.txt \
 && python -m pip uninstall -y pip

# --- runtime stage ----------------------------------------------------------
FROM python:3.12-slim AS runtime

# Build metadata injected by CI; surfaced at /version and as a Prometheus
# label so a running pod is always traceable to a commit.
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TM_VERSION=${APP_VERSION} \
    TM_GIT_SHA=${GIT_SHA} \
    TM_BUILD_TIME=${BUILD_TIME}

# Patch the base image, drop the package manager's cache, and remove the
# system pip. pip is a build-time tool: removing it resolves CVE-2026-8643 and
# every future pip advisory, and a container that cannot install packages is
# one less thing an attacker can use. setuptools is deliberately left in place
# -- some runtime imports still reach for pkg_resources.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/python3.12/site-packages/pip \
           /usr/local/lib/python3.12/site-packages/pip-*.dist-info \
           /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.12 \
 && groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY --from=builder /opt/venv /opt/venv

WORKDIR /srv
COPY --chown=root:root app ./app

# Non-root, and nothing under /srv is writable by the runtime user, so the
# container runs fine with readOnlyRootFilesystem in Kubernetes.
USER 10001:10001

EXPOSE 8000

# Compose-level check only; Kubernetes uses the probes in the Helm chart.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=2).status==200 else 1)"

LABEL org.opencontainers.image.title="triplemind-backend" \
      org.opencontainers.image.source="https://github.com/Suswetha6/triplemind" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${APP_VERSION}"

# One worker per container: scaling is the HPA's job, not uvicorn's, so each
# pod stays a single schedulable unit with predictable resource use.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*"]
