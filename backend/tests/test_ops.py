"""Operational endpoints -- these are what the kubelet and Prometheus rely on."""


def test_healthz_is_independent_of_upstream(client):
    """Liveness must not depend on Groq, or an upstream outage would cause the
    kubelet to restart otherwise-healthy pods."""
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_readyz_reports_ready_after_startup(client):
    resp = client.get("/readyz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ready"


def test_version_exposes_the_running_build(client):
    body = client.get("/version").json()
    assert body["version"] == "0.0.0-test"
    assert body["gitSha"] == "deadbeef"
    assert body["environment"] == "test"


def test_metrics_exposes_prometheus_series(client):
    client.get("/healthz")
    text = client.get("/metrics").text
    assert "triplemind_http_requests_total" in text
    assert 'triplemind_build_info{environment="test"' in text


def test_request_id_is_echoed_and_generated(client):
    supplied = client.get("/healthz", headers={"X-Request-ID": "abc123"})
    assert supplied.headers["X-Request-ID"] == "abc123"
    generated = client.get("/healthz").headers["X-Request-ID"]
    assert len(generated) == 32
