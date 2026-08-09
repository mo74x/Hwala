import { Test, TestingModule } from '@nestjs/testing';
import { SecurityService } from './security.service';
import { RedisService } from '../redis/redis.service';

describe('SecurityService', () => {
  let service: SecurityService;

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue({
      pipeline: jest.fn().mockReturnValue({
        zremrangebyscore: jest.fn(),
        zcard: jest.fn(),
        zadd: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([null, [null, 0]]),
      }),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityService,
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<SecurityService>(SecurityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
