/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { BullMQHealthIndicator } from './indicators/bullmq.health';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: HealthCheckService;

  const mockPrismaHealth = {
    isHealthy: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
  };

  const mockRedisHealth = {
    isHealthy: jest.fn().mockResolvedValue({ redis: { status: 'up' } }),
  };

  const mockBullMQHealth = {
    isHealthy: jest.fn().mockResolvedValue({ bullmq: { status: 'up' } }),
  };

  const mockHealthCheckService = {
    check: jest.fn().mockImplementation((checks) => {
      const results = checks.map((fn: () => any) => fn());
      return Promise.all(results).then((res) => ({
        status: 'ok',
        info: Object.assign({}, ...res),
        error: {},
        details: Object.assign({}, ...res),
      }));
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: PrismaHealthIndicator, useValue: mockPrismaHealth },
        { provide: RedisHealthIndicator, useValue: mockRedisHealth },
        { provide: BullMQHealthIndicator, useValue: mockBullMQHealth },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should run health check for database, redis, and bullmq', async () => {
    const result = await controller.check();

    expect(healthCheckService.check).toHaveBeenCalled();
    expect(mockPrismaHealth.isHealthy).toHaveBeenCalledWith('database');
    expect(mockRedisHealth.isHealthy).toHaveBeenCalledWith('redis');
    expect(mockBullMQHealth.isHealthy).toHaveBeenCalledWith('bullmq');
    expect(result).toEqual({
      status: 'ok',
      info: {
        database: { status: 'up' },
        redis: { status: 'up' },
        bullmq: { status: 'up' },
      },
      error: {},
      details: {
        database: { status: 'up' },
        redis: { status: 'up' },
        bullmq: { status: 'up' },
      },
    });
  });
});
