# Submission

**Project:** TripleMind — a real-time AI meeting copilot (live transcript,
contextual suggestions, grounded chat).
**Repository:** https://github.com/Suswetha6/triplemind

## Baseline

| | |
|---|---|
| Commit | `c68b63d5e94d75249a398a3bcd245a6a9f939bf3` |
| Message | `docs: add live demo URL` |
| Date | 2026-04-20 |
| Permalink | https://github.com/Suswetha6/triplemind/commit/c68b63d5e94d75249a398a3bcd245a6a9f939bf3 |

This commit is preserved in the repository history and is the point the final
work is compared against.

### DevOps features that already existed at the baseline

| Area | At baseline |
|---|---|
| Deployment | Manual. Frontend pushed to Vercel through the dashboard (no `vercel.json` in the repo); backend not deployed at all, only prose instructions in the README. Local dev was two hand-started processes joined by the Vite dev proxy. |
| Containers | None |
| Kubernetes | None |
| CI/CD | None. No `.github/` directory. Only `npm run build` and `npm run lint`, run by hand. No tests of any kind. |
| Configuration management | None. No Helm, no Kustomize, no committed env template, no Python lockfile (floating `>=` ranges). |
| Observability | None. No metrics, no structured logging, no tracing, no health endpoint, no dashboards, no alerts. |
| Security | Partial. No credentials in the repo — the Groq key is user-supplied at runtime and proxied server-side — and `.gitignore` covered `.env`. But: no authentication on any endpoint, `allow_origins=["*"]`, no rate limiting, no upload cap, upstream error bodies returned verbatim, unpinned dependencies, and no scanning of any kind. |

## What the pull request adds

1. **Containers** — multi-stage Dockerfiles for both services, running
   non-root with a read-only root filesystem and all capabilities dropped;
   Compose stack with an optional observability profile.
2. **Backend hardening and instrumentation** — `/healthz`, `/readyz`,
   `/version`, `/metrics`; JSON logging with a correlation id; OpenTelemetry
   tracing; CORS allowlist; rate limiting; upload caps; input validation;
   upstream error containment; fully pinned dependencies.
3. **Tests** — 22 pytest cases and 22 Vitest cases, from zero.
4. **Kubernetes** — a Helm chart with Deployments, three distinct probes,
   resource requests, HPA, PDBs, Ingress, NetworkPolicies, ServiceMonitor,
   SLO-derived alert rules, and a `helm test` smoke pod; three value sets for
   three environments with no duplicated manifests.
5. **CI/CD** — `ci.yml` (lint, typecheck, tests, chart validation, five kinds
   of security scanning, and a real kind deploy with a rollback drill),
   `cd.yml` (SHA-tagged images to GHCR with provenance and SBOM, manual
   approval gate, deploy, verify, automatic rollback on failure), and
   `codeql.yml`.
6. **Observability** — Prometheus, Grafana, Tempo; a dashboard committed as
   code; alerts on error-budget burn against a 99%/1h SLO, each linking to a
   runbook section.
7. **Documentation** — architecture, decisions (with rejected alternatives),
   and run instructions.

## Running it

See [Running it](../README.md#running-it). Shortest path to a working
deployment:

```bash
make kind-up      # cluster + ingress-nginx
make deploy       # build, side-load, helm install
make verify       # helm test + version check + smoke test
open http://triplemind.localtest.me:8081
```

## Evidence

| Claim | How to reproduce |
|---|---|
| It runs on Kubernetes | `make deploy && make verify` |
| The running version is traceable to a commit | `scripts/verify-version.sh triplemind <sha>` — checks the Deployment label *and* asks the process |
| A full user journey works | `make journey` — transcribe, suggest, stream chat through the real proxy against a stand-in provider |
| Recovery works | `make rollback-drill` — deliberately breaks a release, proves the service stayed up, rolls back, re-verifies |
| Autoscaling works | `make load` with `kubectl get hpa -w` |
| Signals are usable | `make monitoring`, then the TripleMind dashboard in Grafana |

## Known limitations

Listed in [Known limitations](../README.md#known-limitations) — chiefly that
NetworkPolicies are written and validated but not enforced by kind's CNI, the
rate limiter is per pod, and the backend API is unauthenticated by design
because it carries the caller's own credential.
