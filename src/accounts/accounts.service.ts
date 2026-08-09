/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AccountType } from '../../generated/prisma/client.js';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a new financial account for a user within a tenant.
   */
  async createAccount(
    tenantId: string,
    userId: string,
    type: AccountType,
    initialBalance = 0,
  ) {
    if (!tenantId || !userId || !type) {
      throw new BadRequestException('tenantId, userId, and type are required');
    }

    if (initialBalance < 0) {
      throw new BadRequestException('Initial balance cannot be negative');
    }

    // Verify tenant exists
    const tenantExists = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenantExists) {
      throw new BadRequestException('Tenant not found');
    }

    return this.prisma.account.create({
      data: {
        tenantId,
        userId,
        type,
        balance: initialBalance,
      },
    });
  }

  /**
   * Lists all accounts belonging to a specific tenant.
   */
  async listAccounts(tenantId: string) {
    return this.prisma.account.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Retrieves the double-entry audit history for a specific account.
   */
  async getAccountLedger(tenantId: string, accountId: string) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, tenantId },
    });

    if (!account) {
      throw new NotFoundException('Account not found for this tenant');
    }

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { accountId, tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      account,
      entries,
    };
  }

  /**
   * Performs automated double-entry balance sanity check (sum of debits == sum of credits).
   */
  async reconcileTenantBalance(tenantId: string) {
    const aggregate = await this.prisma.ledgerEntry.aggregate({
      where: { tenantId },
      _sum: { amount: true },
    });

    const totalSum = Number(aggregate._sum.amount || 0);

    const accounts = await this.prisma.account.findMany({
      where: { tenantId },
      select: { id: true, balance: true },
    });

    //sum across all debits and credits must strictly be 0.00
    const isBalanced = Math.abs(totalSum) < 0.001;

    return {
      tenantId,
      isBalanced,
      totalLedgerSum: totalSum,
      totalAccounts: accounts.length,
      status: isBalanced ? 'HEALTHY' : 'RECONCILIATION_FAILED',
      timestamp: new Date().toISOString(),
    };
  }
}
