/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RiskFlag } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { randomUUID } from 'crypto';

export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED';

export interface EvaluateTransactionParams {
  tenantId: string;
  accountId: string;
  amount: number;
  currency?: string;
}

export interface RiskEvaluationResult {
  allowed: boolean;
  blocked: boolean;
  flags: any[];
  reasons: string[];
}

export interface QueryRiskFlagsOptions {
  accountId?: string;
  status?: RiskStatus;
  limit?: number;
  offset?: number;
}

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  // Velocity rule threshold: max transfers in 1 minute
  private readonly VELOCITY_LIMIT = 10;
  private readonly VELOCITY_WINDOW_MS = 60 * 1000;

  // High-value threshold: transfers exceeding $10,000
  private readonly HIGH_VALUE_THRESHOLD = 10000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService?: RedisService,
  ) {}

  /**
   * Evaluates a transaction against risk rules before execution.
   * Checks velocity and high-value thresholds.
   * Writes RiskFlag records to DB if rules are triggered.
   */
  async evaluateTransaction(
    params: EvaluateTransactionParams,
  ): Promise<RiskEvaluationResult> {
    const { tenantId, accountId, amount } = params;
    const reasons: string[] = [];
    const flagsToCreate: Array<{ reason: string; severity: RiskSeverity }> = [];
    let isBlocked = false;

    // Rule 1: Velocity Check (> 10 transfers / minute)
    const velocityCount = await this.getAccountTransferVelocity(accountId);
    if (velocityCount > this.VELOCITY_LIMIT) {
      const reason = `Velocity limit exceeded: ${velocityCount} transfers initiated in 1 minute (limit is ${this.VELOCITY_LIMIT})`;
      reasons.push(reason);
      flagsToCreate.push({
        reason,
        severity: 'CRITICAL',
      });
      isBlocked = true;
    }

    // Rule 2: High-Value Alert (> $10,000)
    if (amount > this.HIGH_VALUE_THRESHOLD) {
      const reason = `High-value transfer alert: amount $${amount} exceeds high-value threshold of $${this.HIGH_VALUE_THRESHOLD}`;
      reasons.push(reason);
      flagsToCreate.push({
        reason,
        severity: 'HIGH',
      });
    }

    // Persist triggered RiskFlags to database
    const createdFlags: RiskFlag[] = [];
    for (const flag of flagsToCreate) {
      try {
        const created = await this.prisma.riskFlag.create({
          data: {
            tenantId,
            accountId,
            reason: flag.reason,
            severity: flag.severity as any,
            status: 'OPEN',
          },
        });
        createdFlags.push(created);
      } catch (err: any) {
        this.logger.error(
          `Failed to persist RiskFlag for account ${accountId}: ${err.message}`,
        );
      }
    }

    return {
      allowed: !isBlocked,
      blocked: isBlocked,
      flags: createdFlags,
      reasons,
    };
  }

  /**
   * Helper method to calculate transfer velocity using Redis sliding window (or fallback DB count).
   */
  private async getAccountTransferVelocity(accountId: string): Promise<number> {
    if (this.redisService) {
      try {
        const redis = this.redisService.getClient();
        const now = Date.now();
        const windowStart = now - this.VELOCITY_WINDOW_MS;
        const key = `risk:velocity:transfers:${accountId}`;

        const pipeline = redis.pipeline();
        pipeline.zremrangebyscore(key, 0, windowStart);
        pipeline.zcard(key);
        pipeline.zadd(key, now, `${now}-${randomUUID()}`);
        pipeline.expire(key, 60);

        const results = await pipeline.exec();
        if (results && results[1]) {
          return results[1][1] as number;
        }
      } catch (err: any) {
        this.logger.warn(`Redis velocity evaluation failed: ${err.message}`);
      }
    }

    // Fallback to database count if Redis is unavailable
    const windowStart = new Date(Date.now() - this.VELOCITY_WINDOW_MS);
    return this.prisma.ledgerEntry.count({
      where: {
        accountId,
        createdAt: { gte: windowStart },
      },
    });
  }

  /**
   * Retrieves risk flags for a tenant.
   */
  async getRiskFlags(tenantId: string, options?: QueryRiskFlagsOptions) {
    const { accountId, status, limit = 50, offset = 0 } = options || {};

    const where: any = { tenantId };
    if (accountId) where.accountId = accountId;
    if (status) where.status = status;

    const [flags, total] = await Promise.all([
      this.prisma.riskFlag.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          account: {
            select: {
              id: true,
              type: true,
              currency: true,
            },
          },
        },
      }),
      this.prisma.riskFlag.count({ where }),
    ]);

    return {
      data: flags,
      total,
      limit,
      offset,
    };
  }

  /**
   * Updates the status of a risk flag (OPEN, INVESTIGATING, RESOLVED, DISMISSED).
   */
  async updateRiskFlagStatus(tenantId: string, id: string, status: RiskStatus) {
    const existing = await this.prisma.riskFlag.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(`Risk flag with ID ${id} not found`);
    }

    return this.prisma.riskFlag.update({
      where: { id },
      data: { status: status as any },
    });
  }
}
