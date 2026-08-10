import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

interface LedgerSumRow {
  accountId: string;
  ledgerSum: Prisma.Decimal;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Nightly reconciliation cron job.
   *
   * Aggregates SUM from LedgerEntry for each account and compares
   * it against Account.balance + Account.holdBalance.
   * Runs every day at 2:00 AM server time.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    name: 'ledger-reconciliation',
    timeZone: 'UTC',
  })
  async reconcileLedger(): Promise<void> {
    this.logger.log('Starting nightly ledger reconciliation…');

    const startTime = Date.now();
    let accountsChecked = 0;
    let mismatchCount = 0;

    try {
      //Aggregate ledger entry sums grouped by accountId
      const ledgerSums: LedgerSumRow[] = await this.prisma.$queryRaw`
        SELECT
          "accountId",
          COALESCE(SUM("amount"), 0) AS "ledgerSum"
        FROM "LedgerEntry"
        GROUP BY "accountId"
      `;

      //Fetch all accounts with their current balances
      const accounts = await this.prisma.account.findMany({
        select: {
          id: true,
          tenantId: true,
          balance: true,
          holdBalance: true,
        },
      });

      // Build a lookup map: accountId → ledgerSum
      const ledgerMap = new Map<string, number>();
      for (const row of ledgerSums) {
        ledgerMap.set(row.accountId, Number(row.ledgerSum));
      }

      //Compare each account's expected vs actual balance
      for (const account of accounts) {
        accountsChecked++;

        const ledgerSum = ledgerMap.get(account.id) ?? 0;
        const actualTotal =
          Number(account.balance) + Number(account.holdBalance);

        // Use a small epsilon for floating point comparison on Decimal fields
        const difference = Math.abs(ledgerSum - actualTotal);
        if (difference > 0.001) {
          mismatchCount++;
          this.logger.error(
            `RECONCILIATION MISMATCH — ` +
              `Account: ${account.id} | ` +
              `Tenant: ${account.tenantId} | ` +
              `Ledger SUM: ${ledgerSum.toFixed(2)} | ` +
              `Account (balance + holdBalance): ${actualTotal.toFixed(2)} | ` +
              `Difference: ${difference.toFixed(2)}`,
          );
        }
      }

      //Check for orphaned ledger entries (entries referencing
      // accounts that no longer exist)
      const accountIds = new Set(accounts.map((a) => a.id));
      for (const [accountId, sum] of ledgerMap.entries()) {
        if (!accountIds.has(accountId)) {
          mismatchCount++;
          this.logger.error(
            `RECONCILIATION ORPHAN — ` +
              `LedgerEntry references non-existent Account: ${accountId} | ` +
              `Orphaned ledger SUM: ${sum.toFixed(2)}`,
          );
        }
      }

      const elapsed = Date.now() - startTime;

      if (mismatchCount === 0) {
        this.logger.log(
          `Reconciliation complete — ${accountsChecked} accounts checked, ` +
            `0 mismatches found (${elapsed}ms)`,
        );
      } else {
        this.logger.warn(
          `Reconciliation complete — ${accountsChecked} accounts checked, ` +
            `${mismatchCount} MISMATCHES DETECTED (${elapsed}ms)`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Reconciliation cron failed unexpectedly',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
