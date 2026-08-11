import { Test, TestingModule } from '@nestjs/testing';
import { RiskService } from './risk.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { NotFoundException } from '@nestjs/common';

describe('RiskService', () => {
  let service: RiskService;
  let module: TestingModule;

  const mockRiskFlag = {
    id: 'risk-flag-1',
    tenantId: 'tenant-1',
    accountId: 'account-1',
    reason:
      'High-value transfer alert: amount $15000 exceeds high-value threshold of $10000',
    severity: 'HIGH',
    status: 'OPEN',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrismaService = {
    riskFlag: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    ledgerEntry: {
      count: jest.fn(),
    },
  };

  const mockPipeline = {
    zremrangebyscore: jest.fn().mockReturnThis(),
    zcard: jest.fn().mockReturnThis(),
    zadd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };

  const mockRedisClient = {
    pipeline: jest.fn().mockReturnValue(mockPipeline),
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue(mockRedisClient),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        RiskService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<RiskService>(RiskService);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('evaluateTransaction', () => {
    it('should allow normal transaction within velocity & value limits', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 2], // 2 transfers in current window
        [null, 1],
        [null, 1],
      ]);

      const result = await service.evaluateTransaction({
        tenantId: 'tenant-1',
        accountId: 'account-1',
        amount: 500,
      });

      expect(result.allowed).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.reasons).toHaveLength(0);
      expect(mockPrismaService.riskFlag.create).not.toHaveBeenCalled();
    });

    it('should flag high-value transactions (> $10,000) without blocking', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 2],
        [null, 1],
        [null, 1],
      ]);
      mockPrismaService.riskFlag.create.mockResolvedValue(mockRiskFlag);

      const result = await service.evaluateTransaction({
        tenantId: 'tenant-1',
        accountId: 'account-1',
        amount: 15000,
      });

      expect(result.allowed).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toContain('High-value transfer alert');
      expect(mockPrismaService.riskFlag.create).toHaveBeenCalled();
    });

    it('should block and flag transactions exceeding velocity limits (> 10 transfers/min)', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 12], // 12 transfers in current window (> 10 limit)
        [null, 1],
        [null, 1],
      ]);
      mockPrismaService.riskFlag.create.mockResolvedValue({
        ...mockRiskFlag,
        severity: 'CRITICAL',
        reason: 'Velocity limit exceeded',
      });

      const result = await service.evaluateTransaction({
        tenantId: 'tenant-1',
        accountId: 'account-1',
        amount: 100,
      });

      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toContain('Velocity limit exceeded');
      expect(mockPrismaService.riskFlag.create).toHaveBeenCalled();
    });
  });

  describe('getRiskFlags', () => {
    it('should return risk flags with total count', async () => {
      mockPrismaService.riskFlag.findMany.mockResolvedValue([mockRiskFlag]);
      mockPrismaService.riskFlag.count.mockResolvedValue(1);

      const result = await service.getRiskFlags('tenant-1', {
        status: 'OPEN',
        limit: 10,
        offset: 0,
      });

      expect(mockPrismaService.riskFlag.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', status: 'OPEN' },
        take: 10,
        skip: 0,
        orderBy: { createdAt: 'desc' },
        include: {
          account: {
            select: {
              id: true,
              type: true,
              currency: true,
            },
          },
        },
      });
      expect(result.data).toEqual([mockRiskFlag]);
      expect(result.total).toBe(1);
    });
  });

  describe('updateRiskFlagStatus', () => {
    it('should update flag status successfully', async () => {
      mockPrismaService.riskFlag.findFirst.mockResolvedValue(mockRiskFlag);
      mockPrismaService.riskFlag.update.mockResolvedValue({
        ...mockRiskFlag,
        status: 'RESOLVED',
      });

      const result = await service.updateRiskFlagStatus(
        'tenant-1',
        'risk-flag-1',
        'RESOLVED',
      );

      expect(mockPrismaService.riskFlag.findFirst).toHaveBeenCalledWith({
        where: { id: 'risk-flag-1', tenantId: 'tenant-1' },
      });
      expect(mockPrismaService.riskFlag.update).toHaveBeenCalledWith({
        where: { id: 'risk-flag-1' },
        data: { status: 'RESOLVED' },
      });
      expect(result.status).toBe('RESOLVED');
    });

    it('should throw NotFoundException if risk flag is missing', async () => {
      mockPrismaService.riskFlag.findFirst.mockResolvedValue(null);

      await expect(
        service.updateRiskFlagStatus('tenant-1', 'missing-id', 'RESOLVED'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
