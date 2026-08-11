import { Module } from '@nestjs/common';
import { TransferService } from './transfer.service';
import { TransferController } from './transfer.controller';
import { BullModule } from '@nestjs/bullmq';
import { WebhookProcessor } from './webhook.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  providers: [TransferService, WebhookProcessor],
  controllers: [TransferController],
  imports: [
    PrismaModule,
    ExchangeModule,
    RiskModule,
    BullModule.registerQueue({
      name: 'webhook_queue',
    }),
  ],
})
export class TransferModule {}
