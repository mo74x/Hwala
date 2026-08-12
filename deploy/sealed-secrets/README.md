# Sealed Secrets Management — Hwala Core

This directory contains encrypted Kubernetes secrets for Hwala Core environments (`dev`, `staging`, `qa`, `production`) managed using [Bitnami Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets).

---

## 🔒 Security Architecture

`SealedSecret` custom resources can be safely committed to version control repositories (Git). Only the `sealed-secrets-controller` running inside your target Kubernetes cluster possesses the private key required to decrypt them into standard Kubernetes `Secret` objects.

```mermaid
sequenceDiagram
    participant Dev as DevOps Engineer / CI
    participant Git as Git Repository
    participant K8s as Sealed Secrets Controller
    participant Secret as K8s Secret (Decrypted)

    Dev->>Dev: Encrypt plaintext Secret via kubeseal
    Dev->>Git: Commit sealed-secret-${env}.yaml
    Git->>K8s: Apply SealedSecret to Cluster
    K8s->>K8s: Decrypt payload using Controller Private Key
    K8s->>Secret: Create standard Opaque Secret (hwala-core-secrets)
```

---

## 🛠️ Step-by-Step Operator Guide

### 1. Prerequisites

Install the `kubeseal` CLI tool on your local machine:

```bash
# macOS via Homebrew
brew install kubeseal

# Linux / WSL
KUBESEAL_VERSION=$(curl -s https://api.github.com/repos/bitnami-labs/sealed-secrets/releases/latest | jq -r .tag_name | sed -e 's/^v//')
curl -OL "https://github.com/bitnami-labs/sealed-secrets/releases/download/v${KUBESEAL_VERSION}/kubeseal-${KUBESEAL_VERSION}-linux-amd64.tar.gz"
tar -xvzf kubeseal-${KUBESEAL_VERSION}-linux-amd64.tar.gz kubeseal
sudo install -m 755 kubeseal /usr/local/bin/kubeseal
```

---

### 2. Installing Sealed Secrets Controller on Cluster

If not already installed on your Kubernetes cluster:

```bash
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm repo update
helm install sealed-secrets sealed-secrets/sealed-secrets --namespace kube-system
```

---

### 3. Fetching the Public Key

Fetch the cluster's public certificate to seal secrets locally:

```bash
kubeseal --fetch-cert \
  --controller-name=sealed-secrets \
  --controller-namespace=kube-system > pub-cert.pem
```

---

### 4. Creating & Sealing a New Secret

Generate a standard Kubernetes secret and pass it through `kubeseal`:

```bash
# Example: Sealing secrets for Production environment
kubectl create secret generic hwala-core-secrets \
  --namespace=hwala-production \
  --from-literal=DATABASE_URL="postgresql://user:pass@host:5432/dbname?schema=public" \
  --from-literal=REDIS_PASSWORD="secure-redis-password" \
  --from-literal=JWT_SECRET="super-secret-production-jwt-key-32-chars" \
  --dry-run=client -o yaml | \
kubeseal --cert=pub-cert.pem --format=yaml > deploy/sealed-secrets/sealed-secret-production.yaml
```

---

### 5. Applying Sealed Secrets to Cluster

```bash
# Apply sealed secret
kubectl apply -f deploy/sealed-secrets/sealed-secret-production.yaml

# Verify decrypted standard secret is created
kubectl get secrets hwala-core-secrets -n hwala-production
```

---

## 🔑 GitHub Actions Secrets Mapping

For CI/CD execution, store the following non-committable secrets in **GitHub Repository / Environment Secrets**:

| Secret Name | Purpose | Scope |
|:---|:---|:---|
| `KUBECONFIG` | Base64-encoded cluster access kubeconfig | Repository / Environment |
| `DATABASE_URL` | DB string for migration jobs | Repository / Environment |
| `GHCR_TOKEN` | Personal Access Token with `write:packages` scope | Repository |
