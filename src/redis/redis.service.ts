import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = Number(this.configService.get<number>('REDIS_PORT', 6379));
    const password = this.configService.get<string>('REDIS_PASSWORD');

    this.client = new Redis({
      host,
      port,
      password: password || undefined,
      maxRetriesPerRequest: 20,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        this.logger.warn(
          `Redis connection attempt #${times} failed. Retrying in ${delay}ms...`,
        );
        return delay;
      },
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
    });

    this.client.on('error', (err: Error) => {
      this.logger.error(`Redis connection error: ${err.message}`, err.stack);
    });

    this.client.on('connect', () => {
      this.logger.log(`Connecting to Redis host ${host}:${port}`);
    });

    this.client.on('ready', () => {
      this.logger.log('Redis client connection established and ready');
    });

    this.client.on('reconnecting', (delay: number) => {
      this.logger.warn(`Redis client reconnecting in ${delay}ms...`);
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch((err: Error) => {
        this.logger.warn(
          `Error closing Redis client gracefully: ${err.message}`,
        );
        this.client.disconnect();
      });
    }
  }

  getClient(): Redis {
    return this.client;
  }
}
