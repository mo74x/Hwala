import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { OutboxProcessor } from './outbox.processor';
import { WebhookDlqController } from './webhook-dlq.controller';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: 'webhook_queue',
    }),
  ],
  providers: [OutboxProcessor],
  controllers: [WebhookDlqController],
  exports: [OutboxProcessor],
})
export class WebhookModule {}
