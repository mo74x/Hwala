import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { WebhookDlqController } from './webhook-dlq.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('WebhookDlqController', () => {
  let controller: WebhookDlqController;
  let module: TestingModule;

  const mockPrismaService = {
    webhookFailure: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      controllers: [WebhookDlqController],
      providers: [
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: getQueueToken('webhook_queue'), useValue: mockQueue },
      ],
    }).compile();

    controller = module.get<WebhookDlqController>(WebhookDlqController);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getFailedWebhooks', () => {
    it('should return paginated list of failed webhooks', async () => {
      const mockFailures = [
        { id: 'dlq-1', tenantId: 'tenant-1', eventType: 'transfer.completed' },
      ];
      mockPrismaService.webhookFailure.findMany.mockResolvedValue(mockFailures);
      mockPrismaService.webhookFailure.count.mockResolvedValue(1);

      const result = await controller.getFailedWebhooks('tenant-1', '1', '10');

      expect(result).toEqual({
        data: mockFailures,
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      });
      expect(mockPrismaService.webhookFailure.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        skip: 0,
        take: 10,
        orderBy: { failedAt: 'desc' },
      });
    });
  });

  describe('retryFailedWebhook', () => {
    const validUuid = '11111111-1111-1111-1111-111111111111';

    it('should re-enqueue job to BullMQ and delete entry from WebhookFailure', async () => {
      const mockFailure = {
        id: validUuid,
        tenantId: 'tenant-1',
        eventType: 'transfer.completed',
        payload: { amount: 100 },
      };

      mockPrismaService.webhookFailure.findUnique.mockResolvedValue(
        mockFailure,
      );
      mockQueue.add.mockResolvedValue({});
      mockPrismaService.webhookFailure.delete.mockResolvedValue({});

      const result = await controller.retryFailedWebhook(validUuid);

      expect(result).toEqual({
        success: true,
        message: 'Webhook successfully re-queued for delivery',
        failureId: validUuid,
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'transfer.completed',
        { amount: 100 },
        expect.any(Object),
      );
      expect(mockPrismaService.webhookFailure.delete).toHaveBeenCalledWith({
        where: { id: validUuid },
      });
    });

    it('should throw NotFoundException if DLQ entry is not found', async () => {
      mockPrismaService.webhookFailure.findUnique.mockResolvedValue(null);

      await expect(controller.retryFailedWebhook(validUuid)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('dismissFailedWebhook', () => {
    const validUuid = '22222222-2222-2222-2222-222222222222';

    it('should remove entry from WebhookFailure', async () => {
      mockPrismaService.webhookFailure.findUnique.mockResolvedValue({
        id: validUuid,
      });
      mockPrismaService.webhookFailure.delete.mockResolvedValue({});

      const result = await controller.dismissFailedWebhook(validUuid);

      expect(result).toEqual({
        success: true,
        message: 'Failed webhook entry dismissed successfully',
        failureId: validUuid,
      });
      expect(mockPrismaService.webhookFailure.delete).toHaveBeenCalledWith({
        where: { id: validUuid },
      });
    });

    it('should throw NotFoundException if entry to dismiss does not exist', async () => {
      mockPrismaService.webhookFailure.findUnique.mockResolvedValue(null);

      await expect(controller.dismissFailedWebhook(validUuid)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
