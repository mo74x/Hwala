import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@Controller('webhooks/dlq')
export class WebhookDlqController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('webhook_queue') private readonly webhookQueue: Queue,
  ) {}

  /**
   * List all failed webhooks in the DLQ with optional tenant filtering and pagination.
   */
  @Get()
  async getFailedWebhooks(
    @Query('tenantId') tenantId?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(1, Number(pageStr) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitStr) || 20));
    const skip = (page - 1) * limit;

    const whereClause = tenantId ? { tenantId } : {};

    const [data, total] = await Promise.all([
      this.prisma.webhookFailure.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { failedAt: 'desc' },
      }),
      this.prisma.webhookFailure.count({
        where: whereClause,
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Manually retry a failed webhook by re-enqueueing its payload into BullMQ.
   */
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  async retryFailedWebhook(@Param('id', ParseUUIDPipe) id: string) {
    const failure = await this.prisma.webhookFailure.findUnique({
      where: { id },
    });

    if (!failure) {
      throw new NotFoundException(
        `Failed webhook entry with ID ${id} not found`,
      );
    }

    try {
      // Re-enqueue to BullMQ queue
      await this.webhookQueue.add(failure.eventType, failure.payload as any, {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
      });

      // Remove from DLQ table once successfully re-queued
      await this.prisma.webhookFailure.delete({
        where: { id },
      });

      return {
        success: true,
        message: 'Webhook successfully re-queued for delivery',
        failureId: id,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new BadRequestException(
        `Failed to re-enqueue webhook: ${errorMessage}`,
      );
    }
  }

  /**
   * Dismiss / clear a failed webhook entry from the DLQ.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async dismissFailedWebhook(@Param('id', ParseUUIDPipe) id: string) {
    const failure = await this.prisma.webhookFailure.findUnique({
      where: { id },
    });

    if (!failure) {
      throw new NotFoundException(
        `Failed webhook entry with ID ${id} not found`,
      );
    }

    await this.prisma.webhookFailure.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Failed webhook entry dismissed successfully',
      failureId: id,
    };
  }
}
