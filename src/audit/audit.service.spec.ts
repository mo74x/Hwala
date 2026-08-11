import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('AuditService', () => {
  let service: AuditService;
  let module: TestingModule;

  const mockAuditLog = {
    id: 'audit-uuid-1',
    tenantId: 'tenant-uuid-1',
    userId: 'user-uuid-1',
    action: 'API_KEY_CREATED',
    targetId: 'key-uuid-1',
    metadata: { name: 'Test Key' },
    createdAt: new Date(),
  };

  const mockPrismaService = {
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
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

  describe('log', () => {
    it('should create an immutable audit log record', async () => {
      mockPrismaService.auditLog.create.mockResolvedValue(mockAuditLog);

      const result = await service.log({
        tenantId: 'tenant-uuid-1',
        userId: 'user-uuid-1',
        action: 'API_KEY_CREATED',
        targetId: 'key-uuid-1',
        metadata: { name: 'Test Key' },
      });

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-uuid-1',
          userId: 'user-uuid-1',
          action: 'API_KEY_CREATED',
          targetId: 'key-uuid-1',
          metadata: { name: 'Test Key' },
        },
      });
      expect(result).toEqual(mockAuditLog);
    });
  });

  describe('getAuditLogs', () => {
    it('should retrieve audit logs with pagination and total count', async () => {
      mockPrismaService.auditLog.findMany.mockResolvedValue([mockAuditLog]);
      mockPrismaService.auditLog.count.mockResolvedValue(1);

      const result = await service.getAuditLogs('tenant-uuid-1', {
        action: 'API_KEY_CREATED',
        limit: 10,
        offset: 0,
      });

      expect(mockPrismaService.auditLog.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-uuid-1', action: 'API_KEY_CREATED' },
        take: 10,
        skip: 0,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({
        data: [mockAuditLog],
        total: 1,
        limit: 10,
        offset: 0,
      });
    });
  });

  describe('getAuditLogById', () => {
    it('should return audit log when found', async () => {
      mockPrismaService.auditLog.findFirst.mockResolvedValue(mockAuditLog);

      const result = await service.getAuditLogById(
        'tenant-uuid-1',
        'audit-uuid-1',
      );

      expect(mockPrismaService.auditLog.findFirst).toHaveBeenCalledWith({
        where: { id: 'audit-uuid-1', tenantId: 'tenant-uuid-1' },
      });
      expect(result).toEqual(mockAuditLog);
    });

    it('should throw NotFoundException when log is not found', async () => {
      mockPrismaService.auditLog.findFirst.mockResolvedValue(null);

      await expect(
        service.getAuditLogById('tenant-uuid-1', 'non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
