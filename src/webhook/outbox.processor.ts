/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('webhook_queue') private readonly webhookQueue: Queue,
  ) {}

  /**
   * Cron job running every 5 seconds to poll pending outbox events
   * and push them to the BullMQ queue for delivery.
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async processPendingOutbox() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // 1. Fetch PENDING outbox records
      const pendingEntries = await this.prisma.webhookOutbox.findMany({
        where: { status: 'PENDING' },
        take: 50,
        orderBy: { createdAt: 'asc' },
      });

      if (pendingEntries.length === 0) {
        return;
      }

      this.logger.log(
        `Processing ${pendingEntries.length} pending webhook outbox events...`,
      );

      for (const entry of pendingEntries) {
        try {
          // 2. Mark as PROCESSING
          await this.prisma.webhookOutbox.update({
            where: { id: entry.id },
            data: {
              status: 'PROCESSING',
              attempts: { increment: 1 },
            },
          });

          // 3. Push job to BullMQ queue
          await this.webhookQueue.add(entry.eventType, entry.payload as any, {
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: true,
          });

          // 4. Mark as COMPLETED
          await this.prisma.webhookOutbox.update({
            where: { id: entry.id },
            data: { status: 'COMPLETED' },
          });

          this.logger.debug(
            `Successfully enqueued outbox event ${entry.id} (${entry.eventType})`,
          );
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to enqueue outbox event ${entry.id}: ${errorMessage}`,
          );

          const newAttempts = entry.attempts + 1;
          const maxAttempts = 5;

          if (newAttempts >= maxAttempts) {
            // Mark outbox entry as FAILED and record in WebhookFailure DLQ
            await this.prisma.webhookOutbox.update({
              where: { id: entry.id },
              data: { status: 'FAILED' },
            });

            await this.prisma.webhookFailure.create({
              data: {
                tenantId: entry.tenantId,
                eventType: entry.eventType,
                payload: entry.payload as any,
                error: errorMessage,
                retries: newAttempts,
              },
            });

            this.logger.warn(
              `Outbox event ${entry.id} exceeded max attempts (${maxAttempts}) and was moved to WebhookFailure DLQ.`,
            );
          } else {
            // Revert back to PENDING for retry in next poll cycle
            await this.prisma.webhookOutbox.update({
              where: { id: entry.id },
              data: { status: 'PENDING' },
            });
          }
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Outbox polling error: ${errorMessage}`);
    } finally {
      this.isProcessing = false;
    }
  }
}
