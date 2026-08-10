# Implementation Plan: Hawala Core Feature Expansion

This document outlines the implementation plan for building out all four feature sets (Financial Security, Monetization, Webhooks/DLQ, and Compliance/Audit) within the Hawala Core platform.

## User Review Required

> [!WARNING]
> This is a massive update that touches the core transaction engine and database schema. 
> Since we are adding `currency` and `holdBalance` to the `Account` model, we will need to run database migrations which might require default values for existing data.


## Proposed Changes

---

### 1. Database Schema (`prisma/schema.prisma`)

We will heavily expand the Prisma schema to support the new features.

#### [MODIFY] `prisma/schema.prisma`
- **Tenant:** Add `baseCurrency` (default `'USD'`), `feeFixed` (Decimal, default 0), and `feePercentage` (Decimal, default 0) to allow a mix of configurable fees per tenant.
- **Account:** Add `currency` (String) and `holdBalance` (Decimal, default 0).
- **LedgerEntry:** Add `currency` (String), `exchangeRate` (Decimal, default 1.0), `feeAmount` (Decimal), and `type` (enum `TRANSFER`, `FEE`, `HOLD`, `RELEASE`, `REFUND`). Add a unique constraint on `idempotencyKey` to prevent duplicate ledger entries at the DB level.
- **[NEW] WebhookOutbox:** Table for the Transactional Outbox pattern (`id`, `tenantId`, `eventType`, `payload`, `status`).
- **[NEW] WebhookFailure (DLQ):** Table to store permanently failed webhooks for manual retry.
- **[NEW] AuditLog:** Table to track sensitive actions (`adminId`, `action`, `targetId`, `metadata`).
- **[NEW] RiskFlag:** Table for flagged anomalies (`accountId`, `reason`, `severity`, `status`).

---

### 2. Financial Security & Resilience

#### [NEW] `src/security/idempotency.interceptor.ts`
- Implement an interceptor that reads the `X-Idempotency-Key` header.
- Cache the response payload in Redis for 24 hours. If a request with the same key arrives, return the cached response immediately to prevent double charges.

#### [MODIFY] `src/transfer/transfer.service.ts`
- Implement `holdFunds(accountId, amount)`: Increases `holdBalance`, decreases available `balance`.
- Implement `captureHold(accountId, amount)`: Finalizes the transaction, creates `LedgerEntry`.
- Implement `releaseHold(accountId, amount)`: Reverses the hold.

#### [NEW] `src/reconciliation/reconciliation.service.ts`
- A cron job (`@nestjs/schedule`) running nightly that aggregates `SUM(amount)` from `LedgerEntry` for each account and compares it against `Account.balance + Account.holdBalance`. Flags mismatches.

---

### 3. Monetization & Multi-Currency

#### [NEW] `src/exchange/exchange.service.ts`
- Service to handle FX conversions between currencies before a transfer is locked in the DB.
- **Integration:** Integrate a live FX API (like Fixer or OpenExchangeRates) to fetch real-time exchange rates, caching them in Redis for performance.

#### [MODIFY] `src/transfer/transfer.service.ts` (Fee Engine)
- Update `executeTransfer` to calculate a platform fee based on the Tenant's configured mix of fixed amount (`feeFixed`) and percentage (`feePercentage`).
- Generate additional `LedgerEntry` records routing the fee to the `PLATFORM_REVENUE` account within the *same* database transaction.

---

### 4. Webhooks & Developer Portal

#### [MODIFY] `src/transfer/transfer.service.ts` (Transactional Outbox)
- Instead of calling `this.webhookQueue.add(...)`, write the event payload to the new `WebhookOutbox` table inside the main Prisma `$transaction`.

#### [NEW] `src/webhook/outbox.processor.ts`
- A polling cron job that reads from `WebhookOutbox` where `status = PENDING` and pushes them to BullMQ.

#### [NEW] `src/webhook/webhook-dlq.controller.ts`
- API endpoints to list failed webhooks from `WebhookFailure` and trigger manual retries.

---

### 5. Compliance & Audit

#### [NEW] `src/audit/audit.service.ts`
- Service to append immutable logs to the `AuditLog` table. Used for API key generation, tenant config updates, and manual adjustments.

#### [NEW] `src/risk/risk.service.ts`
- Engine that evaluates transactions before execution. Rules:
  - Velocity checks (e.g., > 10 transfers / minute).
  - High-value alerts (e.g., transfer amount > $10,000).
- If triggered, writes to `RiskFlag` and potentially blocks the transaction.

---

## Verification Plan

### Automated Tests
- `npm run test` and `npm run test:e2e`
- We will add specific unit tests for:
  - **Idempotency:** Verify duplicate requests with the same key don't alter balances.
  - **Double-Entry + Fees:** Verify the sum of debits and credits is exactly zero, including fee accounts.
  - **Outbox:** Verify that rolling back the DB transaction also prevents the webhook outbox entry from saving.

### Manual Verification
- Run the reconciliation cron manually and verify the output.
- Check Swagger (`/api/docs`) for new DLQ endpoints and ensure they function correctly.
