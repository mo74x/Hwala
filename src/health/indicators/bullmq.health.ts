/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';

@Injectable()
export class BullMQHealthIndicator extends HealthIndicator {
  constructor(
    @InjectQueue('webhook_queue')
    private readonly webhookQueue: Queue,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const client = await this.webhookQueue.client;
      const pingResult = await (
        client as unknown as { ping: () => Promise<string> }
      ).ping();
      if (pingResult === 'PONG') {
        return this.getStatus(key, true);
      }
      throw new Error(`Unexpected BullMQ Redis ping response: ${pingResult}`);
    } catch (error) {
      throw new HealthCheckError(
        'BullMQ check failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}
