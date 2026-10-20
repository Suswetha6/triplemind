# TripleMind -- developer and operator entry points.
# `make help` lists everything.

SHELL          := /usr/bin/env bash
.DEFAULT_GOAL  := help

CLUSTER        ?= triplemind
NAMESPACE      ?= triplemind
RELEASE        ?= triplemind
CHART          := deploy/helm/triplemind
VALUES         ?= $(CHART)/values-dev.yaml
APP_VERSION    ?= dev
GIT_SHA        ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo local)
INGRESS_URL    ?= http://triplemind.localtest.me:8081

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# --- local development ------------------------------------------------------

.PHONY: install
install: ## Install frontend dependencies
	npm ci

.PHONY: dev
dev: ## Run the frontend dev server (expects the backend on :8000)
	npm run dev

.PHONY: lint
lint: ## Lint frontend and backend
	npm run lint
	cd backend && ruff check .

.PHONY: test
test: ## Run both test suites
	npm run test
	cd backend && pytest -q

.PHONY: test-backend-docker
test-backend-docker: ## Run backend tests in a container (no local Python needed)
	docker run --rm -v "$(PWD)/backend":/w -w /w python:3.12-slim \
	  sh -c "pip install --quiet -r requirements-dev.txt && pytest -q"

.PHONY: lock-backend
lock-backend: ## Re-resolve backend dependency pins from requirements*.in
	docker run --rm -v "$(PWD)/backend":/w -w /w python:3.12-slim sh -c "\
	  pip install --quiet pip-tools==7.4.1 && \
	  pip-compile --quiet --no-header --strip-extras -o requirements.txt requirements.in && \
	  pip-compile --quiet --no-header --strip-extras -o requirements-dev.txt requirements-dev.in"

# --- containers -------------------------------------------------------------

.PHONY: build
build: ## Build both images
	docker build -t triplemind-frontend:$(APP_VERSION) \
	  --build-arg APP_VERSION=$(APP_VERSION) --build-arg GIT_SHA=$(GIT_SHA) .
	docker build -t triplemind-backend:$(APP_VERSION) \
	  --build-arg APP_VERSION=$(APP_VERSION) --build-arg GIT_SHA=$(GIT_SHA) ./backend

.PHONY: up
up: ## Run the stack in Docker Compose
	docker compose up -d --build

.PHONY: up-observability
up-observability: ## Compose stack plus Prometheus, Grafana and Tempo
	TM_OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318 \
	  docker compose --profile observability up -d --build

.PHONY: down
down: ## Stop the Compose stack
	docker compose --profile observability down -v

.PHONY: logs
logs: ## Tail Compose logs
	docker compose logs -f

# --- kubernetes -------------------------------------------------------------

.PHONY: kind-up
kind-up: ## Create the kind cluster with ingress-nginx and metrics-server
	kind create cluster --config deploy/kind/cluster.yaml --wait 120s
	kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.0/deploy/static/provider/kind/deploy.yaml
	kubectl wait --namespace ingress-nginx --for=condition=ready pod \
	  --selector=app.kubernetes.io/component=controller --timeout=180s
	$(MAKE) metrics-server

.PHONY: metrics-server
metrics-server: ## Install metrics-server (the HPA has no input without it)
	kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.2/components.yaml
	# kind's kubelet serves its metrics endpoint with a self-signed cert that
	# metrics-server will not trust by default.
	kubectl patch -n kube-system deployment metrics-server --type=json \
	  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
	kubectl rollout status -n kube-system deployment/metrics-server --timeout=180s

.PHONY: kind-down
kind-down: ## Delete the kind cluster
	kind delete cluster --name $(CLUSTER)

.PHONY: kind-load
kind-load: build ## Build images and side-load them onto the kind node
	kind load docker-image triplemind-backend:$(APP_VERSION) triplemind-frontend:$(APP_VERSION) --name $(CLUSTER)

.PHONY: deploy
deploy: kind-load ## Install/upgrade the chart on kind
	helm upgrade --install $(RELEASE) $(CHART) -n $(NAMESPACE) --create-namespace \
	  -f $(VALUES) \
	  --set global.appVersion=$(APP_VERSION) \
	  --set backend.image.tag=$(APP_VERSION) \
	  --set frontend.image.tag=$(APP_VERSION) \
	  --wait --timeout 5m

.PHONY: template
template: ## Render the chart without installing it
	helm template $(RELEASE) $(CHART) -f $(VALUES)

.PHONY: chart-lint
chart-lint: ## Lint the chart against every value set
	for f in values.yaml values-dev.yaml values-prod.yaml; do \
	  helm lint $(CHART) -f $(CHART)/$$f --strict; \
	done

.PHONY: undeploy
undeploy: ## Remove the release
	helm uninstall $(RELEASE) -n $(NAMESPACE)

# --- verification -----------------------------------------------------------

.PHONY: verify
verify: ## helm test + version check + smoke test through the ingress
	helm test $(RELEASE) -n $(NAMESPACE) --logs
	./scripts/verify-version.sh $(RELEASE) $(APP_VERSION) $(NAMESPACE)
	./scripts/smoke.sh $(INGRESS_URL)

.PHONY: journey
journey: ## Drive the full user journey against the release (stand-in provider)
	./scripts/demo-journey.sh $(NAMESPACE)

.PHONY: rollback-drill
rollback-drill: ## Break a release on purpose, then recover from it
	./scripts/rollback-drill.sh $(RELEASE) $(NAMESPACE)

.PHONY: load
load: ## Generate load to exercise the HPA
	./scripts/load.sh 120 20 $(NAMESPACE)

.PHONY: monitoring
monitoring: ## Install Prometheus, Grafana, Tempo and wire up the dashboard
	./scripts/install-monitoring.sh

.PHONY: status
status: ## What is running, and which version
	kubectl get deploy,pods,svc,ingress,hpa -n $(NAMESPACE) -L app.kubernetes.io/version
	helm history $(RELEASE) -n $(NAMESPACE)
