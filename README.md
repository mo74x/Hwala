<p align="center">
  <h1 align="center">Hwala</h1>
  <p align="center">
    <b>Enterprise-Grade, Multi-Tenant Digital Wallet and Financial Ledger Engine</b>
  </p>
  <p align="center">
    Built with NestJS 11 | Prisma 7 | PostgreSQL 16 | Redis 7 | BullMQ
  </p>
</p>

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [Core Features](#core-features)
- [Database Domain Model](#database-domain-model)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Local Development and Setup](#local-development-and-setup)
- [Running Tests](#running-tests)
- [DevOps and Deployment](#devops-and-deployment)
  - [Containerization](#containerization)
  - [CI/CD Pipeline](#cicd-pipeline)
  - [Kubernetes and Helm Chart](#kubernetes-and-helm-chart)
  - [Secrets Management](#secrets-management)
  - [Observability and Monitoring](#observability-and-monitoring)
  - [Database Backups and Disaster Recovery](#database-backups-and-disaster-recovery)
  - [Security Hardening](#security-hardening)
- [Project Structure](#project-structure)

---

## Overview

**Hwala Core** is a multi-tenant financial transaction engine and double-entry ledger platform designed for scale, fault tolerance, and absolute financial consistency. It handles account management, funds transfers with strict transactional locks, rate-limiting velocity checks, dual-mode JWT and API key authentication, and asynchronous webhook dispatching via BullMQ worker queues.

The platform enforces strict tenant isolation, deterministic deadlock prevention, and financial integrity guarantees through optimistic concurrency control and row-level database locking.

---

## System Architecture

```mermaid
graph TB
    subgraph "Clients"
        WEB[Web Application]
        MOBILE[Mobile App]
        THIRD[Third-Party Services]
    end

    subgraph "API Gateway Layer"
        HELMET[Helmet Security Headers]
        CORS[CORS Policy]
        THROTTLE[Redis Rate Limiter]
        VALIDATION[DTO Validation Pipeline]
    end

    subgraph "Authentication Layer"
        JWT[JWT Bearer Auth]
        APIKEY[API Key Auth]
        SCOPES[Scopes and Roles Guard]
    end

    subgraph "Application Layer"
        AUTH_MOD[Auth Module]
        TENANT_MOD[Tenant Module]
        ACCOUNT_MOD[Accounts Module]
        TRANSFER_MOD[Transfer Module]
        LEDGER[Double-Entry Ledger Engine]
        EXCHANGE_MOD[FX Exchange Module]
        RISK_MOD[Risk Module]
        AUDIT_MOD[Audit Module]
        RECONCILIATION_MOD[Reconciliation Module]
    end

    subgraph "Background Processing"
        BULLMQ[BullMQ Queue]
        WEBHOOK_WORKER[Webhook Dispatcher Worker]
    end

    subgraph "Data Layer"
        PG[(PostgreSQL 16<br/>Primary Datastore)]
        REDIS[(Redis 7<br/>Cache and Queues)]
    end

    subgraph "Observability"
        METRICS[Prometheus /metrics Endpoint]
        HEALTH[Health Check /health]
    end

    WEB & MOBILE & THIRD --> HELMET
    HELMET --> CORS --> THROTTLE --> VALIDATION
    VALIDATION --> JWT & APIKEY
    JWT & APIKEY --> SCOPES
    SCOPES --> AUTH_MOD & TENANT_MOD & ACCOUNT_MOD & TRANSFER_MOD & EXCHANGE_MOD & RISK_MOD
    TRANSFER_MOD --> LEDGER
    LEDGER --> PG
    TRANSFER_MOD --> BULLMQ
    BULLMQ --> WEBHOOK_WORKER
    WEBHOOK_WORKER --> THIRD
    ACCOUNT_MOD & TRANSFER_MOD & RISK_MOD --> PG
    THROTTLE & BULLMQ --> REDIS
    AUDIT_MOD --> PG
    RECONCILIATION_MOD --> PG
```

---

## Technology Stack

| Layer | Technology | Description |
|:---|:---|:---|
| **Runtime** | Node.js 20+ | LTS JavaScript runtime |
| **Framework** | NestJS 11 | TypeScript framework with modular architecture, dependency injection, and decorator-based metadata |
| **Language** | TypeScript 5.7 | Strict type-safe development with ES2023 target |
| **Database** | PostgreSQL 16 | Primary relational datastore for ledger integrity, accounts, and audit trails |
| **ORM** | Prisma 7 | Type-safe database client with native PostgreSQL driver adapter (`@prisma/adapter-pg`) |
| **Caching and Queues** | Redis 7 + BullMQ | Rate limiting, velocity checks, webhook job queues with exponential backoff retries |
| **Authentication** | Passport JWT + Custom API Key Guards | Dual-mode auth with scoped permissions and tenant isolation |
| **Security** | Helmet, Class Validator, Throttler | HTTP security headers (HSTS, CSP, X-Frame-Options), DTO validation pipes, Redis-backed rate limiting |
| **API Documentation** | Swagger / OpenAPI | Interactive REST documentation at `/api/docs` with Bearer and API Key auth support |
| **Health Checks** | NestJS Terminus | System health monitoring at `/health` for database and Redis connectivity status |
| **Observability** | Custom Prometheus Module | Application metrics at `/metrics` in Prometheus exposition format |
| **Containerization** | Docker (multi-stage) | 4-stage production-optimized build with non-root execution |
| **Orchestration** | Kubernetes + Helm | Provider-agnostic Helm chart with per-environment values and auto-scaling |
| **CI/CD** | GitHub Actions | Automated lint, test, build, scan, deploy pipeline with environment promotion gates |

---

## Core Features

### Multi-Tenancy Isolation

Every account, ledger entry, API key, and audit log belongs to a specific `tenantId`. Middleware and Guards enforce strict cross-tenant data isolation at the request level. Each tenant can configure independent webhook URLs, fee structures, and base currencies.

### Double-Entry Ledger Engine

Transfers generate strictly balanced `LedgerEntry` pairs: a Debit entry (`-amount`) and a Credit entry (`+amount`) referencing a single `transactionId`. The system supports multiple entry types including `TRANSFER`, `FEE`, `HOLD`, `RELEASE`, and `REFUND`. Optimistic versioning (`version` field) combined with explicit row-level database locking (`SELECT ... FOR UPDATE`) prevents race conditions and double-spending.

```mermaid
sequenceDiagram
    participant Client
    participant API as Transfer API
    participant Lock as Row Lock Engine
    participant Ledger as Ledger Engine
    participant DB as PostgreSQL
    participant Queue as BullMQ

    Client->>API: POST /transfers (senderId, receiverId, amount)
    API->>API: Validate DTO and check velocity limits in Redis
    API->>Lock: Acquire row locks in deterministic UUID order
    Lock->>DB: SELECT ... FOR UPDATE (sorted accounts)
    API->>API: Verify sender balance >= amount
    API->>Ledger: Create balanced LedgerEntry pair
    Ledger->>DB: INSERT debit entry (-amount)
    Ledger->>DB: INSERT credit entry (+amount)
    Ledger->>DB: UPDATE sender balance, UPDATE receiver balance
    Ledger->>DB: INCREMENT version on both accounts
    API->>Queue: Enqueue webhook event (transfer.completed)
    API-->>Client: 201 Created (transactionId)
    Queue->>Queue: Dispatch webhook with exponential backoff
```

### Deadlock Prevention

Row-locking order is deterministically sorted by account UUID (`[senderId, receiverId].sort()`), eliminating database deadlocks during high-concurrency transfers across the same account pairs.

### Velocity Limits and Redis Throttling

Dynamic velocity limits (e.g., maximum transfers per minute per account) are enforced in Redis *before* acquiring heavy database transaction locks. This prevents unnecessary lock contention during abuse scenarios.

### Fine-Grained Scopes and Roles

Support for roles (`ADMIN`, `SUPPORT`, `API_USER`) and explicit permission scopes (e.g., `['read:ledgers', 'write:ledgers']`) via custom NestJS guards using `@Scopes()` and `@Roles()` decorators.

### Resilient Webhook Dispatcher

Background worker queue (BullMQ) dispatches event notifications (e.g., `transfer.completed`) to tenant-configured `webhookUrl` endpoints with HMAC signature verification and exponential backoff retries. Failed deliveries are tracked in a dedicated `WebhookFailure` table with full payload preservation.

### Risk Flagging and Audit Trail

All sensitive operations produce immutable `AuditLog` entries. The Risk Module automatically flags suspicious activity with configurable severity levels (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) and tracks flag lifecycle through `OPEN`, `INVESTIGATING`, `RESOLVED`, and `DISMISSED` statuses.

---

## Database Domain Model

```mermaid
erDiagram
    Tenant ||--o{ User : "has"
    Tenant ||--o{ ApiKey : "owns"
    Tenant ||--o{ Account : "manages"
    Tenant ||--o{ LedgerEntry : "contains"
    Tenant ||--o{ WebhookOutbox : "dispatches"
    Tenant ||--o{ AuditLog : "records"
    Tenant ||--o{ RiskFlag : "monitors"
    Account ||--o{ LedgerEntry : "has history"
    Account ||--o{ RiskFlag : "flagged by"

    Tenant {
        uuid id PK
        string name
        string webhookUrl
        string webhookSecret
        string baseCurrency
        decimal feeFixed
        decimal feePercentage
        datetime createdAt
        datetime updatedAt
    }

    User {
        uuid id PK
        uuid tenantId FK
        string email
        string passwordHash
        enum role "ADMIN | SUPPORT | API_USER"
        datetime createdAt
    }

    ApiKey {
        uuid id PK
        uuid tenantId FK
        string name
        string keyHash
        array scopes
        datetime createdAt
    }

    Account {
        uuid id PK
        uuid tenantId FK
        uuid userId
        enum type "WALLET | MERCHANT_PAYABLE | PLATFORM_REVENUE"
        string currency
        decimal balance
        decimal holdBalance
        int version
        datetime createdAt
    }

    LedgerEntry {
        uuid id PK
        uuid tenantId FK
        uuid transactionId
        uuid accountId FK
        decimal amount
        string currency
        decimal exchangeRate
        decimal feeAmount
        enum type "TRANSFER | FEE | HOLD | RELEASE | REFUND"
        string idempotencyKey
        string description
        datetime createdAt
    }

    WebhookOutbox {
        uuid id PK
        uuid tenantId FK
        string eventType
        json payload
        enum status "PENDING | PROCESSING | COMPLETED | FAILED"
        int attempts
        datetime createdAt
    }

    AuditLog {
        uuid id PK
        uuid tenantId FK
        uuid userId
        string action
        string targetId
        json metadata
        datetime createdAt
    }

    RiskFlag {
        uuid id PK
        uuid tenantId FK
        uuid accountId FK
        string reason
        enum severity "LOW | MEDIUM | HIGH | CRITICAL"
        enum status "OPEN | INVESTIGATING | RESOLVED | DISMISSED"
        datetime createdAt
    }
```

---

## API Reference

Interactive Swagger documentation is available at `http://localhost:3000/api/docs`.

| Method | Endpoint | Auth Required | Description |
|:---|:---|:---|:---|
| `GET` | `/health` | None | System health check (DB and Redis status) |
| `GET` | `/metrics` | None | Prometheus metrics endpoint |
| `POST` | `/auth/register` | Admin | Register a new user |
| `POST` | `/auth/login` | None | Authenticate user and retrieve JWT token |
| `POST` | `/accounts` | JWT / API Key | Create a new financial account |
| `GET` | `/accounts/:id` | JWT / API Key | Fetch account balance and metadata |
| `POST` | `/transfers` | JWT / API Key (`write:ledgers`) | Execute a funds transfer between accounts |
| `POST` | `/api-keys` | JWT (`ADMIN`) | Generate scoped API key for tenant integration |

---

## Environment Variables

| Variable | Default | Required | Description |
|:---|:---|:---|:---|
| `DATABASE_URL` | `postgresql://postgres@localhost:5432/hawala_db` | Yes | PostgreSQL connection string |
| `DB_POOL_MIN` | `2` | No | Minimum database connection pool size |
| `DB_POOL_MAX` | `10` | No | Maximum database connection pool size |
| `REDIS_HOST` | `localhost` | Yes | Redis server hostname |
| `REDIS_PORT` | `6379` | Yes | Redis server port |
| `REDIS_PASSWORD` | — | No | Redis authentication password |
| `JWT_SECRET` | — | Yes | 256-bit secret key for signing JWT tokens |
| `THROTTLE_TTL` | `60000` | No | Rate limit window in milliseconds |
| `THROTTLE_LIMIT` | `100` | No | Maximum API calls per rate limit window |
| `PORT` | `3000` | No | HTTP application listening port |
| `CORS_ORIGIN` | `http://localhost:3000,http://localhost:5173` | No | Comma-separated allowed CORS origins |
| `FX_API_URL` | `https://open.er-api.com/v6/latest/USD` | No | Foreign exchange rate API URL |
| `FX_CACHE_TTL` | `3600` | No | Exchange rate cache duration in seconds |

---

## Local Development and Setup

### Prerequisites

- Node.js v20 or later
- Docker and Docker Compose

### Installation

```bash
# Install project dependencies
npm install

# Start PostgreSQL and Redis via Docker Compose
docker-compose up -d

# Copy environment variables
cp .env.example .env

# Run Prisma database migrations and generate the client
npx prisma db push
npx prisma generate

# Start the application in development mode
npm run start:dev
```

### Running Tests

```bash
# Unit tests
npm run test

# End-to-end tests
npm run test:e2e

# Test coverage
npm run test:cov
```

### Makefile Shortcuts

```bash
make dev              # Start local stack with Docker Compose
make build            # Build production Docker image
make test             # Run unit tests
make test-e2e         # Run E2E integration tests
make lint             # Run ESLint and type check
make migrate          # Run Prisma dev migrations
make migrate-deploy   # Run Prisma production migrations
make helm-lint        # Lint Helm chart templates
make helm-template    # Render Helm templates (dry-run)
make helm-dev         # Install Helm chart in local cluster
make logs             # Stream Kubernetes API logs
make port-forward     # Port-forward API to localhost:3000
```

---

## DevOps and Deployment

### Deployment Architecture Overview

```mermaid
graph TB
    subgraph "Developer Workflow"
        DEV[Local Development<br/>docker-compose.yml]
        GIT[GitHub Repository<br/>mo74x/Hwala]
    end

    subgraph "CI/CD Pipeline"
        direction LR
        LINT[Lint and Type Check]
        TEST[Unit and E2E Tests]
        BUILD[Docker Build and Push to GHCR]
        SCAN[Trivy CVE Scan]
        DEPLOY[Helm Upgrade to K8s]
    end

    subgraph "Kubernetes Cluster"
        direction TB
        INGRESS[NGINX Ingress Controller]

        subgraph "Application Tier"
            API1[Hwala API Pod 1]
            API2[Hwala API Pod 2]
            APIN[Hwala API Pod N]
            W1[BullMQ Worker Pod 1]
            WN[BullMQ Worker Pod N]
        end

        subgraph "Data Tier - StatefulSets"
            PG[(PostgreSQL 16<br/>Persistent Volume)]
            REDIS[(Redis 7<br/>AOF Persistence)]
        end

        subgraph "Observability Tier"
            PROM[Prometheus]
            GRAFANA[Grafana Dashboards]
            LOKI[Loki Log Aggregation]
        end

        HPA[Horizontal Pod Autoscaler]
        PDB[Pod Disruption Budget]
    end

    DEV -->|git push| GIT
    GIT -->|trigger| LINT --> TEST --> BUILD --> SCAN --> DEPLOY
    DEPLOY --> INGRESS
    INGRESS --> API1 & API2 & APIN
    API1 & API2 & APIN --> PG & REDIS
    W1 & WN --> PG & REDIS
    HPA -.->|scale| API1 & API2 & APIN
    PDB -.->|protect| API1 & API2 & APIN
    PROM -->|scrape /metrics| API1
    LOKI -->|collect logs| API1
    PROM --> GRAFANA
    LOKI --> GRAFANA
```

---

### Containerization

The application uses a 4-stage multi-stage Docker build optimized for production:

| Stage | Purpose |
|:---|:---|
| `base` | Node 20 Alpine with system dependencies (`openssl`, `libc6-compat`) |
| `deps` | Production-only `node_modules` via `npm ci --omit=dev` |
| `build` | Full dependency install, Prisma client generation, and NestJS compilation |
| `production` | Minimal image with `dist/`, `node_modules/`, `generated/`, `prisma/` only. Runs as non-root `node` user with `/health` healthcheck. |

The `docker-compose.prod.yml` provides a production-like local stack with `hwala-api`, `hwala-worker`, `postgres`, and `redis` on a shared bridge network (`hwala-net`) with health-conditioned startup ordering.

---

### CI/CD Pipeline

Three GitHub Actions workflows automate the full software delivery lifecycle:

```mermaid
graph LR
    subgraph "ci.yml - Continuous Integration"
        direction TB
        L[ESLint + tsc --noEmit] --> U[Jest Unit Tests + Coverage]
        U --> E[E2E Tests with Postgres + Redis containers]
        E --> B[Docker Multi-Stage Build]
        B --> T[Trivy Vulnerability Scan]
        T --> P[Push to GitHub Container Registry]
    end

    subgraph "deploy.yml - Continuous Deployment"
        direction TB
        D1[develop branch] -->|auto| DEV_ENV[Dev Environment]
        D2[staging branch] -->|auto| STG_ENV[Staging Environment]
        D3[release branch] -->|manual| QA_ENV[QA Environment]
        D4["v* tag on main"] -->|approval| PROD_ENV[Production Environment]
    end

    subgraph "security.yml - Weekly Audit"
        direction TB
        NA[npm audit --production] --> CQL[CodeQL SAST]
        CQL --> TS[Trivy Container Scan]
    end
```

**Environment Promotion Gates:**

| Trigger | Target | Gate |
|:---|:---|:---|
| Push to `develop` | Development | Automatic |
| Push to `staging` | Staging | Automatic |
| Manual dispatch or PR to `release/*` | QA | Manual approval |
| Tag `v*` on `main` | Production | Manual approval |

Each deployment runs Prisma migrations as a pre-upgrade Helm hook, waits for rollout completion, executes smoke tests, and auto-rolls back on failure.

---

### Kubernetes and Helm Chart

The Helm chart at `deploy/helm/hwala-core/` provides a complete provider-agnostic Kubernetes deployment:

**Resource Sizing by Environment:**

| Resource | Dev | Staging | QA | Production |
|:---|:---|:---|:---|:---|
| API Replicas | 1 | 2 | 2 | 3 to 10 (HPA) |
| Worker Replicas | 1 | 1 | 2 | 2 to 5 (HPA) |
| CPU Request / Limit | 100m / 500m | 250m / 1000m | 250m / 1000m | 500m / 2000m |
| Memory Request / Limit | 128Mi / 512Mi | 256Mi / 1Gi | 256Mi / 1Gi | 512Mi / 2Gi |
| HPA CPU Target | Disabled | 70% | 70% | 60% |
| PDB minAvailable | Disabled | 1 | 1 | 2 |
| PostgreSQL PVC | 5Gi | 20Gi | 20Gi | 50Gi |
| Redis PVC | 2Gi | 5Gi | 5Gi | 10Gi |

**Included Templates:** Namespace with Pod Security Standards, ConfigMap, Secrets, API Deployment, Worker Deployment, Service (NodePort), NGINX Ingress, HPA, PDB, Prisma Migration Job (Helm pre-upgrade hook), PostgreSQL StatefulSet, Redis StatefulSet, and NetworkPolicies.

**Deployment Strategy:** `RollingUpdate` with `maxSurge: 1` and `maxUnavailable: 0` for zero-downtime deployments. Pods include liveness, readiness, and startup probes against `/health`.

---

### Secrets Management

Secrets are managed using [Bitnami Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets). Encrypted `SealedSecret` manifests are safe to commit to Git. Only the sealed-secrets-controller inside the target cluster can decrypt them.

```mermaid
sequenceDiagram
    participant Operator as DevOps Engineer
    participant CLI as kubeseal CLI
    participant Git as Git Repository
    participant Controller as Sealed Secrets Controller
    participant K8s as Kubernetes Secret

    Operator->>CLI: Create plaintext Secret via kubectl (--dry-run)
    CLI->>CLI: Encrypt with cluster public certificate
    CLI->>Git: Commit sealed-secret-{env}.yaml
    Git->>Controller: kubectl apply SealedSecret
    Controller->>Controller: Decrypt using private key
    Controller->>K8s: Create standard Opaque Secret
```

**Managed Secrets:**

| Key | Description |
|:---|:---|
| `DATABASE_URL` | PostgreSQL connection string per environment |
| `REDIS_PASSWORD` | Redis authentication password |
| `JWT_SECRET` | 256-bit JWT signing key |

**CI/CD Secrets** (stored in GitHub Actions, not in Git):

| Key | Purpose |
|:---|:---|
| `KUBECONFIG` | Base64-encoded cluster access configuration |
| `DATABASE_URL` | Connection string for CI migration jobs |
| `GHCR_TOKEN` | GitHub Container Registry write access |

**Sealing a new secret:**

```bash
# Fetch the cluster public certificate
kubeseal --fetch-cert --controller-name=sealed-secrets --controller-namespace=kube-system > pub-cert.pem

# Create and seal a secret for production
kubectl create secret generic hwala-core-secrets \
  --namespace=hwala-production \
  --from-literal=DATABASE_URL="postgresql://user:pass@host:5432/db" \
  --from-literal=REDIS_PASSWORD="password" \
  --from-literal=JWT_SECRET="secret-key-32-chars" \
  --dry-run=client -o yaml | \
kubeseal --cert=pub-cert.pem --format=yaml > deploy/sealed-secrets/sealed-secret-production.yaml
```

---

### Observability and Monitoring

The observability stack consists of application-level Prometheus metrics, Loki log aggregation, and Grafana dashboards.

**Application Metrics** are served at `GET /metrics` in Prometheus exposition format by a native NestJS `MetricsModule`:

| Metric | Type | Description |
|:---|:---|:---|
| `nestjs_http_requests_total` | Counter | Total HTTP requests by method, route, and status code |
| `nestjs_http_request_duration_seconds` | Summary | Request duration by route |
| `hwala_transfers_total` | Counter | Total financial transfers by tenant and status |
| `process_resident_memory_bytes` | Gauge | Process RSS memory |
| `process_heap_bytes` | Gauge | V8 heap memory usage |
| `process_uptime_seconds` | Counter | Process uptime |

Every HTTP request is tagged with an `X-Request-ID` correlation header for distributed tracing.

**Alerting Rules** (via Prometheus Alertmanager with email notifications):

| Alert | Condition | Severity |
|:---|:---|:---|
| HighErrorRate | HTTP 5xx rate exceeds 5% for 5 minutes | Critical |
| HighLatency | P95 latency exceeds 2 seconds for 5 minutes | Warning |
| PodCrashLooping | Pod restarts exceed 3 in 10 minutes | Critical |
| RedisMemoryHigh | Redis memory exceeds 80% for 10 minutes | Warning |
| DiskSpaceLow | Persistent volume usage exceeds 85% | Warning |

---

### Database Backups and Disaster Recovery

| Component | Method | Frequency | Retention |
|:---|:---|:---|:---|
| PostgreSQL | `pg_dump` Kubernetes CronJob | Every 6 hours | 30 days |
| Redis | `BGSAVE` RDB snapshot CronJob | Every 1 hour | 7 days |

**PostgreSQL Restore Procedure:**

1. Scale down API and Worker deployments to zero replicas
2. Terminate active database connections
3. Restore from compressed `.sql.gz` backup via `gunzip | psql`
4. Scale deployments back to target replica count
5. Verify rollout status

**Redis Restore Procedure:**

1. Scale down API and Worker deployments
2. Copy target `.rdb` snapshot to Redis data directory
3. Delete Redis pod to trigger reload from disk
4. Verify `redis-cli ping` returns `PONG`
5. Scale services back up

---

### Security Hardening

```mermaid
graph TD
    subgraph "Network Layer"
        NP["NetworkPolicies<br/>Strict ingress/egress per pod"]
        CORS["CORS Policy<br/>Explicit allowed origins"]
    end

    subgraph "Application Layer"
        HELMET["Helmet Headers<br/>HSTS, CSP, X-Frame-Options, Referrer-Policy"]
        XPOW["X-Powered-By Removed"]
        VALID["ValidationPipe<br/>Whitelist, forbidNonWhitelisted"]
        RATE["Redis Rate Limiter<br/>Throttler with Redis storage"]
    end

    subgraph "Container Layer"
        NONROOT["Non-Root Execution<br/>USER node, UID 1000"]
        READONLY["Read-Only Root FS"]
        NODROP["Capability Drop ALL"]
        PSS["Pod Security Standards<br/>Restricted Profile"]
    end

    subgraph "Supply Chain"
        TRIVY_CI["Trivy in CI Pipeline<br/>SARIF to GitHub Security"]
        TRIVY_OP["Trivy Operator<br/>In-Cluster Scanning"]
        CODEQL["CodeQL SAST<br/>TypeScript Analysis"]
        AUDIT["npm audit<br/>Weekly Dependency Check"]
    end
```

**Security Controls Summary:**

| Control | Enforced By |
|:---|:---|
| HTTP Security Headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options) | Helmet in `main.ts` |
| Express fingerprint removal | `app.disable('x-powered-by')` |
| Payload whitelisting and validation | NestJS `ValidationPipe` |
| Request rate limiting | `ThrottlerModule` with Redis storage |
| Non-root container execution | `USER node` in Dockerfile, `runAsNonRoot: true` in pod spec |
| Pod Security Standards (restricted) | Namespace label enforcement |
| Network segmentation | Kubernetes `NetworkPolicy` per pod component |
| Resource governance | `ResourceQuota` and `LimitRange` per namespace |
| Container vulnerability scanning | Trivy (CI pipeline and in-cluster operator) |
| Static analysis | CodeQL TypeScript SAST |

---

## Project Structure

```
hwala-core/
├── .github/workflows/
│   ├── ci.yml                          # Continuous integration pipeline
│   ├── deploy.yml                      # Continuous deployment with environment promotion
│   └── security.yml                    # Weekly security audit
├── deploy/
│   ├── backup/
│   │   ├── cronjob-pg-backup.yaml      # PostgreSQL backup CronJob
│   │   ├── cronjob-redis-backup.yaml   # Redis backup CronJob
│   │   └── restore-playbook.md         # Disaster recovery procedures
│   ├── helm/hwala-core/
│   │   ├── Chart.yaml
│   │   ├── values.yaml                 # Development defaults
│   │   ├── values-staging.yaml
│   │   ├── values-qa.yaml
│   │   ├── values-production.yaml
│   │   └── templates/                  # K8s resource templates
│   ├── monitoring/
│   │   ├── alerts.yaml                 # Prometheus alerting rules
│   │   ├── dashboard-hwala-core.json   # Grafana dashboard
│   │   ├── loki-stack-values.yaml      # Loki + Promtail + Grafana config
│   │   └── servicemonitor.yaml         # Prometheus ServiceMonitor
│   ├── sealed-secrets/
│   │   ├── sealed-secret-dev.yaml
│   │   ├── sealed-secret-staging.yaml
│   │   ├── sealed-secret-qa.yaml
│   │   └── sealed-secret-production.yaml
│   └── security/
│       ├── resourcequota-*.yaml        # Per-environment resource quotas
│       ├── trivy-operator-values.yaml  # In-cluster scanner config
│       └── security-policy.md          # Security controls checklist
├── prisma/
│   ├── schema.prisma                   # Database schema definition
│   └── migrations/                     # Migration history
├── src/
│   ├── accounts/                       # Account management module
│   ├── api-keys/                       # API key generation and validation
│   ├── audit/                          # Immutable audit log module
│   ├── auth/                           # JWT and API key authentication
│   ├── common/metrics/                 # Prometheus metrics module
│   ├── exchange/                       # FX exchange rate module
│   ├── health/                         # Health check indicators
│   ├── prisma/                         # Prisma service and module
│   ├── reconciliation/                 # Ledger reconciliation module
│   ├── redis/                          # Redis service and module
│   ├── risk/                           # Risk flagging module
│   ├── security/                       # Security guards and middleware
│   ├── tenant/                         # Tenant management module
│   ├── transfer/                       # Transfer and ledger engine
│   ├── webhook/                        # Webhook dispatcher and worker
│   ├── app.module.ts                   # Root application module
│   └── main.ts                         # Application bootstrap
├── test/                               # E2E test suite
├── Dockerfile                          # Multi-stage production build
├── docker-compose.yml                  # Local development stack
├── docker-compose.prod.yml             # Production-like local stack
├── Makefile                            # Developer shortcut commands
├── package.json
├── tsconfig.json
└── prisma.config.ts
```
