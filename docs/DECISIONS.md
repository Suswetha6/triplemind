# Design decisions

Each entry is a choice, the alternative that was rejected, and the condition
under which the other option would be right.

---

## Deployment, not StatefulSet

The backend keeps nothing between requests — the transcript, suggestions and
chat history all live in the browser, and the only persistent thing in the
system (the user's settings) is in `localStorage`. Pods are therefore
interchangeable, which is exactly the assumption a Deployment makes.

*Alternative:* StatefulSet, for stable network identity and per-pod volumes.
Neither is needed, and both would slow rollouts (ordered, one at a time).

*When it would change:* if transcripts were persisted server-side, or if the
suggestion loop kept per-session state in process memory rather than taking it
from the request.

---

## One uvicorn worker per container

Concurrency comes from running more pods, not more workers inside a pod. One
process per container means the pod's CPU and memory numbers describe one
thing, the HPA's per-pod utilisation signal is meaningful, and a crash is a
pod restart the kubelet can see rather than a silently respawned child.

*Alternative:* `--workers 4`. Cheaper per request at low scale, but it hides
failures inside the container and makes resource requests guesswork.

---

## Three probes, each answering a different question

| Probe | Endpoint | Question |
|---|---|---|
| startup | `/healthz` | has the process finished booting? |
| liveness | `/healthz` | is it wedged and in need of a restart? |
| readiness | `/readyz` | should it receive traffic right now? |

The important constraint: **liveness must not depend on Groq.** If `/healthz`
called the provider, a Groq outage would fail every liveness probe, the
kubelet would restart every pod, and a third-party incident would become a
self-inflicted outage. `/healthz` therefore only proves the event loop is
answering.

The startup probe exists so the liveness probe can be aggressive without
risking a kill during a slow start.

*This was not theoretical:* the first deploy to kind crash-looped because Helm
rendered `maxUploadBytes: 26214400` as `"2.62144e+07"` and pydantic rejected
it at import. The startup probe caught it in seconds and the failed rollout
never took traffic. The fix is `| int64 | quote` in the ConfigMap template.

---

## Memory limits, no CPU limits

Requests are set on both resources so the scheduler can pack honestly. A
memory limit is set because memory is incompressible — a leak must be stopped.
A CPU limit is deliberately *not* set on the backend: CFS throttling at the
limit damages p99 latency, and this is a latency-sensitive path where a
suggestion batch has a 30-second window to be useful.

*When it would change:* a shared cluster with untrusted neighbours, or a
chargeback model that requires a hard CPU ceiling. The knob is
`backend.resources.limits.cpu` and it is intentionally left unset rather than
absent.

---

## Rolling update with `maxUnavailable: 0`

Capacity never dips during a release: a new pod is added, it must pass
readiness, then an old one is retired. Combined with `helm --wait`, a release
that cannot become ready fails the pipeline *before* the old version is gone —
which is what makes the automatic rollback in CD cheap.

*Alternatives considered:*

- **Blue-green** — two full stacks and an atomic switch. Gives instant
  rollback, costs double the resources during a release, and needs a second
  Service plus a label flip. Not justified for two stateless Deployments where
  a rolling update already keeps capacity constant.
- **Canary** — percentage-based traffic shifting. Genuinely useful here
  because suggestion quality is subjective and hard to assert in a test, but
  it needs either an ingress that supports weighting or a service mesh, and a
  metric good enough to promote or abort on. The honest version of that is a
  project of its own; shipping a half-wired canary would be worse than a
  rolling update that works.
- **Feature flags** — the right tool for changing prompt behaviour without a
  deploy. Noted as the natural next step, not implemented.

---

## The user's API key is never a cluster secret

The Groq key belongs to the end user. It is typed into Settings, stored in
that browser's `localStorage`, sent as `X-Groq-API-Key` on each request, and
forwarded upstream. It is never persisted, never logged, and never written to
a Kubernetes Secret.

This is the correct design for a bring-your-own-key tool, and it also means
the repository and the running cluster hold no provider credential at all.
`backend.existingSecret` exists in the chart for deployment-owned secrets, and
is empty.

*When it would change:* a hosted multi-tenant version with a platform-owned
key. That needs real authentication first — without it, a platform key behind
an open proxy is a bill waiting to happen.

---

## Rate limiting is per pod, in process

A sliding-window counter per client IP, inside each backend pod. No Redis, no
extra dependency, ~40 lines.

**The limitation, stated plainly:** with N replicas the effective ceiling is
N × limit, and the window resets when a pod restarts. This blunts accidental
retry loops and casual abuse; it is not a defence against a determined
attacker.

*When it would change:* the moment there is authentication to key the limit
on, or a real abuse problem — then a shared counter in Redis, or the limit
moves out to the ingress where it can be enforced once.

---

## Upstream error bodies are logged, not returned

Groq's error responses can echo fragments of the request. The backend logs the
full upstream body and status, and returns a generic message with the status
normalised (5xx → 502). A test asserts a planted secret in an upstream error
never reaches the client.

The `X-Request-ID` in the response is what connects a user's report to the
full detail in the logs.

---

## kind, not a cloud cluster

The brief permits local Kubernetes and does not require paid infrastructure.
kind gives a real API server, real scheduling, real probes and real rollouts.

*What it does not give, stated so no claim is overread:*

- **NetworkPolicy is not enforced** — kindnet ignores it. The policies are
  written, rendered and schema-validated in CI, and enabled in
  `values-prod.yaml`, but they are *not* proven to block anything here.
  Proving them needs a Calico or Cilium CNI.
- **No real LoadBalancer** — ingress-nginx is reached through a node port
  mapped to a host port.
- **Single node** — `topologySpreadConstraints` use `ScheduleAnyway`, so they
  degrade to no-ops rather than blocking scheduling.

---

## CD deploys to an ephemeral cluster

A hosted GitHub runner cannot reach a kind cluster on a laptop. Rather than
mock the deployment, the CD job creates a kind cluster, pulls the digests it
just published, installs the same chart with the same values, and runs the
same verification. The deploy step is real; only the cluster is disposable.
Pointing it at a persistent cluster is a kubeconfig secret and one step — the
rest of the job is unchanged.

---

## Manual approval before deploy, automation everywhere else

Build, test, scan and publish run unattended: they are reversible and cheap to
repeat. The deploy job sits behind a GitHub Environment with required
reviewers, because it is the one step that changes what users see.

Verification after deploy is automated again, and so is the rollback when
verification fails — recovery should not wait for someone to wake up.

---

## Dependencies are pinned, and the pins are generated

`requirements.in` holds direct dependencies with floors; `requirements.txt` is
the fully-resolved transitive set, produced by `make lock-backend` in a
container. The frontend uses `npm ci` against the committed lockfile.

*Why not just pin by hand:* hand-pinned direct dependencies still let
transitive versions float, so two builds of the same commit can differ.
