# Security Hardening and Container Policy

Security posture and defense-in-depth controls enforced across the Hwala Core financial platform ecosystem.

---

## Defense-in-Depth Security Matrix

```mermaid
graph TD
    subgraph "Network Security"
        NET["NetworkPolicies<br/>Strict Namespace Isolation"]
        CORS["CORS Policy<br/>Explicit Allowed Origins"]
    end

    subgraph "Application Layer"
        HELMET["Helmet HTTP Headers<br/>HSTS, CSP, X-Frame-Options"]
        DTO["ValidationPipe<br/>Whitelist, Strict DTO"]
        AUTH["JWT + API Key Guards<br/>Scoped Permissions"]
    end

    subgraph "Container and Workload"
        NONROOT["Non-Root Node User<br/>UID/GID 1000"]
        PSS["Pod Security Standards<br/>Restricted Profile"]
        TRIVY["Trivy Vulnerability Scan<br/>Build and In-Cluster"]
    end

    subgraph "Secrets and Storage"
        SEAL["Bitnami Sealed Secrets<br/>Encrypted in Git"]
        PVC["ReadWriteOnce PVCs<br/>Encrypted Volumes"]
    end
```

---

## Security Controls Checklist

| Layer | Control | Enforced By | Status |
|:---|:---|:---|:---|
| **App** | Strict HTTP Security Headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options) | `helmet` in `src/main.ts` | Enforced |
| **App** | X-Powered-By Signature Removal | Express HttpAdapter | Enforced |
| **App** | Payload Whitelisting and Filtering | NestJS `ValidationPipe` | Enforced |
| **App** | Request Rate Limiting | `ThrottlerModule` + Redis | Enforced |
| **Container** | Multi-stage Distroless-style Build | `Dockerfile` | Enforced |
| **Container** | Non-Root User Execution (`USER node`) | `Dockerfile` / Pod Spec | Enforced |
| **K8s** | Pod Security Standards (`restricted`) | Namespace Label | Enforced |
| **K8s** | Network Isolation and Egress Filtering | `NetworkPolicy` | Enforced |
| **K8s** | Resource Limits and Quotas | `ResourceQuota` / `LimitRange` | Enforced |
| **CI/CD** | Static Application Security Testing (SAST) | GitHub Actions CodeQL | Enforced |
| **CI/CD** | Container Vulnerability Scanning | Trivy Action and Operator | Enforced |

---

## Installing In-Cluster Trivy Vulnerability Scanner

```bash
helm repo add aqua https://aquasecurity.github.io/helm-charts/
helm repo update

helm upgrade --install trivy-operator aqua/trivy-operator \
  --namespace trivy-system \
  --create-namespace \
  --values deploy/security/trivy-operator-values.yaml
```
