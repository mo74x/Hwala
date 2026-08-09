import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { BullMQHealthIndicator } from './indicators/bullmq.health';

@Module({
  imports: [
    TerminusModule,
    PrismaModule,
    RedisModule,
    BullModule.registerQueue({
      name: 'webhook_queue',
    }),
  ],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    RedisHealthIndicator,
    BullMQHealthIndicator,
  ],
})
export class HealthModule {}
