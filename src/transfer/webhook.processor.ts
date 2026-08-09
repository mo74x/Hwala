/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Processor('webhook_queue')
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);
  private readonly DEFAULT_WEBHOOK_SECRET = 'super-secret-merchant-key';

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<any> {
    this.logger.log(
      `Attempt ${job.attemptsMade + 1}: Dispatching webhook for Tx ${job.data.transactionId}`,
    );

    const { tenantId, targetUrl: customUrl, url } = job.data || {};
    const targetUrl =
      (customUrl as string) ||
      (url as string) ||
      'https://merchant.example.com/webhooks';

    let secret = this.DEFAULT_WEBHOOK_SECRET;

    if (tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId as string },
        select: { webhookSecret: true },
      });
      if (tenant?.webhookSecret) {
        secret = tenant.webhookSecret;
      }
    }

    const payloadString = JSON.stringify(job.data);

    // Cryptographic Signature (HMAC-SHA256)
    // X-Signature: sha256=HMAC_SHA256(payload, secret)
    const hmacHex = crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');
    const signature = `sha256=${hmacHex}`;

    this.logger.log(
      `Dispatching to ${targetUrl} with X-Signature: ${signature}`,
    );

    try {
      // Simulate network delay and HTTP request execution with X-Signature header
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const isFlakyNetwork = Math.random() < 0.3;
      if (isFlakyNetwork) {
        throw new Error('Merchant API responded with 503 Service Unavailable');
      }

      this.logger.log(
        `✅ Webhook delivered successfully for Tx ${job.data.transactionId}`,
      );
      return { delivered: true, signature, targetUrl };
    } catch (error) {
      this.logger.error(
        `❌ Webhook delivery failed for Tx ${job.data.transactionId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
