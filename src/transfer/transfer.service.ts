import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SecurityService } from '../security/security.service';

@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('webhook_queue') private readonly webhookQueue: Queue,
    private readonly securityService: SecurityService,
  ) {}

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

    // Check velocity limits BEFORE starting the expensive DB transaction
    await this.securityService.enforceTransferVelocity(senderId);

    const transactionId = randomUUID();
    //Always lock rows in a consistent order (Deadlock Prevention)
    const [firstId, secondId] = [senderId, receiverId].sort();

    try {
      //Everything succeeds or everything rolls back
      const result = await this.prisma.$transaction(async (tx) => {
        //Lock the rows so no other request can touch them until we commit
        await tx.$queryRaw`SELECT * FROM "Account" WHERE id = ${firstId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT * FROM "Account" WHERE id = ${secondId}::uuid FOR UPDATE`;

        //Fetch the strictly locked sender state
        const sender = await tx.account.findUnique({ where: { id: senderId } });
        if (!sender) throw new BadRequestException('Sender account not found');
        if (sender.tenantId !== tenantId)
          throw new BadRequestException(
            'Sender account does not belong to this tenant',
          );
        if (Number(sender.balance) < amount)
          throw new BadRequestException('Insufficient funds');

        const receiver = await tx.account.findUnique({
          where: { id: receiverId },
        });
        if (!receiver)
          throw new BadRequestException('Receiver account not found');
        if (receiver.tenantId !== tenantId)
          throw new BadRequestException(
            'Receiver account does not belong to this tenant',
          );

        // Update Balances
        await tx.account.update({
          where: { id: senderId },
          data: { balance: { decrement: amount }, version: { increment: 1 } },
        });

        await tx.account.update({
          where: { id: receiverId },
          data: { balance: { increment: amount }, version: { increment: 1 } },
        });

        //Create the Double-Entry Ledger Records
        await tx.ledgerEntry.createMany({
          data: [
            {
              tenantId,
              transactionId,
              accountId: senderId,
              amount: -amount, // Debit
              description,
            },
            {
              tenantId,
              transactionId,
              accountId: receiverId,
              amount: amount, // Credit
              description,
            },
          ],
        });

        return { transactionId, status: 'SUCCESS' };
      });

      // Dispatch background job outside of the database transaction
      await this.webhookQueue.add(
        'transfer.completed',
        {
          tenantId,
          transactionId: result.transactionId,
          senderId,
          receiverId,
          amount,
          timestamp: new Date().toISOString(),
        },
        {
          attempts: 5, // Retry up to 5 times if the merchant API fails
          backoff: {
            type: 'exponential',
            delay: 2000, // 2s, 4s, 8s, 16s, 32s
          },
          removeOnComplete: true, // Keep Redis clean
        },
      );

      return result;
    } catch (error) {
      // Re-throw known HTTP exceptions
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(
        'Transfer failed due to a system error',
      );
    }
  }
}
