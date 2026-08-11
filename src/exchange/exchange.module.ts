import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import { ExchangeService } from './exchange.service';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [ExchangeService],
  exports: [ExchangeService],
})
export class ExchangeModule {}
