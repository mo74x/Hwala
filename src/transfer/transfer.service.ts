/* eslint-disable @typescript-eslint/restrict-template-expressions */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SecurityService } from '../security/security.service';
import { RiskService } from '../risk/risk.service';

@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @InjectQueue('webhook_queue')
    private readonly webhookQueue?: Queue,
    private readonly securityService?: SecurityService,
    @Optional()
    private readonly riskService?: RiskService,
  ) {}

  // ────────────────────────────────────────────────────────────────
  //  DIRECT TRANSFER
  // ────────────────────────────────────────────────────────────────

  async executeTransfer(
    tenantId: string,
    senderId: string,
    receiverId: string,
    amount: number,
    description: string,
  ) {
    if (!tenantId)
      throw new BadRequestException('Tenant ID is required for transfers');
    if (amount <= 0)
      throw new BadRequestException(
        'Transfer amount must be greater than zero',
      );
    if (senderId === receiverId)
      throw new BadRequestException('Cannot transfer to the same account');

    // Check velocity limits BEFORE starting the DB transaction if security service is present
    if (this.securityService) {
      await this.securityService.enforceTransferVelocity(senderId);
    }

    // Evaluate risk rules (velocity and high-value limits)
    if (this.riskService) {
      const riskResult = await this.riskService.evaluateTransaction({
        tenantId,
        accountId: senderId,
        amount,
      });

      if (riskResult.blocked) {
        throw new BadRequestException(
          `Transaction blocked by Risk Engine: ${riskResult.reasons.join('; ')}`,
        );
      }
    }

    const transactionId = randomUUID();

    try {
      // Everything succeeds or everything rolls back atomically
      const result = await this.prisma.$transaction(async (tx) => {
        // Fetch Tenant fee configuration
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new BadRequestException('Tenant not found');

        const feeFixed = Number(tenant.feeFixed || 0);
        const feePercentage = Number(tenant.feePercentage || 0);
        const calculatedFee = feeFixed + amount * feePercentage;
        const totalFee = Math.max(0, Number(calculatedFee.toFixed(2)));
        const totalRequired = amount + totalFee;

        // Find or prepare platform revenue account if fees apply
        let revenueAccountId: string | null = null;
        if (totalFee > 0) {
          let revenueAccount = await tx.account.findFirst({
            where: { tenantId, type: 'PLATFORM_REVENUE' },
          });

          if (!revenueAccount) {
            const senderInfo = await tx.account.findUnique({
              where: { id: senderId },
            });
            if (!senderInfo)
              throw new BadRequestException('Sender account not found');

            revenueAccount = await tx.account.create({
              data: {
                tenantId,
                userId: senderInfo.userId,
                type: 'PLATFORM_REVENUE',
                currency: senderInfo.currency || 'USD',
                balance: 0,
              },
            });
          }

          revenueAccountId = revenueAccount.id;
        }

        // Always lock rows in a consistent sorted order (Deadlock Prevention)
        const accountIdsToLock = Array.from(
          new Set(
            [senderId, receiverId, revenueAccountId].filter(
              (id): id is string => Boolean(id),
            ),
          ),
        ).sort();

        for (const id of accountIdsToLock) {
          await tx.$queryRaw`SELECT * FROM "Account" WHERE id = ${id}::uuid FOR UPDATE`;
        }

        // Fetch sender state
        const sender = await tx.account.findUnique({ where: { id: senderId } });
        if (!sender) throw new BadRequestException('Sender account not found');
        if (sender.tenantId !== tenantId)
          throw new BadRequestException(
            'Sender account does not belong to this tenant',
          );
        if (Number(sender.balance) < totalRequired) {
          throw new BadRequestException(
            `Insufficient funds. Required: ${totalRequired} (Transfer: ${amount}, Fee: ${totalFee}), Available: ${sender.balance}`,
          );
        }

        const receiver = await tx.account.findUnique({
          where: { id: receiverId },
        });
        if (!receiver)
          throw new BadRequestException('Receiver account not found');
        if (receiver.tenantId !== tenantId)
          throw new BadRequestException(
            'Receiver account does not belong to this tenant',
          );

        // 1. Update Balances
        await tx.account.update({
          where: { id: senderId },
          data: {
            balance: { decrement: totalRequired },
            version: { increment: 1 },
          },
        });

        await tx.account.update({
          where: { id: receiverId },
          data: { balance: { increment: amount }, version: { increment: 1 } },
        });

        if (totalFee > 0 && revenueAccountId) {
          await tx.account.update({
            where: { id: revenueAccountId },
            data: {
              balance: { increment: totalFee },
              version: { increment: 1 },
            },
          });
        }

        // 2. Create Double-Entry Ledger Records
        const ledgerEntriesData: Array<{
          tenantId: string;
          transactionId: string;
          accountId: string;
          amount: number;
          feeAmount?: number;
          type: 'TRANSFER' | 'FEE';
          description: string;
        }> = [
          {
            tenantId,
            transactionId,
            accountId: senderId,
            amount: -amount,
            type: 'TRANSFER',
            description: description || 'Transfer debit',
          },
          {
            tenantId,
            transactionId,
            accountId: receiverId,
            amount: amount,
            type: 'TRANSFER',
            description: description || 'Transfer credit',
          },
        ];

        if (totalFee > 0 && revenueAccountId) {
          ledgerEntriesData.push(
            {
              tenantId,
              transactionId,
              accountId: senderId,
              amount: -totalFee,
              feeAmount: totalFee,
              type: 'FEE',
              description: `Platform fee for transfer ${transactionId}`,
            },
            {
              tenantId,
              transactionId,
              accountId: revenueAccountId,
              amount: totalFee,
              feeAmount: totalFee,
              type: 'FEE',
              description: `Platform fee revenue for transfer ${transactionId}`,
            },
          );
        }

        await tx.ledgerEntry.createMany({
          data: ledgerEntriesData,
        });

        // 3. Transactional Outbox: Persist webhook event atomically inside the same DB transaction
        await tx.webhookOutbox.create({
          data: {
            tenantId,
            eventType: 'transfer.completed',
            payload: {
              tenantId,
              transactionId,
              senderId,
              receiverId,
              amount,
              fee: totalFee,
              timestamp: new Date().toISOString(),
            },
            status: 'PENDING',
          },
        });

        return { transactionId, fee: totalFee, status: 'SUCCESS' };
      });

      return result;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(
        'Transfer failed due to a system error',
      );
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  HOLD / ESCROW ENGINE
  // ────────────────────────────────────────────────────────────────

  /**
   * Reserves funds by moving `amount` from available `balance` into `holdBalance`.
   * Creates a HOLD ledger entry and writes `hold.created` to WebhookOutbox.
   *
   * @returns transactionId (holdId) that must be passed to captureHold / releaseHold.
   */
  async holdFunds(
    tenantId: string,
    accountId: string,
    amount: number,
    description: string,
  ) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    if (amount <= 0)
      throw new BadRequestException('Hold amount must be greater than zero');

    const transactionId = randomUUID();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Lock the account row to prevent concurrent modifications
        await tx.$queryRaw`SELECT * FROM "Account" WHERE id = ${accountId}::uuid FOR UPDATE`;

        const account = await tx.account.findUnique({
          where: { id: accountId },
        });
        if (!account) throw new NotFoundException('Account not found');
        if (account.tenantId !== tenantId)
          throw new BadRequestException(
            'Account does not belong to this tenant',
          );
        if (Number(account.balance) < amount)
          throw new BadRequestException(
            'Insufficient available balance to place hold',
          );

        // Move funds from available balance → holdBalance
        await tx.account.update({
          where: { id: accountId },
          data: {
            balance: { decrement: amount },
            holdBalance: { increment: amount },
            version: { increment: 1 },
          },
        });

        // Record a HOLD ledger entry for the audit trail
        await tx.ledgerEntry.create({
          data: {
            tenantId,
            transactionId,
            accountId,
            amount: -amount,
            type: 'HOLD',
            description: description || 'Funds held',
          },
        });

        // Transactional Outbox: Record hold.created event in WebhookOutbox
        await tx.webhookOutbox.create({
          data: {
            tenantId,
            eventType: 'hold.created',
            payload: {
              tenantId,
              transactionId,
              accountId,
              amount,
              timestamp: new Date().toISOString(),
            },
            status: 'PENDING',
          },
        });

        return {
          holdId: transactionId,
          accountId,
          amount,
          status: 'HELD',
        };
      });

      return result;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      )
        throw error;
      throw new InternalServerErrorException(
        'Hold operation failed due to a system error',
      );
    }
  }

  /**
   * Captures (finalizes) a previously held amount.
   * Deducts the held funds from `holdBalance` on the sender and credits
   * the `balance` on the receiver, creating TRANSFER ledger entries and writing `hold.captured` to WebhookOutbox.
   *
   * @param holdId - The transactionId returned by holdFunds.
   */
  async captureHold(
    tenantId: string,
    holdId: string,
    receiverId: string,
    amount: number,
    description: string,
  ) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    if (amount <= 0)
      throw new BadRequestException('Capture amount must be greater than zero');

    const transactionId = randomUUID();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Find the original HOLD ledger entry to identify the sender account
        const holdEntry = await tx.ledgerEntry.findFirst({
          where: {
            transactionId: holdId,
            tenantId,
            type: 'HOLD',
          },
        });
        if (!holdEntry)
          throw new NotFoundException(
            'Hold not found. Verify the holdId and tenant.',
          );

        const senderId = holdEntry.accountId;

        if (senderId === receiverId)
          throw new BadRequestException(
            'Cannot capture hold to the same account',
          );

        // Deterministic lock ordering to prevent deadlocks
        const [firstId, secondId] = [senderId, receiverId].sort();
        await tx.$queryRaw`SELECT * FROM "Account" WHERE id = ${firstId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT * FROM "Account" WHERE id = ${secondId}::uuid FOR UPDATE`;

        const sender = await tx.account.findUnique({
          where: { id: senderId },
        });
        if (!sender) throw new NotFoundException('Sender account not found');

        const heldAmount = Math.abs(Number(holdEntry.amount));
        if (amount > heldAmount)
          throw new BadRequestException(
            `Capture amount (${amount}) exceeds held amount (${heldAmount})`,
          );

        if (Number(sender.holdBalance) < amount)
          throw new BadRequestException('Insufficient held balance to capture');

        const receiver = await tx.account.findUnique({
          where: { id: receiverId },
        });
        if (!receiver)
          throw new NotFoundException('Receiver account not found');
        if (receiver.tenantId !== tenantId)
          throw new BadRequestException(
            'Receiver account does not belong to this tenant',
          );

        // Deduct from sender's holdBalance
        await tx.account.update({
          where: { id: senderId },
          data: {
            holdBalance: { decrement: amount },
            version: { increment: 1 },
          },
        });

        // Credit receiver's available balance
        await tx.account.update({
          where: { id: receiverId },
          data: {
            balance: { increment: amount },
            version: { increment: 1 },
          },
        });

        // If partial capture, release the remainder back to sender's balance
        const remainder = heldAmount - amount;
        if (remainder > 0) {
          await tx.account.update({
            where: { id: senderId },
            data: {
              holdBalance: { decrement: remainder },
              balance: { increment: remainder },
              version: { increment: 1 },
            },
          });

          // Record a RELEASE entry for the partial remainder
          await tx.ledgerEntry.create({
            data: {
              tenantId,
              transactionId,
              accountId: senderId,
              amount: remainder,
              type: 'RELEASE',
              description: `Partial hold release (remainder of hold ${holdId})`,
            },
          });
        }

        // Double-entry ledger records for the captured transfer
        await tx.ledgerEntry.createMany({
          data: [
            {
              tenantId,
              transactionId,
              accountId: senderId,
              amount: -amount,
              type: 'TRANSFER',
              description: description || `Capture of hold ${holdId}`,
            },
            {
              tenantId,
              transactionId,
              accountId: receiverId,
              amount: amount,
              type: 'TRANSFER',
              description: description || `Capture of hold ${holdId}`,
            },
          ],
        });

        // Transactional Outbox: Record hold.captured event in WebhookOutbox
        await tx.webhookOutbox.create({
          data: {
            tenantId,
            eventType: 'hold.captured',
            payload: {
              tenantId,
              transactionId,
              holdId,
              senderId,
              receiverId,
              capturedAmount: amount,
              releasedRemainder: remainder,
              timestamp: new Date().toISOString(),
            },
            status: 'PENDING',
          },
        });

        return {
          transactionId,
          holdId,
          senderId,
          receiverId,
          capturedAmount: amount,
          releasedRemainder: remainder,
          status: 'CAPTURED',
        };
      });

      return result;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      )
        throw error;
      throw new InternalServerErrorException(
        'Capture operation failed due to a system error',
      );
    }
  }

  /**
   * Releases (voids) a previously held amount back to the account's
   * available `balance`. Creates a RELEASE ledger entry and writes `hold.released` to WebhookOutbox.
   *
   * @param holdId - The transactionId returned by holdFunds.
   */
  async releaseHold(
    tenantId: string,
    holdId: string,
    amount: number,
    description: string,
  ) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    if (amount <= 0)
      throw new BadRequestException('Release amount must be greater than zero');

    const transactionId = randomUUID();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Find the original HOLD ledger entry
        const holdEntry = await tx.ledgerEntry.findFirst({
          where: {
            transactionId: holdId,
            tenantId,
            type: 'HOLD',
          },
        });
        if (!holdEntry)
          throw new NotFoundException(
            'Hold not found. Verify the holdId and tenant.',
          );

        const accountId = holdEntry.accountId;

        // Lock the account row
        await tx.$queryRaw`SELECT * FROM "Account" WHERE id = ${accountId}::uuid FOR UPDATE`;

        const account = await tx.account.findUnique({
          where: { id: accountId },
        });
        if (!account) throw new NotFoundException('Account not found');

        const heldAmount = Math.abs(Number(holdEntry.amount));
        if (amount > heldAmount)
          throw new BadRequestException(
            `Release amount (${amount}) exceeds held amount (${heldAmount})`,
          );

        if (Number(account.holdBalance) < amount)
          throw new BadRequestException('Insufficient held balance to release');

        // Move funds back: holdBalance → balance
        await tx.account.update({
          where: { id: accountId },
          data: {
            holdBalance: { decrement: amount },
            balance: { increment: amount },
            version: { increment: 1 },
          },
        });

        // Record a RELEASE ledger entry
        await tx.ledgerEntry.create({
          data: {
            tenantId,
            transactionId,
            accountId,
            amount: amount,
            type: 'RELEASE',
            description: description || `Release of hold ${holdId}`,
          },
        });

        // Transactional Outbox: Record hold.released event in WebhookOutbox
        await tx.webhookOutbox.create({
          data: {
            tenantId,
            eventType: 'hold.released',
            payload: {
              tenantId,
              transactionId,
              holdId,
              accountId,
              releasedAmount: amount,
              timestamp: new Date().toISOString(),
            },
            status: 'PENDING',
          },
        });

        return {
          transactionId,
          holdId,
          accountId,
          releasedAmount: amount,
          status: 'RELEASED',
        };
      });

      return result;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      )
        throw error;
      throw new InternalServerErrorException(
        'Release operation failed due to a system error',
      );
    }
  }
}
